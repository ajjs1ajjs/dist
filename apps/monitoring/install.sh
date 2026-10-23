#!/bin/bash
# PyMon NOC (Go) - one-line installer/updater (Ubuntu)
# The SAME command installs on first run and safely UPDATES on subsequent runs:
#   - keeps config (/etc/pymon/config.yml), database, users and admin password
#   - replaces only the binary and restarts the service
# Usage: curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/monitoring/install.sh | sudo bash

set -e

INSTALL_DIR="/opt/pymon"
CONFIG_DIR="/etc/pymon"
DATA_DIR="/var/lib/pymon"
LOG_DIR="/var/log/pymon"
SERVICE_NAME="pymon"
PYMON_VER="${PYMON_VERSION:-latest}"
# Релізи живуть у публічному dist (кодовий репозиторій приватний), тег monitoring-v<version>.
DIST_REPO="ajjs1ajjs/dist"
TAG_PREFIX="monitoring-v"

# --- Database backend -------------------------------------------------------
# New installations default to PostgreSQL (auto-provisioned locally with a
# generated password). Existing installations keep whatever their config.yml
# already uses. Set PYMON_DB_BACKEND=sqlite to opt out.
DB_BACKEND="${PYMON_DB_BACKEND:-}"
DB_DSN="${PYMON_DATABASE_URL:-${DATABASE_URL:-}}"
PG_DB_NAME="${PYMON_PG_DATABASE:-pymon}"
PG_DB_USER="${PYMON_PG_USER:-pymon}"
PG_DB_NAME="$(printf '%s' "$PG_DB_NAME" | tr -cd 'A-Za-z0-9_')"
PG_DB_USER="$(printf '%s' "$PG_DB_USER" | tr -cd 'A-Za-z0-9_')"
PG_DB_HOST="${PYMON_PG_HOST:-127.0.0.1}"
PG_DB_PORT="${PYMON_PG_PORT:-5432}"
PG_PASSWORD="${PYMON_PG_PASSWORD:-}"
PG_PASSWORD_FILE="$CONFIG_DIR/postgres_password.txt"

if [ "$PYMON_VER" != "latest" ] && ! echo "$PYMON_VER" | grep -qE '^([0-9]|v[0-9]|monitoring-v[0-9])'; then
    echo "ERROR: Invalid PYMON_VERSION '$PYMON_VER'. Must be 'latest' or a version like 3.3.0 / v3.3.0"
    exit 1
fi

CONFIG_FILE="$CONFIG_DIR/config.yml"

if [ "$(id -u)" -ne 0 ]; then
    echo "Please run as root (sudo ./install.sh)"
    exit 1
fi

# --- Dependency preflight ---------------------------------------------------
if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: 'curl' is required but not installed."
    echo "Install it first: sudo apt-get update && sudo apt-get install -y curl"
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
        echo "ERROR: Unsupported Ubuntu version: $VERSION_ID. Supported: Ubuntu 24, 25, 26 (latest and preview)."
        exit 1
    fi
    echo "[OK] Detected Ubuntu $VERSION_ID ($PRETTY_NAME) — supported."
fi

# --- Database helpers --------------------------------------------------------
existing_backend() {
    [ -f "$CONFIG_FILE" ] || return 0
    sed -n 's/^[[:space:]]*backend:[[:space:]]*//p' "$CONFIG_FILE" | head -n1 | tr -d '\r"' | awk '{print $1}'
}

existing_dsn() {
    [ -f "$CONFIG_FILE" ] || return 0
    sed -n 's/^[[:space:]]*dsn:[[:space:]]*//p' "$CONFIG_FILE" | head -n1 | sed 's/^["'\'']//; s/["'\'']$//'
}

