#!/bin/bash
# MyGit (Go) - one-line installer/updater (Linux)
# The SAME command installs on first run and safely UPDATES on subsequent runs.
# Usage: curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/mygit/install.sh | sudo bash

set -e

INSTALL_DIR="/opt/mygit"
DATA_DIR="/var/lib/mygit"
REPOS_DIR="/var/lib/mygit/repos"
SERVICE_NAME="mygit"
ENV_DIR="/etc/mygit"
ENV_FILE="$ENV_DIR/mygit.env"
MYGIT_VER="${MYGIT_VERSION:-latest}"
# Релізи живуть у публічному dist (кодовий репозиторій приватний), тег mygit-v<version>.
DIST_REPO="ajjs1ajjs/dist"
TAG_PREFIX="mygit-v"

get_latest_release_tag() {
    local page=1 count body tags candidate latest=''
    while [ "$page" -le 50 ]; do
        body="$(curl -fsSL "https://api.github.com/repos/${DIST_REPO}/releases?per_page=100&page=${page}")" || return 1
        count="$(printf '%s' "$body" | grep -o '"tag_name"' | wc -l)"
        tags="$(printf '%s' "$body" | grep -o '"tag_name": *"[^"]*"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/' | grep -E "^${TAG_PREFIX}[0-9]+\\.[0-9]+\\.[0-9]+$" || true)"
        candidate="$(printf '%s\n' "$tags" | sort -V | tail -n1)"
        if [ -n "$candidate" ]; then latest="$(printf '%s\n%s\n' "$latest" "$candidate" | sort -V | tail -n1)"; fi
        [ "$count" -lt 100 ] && { printf '%s\n' "$latest"; return 0; }
        page=$((page + 1))
    done
    echo "ERROR: release listing exceeded 50 pages; refusing incomplete selection." >&2
    return 1
}
# Port to bind. If it is already taken, the script picks the next free port
# automatically (you can pin one with MYGIT_PORT).
PORT="${MYGIT_PORT:-9555}"

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
#
# On update, reuse the port already in the unit: the running service still holds
# it, so find_free_port would see it as taken and drift to the next port on every
# update. MYGIT_PORT always wins (and is checked for availability).
EXISTING_UNIT="/etc/systemd/system/$SERVICE_NAME.service"
if [ -n "${MYGIT_PORT:-}" ]; then
    PORT="$(find_free_port "$MYGIT_PORT")"
elif [ -f "$EXISTING_UNIT" ]; then
    EXISTING_PORT="$(grep -oE -- '-port [0-9]+' "$EXISTING_UNIT" 2>/dev/null | awk '{print $2}' | head -n1)"
    if [ -n "$EXISTING_PORT" ]; then
        PORT="$EXISTING_PORT"
        echo "[i] Reusing configured port $PORT"
    else
        PORT="$(find_free_port "$PORT")"
    fi
else
    PORT="$(find_free_port "$PORT")"
fi

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

case "$(uname -m)" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "ERROR: unsupported architecture"; exit 1 ;;
esac
BINARY_NAME="mygit-linux-${ARCH}"

# Резолвимо тег: 'latest' -> найновіший mygit-v* у dist (репозиторій спільний,
# тож /releases/latest не годиться); інакше нормалізуємо версію до тега dist.
if [ "$MYGIT_VER" = "latest" ]; then
    TAG="$(get_latest_release_tag)"
    [ -n "$TAG" ] || { echo "ERROR: no ${TAG_PREFIX}* release found in ${DIST_REPO}"; exit 1; }
else
    case "$MYGIT_VER" in
        ${TAG_PREFIX}*) TAG="$MYGIT_VER" ;;
        v*)             TAG="${TAG_PREFIX}${MYGIT_VER#v}" ;;
        *)              TAG="${TAG_PREFIX}${MYGIT_VER}" ;;
    esac
