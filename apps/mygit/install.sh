#!/bin/bash
# MyGit (Go) - one-line installer/updater (Linux)
# The SAME command installs on first run and safely UPDATES on subsequent runs.
# Usage: curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/mygit/install.sh | sudo bash

set -e

INSTALL_DIR="/opt/mygit"
DATA_DIR="/var/lib/mygit"
REPOS_DIR="/var/lib/mygit/repos"
SERVICE_NAME="mygit"
MYGIT_VER="${MYGIT_VERSION:-latest}"
# Релізи живуть у публічному dist (кодовий репозиторій приватний), тег mygit-v<version>.
DIST_REPO="ajjs1ajjs/dist"
TAG_PREFIX="mygit-v"
# Port to bind. If it is already taken, the script picks the next free port
# automatically (you can pin one with MYGIT_PORT).
PORT="${MYGIT_PORT:-8060}"

# Find the first free TCP port starting from $1 (up to +30). Uses ss (iproute2);
# falls back to the requested port if ss is unavailable.
find_free_port() {
    local p="$1"
    if command -v ss >/dev/null 2>&1; then
        for i in $(seq 0 30); do
            if ! ss -tln 2>/dev/null | grep -q ":$p "; then
                echo "$p"
                return 0
            fi
            p=$((p + 1))
        done
    fi
    echo "$1"
}

if [ "$(id -u)" -ne 0 ]; then
    echo "Please run as root (sudo ./install.sh)"
    exit 1
fi

# --- OS version check -------------------------------------------------------
if [ -f /etc/os-release ]; then
    . /etc/os-release
    if [ "$ID" != "ubuntu" ]; then
        echo "ERROR: This installer supports Ubuntu only. Detected: $ID"
        exit 1
    fi
    ver="${VERSION_ID%%.*}"
    supported="24 25 26"
    is_supported=0
    for s in $supported; do
        if [ "$ver" = "$s" ]; then
            is_supported=1
            break
        fi
    done
    if [ "$is_supported" -eq 0 ]; then
        echo "ERROR: Unsupported $ID version: $VERSION_ID. Supported: Ubuntu 24, 25, 26."
        exit 1
    fi
    echo "[OK] Detected $ID $VERSION_ID ($PRETTY_NAME) — supported."
fi

# Resolve the final port before configuring the service so the health check and
# the systemd unit agree with each other.
PORT="$(find_free_port "$PORT")"

IS_UPDATE=0
if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ] || [ -x "$INSTALL_DIR/mygit" ] || [ -f "$DATA_DIR/mygit.db" ]; then
    IS_UPDATE=1
fi
if [ "$IS_UPDATE" = "1" ]; then MODE="Оновлення (update)"; else MODE="Встановлення (install)"; fi

echo "=============================================="
echo "   MyGit - $MODE"
echo "=============================================="
echo ""

OLD_VERSION=""
if [ -x "$INSTALL_DIR/mygit" ]; then
    OLD_VERSION="$($INSTALL_DIR/mygit --version 2>/dev/null || echo "?")"
fi

case "$(uname -m)" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "ERROR: unsupported architecture"; exit 1 ;;
esac
BINARY_NAME="mygit-linux-${ARCH}"

# Резолвимо тег: 'latest' -> найновіший mygit-v* у dist (репозиторій спільний,
# тож /releases/latest не годиться); інакше нормалізуємо версію до тега dist.
if [ "$MYGIT_VER" = "latest" ]; then
    TAG="$(curl -fsSL "https://api.github.com/repos/${DIST_REPO}/releases?per_page=100" \
        | grep -o '"tag_name": *"[^"]*"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/' \
        | grep "^${TAG_PREFIX}" | sort -V | tail -n1)"
    [ -n "$TAG" ] || { echo "ERROR: no ${TAG_PREFIX}* release found in ${DIST_REPO}"; exit 1; }
else
    case "$MYGIT_VER" in
        ${TAG_PREFIX}*) TAG="$MYGIT_VER" ;;
        v*)             TAG="${TAG_PREFIX}${MYGIT_VER#v}" ;;
        *)              TAG="${TAG_PREFIX}${MYGIT_VER}" ;;
    esac
fi
DOWNLOAD_URL="https://github.com/${DIST_REPO}/releases/download/${TAG}/${BINARY_NAME}"

echo "[1/4] Downloading MyGit ${TAG} (${BINARY_NAME})..."
TMP_BIN="$(mktemp)"
if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$DOWNLOAD_URL" -o "$TMP_BIN" || { echo "ERROR: download failed"; rm -f "$TMP_BIN"; exit 1; }
elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$TMP_BIN" "$DOWNLOAD_URL" || { echo "ERROR: download failed"; rm -f "$TMP_BIN"; exit 1; }
else
    echo "ERROR: curl or wget required"; rm -f "$TMP_BIN"; exit 1
fi

# Integrity check (fail-closed): verify the binary against the published
# checksums.txt. This protects the update path from a tampered or truncated
# artifact. Set MYGIT_SKIP_CHECKSUM=1 to explicitly bypass (not recommended).
CHECKSUM_URL="${DOWNLOAD_URL%/*}/checksums.txt"
if [ "${MYGIT_SKIP_CHECKSUM:-0}" = "1" ]; then
    echo "WARNING: checksum verification explicitly skipped. Installing unverified binary."