provision_postgres() {
    if [ -n "$DB_DSN" ]; then
        echo "[i] PostgreSQL: зовнішній DSN із PYMON_DATABASE_URL/DATABASE_URL."
        return 0
    fi
    case "$PG_DB_HOST" in
        127.0.0.1|localhost|::1) ;;
        *)
            echo "ERROR: локальний PostgreSQL можна налаштувати лише для 127.0.0.1."
            echo "Для зовнішнього сервера задайте PYMON_DATABASE_URL='postgres://user:pass@host:5432/db?sslmode=require'."
            exit 1
            ;;
    esac

    need_install=0
    if ! command -v psql >/dev/null 2>&1 || ! command -v pg_isready >/dev/null 2>&1; then
        need_install=1
    elif ! pg_isready -h "$PG_DB_HOST" -p "$PG_DB_PORT" >/dev/null 2>&1; then
        need_install=1
    fi
    if [ "$need_install" = "1" ]; then
        echo "[i] Встановлюю PostgreSQL (пакет Ubuntu)..."
        apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-client
    fi
    systemctl enable postgresql >/dev/null 2>&1 || true
    systemctl start postgresql >/dev/null 2>&1 || true

    ready=0
    for _ in $(seq 1 30); do
        if pg_isready -h "$PG_DB_HOST" -p "$PG_DB_PORT" >/dev/null 2>&1; then ready=1; break; fi
        sleep 1
    done
    if [ "$ready" != "1" ]; then
        echo "ERROR: PostgreSQL не відповідає на ${PG_DB_HOST}:${PG_DB_PORT}."
        echo "Перевірте: systemctl status postgresql; journalctl -u postgresql -n 50"
        exit 1
    fi

    if [ -z "$PG_PASSWORD" ]; then
        PG_PASSWORD="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
    fi
    if [ -z "$PG_PASSWORD" ]; then
        echo "ERROR: не вдалося згенерувати пароль PostgreSQL."
        exit 1
    fi

    role_exists="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_DB_USER}'" 2>/dev/null || true)"
    if [ "$role_exists" = "1" ]; then
        sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE \"${PG_DB_USER}\" WITH LOGIN PASSWORD '${PG_PASSWORD}'" >/dev/null
    else
        sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE \"${PG_DB_USER}\" LOGIN PASSWORD '${PG_PASSWORD}'" >/dev/null
    fi

    db_exists="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB_NAME}'" 2>/dev/null || true)"
    if [ "$db_exists" != "1" ]; then
        sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${PG_DB_NAME}\" OWNER \"${PG_DB_USER}\"" >/dev/null
    fi

    DB_DSN="postgres://${PG_DB_USER}:${PG_PASSWORD}@${PG_DB_HOST}:${PG_DB_PORT}/${PG_DB_NAME}?sslmode=disable"
    mkdir -p "$CONFIG_DIR"
    printf '%s\n' "$PG_PASSWORD" > "$PG_PASSWORD_FILE"
    chmod 600 "$PG_PASSWORD_FILE"
    echo "[OK] PostgreSQL готовий: ${PG_DB_USER}@${PG_DB_HOST}:${PG_DB_PORT}/${PG_DB_NAME}"
    echo "     Пароль збережено: $PG_PASSWORD_FILE (0600)"
}

apply_storage_config() {
    chmod 600 "$CONFIG_FILE"
    local dsn_esc
    dsn_esc="$(printf '%s' "$DB_DSN" | sed 's/[\\&|]/\\&/g')"
    if grep -q '^[[:space:]]*backend:' "$CONFIG_FILE"; then
        sed -i "s|^\([[:space:]]*\)backend:.*|\1backend: ${EFFECTIVE_BACKEND}|" "$CONFIG_FILE"
    else
        sed -i "/^storage:/a\\  backend: ${EFFECTIVE_BACKEND}" "$CONFIG_FILE"
    fi
    if [ "$EFFECTIVE_BACKEND" = "postgres" ]; then
        if grep -q '^[[:space:]]*dsn:' "$CONFIG_FILE"; then
            sed -i "s|^\([[:space:]]*\)dsn:.*|\1dsn: ${dsn_esc}|" "$CONFIG_FILE"
        else
            sed -i "/^[[:space:]]*backend:/a\\  dsn: ${dsn_esc}" "$CONFIG_FILE"
        fi
    fi
    if grep -q '^[[:space:]]*data_dir:' "$CONFIG_FILE"; then
        sed -i "s|^\([[:space:]]*\)data_dir:.*|\1data_dir: ${DATA_DIR}|" "$CONFIG_FILE"
    else
        sed -i "/^[[:space:]]*backend:/a\\  data_dir: ${DATA_DIR}" "$CONFIG_FILE"
    fi
    if ! grep -q '^[[:space:]]*rollup_retention_days:' "$CONFIG_FILE"; then
        sed -i "/^[[:space:]]*retention_hours:/a\\  rollup_retention_days: 90" "$CONFIG_FILE"
    fi
}