fi
printf '%s\n' "$TAG" | grep -Eq "^${TAG_PREFIX}[0-9]+\\.[0-9]+\\.[0-9]+$" || { echo "ERROR: invalid stable release tag '$TAG'"; exit 1; }
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
    # CRLF/* tolerant + терпить склеєний рядок (mygit-v3.7.3 мав
    # "hash1  file1hash2  file2" в один рядок через -NoNewline в Release-Local.ps1).
    # Шукаємо "64hex + пробіли + [*]filename" як підрядок, без прив'язки до кінця рядка.
    # tr є в coreutils разом із sha256sum.
    EXPECTED="$(tr -d '\r' < "$TMP_SUM" | grep -oE "[0-9a-fA-F]{64}[[:space:]]+\\*?${BINARY_NAME}" | awk '{print $1}' | head -n1)"
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
if [ "$IS_UPDATE" = "1" ] && [ -f "$INSTALL_DIR/mygit" ] && ! cmp -s "$INSTALL_DIR/mygit" "$TMP_BIN"; then
    # Preserve the old file without executing it as root. Older installs may
    # have allowed the service account to replace this path.
    install -m 0755 "$INSTALL_DIR/mygit" "$INSTALL_DIR/mygit.old"
fi
install -m 0755 "$TMP_BIN" "$INSTALL_DIR/.mygit.new"
mv -f "$INSTALL_DIR/.mygit.new" "$INSTALL_DIR/mygit"
rm -f "$TMP_BIN"

echo "[3/4] Configuring system user and service (port $PORT)..."
if ! id mygit >/dev/null 2>&1; then
    useradd -r -s /bin/false -d "$INSTALL_DIR" mygit
fi
chown -R root:root "$INSTALL_DIR"
chmod 0755 "$INSTALL_DIR"
install -d -o mygit -g mygit -m 0750 "$INSTALL_DIR/.config"
chown -R mygit:mygit "$INSTALL_DIR/.config" "$DATA_DIR"

# Required secrets. The server refuses to start (fail-closed) without
# JWT, internal API, data encryption, and backup keys. Generate them once
# and keep them across updates via an EnvironmentFile.
mkdir -p "$ENV_DIR"
if [ ! -s "$ENV_FILE" ]; then
    umask 077
    JWT_SECRET="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
    INTERNAL_TOKEN="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
    DATA_KEY="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
    BACKUP_KEY="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
    cat > "$ENV_FILE" <<ENVEOF
MYGIT_JWT_SECRET=$JWT_SECRET
MYGIT_INTERNAL_API_TOKEN=$INTERNAL_TOKEN
MYGIT_DATA_ENCRYPTION_KEY=$DATA_KEY
MYGIT_BACKUP_KEY=$BACKUP_KEY
ENVEOF
    chmod 600 "$ENV_FILE"
    echo "Generated MYGIT_JWT_SECRET + MYGIT_INTERNAL_API_TOKEN -> $ENV_FILE (keep this file)"
else
    echo "Keeping existing secrets from $ENV_FILE"
fi

# Add separate data/backup keys to older EnvironmentFiles. The server lazily
# re-encrypts stored secrets from the legacy JWT-derived key on first startup.
for KEY_NAME in MYGIT_DATA_ENCRYPTION_KEY MYGIT_BACKUP_KEY; do
    if ! grep -q "^${KEY_NAME}=" "$ENV_FILE"; then
        KEY_VALUE="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
        printf '\n%s=%s\n' "$KEY_NAME" "$KEY_VALUE" >> "$ENV_FILE"
    fi
done
chmod 600 "$ENV_FILE"

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
EnvironmentFile=$ENV_FILE
Environment=MYGIT_BASE_DIR=$DATA_DIR
Environment=MYGIT_REPOS_ROOT=$REPOS_DIR
Environment=MYGIT_DB_PATH=$DATA_DIR/mygit.db
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
CapabilityBoundingSet=
ReadWritePaths=$DATA_DIR $REPOS_DIR $INSTALL_DIR/.config

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $SERVICE_NAME