elif ! command -v sha256sum >/dev/null 2>&1; then
    echo "ERROR: sha256sum not found; cannot verify binary integrity."
    echo "Install coreutils, or set MYGIT_SKIP_CHECKSUM=1 to explicitly bypass verification."
    rm -f "$TMP_BIN"; exit 1
else
    TMP_SUM="$(mktemp)"
    DOWNLOADED_SUM=0
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$CHECKSUM_URL" -o "$TMP_SUM" 2>/dev/null && DOWNLOADED_SUM=1
    elif command -v wget >/dev/null 2>&1; then
        wget -q -O "$TMP_SUM" "$CHECKSUM_URL" 2>/dev/null && DOWNLOADED_SUM=1
    fi
    if [ "$DOWNLOADED_SUM" != "1" ] || [ ! -s "$TMP_SUM" ]; then
        echo "ERROR: could not download checksums.txt from $CHECKSUM_URL."
        echo "Refusing to install an unverified binary. Re-run once GitHub is reachable,"
        echo "or set MYGIT_SKIP_CHECKSUM=1 to explicitly bypass verification."
        rm -f "$TMP_BIN" "$TMP_SUM"; exit 1
    fi
    EXPECTED="$(grep " ${BINARY_NAME}\$" "$TMP_SUM" | awk '{print $1}')"
    if [ -z "$EXPECTED" ]; then
        echo "ERROR: checksums.txt has no entry for ${BINARY_NAME}; refusing to install."
        rm -f "$TMP_BIN" "$TMP_SUM"; exit 1
    fi
    ACTUAL="$(sha256sum "$TMP_BIN" | awk '{print $1}')"
    if [ "$EXPECTED" != "$ACTUAL" ]; then
        echo "ERROR: checksum mismatch for ${BINARY_NAME}. Expected $EXPECTED, got $ACTUAL."
        rm -f "$TMP_BIN" "$TMP_SUM"; exit 1
    fi
    echo "Checksum OK."
    rm -f "$TMP_SUM"
fi

chmod +x "$TMP_BIN"
"$TMP_BIN" --version >/dev/null 2>&1 || { echo "ERROR: not a valid binary"; rm -f "$TMP_BIN"; exit 1; }

echo "[2/4] Installing binary..."
mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$REPOS_DIR"
if [ -d "$INSTALL_DIR/mygit" ]; then rm -rf "$INSTALL_DIR/mygit"; fi
if [ "$IS_UPDATE" = "1" ] && [ -f "$INSTALL_DIR/mygit" ]; then
    cp -f "$INSTALL_DIR/mygit" "$INSTALL_DIR/mygit.old" 2>/dev/null || true
fi
install -m 0755 "$TMP_BIN" "$INSTALL_DIR/mygit"
rm -f "$TMP_BIN"

echo "[3/4] Configuring system user and service (port $PORT)..."
if ! id mygit >/dev/null 2>&1; then
    useradd -r -s /bin/false -d "$INSTALL_DIR" mygit
fi
chown -R mygit:mygit "$INSTALL_DIR" "$DATA_DIR"
systemctl stop $SERVICE_NAME 2>/dev/null || true

cat > /etc/systemd/system/$SERVICE_NAME.service <<EOF
[Unit]
Description=MyGit - self-hosted Git platform
After=network.target

[Service]
User=mygit
Group=mygit
ExecStart=$INSTALL_DIR/mygit -port $PORT
Restart=always
RestartSec=5
Environment=MYGIT_BASE_DIR=$DATA_DIR
Environment=MYGIT_REPOS_ROOT=$REPOS_DIR
Environment=MYGIT_DB_PATH=$DATA_DIR/mygit.db

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl restart $SERVICE_NAME

# Wait for MYGIT's own health endpoint. Checking / on the port is NOT enough —
# any other service (e.g. uptime-monitor) would answer and give a false OK.
echo -n "Waiting for MyGit on port $PORT to become healthy..."
for i in $(seq 1 15); do
    if curl -fsS "http://localhost:$PORT/api/v1/health" >/dev/null 2>&1; then echo " OK"; break; fi
    if [ "$i" = "15" ]; then echo " FAILED — is port $PORT free? (another service may be using it)"; exit 1; else echo -n "."; sleep 1; fi
done

echo "[4/4] Done."
echo ""
if [ "$IS_UPDATE" = "1" ]; then
    NEW_VERSION="$("$INSTALL_DIR/mygit" --version 2>/dev/null || echo "$MYGIT_VER")"
    echo "MyGit updated: ${OLD_VERSION} -> ${NEW_VERSION}"
    echo "Config, repositories and users preserved."
else
    echo "MyGit installed. Version: ${MYGIT_VER}"
fi
echo ""
echo "Dashboard: http://localhost:$PORT/"
echo "Зареєструйте ПЕРШИЙ обліковий запис — він стане власником (superuser)."
echo ""
if [ -f "$INSTALL_DIR/mygit.old" ]; then echo "Previous binary kept at: $INSTALL_DIR/mygit.old"; fi
echo "Installed version: $("$INSTALL_DIR/mygit" --version)"