# --- Detect existing installation -------------------------------------------
IS_UPDATE=0
if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ] || [ -x "$INSTALL_DIR/pymon" ] || [ -f "$DATA_DIR/pymon.db" ]; then
    IS_UPDATE=1
fi


if [ "$IS_UPDATE" = "1" ]; then
    MODE="Оновлення (update)"
else
    MODE="Встановлення (install)"
fi

# --- Choose the database backend --------------------------------------------
EFFECTIVE_BACKEND="$DB_BACKEND"
if [ -z "$EFFECTIVE_BACKEND" ]; then
    if [ "$IS_UPDATE" = "1" ]; then
        EFFECTIVE_BACKEND="$(existing_backend)"
    else
        EFFECTIVE_BACKEND="postgres"
    fi
fi
EFFECTIVE_BACKEND="$(printf '%s' "$EFFECTIVE_BACKEND" | tr 'A-Z' 'a-z')"
case "$EFFECTIVE_BACKEND" in
    postgres|postgresql|pg) EFFECTIVE_BACKEND="postgres" ;;
    *)                      EFFECTIVE_BACKEND="sqlite" ;;
esac
if [ -n "$DB_DSN" ]; then EFFECTIVE_BACKEND="postgres"; fi
if [ "$EFFECTIVE_BACKEND" = "postgres" ] && [ -z "$DB_DSN" ]; then
    DB_DSN="$(existing_dsn)"
fi
if [ "$IS_UPDATE" = "1" ] && [ "$EFFECTIVE_BACKEND" = "postgres" ] && [ "$(existing_backend)" != "postgres" ]; then
    echo "ERROR: перемикання наявної SQLite-інсталяції на PostgreSQL не робиться автоматично."
    echo "Спершу перенесіть дані:"
    echo "  sudo DB_PATH=$DATA_DIR/pymon.db $INSTALL_DIR/pymon db-migrate --source $DATA_DIR/pymon.db --target 'postgres://...'"
    echo "Потім задайте storage.backend: postgres і storage.dsn у $CONFIG_FILE та запустіть інсталятор ще раз."
    exit 1
fi
if [ "$EFFECTIVE_BACKEND" = "postgres" ] && [ -z "$DB_DSN" ]; then
    provision_postgres
fi
if [ "$EFFECTIVE_BACKEND" = "postgres" ]; then
    echo "[i] База даних: PostgreSQL (${PG_DB_HOST}:${PG_DB_PORT}/${PG_DB_NAME})"
else
    echo "[i] База даних: SQLite ($DATA_DIR/pymon.db)"
fi
echo "=============================================="
echo "   PyMon NOC - $MODE"
echo "=============================================="
echo ""

OLD_VERSION=""
if [ -x "$INSTALL_DIR/pymon" ] && [ ! -d "$INSTALL_DIR/pymon" ]; then
    OLD_VERSION="$("$INSTALL_DIR/pymon" --version 2>/dev/null || true)"
fi

# --- Architecture detection -------------------------------------------------
case "$(uname -m)" in
    x86_64|amd64)  ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)
        echo "ERROR: unsupported architecture: $(uname -m)"
        echo "Supported: x86_64/amd64, aarch64/arm64"
        exit 1
        ;;
esac
BINARY_NAME="pymon-linux-${ARCH}"

# Резолвимо тег: для 'latest' — найновіший monitoring-v* у dist (репозиторій спільний,
# тож /releases/latest не годиться); інакше нормалізуємо версію до тега dist.
if [ "$PYMON_VER" = "latest" ]; then
    TAG="$(curl -fsSL "https://api.github.com/repos/${DIST_REPO}/releases?per_page=100" \
        | grep -o '"tag_name": *"[^"]*"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/' \
        | grep "^${TAG_PREFIX}" | sort -V | tail -n1)"
    [ -n "$TAG" ] || { echo "ERROR: no ${TAG_PREFIX}* release found in ${DIST_REPO}"; exit 1; }
else
    case "$PYMON_VER" in
        ${TAG_PREFIX}*) TAG="$PYMON_VER" ;;
        v*)             TAG="${TAG_PREFIX}${PYMON_VER#v}" ;;
        *)              TAG="${TAG_PREFIX}${PYMON_VER}" ;;
    esac
fi

BASE_URL="https://github.com/${DIST_REPO}/releases/download/${TAG}"
DOWNLOAD_URL="${BASE_URL}/${BINARY_NAME}"
CHECKSUM_URL="${BASE_URL}/checksums.txt"