# --- License preflight --------------------------------------------------------
# The server verifies the license on every start and exits without one (fail
# closed), so on an unlicensed host the update would end with a crash-looping
# unit and the operator hunting for commands. Offer the key / 3-day trial right
# here — `curl | sudo bash` keeps the script itself on stdin, so every prompt
# reads from /dev/tty. Skipping never leaves a dead service: an update is rolled
# back to the previous binary (which keeps running), a fresh install stays
# stopped with exact steps. Unattended runs: MYGIT_LICENSE_KEY=<key> or
# MYGIT_TRIAL_EMAIL=<email>.
LICENSE_FILE="$INSTALL_DIR/.config/mygit/license.json"
lic_cli() { sudo -u mygit env HOME="$INSTALL_DIR" "$INSTALL_DIR/mygit" "$@"; }
lic_valid() {
    [ -s "$LICENSE_FILE" ] || return 1
    local exp epoch now
    exp="$(sed -n 's/.*"expires_at"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$LICENSE_FILE" | head -n 1)"
    [ -n "$exp" ] || return 0                    # unparsable -> let the service decide
    epoch="$(date -u -d "$exp" +%s 2>/dev/null)" || return 0
    now="$(date -u +%s)"
    [ "$epoch" -gt "$now" ]
}
license_activate_key() { [ -n "$1" ] && lic_cli license activate "$1"; }
license_start_trial()  { [ -n "$1" ] && lic_cli license trial "$1"; }

# The binary's own hints say `mygit license ...` — make that work: symlink onto
# PATH and point root's config dir at the service user's (root runs with
# HOME=/root; without the link `sudo mygit license activate` would write a
# license the service never reads).
mkdir -p /usr/local/bin
ln -sf "$INSTALL_DIR/mygit" /usr/local/bin/mygit
SVC_CFG_DIR="$INSTALL_DIR/.config/mygit"
mkdir -p "$SVC_CFG_DIR"
if [ ! -e /root/.config/mygit ] && [ ! -L /root/.config/mygit ]; then
    mkdir -p /root/.config
    ln -s "$SVC_CFG_DIR" /root/.config/mygit
elif [ -d /root/.config/mygit ] && [ ! -L /root/.config/mygit ] \
     && [ -s /root/.config/mygit/license.json ] && [ ! -s "$SVC_CFG_DIR/license.json" ]; then
    # A license was once activated as root: migrate it where the service looks.
    cp /root/.config/mygit/license.json "$SVC_CFG_DIR/license.json"
fi
chown -R mygit:mygit "$INSTALL_DIR/.config" 2>/dev/null || true

LICENSE_OK=0
if lic_valid; then
    LICENSE_OK=1
    echo "[i] Ліцензія: активна."
elif [ -n "$MYGIT_LICENSE_KEY" ]; then
    echo "[i] Активація ліцензії з MYGIT_LICENSE_KEY..."
    if license_activate_key "$MYGIT_LICENSE_KEY"; then LICENSE_OK=1; fi
elif [ -n "$MYGIT_TRIAL_EMAIL" ]; then
    echo "[i] Активація 3-денного Trial для $MYGIT_TRIAL_EMAIL..."
    if license_start_trial "$MYGIT_TRIAL_EMAIL"; then LICENSE_OK=1; fi
