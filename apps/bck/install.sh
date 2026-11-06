#!/usr/bin/env bash
#
# BCK Enterprise Backup — one-line installer / updater (Ubuntu)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/bck/install.sh | sudo bash
#
# Re-running the same command performs an UPDATE (binaries + web UI are
# replaced, configuration and backup data are preserved).
#
# Distribution model:
#   The BCK source repository is PRIVATE. This installer is served from the
#   public `dist` repository, together with the prebuilt release archives.
#   Releases live in `dist` under the tag pattern `bck-v<semver>`.
#
# Behavior:
#   1. Resolve the newest `bck-v*` release in the dist repository and download
#      its archive. If no release exists (or --from-source is passed), build
#      from source — that requires BCK_SOURCE_URL pointing at a git remote you
#      can access, since the source repo is private.
#   2. Install binaries, web UI and default config to BCK_HOME (/opt/bck).
#   3. Create systemd service.
#   4. Idempotent: safe to re-run, acts as an upgrade.
#
# Supply-chain:
#   - Release archives must include a matching .sha256 asset; missing or
#     mismatched checksums stop installation before any installed files change.
#   - Set DIST_REQUIRE_SIGNATURE=1 to require Sigstore verification with a
#     separately installed, trusted Cosign binary. Legacy releases may lack a bundle.
#
# Database recovery:
#   - Updates require a verified rollback snapshot. For external databases that
#     cannot be snapshotted here, set BCK_ALLOW_UNVERIFIED_DB_UPGRADE=1 only
#     after creating and verifying an independent backup.

set -euo pipefail

# ---------------------------------------------------------------- settings ---
REPO="ajjs1ajjs/dist"                     # public distribution repository
TAG_PREFIX="bck"                          # release tags are ${TAG_PREFIX}-v<semver>
SELF_PATH="apps/bck/install.sh"           # this script's path inside REPO
BCK_HOME="${BCK_HOME:-/opt/bck}"
BCK_USER="${BCK_USER:-bck}"
BCK_GROUP="${BCK_GROUP:-bck}"
BCK_DATA_DIR="${BCK_DATA_DIR:-/var/lib/bck}"
BCK_CONFIG_DIR="${BCK_CONFIG_DIR:-/etc/bck}"
BCK_PORT="${BCK_PORT:-9440}"
BCK_GRPC_PORT="${BCK_GRPC_PORT:-9441}"
BCK_GRPC_HOST="${BCK_GRPC_HOST:-127.0.0.1}"
BCK_IP="${BCK_IP:-auto}"
BCK_TLS_CERT="${BCK_TLS_CERT:-}"
BCK_TLS_KEY="${BCK_TLS_KEY:-}"
BCK_INTERACTIVE="${BCK_INTERACTIVE:-0}"
BCK_ENABLE_HTTPS=0
BCK_VERSION="${BCK_VERSION:-}"            # empty = newest bck-v* release
BCK_LOCAL_ARCHIVE="${BCK_LOCAL_ARCHIVE:-}" # optional operator-supplied archive + .sha256
MODE="release"                            # release | source

for arg in "$@"; do
    case "$arg" in
        --from-source) MODE="source" ;;
        --advanced) BCK_INTERACTIVE=1 ;;
        --enable-https) BCK_ENABLE_HTTPS=1 ;;
        --ip=*) BCK_IP="${arg#*=}" ;;
        --port=*) BCK_PORT="${arg#*=}" ;;
        --grpc-host=*) BCK_GRPC_HOST="${arg#*=}" ;;
        --grpc-port=*) BCK_GRPC_PORT="${arg#*=}" ;;
        --data-dir=*) BCK_DATA_DIR="${arg#*=}" ;;
        --tls-cert=*) BCK_TLS_CERT="${arg#*=}" ;;
        --tls-key=*) BCK_TLS_KEY="${arg#*=}" ;;
        *) printf 'Unknown option: %s\n' "$arg" >&2; exit 1 ;;
    esac
done

log()  { printf '\033[1;34m[BCK]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[BCK]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[BCK]\033[0m %s\n' "$*" >&2; exit 1; }

self_url() { echo "https://raw.githubusercontent.com/${REPO}/main/${SELF_PATH}"; }

check_ubuntu_version() {
    if [ ! -f /etc/os-release ]; then
        fail "Cannot determine OS version (/etc/os-release not found)."
    fi
    . /etc/os-release
    if [ "$ID" != "ubuntu" ]; then
        fail "This installer supports Ubuntu only. Detected: $ID"
    fi
    local ver="${VERSION_ID%%.*}"
    local supported="24 25 26"
    local is_supported=0
    for s in $supported; do
        if [ "$ver" = "$s" ]; then
            is_supported=1
            break
        fi
    done
    if [ "$is_supported" -eq 0 ]; then
        fail "Unsupported Ubuntu version: $VERSION_ID. Supported: Ubuntu 24, 25, 26 (latest and preview)."
    fi
    log "Detected $ID $VERSION_ID ($PRETTY_NAME) — supported."
}

OS_LOWER="linux"
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|amd64) ARCH_LOWER="x86_64" ;;
    aarch64|arm64) ARCH_LOWER="aarch64" ;;
    *) fail "Unsupported arch: $ARCH" ;;
esac

check_ubuntu_version

# Re-exec as root so system deps + /opt install + service registration work.
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        log "Not running as root — re-executing installer with sudo..."
        if [ -n "${BCK_INSTALL_REEXEC:-}" ]; then
            fail "sudo re-exec already attempted; install manually as root."
        fi
        # Download ourselves to a temp file (stdin may be a pipe) and re-run.
        SELF_URL="$(self_url)"
        TMP_SELF="$(mktemp)"
        if command -v curl >/dev/null 2>&1; then
            curl -fsSL "$SELF_URL" -o "$TMP_SELF"
        elif command -v wget >/dev/null 2>&1; then
            wget -q "$SELF_URL" -O "$TMP_SELF"
        else
            fail "Need curl or wget"
        fi
        exec sudo -E env BCK_INSTALL_REEXEC=1 bash "$TMP_SELF" "$@"
    else
        warn "Root privileges are required to install system dependencies and register the service."
        warn "Re-run as root:  curl -fsSL $(self_url) | sudo bash"
        exit 1
    fi
fi

# Install the small runtime prerequisites on minimal Ubuntu installations.
missing_runtime=()
for pair in python3:python3 openssl:openssl ip:iproute2 curl:curl; do
    command -v "${pair%%:*}" >/dev/null 2>&1 || missing_runtime+=("${pair#*:}")