if ! echo "$DOWNLOAD_URL" | grep -qE '^https://github\.com/[^/]+/[^/]+/releases/download/'; then
    echo "ERROR: Invalid download URL generated"
    echo "TAG='$TAG' BINARY_NAME='$BINARY_NAME' DOWNLOAD_URL='$DOWNLOAD_URL'"
    exit 1
fi


echo "[1/4] Downloading PyMon ${TAG} (${BINARY_NAME})..."
TMP_BIN="$(mktemp)"
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_BIN" || { echo "ERROR: download failed. Is release ${TAG} published?"; rm -f "$TMP_BIN"; exit 1; }

# --- Verify SHA-256 checksum (fail-closed) ----------------------------------
# Glued/CRLF-tolerant parsing like uptime/mygit: look for "64hex  [*]name" as
# a substring, not anchored to end-of-line. An old release glued both entries
# on one line and the end-anchored grep silently skipped verification (amd64)
# or compared the wrong hash (arm64).
echo "Verifying checksum..."
if [ "${PYMON_SKIP_CHECKSUM:-0}" = "1" ]; then
    echo "WARNING: checksum verification explicitly skipped (PYMON_SKIP_CHECKSUM=1). Installing unverified binary."
else
    TMP_SUM="$(mktemp)"
    DOWNLOADED_SUM=0
    if curl -fsSL "$CHECKSUM_URL" -o "$TMP_SUM" 2>/dev/null; then DOWNLOADED_SUM=1; fi
    if [ "$DOWNLOADED_SUM" != "1" ] || [ ! -s "$TMP_SUM" ]; then
        echo "ERROR: could not download checksums.txt from ${CHECKSUM_URL}."
        echo "Refusing to install an unverified binary. Re-run once GitHub is reachable,"
        echo "or set PYMON_SKIP_CHECKSUM=1 to explicitly bypass verification."
        rm -f "$TMP_BIN" "$TMP_SUM"
        exit 1
    fi
    EXPECTED="$(tr -d '\r' < "$TMP_SUM" | grep -oE "[0-9a-fA-F]{64}[[:space:]]+\\*?${BINARY_NAME}" | awk '{print $1}' | head -n1)"
    if [ -z "$EXPECTED" ]; then
        echo "ERROR: checksums.txt has no entry for ${BINARY_NAME}; refusing to install an unverified binary."
        echo "Re-run once GitHub is reachable, or set PYMON_SKIP_CHECKSUM=1 to explicitly bypass verification."
        rm -f "$TMP_BIN" "$TMP_SUM"
        exit 1
    fi
    if command -v sha256sum >/dev/null 2>&1; then
        ACTUAL="$(sha256sum "$TMP_BIN" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
        ACTUAL="$(shasum -a 256 "$TMP_BIN" | awk '{print $1}')"
    else
        echo "ERROR: neither sha256sum nor shasum is installed; cannot verify checksum."
        echo "Install one of them and re-run, or set PYMON_SKIP_CHECKSUM=1 to bypass."
        rm -f "$TMP_BIN" "$TMP_SUM"
        exit 1
    fi
    if [ "$EXPECTED" != "$ACTUAL" ]; then
        echo "ERROR: checksum mismatch for ${BINARY_NAME}."
        echo "  expected: ${EXPECTED}"
        echo "  actual:   ${ACTUAL}"
        rm -f "$TMP_BIN" "$TMP_SUM"
        exit 1
    fi
    echo "Checksum OK."
    rm -f "$TMP_SUM"
fi

chmod +x "$TMP_BIN"
"$TMP_BIN" --version >/dev/null 2>&1 || { echo "ERROR: downloaded file is not a valid PyMon binary"; rm -f "$TMP_BIN"; exit 1; }
NEW_VERSION="$("$TMP_BIN" --version 2>/dev/null || echo "?")"

# --- Install binary ---------------------------------------------------------
echo "[2/4] Installing binary to ${INSTALL_DIR}/pymon..."
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR"

# Broken previous install may have left a directory at the binary path.
if [ -d "$INSTALL_DIR/pymon" ]; then
    echo "Removing stale directory at $INSTALL_DIR/pymon..."
    rm -rf "$INSTALL_DIR/pymon"
fi