elif { true </dev/tty; } 2>/dev/null; then
    echo ""
    echo "======================================================="
    echo "  ЛІЦЕНЗІЯ MyGit не активована."
    echo "  Сервіс перевіряє ліцензію при кожному старті: без неї він"
    echo "  не запускається, а systemd зациклює перезапуски."
    echo "  Активуйте зараз — це займе кілька секунд."
    echo "======================================================="
    while [ "$LICENSE_OK" != "1" ]; do
        echo ""
        echo "  1) Ввести ліцензійний ключ (AK-…)"
        echo "  2) Отримати безкоштовний 3-денний Trial (потрібен email)"
        echo "  3) Пропустити"
        printf '  Ваш вибір [1/2/3]: '
        LIC_CHOICE=""
        read -r LIC_CHOICE </dev/tty || LIC_CHOICE=""
        case "$LIC_CHOICE" in
            1)
                printf '  Ліцензійний ключ: '
                LIC_KEY=""
                read -r LIC_KEY </dev/tty || LIC_KEY=""
                if license_activate_key "$LIC_KEY"; then
                    LICENSE_OK=1
                else
                    echo "  [x] Активувати не вдалося — перевірте ключ і мережу та спробуйте ще раз."
                fi
                ;;
            2)
                printf '  Email для Trial: '
                LIC_EMAIL=""
                read -r LIC_EMAIL </dev/tty || LIC_EMAIL=""
                if license_start_trial "$LIC_EMAIL"; then
                    LICENSE_OK=1
                else
                    echo "  [x] Trial не активовано — перевірте email і мережу та спробуйте ще раз."
                fi
                ;;
            3|"")
                break
                ;;
            *)
                echo "  Введіть 1, 2 або 3."
                ;;
        esac
    done
fi

if [ "$LICENSE_OK" != "1" ]; then
    echo ""
    echo "Ліцензію не активовано — нову версію не запускаю, щоб нічого не зламати."
    ROLLBACK_OK=0
    if [ "$IS_UPDATE" = "1" ] && [ -f "$INSTALL_DIR/mygit.old" ]; then ROLLBACK_OK=1; fi
    if [ "$ROLLBACK_OK" = "1" ]; then
        install -m 0755 "$INSTALL_DIR/mygit.old" "$INSTALL_DIR/.mygit.rollback"
        mv -f "$INSTALL_DIR/.mygit.rollback" "$INSTALL_DIR/mygit"
        systemctl restart $SERVICE_NAME >/dev/null 2>&1 || true
        echo "Оновлення скасовано: відновлено попередній бінарник без запуску від root."
        if systemctl is-active --quiet $SERVICE_NAME; then
            echo "Сервіс працює, як і до оновлення."
        else
            echo "УВАГА: сервіс не піднявся — перевірте: systemctl status $SERVICE_NAME"
        fi
    else
        systemctl disable $SERVICE_NAME >/dev/null 2>&1 || true
        # A crash-looping unit (auto-restart) is almost never "active" when
        # sampled; stop it so the loop does not keep hammering. A healthy
        # running service is left up.
        WAS_UP=1
        for _ in 1 2 3; do
            if ! systemctl is-active --quiet $SERVICE_NAME; then WAS_UP=0; break; fi
            sleep 1
        done
        if [ "$WAS_UP" != "1" ]; then systemctl stop $SERVICE_NAME >/dev/null 2>&1 || true; fi
        if [ "$WAS_UP" = "1" ]; then
            echo "Нову версію не запущено. Поточний сервіс продовжує працювати; автозапуск вимкнено (новий бінарник без ліцензії не стартує)."
        else
            echo "Сервіс встановлено, але НЕ запущено й автозапуск вимкнено (без ліцензії він не стартує)."
        fi
    fi
    echo ""
    echo "Активуйте ліцензію та повторіть встановлення:"
    echo "  sudo mygit license trial <email>          # 3-денний Trial"
    echo "  sudo mygit license activate <key>         # придбаний ключ"
    echo "  sudo systemctl enable --now $SERVICE_NAME          # якщо автозапуск вимкнено"
    echo "Або просто запустіть інсталятор ще раз — він запитає ключ/email сам:"
    echo "  curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/mygit/install.sh | sudo bash"
    echo ""
    echo "Не звітую про успіх: сервіс не працює на новій версії."
    exit 1
fi

systemctl stop $SERVICE_NAME 2>/dev/null || true
systemctl restart $SERVICE_NAME