done
if [ ${#missing_runtime[@]} -gt 0 ]; then
    apt-get update || fail "Could not update package metadata."
    DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing_runtime[@]}" || fail "Could not install runtime prerequisites."
fi
command -v systemctl >/dev/null 2>&1 || fail "A working systemd installation is required."
systemctl show --property=Version >/dev/null 2>&1 || fail "systemd is not running; install on a booted Ubuntu system."


for value in "$BCK_PORT" "$BCK_GRPC_PORT"; do
    [[ "$value" =~ ^[0-9]+$ ]] && [ "$value" -ge 1 ] && [ "$value" -le 65535 ] || fail "Invalid port: $value"
done
[ "$BCK_PORT" != "$BCK_GRPC_PORT" ] || fail "REST and gRPC require different ports."
for path in "$BCK_HOME" "$BCK_DATA_DIR" "$BCK_CONFIG_DIR"; do
    [[ "$path" =~ ^/[a-zA-Z0-9_./-]+$ && "$path" != / && "/$path/" != */../* ]] || fail "Use absolute non-root paths with letters, digits, dots, underscores, slashes or hyphens: $path"
done
[[ "$BCK_USER" =~ ^[a-z_][a-z0-9_-]*$ && "$BCK_GROUP" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "Invalid service account or group."
if [ "$BCK_IP" != auto ]; then
    python3 -c 'import ipaddress,sys; ip=ipaddress.IPv4Address(sys.argv[1]); sys.exit(ip.is_unspecified or ip.is_multicast or ip.is_loopback or ip.is_link_local)' "$BCK_IP" || fail "--ip must be a usable IPv4 address."
    python3 -c 'import json,subprocess,sys; data=json.loads(subprocess.check_output(["ip","-j","-4","address","show"],text=True)); sys.exit(not any(a.get("local")==sys.argv[1] for i in data if i.get("ifname") != "lo" for a in i.get("addr_info",[])))' "$BCK_IP" || fail "--ip must be assigned to a local network interface."
fi
if [ -n "$BCK_TLS_CERT" ] || [ -n "$BCK_TLS_KEY" ]; then
    [ -n "$BCK_TLS_CERT" ] && [ -n "$BCK_TLS_KEY" ] || fail "Provide both --tls-cert and --tls-key."
    [ -r "$BCK_TLS_CERT" ] && [ -r "$BCK_TLS_KEY" ] || fail "TLS certificate or key cannot be read."
    for path in "$BCK_TLS_CERT" "$BCK_TLS_KEY"; do
        [[ "$path" =~ ^/[a-zA-Z0-9_./-]+$ && "/$path/" != */../* ]] || fail "Invalid TLS path."
    done
fi
python3 -c 'import ipaddress,sys; ipaddress.ip_address(sys.argv[1])' "$BCK_GRPC_HOST" || fail "--grpc-host must be an IP address."

# ------------------------------------------------------------------ helpers ---
require() {
    command -v "$1" >/dev/null 2>&1 || fail "Required tool not found: $1"
}

managed_state_write() {
    local path="$1" value="$2" tmp
    [ ! -L "$path" ] || fail "Refusing symlinked TLS state: $path"
    if [ -e "$path" ]; then
        python3 - "$path" <<'PY' || fail "Unsafe TLS state ownership or permissions: $path"
import os, stat, sys
s = os.lstat(sys.argv[1])
if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
    raise SystemExit(1)
PY
    fi
    tmp="$(mktemp "$BCK_CONFIG_DIR/certs/.state.XXXXXX")"
    printf '%s\n' "$value" > "$tmp"
    chmod 0600 "$tmp"
    mv -f -- "$tmp" "$path"
}

# Install the Rust toolchain (rustup) when missing. Safe to run repeatedly.
# INFRA-001: sh.rustup.rs is fetched over pinned HTTPS+TLS1.2; integrity is
# checked via shebang + optional BCK_RUSTUP_SHA256 pin (set to enforce exact hash).
ensure_rust() {
    if command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1; then
        return 0
    fi
    log "Installing Rust toolchain (rustup) ..."
    if command -v curl >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o "$TMPDIR/rustup.sh"
        test -s "$TMPDIR/rustup.sh"
        # Verify rustup.sh is a shell script (starts with #!) and not an error page
        head -n1 "$TMPDIR/rustup.sh" | grep -q "^#!" || fail "rustup.sh download integrity check failed"
        if [ -n "${BCK_RUSTUP_SHA256:-}" ]; then
            echo "$BCK_RUSTUP_SHA256  $TMPDIR/rustup.sh" | sha256sum -c - || fail "rustup.sh SHA256 mismatch (BCK_RUSTUP_SHA256)"
            log "rustup.sh SHA256 verified"
        else
            warn "BCK_RUSTUP_SHA256 not set — skipping exact-hash pin (shebang check only)"
        fi
        sh "$TMPDIR/rustup.sh" -y --profile minimal --default-toolchain stable
    elif command -v wget >/dev/null 2>&1; then
        wget -q --secure-protocol=TLSv1_2 https://sh.rustup.rs -O "$TMPDIR/rustup.sh"
        test -s "$TMPDIR/rustup.sh"
        head -n1 "$TMPDIR/rustup.sh" | grep -q "^#!" || fail "rustup.sh download integrity check failed"
        if [ -n "${BCK_RUSTUP_SHA256:-}" ]; then
            echo "$BCK_RUSTUP_SHA256  $TMPDIR/rustup.sh" | sha256sum -c - || fail "rustup.sh SHA256 mismatch (BCK_RUSTUP_SHA256)"
            log "rustup.sh SHA256 verified"
        fi
        sh "$TMPDIR/rustup.sh" -y --profile minimal --default-toolchain stable
    else
        fail "Need curl or wget to install Rust"
    fi
    # Source the environment so `cargo` is on PATH for this session.
    # shellcheck disable=SC1091
    if [ -f "$HOME/.cargo/env" ]; then
        . "$HOME/.cargo/env"
    else
        export PATH="$HOME/.cargo/bin:$PATH"
    fi
    if ! command -v cargo >/dev/null 2>&1; then
        warn "Rust was installed but 'cargo' is not on PATH yet."
        warn "Open a new shell and re-run this installer, or run:"
        warn "  . \"\$HOME/.cargo/env\""
        warn "  curl -fsSL $(self_url) | bash"
        return 1
    fi
    log "Rust toolchain ready (cargo $(cargo --version | awk '{print $2}'))."
}

# Install build prerequisites (Ubuntu): C toolchain + OpenSSL + protoc + node.
ensure_build_deps() {
    # Only the packages that are actually missing get installed, so distro
    # repos that already provide node (e.g. nodesource) are never disturbed.
    local missing=""
    command -v cc >/dev/null 2>&1  || command -v gcc >/dev/null 2>&1 || missing="$missing build-essential"
    command -v cmake >/dev/null 2>&1 || missing="$missing cmake"
    command -v pkg-config >/dev/null 2>&1 || missing="$missing pkg-config"
    pkg-config --exists openssl 2>/dev/null || missing="$missing libssl-dev"
    pkg-config --exists libzstd 2>/dev/null || missing="$missing libzstd-dev"
    command -v protoc >/dev/null 2>&1 || missing="$missing protobuf-compiler"

    if [ -n "$missing" ]; then
        log "Installing build dependencies:$missing ..."
        if ! command -v apt-get >/dev/null 2>&1; then
            warn "apt-get not found — this installer requires Ubuntu."
            warn "Install the dependencies manually and re-run, e.g.:"
            warn "  sudo apt-get install -y build-essential cmake pkg-config libssl-dev libzstd-dev protobuf-compiler"
            return 1
        fi
        apt-get update -y >/dev/null 2>&1
        apt-get install -y $missing || {
            warn "Failed to install build dependencies automatically."
            warn "Install them manually and re-run:"
            warn "  sudo apt-get install -y build-essential cmake pkg-config libssl-dev libzstd-dev protobuf-compiler"
            return 1
        }
    fi

    # Node.js for the web console — best effort, never blocks the install.
    if ! command -v npm >/dev/null 2>&1; then
        log "Installing Node.js (for web console) ..."
        apt-get install -y nodejs npm >/dev/null 2>&1 || true
        command -v npm >/dev/null 2>&1 || warn "npm still not available — web console will be skipped (daemon/CLI/agent work)."
    fi

    # Give the shell the updated linker/cc path just in case.
    export CC="${CC:-cc}"
}

download() { # url -> local path
    local url="$1" out="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL --connect-timeout 20 --retry 3 "$url" -o "$out" || return 1
    elif command -v wget >/dev/null 2>&1; then
        wget -q --timeout=20 --tries=3 "$url" -O "$out" || return 1
    else
        fail "Need curl or wget"
    fi
    test -s "$out" || { warn "download failed or empty: $url"; return 1; }
    # Structural check: tar.gz must be listable, zip must be testable if applicable
    if [[ "$out" == *.tar.gz ]]; then
        tar -tzf "$out" >/dev/null 2>&1 || { warn "downloaded archive integrity check failed: $url"; return 1; }
    elif [[ "$out" == *.zip ]]; then
        unzip -t "$out" >/dev/null 2>&1 || { warn "downloaded zip integrity check failed: $url"; return 1; }
    fi
}

release_asset() { # URL and destination; explicit local archive is useful for offline staging.
    local url="$1" out="$2" source
    if [ -z "$BCK_LOCAL_ARCHIVE" ]; then
        download "$url" "$out"
        return
    fi
    case "$url" in
        *.sha256) source="${BCK_LOCAL_ARCHIVE}.sha256" ;;
        *.sigstore.json) source="${BCK_LOCAL_ARCHIVE}.sigstore.json" ;;
        *) source="$BCK_LOCAL_ARCHIVE" ;;
    esac
    [ -f "$source" ] && [ -s "$source" ] || return 1
    cp -- "$source" "$out"
}

# Newest `${TAG_PREFIX}-v*` release in the dist repository.
# Not /releases/latest: that endpoint is global to the repository and every app
# publishes here, so the newest release overall may belong to another app.
get_latest_release() {
    local page=1 count body tags candidate latest=''
    while [ "$page" -le 50 ]; do
        body="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}")" || return 1
        count="$(printf '%s' "$body" | grep -o '"tag_name"' | wc -l)"
        tags="$(printf '%s' "$body" | grep -o '"tag_name": *"[^"]*"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/' | grep -E "^${TAG_PREFIX}-v[0-9]+\\.[0-9]+\\.[0-9]+$" || true)"
        candidate="$(printf '%s\n' "$tags" | sort -V | tail -n1)"
        if [ -n "$candidate" ]; then latest="$(printf '%s\n%s\n' "$latest" "$candidate" | sort -V | tail -n1)"; fi
        [ "$count" -lt 100 ] && { printf '%s\n' "$latest"; return 0; }
        page=$((page + 1))
    done
    echo "ERROR: release listing exceeded 50 pages; refusing incomplete selection." >&2
    return 1
}

# --------------------------------------------------------------- download -----
BIN_NAMES=(bckd bck-agent bck bck-proxy)
TMPDIR="$(mktemp -d)"
BCK_STAGE_DIR=""
CONFIG_CANDIDATE=""
cleanup_installer() {
    local rc=$?
    rm -rf -- "$TMPDIR"
    if [ -n "$BCK_STAGE_DIR" ] && [ -d "$BCK_STAGE_DIR" ]; then
        rm -rf -- "$BCK_STAGE_DIR"
    fi
    if [ -n "$CONFIG_CANDIDATE" ] && [ -f "$CONFIG_CANDIDATE" ]; then
        rm -f -- "$CONFIG_CANDIDATE"
    fi
    return "$rc"
}
trap cleanup_installer EXIT

# Prebuilt archives are published for Ubuntu x86_64 only; other arches must
# build from source, which requires access to the private source repository.
if [ "$ARCH_LOWER" != "x86_64" ]; then
    if [ -z "${BCK_SOURCE_URL:-}" ]; then
        fail "No prebuilt archive for $ARCH_LOWER (releases publish x86_64 only) and the source repository is private.
  Use an x86_64 host, or build from source with BCK_SOURCE_URL set to a git remote you can access:
    BCK_SOURCE_URL=https://<user>:<token>@github.com/<owner>/<repo>.git curl -fsSL $(self_url) | sudo -E bash -s -- --from-source"
    fi
    log "No prebuilt archive for this arch — building from source."
    MODE="source"
fi

if [ "$MODE" = "release" ]; then
    if [ -n "$BCK_LOCAL_ARCHIVE" ]; then
        [ -n "$BCK_VERSION" ] || fail "Set BCK_VERSION when using BCK_LOCAL_ARCHIVE."
        [ "$(basename "$BCK_LOCAL_ARCHIVE")" = "bck-${OS_LOWER}-${ARCH_LOWER}.tar.gz" ] || fail "Local archive has an unexpected name."
    fi
    if [ -n "$BCK_VERSION" ]; then
        case "$BCK_VERSION" in
            "${TAG_PREFIX}-v"*) TAG="$BCK_VERSION" ;;
            v*) TAG="${TAG_PREFIX}-${BCK_VERSION}" ;;
            *) TAG="${TAG_PREFIX}-v${BCK_VERSION}" ;;
        esac
        [[ "$TAG" =~ ^${TAG_PREFIX}-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Invalid stable release tag: $TAG"
    else
        TAG="$(get_latest_release)"
    fi
    if [ -n "$TAG" ]; then
        log "Downloading release $TAG ($OS_LOWER/$ARCH_LOWER)"
        ARCHIVE="bck-${OS_LOWER}-${ARCH_LOWER}.tar.gz"
        URL="https://github.com/${REPO}/releases/download/${TAG}/${ARCHIVE}"
        if release_asset "$URL" "$TMPDIR/$ARCHIVE"; then
            # Fail closed: a root installer must never accept an unchecked archive.
            if release_asset "$URL.sha256" "$TMPDIR/$ARCHIVE.sha256" 2>/dev/null; then
                python3 - "$TMPDIR/$ARCHIVE" "$TMPDIR/$ARCHIVE.sha256" "$ARCHIVE" <<'PY' || fail "SHA256 verification failed for $ARCHIVE"
import hashlib, pathlib, re, sys
archive, checksum, name = sys.argv[1:]
contents = pathlib.Path(checksum).read_text(encoding='ascii')
match = re.fullmatch(r'([a-fA-F0-9]{64})[ \t]+\*?' + re.escape(name) + r'\r?\n?', contents)
if not match:
    raise SystemExit('Invalid checksum file format')
with open(archive, 'rb') as handle:
    actual = hashlib.file_digest(handle, 'sha256').hexdigest()
if actual != match.group(1).lower():
    raise SystemExit('Checksum mismatch')
PY
                log "SHA256 verified for $ARCHIVE"
            else
                fail "No .sha256 checksum asset for $ARCHIVE; refusing to install an unverified release."
            fi
            # Fail closed when the operator opts in during signed-release rollout.
            if [ "${DIST_REQUIRE_SIGNATURE:-0}" = "1" ]; then
                command -v cosign >/dev/null 2>&1 || fail "cosign is required for signature verification."
                release_asset "$URL.sigstore.json" "$TMPDIR/$ARCHIVE.sigstore.json" || fail "Sigstore signature bundle unavailable."
                cosign verify-blob --bundle "$TMPDIR/$ARCHIVE.sigstore.json" \
                    --certificate-identity "https://github.com/ajjs1ajjs/BCK/.github/workflows/release.yml@refs/heads/main" \
                    --certificate-oidc-issuer https://token.actions.githubusercontent.com "$TMPDIR/$ARCHIVE" || fail "Sigstore signature verification failed."
                log "Sigstore signature verified"
            fi
            tar -xzf "$TMPDIR/$ARCHIVE" -C "$TMPDIR"
            SRC_DIR="$TMPDIR"
            log "Release binaries staged."
        else
            warn "Release download failed ($ARCHIVE)."
            if [ -n "${BCK_SOURCE_URL:-}" ]; then
                warn "Falling back to a source build."
                MODE="source"
            else
                fail "Release download failed and no source URL provided (the source repository is private).
  Check that $TAG exists in $REPO and publishes $ARCHIVE."
            fi
        fi
    else
        warn "No ${TAG_PREFIX}-v* release found in $REPO."
        if [ -n "${BCK_SOURCE_URL:-}" ]; then
            warn "Falling back to a source build."
            MODE="source"
        else
            fail "No release available yet and no source URL provided (the source repository is private)."
        fi
    fi
fi

if [ "$MODE" = "source" ]; then
    [ -n "${BCK_SOURCE_URL:-}" ] || fail "Source build requested but BCK_SOURCE_URL is not set (the source repository is private)."
    log "Building from source (this requires Rust + a C toolchain)..."
    if ! ensure_rust; then
        fail "Rust toolchain could not be prepared. Install it manually (see message above), then re-run this installer."
    fi
    if ! ensure_build_deps; then
        fail "System build dependencies are required. Install them and re-run."
    fi
    require git
    if [ -d "$TMPDIR/BCK/.git" ]; then
        (cd "$TMPDIR/BCK" && git fetch --depth 1 origin main && git reset --hard origin/main) || true
    else
        git clone --depth 1 --branch main "$BCK_SOURCE_URL" "$TMPDIR/BCK"
    fi
    cd "$TMPDIR/BCK"

    # Sanity check: a couple of files that must exist for a valid checkout.
    if [ ! -f "core/src/db/hypervisor.rs" ] || [ ! -f "core/src/api/grpc.rs" ]; then
        fail "Source checkout looks incomplete (missing files). Re-run the installer."
    fi

    log "Compiling release binaries (this takes several minutes)..."
    if ! cargo build --release --workspace --bins; then
        warn "Cargo build failed. Re-run the installer to retry (it will reuse cached artifacts)."
        exit 1
    fi
    SRC_DIR="$TMPDIR/BCK"
    # Collect binaries
    mkdir -p "$TMPDIR/bin"
    for b in "${BIN_NAMES[@]}"; do
        [ -f "target/release/$b" ] && cp "target/release/$b" "$TMPDIR/bin/" || warn "missing binary: $b"
    done
    install -m 0755 scripts/bck-network-tls.py "$TMPDIR/bin/bck-network-tls"
    # Build web UI if node is available
    if [ -d web-ui ] && command -v npm >/dev/null 2>&1; then
        log "Building web UI..."
        (cd web-ui && npm ci --silent && npm run build)
        mkdir -p "$TMPDIR/web-ui"
        cp -r web-ui/dist "$TMPDIR/web-ui/"
    elif [ -d web-ui ]; then
        warn "npm not found — skipping web UI build. Install Node.js (nodejs + npm) for the web console."
    fi
fi

# Verify binaries exist in SRC_DIR (either release archive or source build).
if [ "$MODE" = "release" ]; then
    # Release archives contain bin/ at the top level.
    if [ -d "$SRC_DIR/bin" ]; then
        BIN_DIR="$SRC_DIR/bin"
    else
        BIN_DIR="$SRC_DIR"
    fi
else
    BIN_DIR="$TMPDIR/bin"
fi
for b in "${BIN_NAMES[@]}"; do
    [ -f "$BIN_DIR/$b" ] || fail "Required binary is missing from the release: $b"
done
[ -f "$BIN_DIR/bck-network-tls" ] || fail "This release does not include the HTTPS setup helper. Install a BCK release with managed TLS support."

# ------------------------------------------------------------- install ---------
log "Installing to $BCK_HOME ..."
if [ "$(id -u)" -eq 0 ]; then
    if ! getent group "$BCK_GROUP" >/dev/null; then
        groupadd --system "$BCK_GROUP" || fail "Could not create the BCK service group."
    fi
    if ! id -u "$BCK_USER" >/dev/null 2>&1; then
        useradd --system --gid "$BCK_GROUP" --home-dir "$BCK_HOME" --shell /sbin/nologin "$BCK_USER" 2>/dev/null \
            || fail "Could not create the BCK service user."
    fi
fi
getent group "$BCK_GROUP" >/dev/null || fail "Service group does not exist: $BCK_GROUP"

# The root-run refresh helper and systemd unit must never be located beneath
# an attacker-writable or symlinked parent.
python3 - "$BCK_HOME" "$(dirname "$BCK_CONFIG_DIR")" <<'PY' || fail "Unsafe BCK installation or configuration parent path."
import os, stat, sys
for value in sys.argv[1:]:
    path = os.path.abspath(value)
    while not os.path.lexists(path):
        path = os.path.dirname(path)
    while True:
        info = os.lstat(path)
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise SystemExit(f"unsafe privileged path: {path}")
        parent = os.path.dirname(path)
        if parent == path: break
        path = parent
PY

mkdir -p "$BCK_HOME/releases"
chmod 0755 "$BCK_HOME/releases"
mkdir -p "$BCK_CONFIG_DIR"
[ ! -L "$BCK_CONFIG_DIR" ] || fail "Config directory must not be a symlink."
chown root:"$BCK_GROUP" "$BCK_CONFIG_DIR"
chmod 0750 "$BCK_CONFIG_DIR"
if [ ! -d "$BCK_DATA_DIR" ]; then
    install -d -o "$BCK_USER" -g "$BCK_GROUP" -m 0750 "$BCK_DATA_DIR"
fi
if [ ! -d "$BCK_DATA_DIR/restore" ]; then
    install -d -o "$BCK_USER" -g "$BCK_GROUP" -m 0750 "$BCK_DATA_DIR/restore"
fi
RELEASE_ID="${TAG:-source-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
[[ "$RELEASE_ID" =~ ^[A-Za-z0-9._-]+$ ]] || fail "Unsafe release identifier: $RELEASE_ID"
RELEASE_DIR="$BCK_HOME/releases/$RELEASE_ID"
BCK_STAGE_DIR="$(mktemp -d "$BCK_HOME/releases/.stage-${RELEASE_ID}.XXXXXX")"
mkdir -p "$BCK_STAGE_DIR/bin"

# Prepare and verify every artifact away from the live path. A failed copy,
# checksum, disk write, or permission operation must leave the current release
# usable and internally consistent.
for b in "${BIN_NAMES[@]}"; do
    install -m 0755 "$BIN_DIR/$b" "$BCK_STAGE_DIR/bin/$b"
    [ -s "$BCK_STAGE_DIR/bin/$b" ] && [ -x "$BCK_STAGE_DIR/bin/$b" ] \
        || fail "Staged binary is missing or not executable: $b"
done
install -m 0755 "$BIN_DIR/bck-network-tls" "$BCK_STAGE_DIR/bin/bck-network-tls"
if [ -d "$SRC_DIR/web-ui" ]; then
    mkdir -p "$BCK_STAGE_DIR/web-ui"
    cp -a "$SRC_DIR/web-ui/." "$BCK_STAGE_DIR/web-ui/"
elif [ -d "$TMPDIR/web-ui" ]; then
    mkdir -p "$BCK_STAGE_DIR/web-ui"
    cp -a "$TMPDIR/web-ui/." "$BCK_STAGE_DIR/web-ui/"
elif [ -d "$BCK_HOME/current/web-ui" ]; then
    mkdir -p "$BCK_STAGE_DIR/web-ui"
    cp -a "$BCK_HOME/current/web-ui/." "$BCK_STAGE_DIR/web-ui/"
elif [ -d "$BCK_HOME/web-ui" ] && [ ! -L "$BCK_HOME/web-ui" ]; then
    mkdir -p "$BCK_STAGE_DIR/web-ui"
    cp -a "$BCK_HOME/web-ui/." "$BCK_STAGE_DIR/web-ui/"
fi

if [ -e "$RELEASE_DIR" ]; then
    if ! diff -qr "$BCK_STAGE_DIR" "$RELEASE_DIR" >/dev/null 2>&1; then
        fail "Release directory already exists with different contents: $RELEASE_DIR"
    fi
    rm -rf -- "$BCK_STAGE_DIR"
    BCK_STAGE_DIR=""
else
    mv "$BCK_STAGE_DIR" "$RELEASE_DIR"
    BCK_STAGE_DIR=""
fi
chmod 0755 "$RELEASE_DIR" "$RELEASE_DIR/bin"

# Migrate a pre-versioned installation into an immutable legacy release before
# replacing its compatibility paths. The daemon keeps using the same files
# until the single `current` symlink is switched near service restart.
if [ -e "$BCK_HOME/current" ] && [ ! -L "$BCK_HOME/current" ]; then
    fail "Refusing to replace non-symlink current path: $BCK_HOME/current"
fi
if [ -L "$BCK_HOME/current" ]; then
    CURRENT_RELATIVE="$(readlink "$BCK_HOME/current")"
    if [[ "$CURRENT_RELATIVE" =~ ^releases/[A-Za-z0-9._-]+$ ]]; then
        [ -d "$BCK_HOME/$CURRENT_RELATIVE" ] || fail "Current release target is missing: $CURRENT_RELATIVE"
    else
        fail "Current release points outside the managed releases directory: $CURRENT_RELATIVE"
    fi
    CURRENT_TARGET="$BCK_HOME/$CURRENT_RELATIVE"
else
    CURRENT_TARGET=""
    if [ -d "$BCK_HOME/bin" ] || [ -d "$BCK_HOME/web-ui" ]; then
        LEGACY_ID="legacy-$(date -u +%Y%m%dT%H%M%SZ)-$$"
        LEGACY_STAGE="$(mktemp -d "$BCK_HOME/releases/.stage-${LEGACY_ID}.XXXXXX")"
        BCK_STAGE_DIR="$LEGACY_STAGE"
        if [ -d "$BCK_HOME/bin" ]; then
            mkdir -p "$LEGACY_STAGE/bin"
            cp -a "$BCK_HOME/bin/." "$LEGACY_STAGE/bin/"
        fi
        if [ -d "$BCK_HOME/web-ui" ]; then
            mkdir -p "$LEGACY_STAGE/web-ui"
            cp -a "$BCK_HOME/web-ui/." "$LEGACY_STAGE/web-ui/"
        fi
        mv "$LEGACY_STAGE" "$BCK_HOME/releases/$LEGACY_ID"
        BCK_STAGE_DIR=""
        chmod 0755 "$BCK_HOME/releases/$LEGACY_ID" "$BCK_HOME/releases/$LEGACY_ID/bin"
        ln -s "releases/$LEGACY_ID" "$BCK_HOME/.current-legacy.$$"
        mv -Tf "$BCK_HOME/.current-legacy.$$" "$BCK_HOME/current"
        CURRENT_TARGET="$BCK_HOME/releases/$LEGACY_ID"
    fi
fi

for compat in bin web-ui; do
    compat_path="$BCK_HOME/$compat"
    if [ -L "$compat_path" ]; then
        [ "$(readlink "$compat_path")" = "current/$compat" ] \
            || fail "Refusing to replace unexpected compatibility symlink: $compat_path"
        continue
    fi
    if [ -e "$compat_path" ]; then
        [ -d "$compat_path" ] || fail "Unexpected non-directory at $compat_path"
        mv "$compat_path" "$BCK_HOME/.legacy-${compat}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    fi
    ln -s "current/$compat" "$BCK_HOME/.${compat}-link.$$"
    mv -Tf "$BCK_HOME/.${compat}-link.$$" "$compat_path"
done

# Config is created only on first install; updates never rewrite it.
CONFIG="$BCK_CONFIG_DIR/config.toml"
[ ! -L "$CONFIG" ] || fail "Refusing a symlinked config file; use a regular config file for safe upgrade and rollback."
PREVIOUS_RELEASE_RELATIVE="${CURRENT_RELATIVE:-}"
UPDATE_EXISTING=0
if [ -n "$PREVIOUS_RELEASE_RELATIVE" ] || [ -d "$BCK_HOME/bin" ] || [ -d "$BCK_HOME/web-ui" ]; then
    UPDATE_EXISTING=1
fi
ROLLBACK_ID="preupgrade-$(date -u +%Y%m%dT%H%M%SZ)-$$"
ROLLBACK_DIR="$BCK_HOME/rollback/$ROLLBACK_ID"
CONFIG_EXISTED=0
MANAGED_TLS_IP="$BCK_IP"
if [ ! -f "$CONFIG" ]; then
    DETECTED_IP="$(python3 "$RELEASE_DIR/bin/bck-network-tls" --detect-ip)"
    [ "$BCK_IP" = auto ] || DETECTED_IP="$BCK_IP"
    SERVER_HOST="0.0.0.0"
    [ "$DETECTED_IP" != "127.0.0.1" ] || SERVER_HOST="127.0.0.1"
    if [ -z "$BCK_TLS_CERT" ]; then
        BCK_TLS_CERT="$BCK_CONFIG_DIR/certs/current/server.crt"
        BCK_TLS_KEY="$BCK_CONFIG_DIR/certs/current/server.key"
        [ ! -L "$BCK_CONFIG_DIR/certs" ] || fail "Certificate directory must not be a symlink."
        install -d -o root -g "$BCK_GROUP" -m 0750 "$BCK_CONFIG_DIR/certs"
        for file in current .bck-managed managed-ip .managed-config-sha256; do
            [ ! -e "$BCK_CONFIG_DIR/certs/$file" ] && [ ! -L "$BCK_CONFIG_DIR/certs/$file" ] || fail "Existing certificate state is not managed by this installation; use --tls-cert and --tls-key."
        done
        (umask 077; set -o noclobber; : > "$BCK_CONFIG_DIR/certs/.bck-managed") || fail "Could not create TLS ownership marker."
        managed_state_write "$BCK_CONFIG_DIR/certs/managed-ip" "$MANAGED_TLS_IP"
    fi
    umask 077
    cat > "$CONFIG" <<EOF
# File-level restores are restricted to this directory.
restore_root = "${BCK_DATA_DIR}/restore"

[server]
# REST/Web UI and gRPC listeners. Set grpc_host to a reachable address for remote gRPC agents.
host = "${SERVER_HOST}"
port = ${BCK_PORT}
grpc_host = "${BCK_GRPC_HOST}"
grpc_port = ${BCK_GRPC_PORT}
web_ui_dir = "${BCK_HOME}/current/web-ui/dist"
tls_cert = "${BCK_TLS_CERT}"
tls_key = "${BCK_TLS_KEY}"
# allowed_origins = ["https://backup.example.com"]

[database]
url = "sqlite://${BCK_DATA_DIR}/bck.db?mode=rwc"
pool_size = 10
migrate = true

[storage]
default_path = "${BCK_DATA_DIR}/backups"
temp_path = "${BCK_DATA_DIR}/tmp"

[encryption]
# Use a separately protected passphrase or KMS and back up the key independently.
algorithm = "aes-256-gcm"

[logging]
level = "info"
json = false
EOF
    if [ "$BCK_IP" = auto ] && [ -f "$BCK_CONFIG_DIR/certs/.bck-managed" ]; then
        managed_state_write "$BCK_CONFIG_DIR/certs/.managed-config-sha256" "$(sha256sum "$CONFIG" | cut -d ' ' -f 1)"
    fi
    log "Created default config at $CONFIG"
else
    CONFIG_EXISTED=1
    log "Config exists — preserving it."
    install -d -m 0700 "$ROLLBACK_DIR"
    cp -p "$CONFIG" "$ROLLBACK_DIR/config.toml"
    [ ! -L "$BCK_CONFIG_DIR/certs" ] || fail "Certificate directory must not be a symlink."
    [ ! -L "$BCK_CONFIG_DIR/certs/managed-ip" ] || fail "Refusing symlinked managed IP state."
    if [ -f "$BCK_CONFIG_DIR/certs/managed-ip" ]; then
        python3 - "$BCK_CONFIG_DIR/certs/managed-ip" <<'PY' || fail "Unsafe managed IP state."
import os, stat, sys
s = os.lstat(sys.argv[1])
if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
    raise SystemExit(1)
PY
        MANAGED_TLS_IP="$(cat "$BCK_CONFIG_DIR/certs/managed-ip")"
    fi
fi
if [ "$MANAGED_TLS_IP" != auto ]; then
    python3 -c 'import ipaddress,sys; ip=ipaddress.IPv4Address(sys.argv[1]); sys.exit(ip.is_unspecified or ip.is_multicast or ip.is_loopback or ip.is_link_local)' "$MANAGED_TLS_IP" || fail "Invalid managed TLS IP setting."
fi
# Symlink binaries into PATH
mkdir -p /usr/local/bin
for b in "${BIN_NAMES[@]}"; do
    [ -f "$RELEASE_DIR/bin/$b" ] && ln -sf "$BCK_HOME/bin/$b" "/usr/local/bin/$b"
done

# Ownership (ignore failures on non-root / weird mounts)
chown -R root:root "$RELEASE_DIR"
chown root:root "$BCK_HOME" "$BCK_HOME/releases"
chmod 0755 "$BCK_HOME"
chown root:"$BCK_GROUP" "$BCK_CONFIG_DIR"
chmod 0750 "$BCK_CONFIG_DIR"
python3 - "$BCK_HOME" "$BCK_CONFIG_DIR" <<'PY' || fail "BCK home and config paths must have root-owned, non-writable, non-symlink ancestors."
import os, stat, sys
for value in sys.argv[1:]:
    path = os.path.abspath(value)
    while True:
        info = os.lstat(path)
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise SystemExit(f"unsafe privileged path: {path}")
        parent = os.path.dirname(path)
        if parent == path: break
        path = parent
PY
if [ "$CONFIG_EXISTED" = 0 ]; then
    chown root:"$BCK_GROUP" "$CONFIG"
    chmod 0640 "$CONFIG"
fi
install -d -o "$BCK_USER" -g "$BCK_GROUP" -m 0750 "$BCK_HOME/.config"
install -d -o "$BCK_USER" -g "$BCK_GROUP" -m 0750 "$BCK_HOME/.config/bck"

# Opt-in migration for the legacy loopback-only default. Keep the original
# config in place until the candidate has been validated and the service has
# stopped with a verified database/index snapshot.
CONFIG_FOR_VALIDATION="$CONFIG"
if [ "$CONFIG_EXISTED" = 1 ] && [ "$BCK_ENABLE_HTTPS" = 1 ]; then
    DETECTED_IP="$(python3 "$RELEASE_DIR/bin/bck-network-tls" --detect-ip)"
    [ "$BCK_IP" = auto ] || DETECTED_IP="$BCK_IP"
    SERVER_HOST="0.0.0.0"
    [ "$DETECTED_IP" != "127.0.0.1" ] || SERVER_HOST="127.0.0.1"
    MIGRATION_MANAGED=0
    if [ -z "$BCK_TLS_CERT" ]; then
        MIGRATION_MANAGED=1
        BCK_TLS_CERT="$BCK_CONFIG_DIR/certs/current/server.crt"
        BCK_TLS_KEY="$BCK_CONFIG_DIR/certs/current/server.key"
    fi
    CONFIG_CANDIDATE="$(mktemp "${CONFIG}.https-candidate.XXXXXX")"
    python3 - "$CONFIG" "$CONFIG_CANDIDATE" "$SERVER_HOST" "$BCK_TLS_CERT" "$BCK_TLS_KEY" <<'PY' || fail "HTTPS migration requires a legacy loopback config without TLS; the original config is unchanged."
import json, re, sys, tomllib
source, dest, host, cert, key = sys.argv[1:]
with open(source, 'rb') as f: config = tomllib.load(f)
server = config['server']
if server.get('host') != '127.0.0.1' or server.get('tls_cert') or server.get('tls_key'):
    raise SystemExit('Not a legacy loopback-only, TLS-free configuration')
lines = open(source, encoding='utf-8').read().splitlines(keepends=True)
start = next((i for i, line in enumerate(lines) if re.fullmatch(r'\s*\[server\]\s*(?:#.*)?\n?', line)), None)
if start is None: raise SystemExit('Missing server section')
end = next((i for i in range(start + 1, len(lines)) if re.match(r'^\s*\[', lines[i])), len(lines))
hosts = [i for i in range(start + 1, end) if re.match(r'^\s*host\s*=', lines[i])]
if len(hosts) != 1: raise SystemExit('Ambiguous host setting')
i = hosts[0]
lines[i] = 'host = ' + json.dumps(host) + '\n'
extra = ['tls_cert = ' + json.dumps(cert) + '\n', 'tls_key = ' + json.dumps(key) + '\n']
if 'grpc_host' not in server: extra.append('grpc_host = "127.0.0.1"\n')
lines[i+1:i+1] = extra
result = ''.join(lines)
tomllib.loads(result)
with open(dest, 'w', encoding='utf-8', newline='\n') as f:
    f.write(result)
    f.flush()
    import os
    os.fsync(f.fileno())
PY
    chown root:"$BCK_GROUP" "$CONFIG_CANDIDATE"
    chmod 0640 "$CONFIG_CANDIDATE"
    if [ "$MIGRATION_MANAGED" = 1 ]; then
        [ ! -L "$BCK_CONFIG_DIR/certs" ] || fail "Managed certificate directory must not be a symlink."
        install -d -o root -g "$BCK_GROUP" -m 0750 "$BCK_CONFIG_DIR/certs"
        if [ ! -f "$BCK_CONFIG_DIR/certs/.bck-managed" ]; then
            for file in current .bck-managed managed-ip .managed-config-sha256; do
                [ ! -e "$BCK_CONFIG_DIR/certs/$file" ] && [ ! -L "$BCK_CONFIG_DIR/certs/$file" ] || fail "Existing certificates are not managed; pass --tls-cert and --tls-key."
            done
            (umask 077; set -o noclobber; : > "$BCK_CONFIG_DIR/certs/.bck-managed") || fail "Could not create TLS ownership marker."
        fi
        python3 - "$BCK_CONFIG_DIR/certs/.bck-managed" <<'PY' || fail "Unsafe managed TLS ownership marker."
import os, stat, sys
s = os.lstat(sys.argv[1])
if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
    raise SystemExit(1)
PY
        managed_state_write "$BCK_CONFIG_DIR/certs/managed-ip" "$MANAGED_TLS_IP"
        if [ "$MANAGED_TLS_IP" = auto ]; then
            managed_state_write "$BCK_CONFIG_DIR/certs/.managed-config-sha256" "$(sha256sum "$CONFIG_CANDIDATE" | cut -d ' ' -f 1)"
        fi
        python3 "$RELEASE_DIR/bin/bck-network-tls" --config "$CONFIG_CANDIDATE" --cert-dir "$BCK_CONFIG_DIR/certs" --group "$BCK_GROUP" --ip "$MANAGED_TLS_IP" \
            || fail "Could not prepare the managed TLS certificate; the original config is unchanged."
    fi
    CONFIG_FOR_VALIDATION="$CONFIG_CANDIDATE"
fi

# --- License preflight --------------------------------------------------------
# bckd starts without a license (it only warns), but CLI operations are blocked
# and the console shows "no license". Offer the key right here — `curl | sudo bash`
# keeps the script itself on stdin, so prompts read from /dev/tty.
# Unattended runs: BCK_LICENSE_KEY=<key>.
BCK_LICENSE_FILE="$BCK_HOME/.config/bck/license.json"
bck_lic_valid() {
    [ -s "$BCK_LICENSE_FILE" ] || return 1
    local exp epoch now
    exp="$(sed -n 's/.*"expires_at"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BCK_LICENSE_FILE" | head -n 1)"
    [ -n "$exp" ] || return 1
    epoch="$(date -u -d "$exp" +%s 2>/dev/null)" || return 1
    now="$(date -u +%s)"
    [ "$epoch" -gt "$now" ]
}
# `bck license` prints activation errors but exits 0 even when it fails, so the
# result is confirmed by re-reading the license file.
bck_lic_activate() {
    [ -n "${1:-}" ] || return 1
    sudo -u "$BCK_USER" env HOME="$BCK_HOME" "$RELEASE_DIR/bin/bck" license activate --key "$1" >/dev/null 2>&1
    [ ! -f "$BCK_LICENSE_FILE" ] || chmod 0600 "$BCK_LICENSE_FILE"
    bck_lic_valid
}

# The CLI's own hints say `bck license ...` — make that work: point root's
# config dir at the service user's (root runs with HOME=/root; without the link
# `sudo bck license activate` would write a license bckd never reads).
SVC_CFG_DIR="$BCK_HOME/.config/bck"
mkdir -p "$SVC_CFG_DIR"
if [ ! -e /root/.config/bck ] && [ ! -L /root/.config/bck ]; then
    mkdir -p /root/.config
    ln -s "$SVC_CFG_DIR" /root/.config/bck
elif [ -d /root/.config/bck ] && [ ! -L /root/.config/bck ] \
     && [ -s /root/.config/bck/license.json ] && [ ! -s "$SVC_CFG_DIR/license.json" ]; then
    # A license was once activated as root: migrate it where bckd looks.
    cp /root/.config/bck/license.json "$SVC_CFG_DIR/license.json"
fi
chown -R "$BCK_USER:$BCK_GROUP" "$BCK_HOME/.config" 2>/dev/null || true
chmod 0700 "$BCK_HOME/.config/bck"
if [ -f "$SVC_CFG_DIR/license.json" ]; then chmod 0600 "$SVC_CFG_DIR/license.json"; fi

BCK_LICENSE_OK=0
if bck_lic_valid; then
    BCK_LICENSE_OK=1
    log "Ліцензія: активна."
elif [ -n "${BCK_LICENSE_KEY:-}" ]; then
    log "Активація ліцензії з BCK_LICENSE_KEY..."
    if bck_lic_activate "$BCK_LICENSE_KEY"; then BCK_LICENSE_OK=1; fi
elif [ "$BCK_INTERACTIVE" = 1 ] && { true </dev/tty; } 2>/dev/null; then
    echo ""
    echo "======================================================="
    echo "  ЛІЦЕНЗІЯ BCK Enterprise не активована."
    echo "  bckd запуститься, але без ліцензії CLI-операції"
    echo "  заблоковані. Активуйте зараз — це займе кілька секунд."
    echo "======================================================="
    while [ "$BCK_LICENSE_OK" != "1" ]; do
        echo ""
        echo "  1) Ввести ліцензійний ключ (AK-…)"
        echo "  2) Пропустити"
        printf '  Ваш вибір [1/2]: '
        LIC_CHOICE=""
        read -r LIC_CHOICE </dev/tty || LIC_CHOICE=""
        case "$LIC_CHOICE" in
            1)
                printf '  Ліцензійний ключ: '
                LIC_KEY=""
                read -rs LIC_KEY </dev/tty || LIC_KEY=""
                printf '\n'
                if bck_lic_activate "$LIC_KEY"; then
                    BCK_LICENSE_OK=1
                else
                    echo "  [x] Активувати не вдалося — перевірте ключ і мережу та спробуйте ще раз."
                fi
                ;;
            2|"")
                break
                ;;
            *)
                echo "  Введіть 1 або 2."
                ;;
        esac
    done
fi
if [ "$BCK_LICENSE_OK" != "1" ]; then
    warn "Ліцензію не активовано — bckd працюватиме, але CLI-операції заблоковані."
    warn "Активуйте пізніше: sudo bck license activate --key <key>"
fi

# Validate the candidate configuration and certificate as the service account
# before stopping a working daemon or switching the release pointer.
if [ -f "$BCK_CONFIG_DIR/certs/.bck-managed" ]; then
    python3 "$RELEASE_DIR/bin/bck-network-tls" --config "$CONFIG_FOR_VALIDATION" --cert-dir "$BCK_CONFIG_DIR/certs" --group "$BCK_GROUP" --ip "$MANAGED_TLS_IP" \
        || fail "Could not prepare the managed TLS certificate."
fi
runuser -u "$BCK_USER" -g "$BCK_GROUP" -- "$RELEASE_DIR/bin/bckd" -c "$CONFIG_FOR_VALIDATION" --check-config \
    || fail "Configuration validation failed; the running service was not restarted."

# A SQLite snapshot lets the installer restore the database if the new daemon
# fails after running migrations. External databases are left for their own
# backup/restore tooling; without a verified snapshot we keep the previous
# release available but never point an old binary at a potentially migrated DB.
DB_BACKUP_READY=0
DB_BACKUP_KIND=""
DB_PATH=""
DB_EXISTED=0
INDEX_PATH=""
INDEX_EXISTED=0
snapshot_sqlite_for_rollback() {
    [ "$UPDATE_EXISTING" = "1" ] || return 0
    if ! command -v python3 >/dev/null 2>&1; then
        warn "python3 is unavailable; database rollback snapshot was not created."
        return 0
    fi
    local db_info
    db_info="$(python3 - "$CONFIG" <<'PY'
import os, sys, tomllib
from urllib.parse import unquote

try:
    with open(sys.argv[1], "rb") as stream:
        url = tomllib.load(stream).get("database", {}).get("url", "")
except Exception:
    print("unknown")
    raise SystemExit(0)

if url.startswith("sqlite://"):
    path = unquote(url[9:].split("?", 1)[0])
    if path in ("", ":memory:"):
        print("memory")
    else:
        if not os.path.isabs(path):
            path = os.path.abspath(os.path.join("/", path))
        print("sqlite\t" + path)
elif url.startswith(("postgres://", "postgresql://")):
    print("external")
else:
    print("unknown")
PY
)" || return 0
    case "$db_info" in
        memory)
            warn "In-memory metadata databases cannot be snapshotted for rollback."
            return 0
            ;;
        external)
            warn "External database detected; automatic DB restore is disabled. The previous release will be retained."
            return 0
            ;;
        unknown)
            warn "Database URL could not be classified; automatic DB restore is disabled."
            return 0
            ;;
        sqlite$'\t'*)
            DB_PATH="${db_info#*$'\t'}"
            ;;
        *)
            warn "Database URL could not be classified; automatic DB restore is disabled."
            return 0
            ;;
    esac
    case "$DB_PATH" in
        /*) ;;
        *) warn "SQLite path is not absolute; automatic DB restore is disabled."; return 0 ;;
    esac
    INDEX_PATH="$(python3 - "$CONFIG" <<'PY'
import os, sys, tomllib
with open(sys.argv[1], 'rb') as f:
    storage = tomllib.load(f)['storage']['default_path']
print(os.path.abspath(os.path.join('/', storage, 'index.db')))
PY
)" || return 0
    if [ -z "$INDEX_PATH" ] || [ "$INDEX_PATH" = "$DB_PATH" ]; then
        warn "Invalid block index path; automatic rollback is disabled."
        return 0
    fi
    DB_BACKUP_KIND="sqlite"
    install -d -m 0700 "$ROLLBACK_DIR/db"
    local suffix source backup_name kind base
    [ ! -f "$DB_PATH" ] || DB_EXISTED=1
    [ ! -f "$INDEX_PATH" ] || INDEX_EXISTED=1
    if [ "$DB_EXISTED" != 1 ] || [ "$INDEX_EXISTED" != 1 ]; then
        warn "Metadata database or block index is missing; refusing an unverified automatic rollback."
        return 0
    fi
    DB_BACKUP_READY=1
    for kind in main index; do
        if [ "$kind" = main ]; then base="$DB_PATH"; else base="$INDEX_PATH"; fi
        for suffix in "" -wal -journal; do
            source="${base}${suffix}"
            backup_name="${kind}${suffix}"
            if [ -L "$source" ]; then
                DB_BACKUP_READY=0
                warn "SQLite database and sidecar paths must not be symlinks for automatic rollback."
                return 0
            fi
            if [ -f "$source" ]; then
                if [ "$suffix" != "" ] && [ ! -f "$base" ]; then
                    DB_BACKUP_READY=0
                    warn "SQLite sidecar exists without its database; refusing automatic rollback."
                    return 0
                fi
                if ! cp -a "$source" "$ROLLBACK_DIR/db/$backup_name" || ! cmp -s "$source" "$ROLLBACK_DIR/db/$backup_name"; then
                    DB_BACKUP_READY=0
                    warn "Could not verify the SQLite database and block index snapshot."
                    return 0
                fi
            fi
        done
    done
    log "SQLite database and block index rollback snapshot captured at $ROLLBACK_DIR/db"
}

restore_sqlite_snapshot() {
    [ "$DB_BACKUP_KIND" = "sqlite" ] || return 1
    local kind existed
    for kind in main index; do
        if [ "$kind" = main ]; then existed="$DB_EXISTED"; else existed="$INDEX_EXISTED"; fi
        [ "$existed" != 1 ] || [ -f "$ROLLBACK_DIR/db/$kind" ] || return 1
    done
    python3 - "$DB_PATH" "$INDEX_PATH" "$ROLLBACK_DIR/db" <<'PY'
import os, shutil, stat, sys, tempfile
from pathlib import Path

for base, name in ((Path(sys.argv[1]), 'main'), (Path(sys.argv[2]), 'index')):
    for suffix in ('', '-wal', '-shm', '-journal'):
        src = Path(sys.argv[3]) / (name + suffix)
        target = Path(str(base) + suffix)
        if not src.exists():
            target.unlink(missing_ok=True)
            continue
        src_fd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW)
        temp = None
        try:
            info = os.fstat(src_fd)
            if not stat.S_ISREG(info.st_mode):
                raise ValueError(f'Invalid rollback snapshot: {src}')
            fd, temp = tempfile.mkstemp(prefix='.bck-restore-', dir=target.parent)
            with os.fdopen(fd, 'wb') as out, os.fdopen(src_fd, 'rb') as inp:
                src_fd = None
                shutil.copyfileobj(inp, out)
                os.fchmod(out.fileno(), stat.S_IMODE(info.st_mode))
                os.fchown(out.fileno(), info.st_uid, info.st_gid)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temp, target)
            temp = None
        finally:
            if src_fd is not None: os.close(src_fd)
            if temp is not None and os.path.exists(temp): os.unlink(temp)
PY
}

# ------------------------------------------------------------- service ---------
activate_release() {
    local link_tmp="$BCK_HOME/.current-new.$$"
    ln -s "releases/$RELEASE_ID" "$link_tmp"
    mv -Tf "$link_tmp" "$BCK_HOME/current"
    CURRENT_TARGET="$RELEASE_DIR"
}

configure_health_settings() {
    HEALTH_URL="$(python3 - "$CONFIG" <<'PY'
import sys, tomllib
with open(sys.argv[1], 'rb') as f:
    s = tomllib.load(f)['server']
host = s['host']
if host in ('0.0.0.0', '::'):
    host = '127.0.0.1' if host == '0.0.0.0' else '::1'
if ':' in host and not host.startswith('['):
    host = '[' + host + ']'
scheme = 'https' if s.get('tls_cert') and s.get('tls_key') else 'http'
print(f"{scheme}://{host}:{s['port']}/api/v1/healthz")
PY
)" || return 1
    HEALTH_TLS_ARGS=(--insecure)
    if python3 - "$CONFIG" "$BCK_CONFIG_DIR/certs/current/server.crt" <<'PY'
import sys, tomllib
with open(sys.argv[1], 'rb') as f: config = tomllib.load(f)
raise SystemExit(config['server'].get('tls_cert') != sys.argv[2])
PY
    then
        HEALTH_TLS_ARGS=(--cacert "$BCK_CONFIG_DIR/certs/current/server.crt")
    fi
}

if command -v systemctl >/dev/null 2>&1; then
    if [ -f /etc/systemd/system/bckd.service ]; then
        install -d -m 0700 "$ROLLBACK_DIR"
        cp -p /etc/systemd/system/bckd.service "$ROLLBACK_DIR/bckd.service"
    fi
    PREVIOUS_TIMER_ACTIVE=0
    if systemctl is-active --quiet bck-tls-refresh.timer; then PREVIOUS_TIMER_ACTIVE=1; fi
    for unit in bck-tls-refresh.service bck-tls-refresh.timer; do
        if [ -f "/etc/systemd/system/$unit" ]; then
            install -d -m 0700 "$ROLLBACK_DIR"
            cp -p "/etc/systemd/system/$unit" "$ROLLBACK_DIR/$unit"
        fi
    done
    restore_previous_unit() {
        systemctl disable --now bck-tls-refresh.timer >/dev/null 2>&1 || true
        for unit in bck-tls-refresh.service bck-tls-refresh.timer; do
            if [ -f "$ROLLBACK_DIR/$unit" ]; then
                cp -p "$ROLLBACK_DIR/$unit" "/etc/systemd/system/$unit"
            else
                rm -f -- "/etc/systemd/system/$unit"
            fi
        done
        if [ -f "$ROLLBACK_DIR/bckd.service" ]; then
            cp -p "$ROLLBACK_DIR/bckd.service" /etc/systemd/system/bckd.service
        fi
        systemctl daemon-reload || true
        if [ "$PREVIOUS_TIMER_ACTIVE" = 1 ]; then
            systemctl enable --now bck-tls-refresh.timer || true
        fi
    }
    cat > /etc/systemd/system/bckd.service <<EOF
[Unit]
Description=BCK Enterprise Backup Daemon
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=3

[Service]
Type=simple
User=${BCK_USER}
Group=${BCK_GROUP}
ExecStartPre=+${BCK_HOME}/current/bin/bck-network-tls --config ${CONFIG} --cert-dir ${BCK_CONFIG_DIR}/certs --group ${BCK_GROUP} --ip ${MANAGED_TLS_IP}
ExecStartPre=${BCK_HOME}/current/bin/bckd -c ${CONFIG} --check-config
ExecStart=${BCK_HOME}/current/bin/bckd -c ${BCK_CONFIG_DIR}/config.toml
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=${BCK_DATA_DIR} ${BCK_CONFIG_DIR} ${BCK_HOME}/.config

[Install]
WantedBy=multi-user.target
EOF
    cat > /etc/systemd/system/bck-tls-refresh.service <<EOF
[Unit]
Description=Refresh BCK managed TLS certificate after address change
After=network-online.target

[Service]
Type=oneshot
ExecStart=${BCK_HOME}/current/bin/bck-network-tls --config ${CONFIG} --cert-dir ${BCK_CONFIG_DIR}/certs --group ${BCK_GROUP} --ip ${MANAGED_TLS_IP} --restart-on-change
EOF
    cat > /etc/systemd/system/bck-tls-refresh.timer <<'EOF'
[Unit]
Description=Periodically check BCK managed TLS certificate

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=bck-tls-refresh.service

[Install]
WantedBy=timers.target
EOF
    # Stop an existing daemon before changing the single release pointer, so
    # its child processes and static UI are never split across versions.
    if systemctl is-active --quiet bckd 2>/dev/null; then
        systemctl stop bckd 2>/dev/null || true
        if systemctl is-active --quiet bckd 2>/dev/null; then
            fail "Could not stop the existing bckd service before switching releases."
        fi
    fi
    if [ "$UPDATE_EXISTING" = "1" ]; then
        install -d -m 0700 "$ROLLBACK_DIR"
        snapshot_sqlite_for_rollback
        if [ "$DB_BACKUP_READY" != "1" ] && [ "${BCK_ALLOW_UNVERIFIED_DB_UPGRADE:-0}" != "1" ]; then
            restore_previous_unit
            systemctl daemon-reload 2>/dev/null || true
            systemctl restart bckd 2>/dev/null || true
            if systemctl is-active --quiet bckd 2>/dev/null; then
                fail "Upgrade stopped: no verified database rollback snapshot is available. Take and verify an independent backup, then explicitly set BCK_ALLOW_UNVERIFIED_DB_UPGRADE=1 to proceed. The prior release remains active."
            fi
            fail "Upgrade stopped because no verified database rollback snapshot is available, and the prior bckd service did not restart. Start it manually before retrying."
        fi
        if [ "$DB_BACKUP_READY" != "1" ]; then
            warn "Proceeding without automatic database rollback because BCK_ALLOW_UNVERIFIED_DB_UPGRADE=1 was explicitly set; retain the independent verified backup."
        fi
    fi
    if [ -n "$CONFIG_CANDIDATE" ]; then
        mv -f -- "$CONFIG_CANDIDATE" "$CONFIG"
        CONFIG_CANDIDATE=""
        log "Enabled HTTPS for the legacy configuration; the previous config is backed up at $ROLLBACK_DIR/config.toml."
    fi
    activate_release
    SERVICE_READY=1
    systemctl daemon-reload || SERVICE_READY=0
    systemctl enable bckd || SERVICE_READY=0
    TIMER_READY=1
    systemctl enable --now bck-tls-refresh.timer || TIMER_READY=0
    systemctl restart bckd 2>/dev/null || true
    configure_health_settings || fail "Could not read health endpoint from configuration."
    HEALTHY=0
    for _ in $(seq 1 30); do
        if [ "$SERVICE_READY" = 1 ] && [ "$TIMER_READY" = 1 ] && systemctl is-active --quiet bckd && curl --noproxy '*' -fs "${HEALTH_TLS_ARGS[@]}" --connect-timeout 2 --max-time 3 "$HEALTH_URL" >/dev/null; then
            HEALTHY=1
            break
        fi
        sleep 1
    done
    if [ "$HEALTHY" = 1 ]; then
        log "systemd service 'bckd' started. Status: systemctl status bckd"
    else
        warn "systemd service 'bckd' is NOT running after restart. Recent log:"
        journalctl -u bckd -n 15 --no-pager 2>/dev/null || true
        if [ -n "$PREVIOUS_RELEASE_RELATIVE" ] && [ "$DB_BACKUP_READY" = "1" ]; then
            systemctl stop bckd 2>/dev/null || true
            if restore_sqlite_snapshot; then
                if [ "$CONFIG_EXISTED" = "1" ] && [ -f "$ROLLBACK_DIR/config.toml" ]; then
                    cp -p "$ROLLBACK_DIR/config.toml" "$CONFIG"
                elif [ "$CONFIG_EXISTED" = "0" ]; then
                    rm -f -- "$CONFIG"
                fi
                ln -s "$PREVIOUS_RELEASE_RELATIVE" "$BCK_HOME/.current-rollback.$$"
                mv -Tf "$BCK_HOME/.current-rollback.$$" "$BCK_HOME/current"
                restore_previous_unit
                systemctl daemon-reload 2>/dev/null || true
                systemctl restart bckd 2>/dev/null || true
                configure_health_settings || warn "Could not read the restored health endpoint."
                ROLLBACK_HEALTHY=0
                for _ in $(seq 1 30); do
                    if systemctl is-active --quiet bckd && curl --noproxy '*' -fs "${HEALTH_TLS_ARGS[@]}" --connect-timeout 2 --max-time 3 "$HEALTH_URL" >/dev/null; then
                        ROLLBACK_HEALTHY=1
                        break
                    fi
                    sleep 1
                done
                if [ "$ROLLBACK_HEALTHY" = 1 ]; then
                    log "New release failed; restored the prior release and pre-upgrade SQLite database."
                else
                    warn "Prior release and database were restored, but its health check did not pass."
                fi
            else
                warn "Could not restore the pre-upgrade SQLite snapshot; manual recovery is required."
            fi
        elif [ -n "$PREVIOUS_RELEASE_RELATIVE" ]; then
            warn "Previous release retained at $PREVIOUS_RELEASE_RELATIVE; database was not snapshotted, so no binary rollback was attempted."
        fi
        warn "Common causes:"
        warn "  - TLS errors: check server.tls_cert and server.tls_key in $CONFIG."
        warn "  - Bad paths/permissions in $CONFIG (data dirs must be writable by $BCK_USER)."
        fail "bckd failed to start — fix the issue above and re-run the installer."
    fi
    # On a fresh install the daemon generates the admin password and writes it
    # to a bootstrap file; surface it so the operator does not have to grep
    # the journal. The file is removed after first login / password change.
    BOOTSTRAP_FILE="$BCK_DATA_DIR/bootstrap_admin.txt"
    if [ -n "$BOOTSTRAP_FILE" ]; then
        for _ in $(seq 1 40); do
            [ -f "$BOOTSTRAP_FILE" ] && break
            sleep 0.5
        done
        if [ -f "$BOOTSTRAP_FILE" ]; then
            log "Bootstrap admin credentials are in the restricted file $BOOTSTRAP_FILE."
            chmod 600 "$BOOTSTRAP_FILE" 2>/dev/null || true
        else
            log "No bootstrap credential file found; the administrator account may already exist."
        fi
    fi
else
    fail "A working systemd installation is required. The release was not activated."
fi

# ------------------------------------------------------------- finalize ---------
log "==============================================="
log " BCK Enterprise Backup installed/updated"
log "   Home:    $BCK_HOME"
log "   Config:  $CONFIG"
log "   Data:    $BCK_DATA_DIR"
DISPLAY_IP="$(python3 "$RELEASE_DIR/bin/bck-network-tls" --detect-ip)"
[ "$MANAGED_TLS_IP" = auto ] || DISPLAY_IP="$MANAGED_TLS_IP"
WEB_INFO="$(python3 - "$CONFIG" "$DISPLAY_IP" <<'PY'
import sys, tomllib
with open(sys.argv[1], 'rb') as f: s = tomllib.load(f)['server']
host = s['host']
if host == '0.0.0.0': host = sys.argv[2]
if ':' in host and not host.startswith('['): host = '[' + host + ']'
scheme = 'https' if s.get('tls_cert') and s.get('tls_key') else 'http'
print(f"{scheme}://{host}:{s['port']}")
PY
)"
log "   Web UI:  $WEB_INFO"
if python3 - "$CONFIG" <<'PY'
import sys, tomllib
with open(sys.argv[1], 'rb') as f: config = tomllib.load(f)
raise SystemExit(config['server']['host'] not in ('0.0.0.0', '::'))
PY
then
    warn "The Web UI listens on all interfaces; restrict port access to trusted management networks."
fi
if [ -f "$BCK_CONFIG_DIR/certs/.bck-managed" ] && python3 - "$CONFIG" "$BCK_CONFIG_DIR/certs/current/server.crt" <<'PY'
import sys, tomllib
with open(sys.argv[1], 'rb') as f: config = tomllib.load(f)
raise SystemExit(config['server'].get('tls_cert') != sys.argv[2])
PY
then
    warn "The managed self-signed certificate is not trusted by browsers. Verify its fingerprint, or configure a certificate from your corporate CA."
    openssl x509 -in "$BCK_CONFIG_DIR/certs/current/server.crt" -noout -fingerprint -sha256 || true
fi
if [ "$BCK_LICENSE_OK" = 1 ]; then log "   License: cached and unexpired (online status not checked)"; else warn "   License: not activated"; fi
log "   Binaries: ${BCK_HOME}/bin/{bckd,bck-agent,bck,bck-proxy}"
log "   CLI:     bck --help"
log "   License: sudo bck license status"
log "   Agent:   bck-agent --server <host> --port <grpc-port> --api-port <web-port> --https --ca-cert <CA.pem>"
log "            Remote gRPC requires configuring server.grpc_host and firewall access."
log "==============================================="
log "Re-run this installer any time to update."