# On update, keep a rollback copy of the previous binary — but only when it is
# a DIFFERENT version from the one being installed. Copying a same-version
# binary (retry after a failed update) would overwrite the last known-good
# .old with the very version that does not start.
if [ "$IS_UPDATE" = "1" ] && [ -f "$INSTALL_DIR/pymon" ]; then
    CUR_V="$("$INSTALL_DIR/pymon" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
    NEW_V="$(printf '%s' "$NEW_VERSION" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
    if [ -n "$CUR_V" ] && [ "$CUR_V" != "$NEW_V" ]; then
        cp -f "$INSTALL_DIR/pymon" "$INSTALL_DIR/pymon.old" 2>/dev/null || true
    fi
fi

install -m 0755 "$TMP_BIN" "$INSTALL_DIR/pymon"
rm -f "$TMP_BIN"

if ! "$INSTALL_DIR/pymon" --version >/dev/null 2>&1; then
    echo "ERROR: installed binary at $INSTALL_DIR/pymon is not runnable."
    echo "Restoring previous version if available..."
    [ -f "$INSTALL_DIR/pymon.old" ] && install -m 0755 "$INSTALL_DIR/pymon.old" "$INSTALL_DIR/pymon" || true
    exit 1
fi

# --- Config (kept on update, only created on first install) ----------------
CONFIG_CREATED=0
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Creating default config at $CONFIG_FILE ..."
        curl -fsSL "https://raw.githubusercontent.com/${DIST_REPO}/main/apps/monitoring/config.example.yml" -o "$CONFIG_FILE" \
            || cp "$(dirname "$0")/config.example.yml" "$CONFIG_FILE" 2>/dev/null || true
    CONFIG_CREATED=1
fi
if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: не вдалося створити $CONFIG_FILE (немає ні мережі, ні config.example.yml поруч)."
    exit 1
fi
if [ "$CONFIG_CREATED" = "1" ] || [ "$IS_UPDATE" != "1" ]; then
    apply_storage_config
fi
chmod 600 "$CONFIG_FILE"

# --- System user and service ------------------------------------------------
echo "[3/4] Configuring system user and service..."
if ! id pymon >/dev/null 2>&1; then
    useradd -r -s /bin/false -d "$INSTALL_DIR" pymon
fi
chown -R pymon:pymon "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR"

DB_UNIT_ENV="Environment=DB_PATH=$DATA_DIR/pymon.db"
DB_UNIT_AFTER=""
if [ "$EFFECTIVE_BACKEND" = "postgres" ]; then
    DB_UNIT_ENV=""
    if systemctl cat postgresql.service >/dev/null 2>&1; then
        DB_UNIT_AFTER=" postgresql.service"
    fi
fi

cat > /etc/systemd/system/$SERVICE_NAME.service <<EOF
[Unit]
Description=PyMon NOC Monitoring
After=network.target${DB_UNIT_AFTER}

[Service]
User=pymon
Group=pymon
ExecStart=$INSTALL_DIR/pymon server --config $CONFIG_FILE
Restart=always
RestartSec=5
Environment=CONFIG_PATH=$CONFIG_FILE
Environment=DATA_DIR=$DATA_DIR
Environment=LOG_DIR=$LOG_DIR
$DB_UNIT_ENV

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictRealtime=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ReadWritePaths=$DATA_DIR $LOG_DIR -$INSTALL_DIR/.config

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
# stopped with exact steps. Unattended runs: PYMON_LICENSE_KEY=<key> or
# PYMON_TRIAL_EMAIL=<email>.
LICENSE_FILE="$INSTALL_DIR/.config/pymon/license.json"
lic_cli() { sudo -u pymon env HOME="$INSTALL_DIR" "$INSTALL_DIR/pymon" "$@"; }
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

# The binary's own hints say `pymon license ...` — make that work: symlink onto
# PATH and point root's config dir at the service user's (root runs with
# HOME=/root; without the link `sudo pymon license activate` would write a
# license the service never reads).
mkdir -p /usr/local/bin
ln -sf "$INSTALL_DIR/pymon" /usr/local/bin/pymon
SVC_CFG_DIR="$INSTALL_DIR/.config/pymon"
mkdir -p "$SVC_CFG_DIR"
if [ ! -e /root/.config/pymon ] && [ ! -L /root/.config/pymon ]; then
    mkdir -p /root/.config
    ln -s "$SVC_CFG_DIR" /root/.config/pymon