# Wait for MYGIT's own health endpoint. Checking / on the port is NOT enough —
# any other service (e.g. uptime-monitor) would answer and give a false OK.
echo -n "Waiting for MyGit on port $PORT to become healthy..."
for i in $(seq 1 15); do
    if curl -fsS "http://localhost:$PORT/api/v1/health" >/dev/null 2>&1; then echo " OK"; break; fi
    if [ "$i" = "15" ]; then
        echo " FAILED — service did not become healthy on port $PORT."
        echo "--- systemctl status $SERVICE_NAME ---"
        systemctl --no-pager --full status "$SERVICE_NAME" 2>&1 | head -25 || true
        echo "--- journalctl -u $SERVICE_NAME (last 30) ---"
        journalctl -u "$SERVICE_NAME" -n 30 --no-pager 2>&1 || true
        echo "--- port $PORT in use? ---"
        ss -ltnp 2>/dev/null | grep ":$PORT " || echo "(nothing listening on $PORT)"
        if journalctl -u "$SERVICE_NAME" -n 30 --no-pager 2>/dev/null | grep -q 'ЛІЦЕНЗІЯ'; then
            echo "--- ліцензія ---"
            echo "Схоже, сервіс не піднявся через ліцензію (див. [ЛІЦЕНЗІЯ] вище). Активуйте та повторіть:"
            echo "  sudo mygit license trial <email>    # або: sudo mygit license activate <key>"
            echo "  sudo systemctl restart $SERVICE_NAME"
        fi
        if [ "$IS_UPDATE" = "1" ] && [ -f "$INSTALL_DIR/mygit.old" ]; then
            echo "--- відкат ---"
            echo "  sudo systemctl stop $SERVICE_NAME"
            echo "  sudo mv $INSTALL_DIR/mygit.old $INSTALL_DIR/mygit && sudo systemctl start $SERVICE_NAME"
        fi
        exit 1
    else echo -n "."; sleep 1; fi
done

# Optional: install a local Linux CI runner alongside the server.
# MYGIT_INSTALL_RUNNER=1 (optional MYGIT_RUNNER_CPUS / MYGIT_RUNNER_MEMORY / MYGIT_RUNNER_COUNT).
if [ "${MYGIT_INSTALL_RUNNER:-0}" = "1" ]; then
    echo ""
    echo "[i] Installing a local CI runner..."
    R_CPUS="${MYGIT_RUNNER_CPUS:-0}"
    R_MEM="${MYGIT_RUNNER_MEMORY:-0}"
    R_COUNT="${MYGIT_RUNNER_COUNT:-1}"
    TOKEN="$(MYGIT_DB_PATH="$DATA_DIR/mygit.db" "$INSTALL_DIR/mygit" add-runner \
        --name "local-$(hostname)" --os linux \
        --cpus "$R_CPUS" --memory "$R_MEM" --replicas "$R_COUNT" 2>/dev/null | tail -n1)"
    if [ -n "$TOKEN" ]; then
        curl -sSL "http://localhost:$PORT/install-runner.sh" | \
            bash -s -- --url "http://localhost:$PORT" --token "$TOKEN" \
                --cpus "$R_CPUS" --memory "$R_MEM" --count "$R_COUNT" \
            || echo "  [warn] runner install failed; add it later from the web UI (Admin -> Runners)."
    else
        echo "  [warn] could not create a runner token; add a runner from the web UI (Admin -> Runners)."
    fi
fi

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
echo "Ліцензія:   sudo mygit license status   (trial/activate — ті самі команди)"
echo "Зареєструйте ПЕРШИЙ обліковий запис — він стане власником (superuser)."
echo ""
if [ -f "$INSTALL_DIR/mygit.old" ]; then echo "Previous binary kept at: $INSTALL_DIR/mygit.old"; fi
echo "Installed version: $("$INSTALL_DIR/mygit" --version)"