elif [ -d /root/.config/pymon ] && [ ! -L /root/.config/pymon ] \
     && [ -s /root/.config/pymon/license.json ] && [ ! -s "$SVC_CFG_DIR/license.json" ]; then
    # A license was once activated as root: migrate it where the service looks.
    cp /root/.config/pymon/license.json "$SVC_CFG_DIR/license.json"
fi
chown -R pymon:pymon "$INSTALL_DIR/.config" 2>/dev/null || true

LICENSE_OK=0
if lic_valid; then
    LICENSE_OK=1
    echo "[i] Ліцензія: активна."
elif [ -n "$PYMON_LICENSE_KEY" ]; then
    echo "[i] Активація ліцензії з PYMON_LICENSE_KEY..."
    if license_activate_key "$PYMON_LICENSE_KEY"; then LICENSE_OK=1; fi
elif [ -n "$PYMON_TRIAL_EMAIL" ]; then
    echo "[i] Активація 3-денного Trial для $PYMON_TRIAL_EMAIL..."
    if license_start_trial "$PYMON_TRIAL_EMAIL"; then LICENSE_OK=1; fi
elif { true </dev/tty; } 2>/dev/null; then
    echo ""
    echo "======================================================="
    echo "  ЛІЦЕНЗІЯ PyMon не активована."
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
    if [ "$IS_UPDATE" = "1" ] && [ -f "$INSTALL_DIR/pymon.old" ] \
       && "$INSTALL_DIR/pymon.old" --version >/dev/null 2>&1; then
        OLD_V="$("$INSTALL_DIR/pymon.old" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
        NEWV="$(printf '%s' "$NEW_VERSION" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
        # Rollback only makes sense to a DIFFERENT version than the new one.
        if [ -n "$OLD_V" ] && [ "$OLD_V" != "$NEWV" ]; then ROLLBACK_OK=1; fi
    fi
    if [ "$ROLLBACK_OK" = "1" ]; then
        install -m 0755 "$INSTALL_DIR/pymon.old" "$INSTALL_DIR/pymon"
        systemctl restart $SERVICE_NAME >/dev/null 2>&1 || true
        RESTORED_V="$("$INSTALL_DIR/pymon" --version 2>/dev/null || echo '?')"
        echo "Оновлення скасовано: відновлено попередню версію ($RESTORED_V)."
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
    echo "  sudo pymon license trial <email>          # 3-денний Trial"
    echo "  sudo pymon license activate <key>         # придбаний ключ"
    echo "  sudo systemctl enable --now $SERVICE_NAME          # якщо автозапуск вимкнено"
    echo "Або просто запустіть інсталятор ще раз — він запитає ключ/email сам:"
    echo "  curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/monitoring/install.sh | sudo bash"
    echo ""
    echo "Не звітую про успіх: сервіс не працює на новій версії."
    exit 1
fi

systemctl stop $SERVICE_NAME 2>/dev/null || true

# --- Admin password (fresh install only, unless PYMON_ADMIN_PASSWORD set) ---
ADMIN_SET=0
if [ "$IS_UPDATE" = "1" ] && [ -z "$PYMON_ADMIN_PASSWORD" ]; then
    : # update: keep existing credentials
else
    HAS_ADMIN="$(sudo -u pymon DB_PATH="$DATA_DIR/pymon.db" "$INSTALL_DIR/pymon" has-admin --config "$CONFIG_FILE" 2>/dev/null || echo no)"
    if [ "$HAS_ADMIN" != "yes" ] || [ -n "$PYMON_ADMIN_PASSWORD" ]; then
        if [ -n "$PYMON_ADMIN_PASSWORD" ]; then
            ADMIN_PW="$PYMON_ADMIN_PASSWORD"
        else
            ADMIN_PW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 18)"
            if [ -z "$ADMIN_PW" ]; then
                echo "ERROR: failed to generate random admin password (/dev/urandom unavailable)."
                echo "Set PYMON_ADMIN_PASSWORD explicitly and re-run the installer."
                rm -f "$TMP_BIN"
                exit 1
            fi
        fi
        sudo -u pymon PYMON_ADMIN_PASSWORD="$ADMIN_PW" DB_PATH="$DATA_DIR/pymon.db" \
            "$INSTALL_DIR/pymon" reset-admin --config "$CONFIG_FILE"
        echo "$ADMIN_PW" > "$DATA_DIR/admin_password.txt"
        chown pymon:pymon "$DATA_DIR/admin_password.txt"
        chmod 600 "$DATA_DIR/admin_password.txt"
        ADMIN_SET=1
    fi
fi

systemctl restart $SERVICE_NAME

# --- Health check -----------------------------------------------------------
echo -n "Waiting for the service to become healthy..."
for i in $(seq 1 15); do
    if curl -fsS "http://localhost:10000/api/v1/health" >/dev/null 2>&1; then
        echo " OK"
        break
    fi
    if [ "$i" = "15" ]; then
        echo " FAILED"
        echo "Check the service log: journalctl -u $SERVICE_NAME"
        if journalctl -u $SERVICE_NAME -n 30 --no-pager 2>/dev/null | grep -q 'ЛІЦЕНЗІЯ'; then
            echo "--- ліцензія ---"
            echo "Схоже, сервіс не піднявся через ліцензію (див. [ЛІЦЕНЗІЯ] вище). Активуйте та повторіть:"
            echo "  sudo pymon license trial <email>    # або: sudo pymon license activate <key>"
            echo "  sudo systemctl restart $SERVICE_NAME"
        fi
        if [ "$IS_UPDATE" = "1" ] && [ -f "$INSTALL_DIR/pymon.old" ]; then
            echo "--- відкат ---"
            echo "  sudo systemctl stop $SERVICE_NAME"
            echo "  sudo mv $INSTALL_DIR/pymon.old $INSTALL_DIR/pymon && sudo systemctl start $SERVICE_NAME"
        fi
        exit 1
    else
        echo -n "."
        sleep 1
    fi
done

# --- Summary ----------------------------------------------------------------
echo "[4/4] Done."
echo ""
if [ "$IS_UPDATE" = "1" ]; then
    echo "PyMon NOC updated successfully."
    echo "  Version: ${OLD_VERSION:-?} -> ${NEW_VERSION}"
    echo "  Config, database and users were preserved."
    [ -f "$INSTALL_DIR/pymon.old" ] && echo "  Previous binary kept at: $INSTALL_DIR/pymon.old"
else
    echo "PyMon NOC installed successfully."
    echo "  Version: ${NEW_VERSION}"
    echo "  Config:   $CONFIG_FILE"
    if [ "$EFFECTIVE_BACKEND" = "postgres" ]; then
        echo "  Database: PostgreSQL ${PG_DB_USER}@${PG_DB_HOST}:${PG_DB_PORT}/${PG_DB_NAME}"
        [ -f "$PG_PASSWORD_FILE" ] && echo "  DB pass:  $PG_PASSWORD_FILE (0600)"
    else
        echo "  Database: SQLite $DATA_DIR/pymon.db"
    fi
    echo "  Service:  systemctl status $SERVICE_NAME"
fi
echo ""
echo "Dashboard: http://localhost:10000/"
echo "Ліцензія:   sudo pymon license status   (trial/activate — ті самі команди)"
echo ""
if [ "$ADMIN_SET" = "1" ]; then
    echo "===================================="
    echo "  Логін:    admin"
    echo "  Пароль:   $ADMIN_PW"
    echo "===================================="
    echo ""
    echo "При вході дашборд попросить змінити пароль."
    echo "Пароль також збережено: $DATA_DIR/admin_password.txt (видаліть після входу)"
    echo "  sudo rm $DATA_DIR/admin_password.txt"
elif [ "$IS_UPDATE" = "1" ]; then
    echo "Існуючі облікові дані збережено (пароль не змінювався)."
    echo "Якщо треба скинути пароль адміна:"
    if [ "$EFFECTIVE_BACKEND" = "postgres" ]; then
        echo "  sudo PYMON_ADMIN_PASSWORD='YourStrongPass123' $INSTALL_DIR/pymon reset-admin --config $CONFIG_FILE"
    else
        echo "  sudo PYMON_ADMIN_PASSWORD='YourStrongPass123' DB_PATH=$DATA_DIR/pymon.db $INSTALL_DIR/pymon reset-admin --config $CONFIG_FILE"
    fi
    echo "  sudo systemctl restart $SERVICE_NAME"
    echo "  Логін: admin / YourStrongPass123"
fi
echo ""
echo "Installed version: $("$INSTALL_DIR/pymon" --version)"
