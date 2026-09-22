#!/bin/bash
# PyMon NOC (Go) - one-line installer/updater (Ubuntu)
# The SAME command installs on first run and safely UPDATES on subsequent runs:
#   - keeps config (/etc/pymon/config.yml), database, users and admin password
#   - replaces only the binary and restarts the service
# Usage: curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/monitoring/install.sh | sudo bash

set -e

unset PYMON_VERSION

INSTALL_DIR="/opt/pymon"
CONFIG_DIR="/etc/pymon"
DATA_DIR="/var/lib/pymon"
LOG_DIR="/var/log/pymon"
SERVICE_NAME="pymon"
PYMON_VER="${PYMON_VERSION:-latest}"
# Релізи живуть у публічному dist (кодовий репозиторій приватний), тег monitoring-v<version>.
DIST_REPO="ajjs1ajjs/dist"
TAG_PREFIX="monitoring-v"

echo "DEBUG: PYMON_VERSION='$PYMON_VERSION' PYMON_VER='$PYMON_VER'" >&2

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

# --- Detect existing installation -------------------------------------------
IS_UPDATE=0
if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ] || [ -x "$INSTALL_DIR/pymon" ] || [ -f "$DATA_DIR/pymon.db" ]; then
    IS_UPDATE=1
fi

echo "DEBUG: IS_UPDATE=$IS_UPDATE INSTALL_DIR=$INSTALL_DIR DATA_DIR=$DATA_DIR"
echo "DEBUG: checking /etc/systemd/system/$SERVICE_NAME.service: $([ -f /etc/systemd/system/$SERVICE_NAME.service ] && echo exists || echo missing)"

if [ "$IS_UPDATE" = "1" ]; then
    MODE="Оновлення (update)"
else
    MODE="Встановлення (install)"
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

echo "DEBUG: TAG=$TAG DOWNLOAD_URL=$DOWNLOAD_URL"

echo "[1/4] Downloading PyMon ${TAG} (${BINARY_NAME})..."
TMP_BIN="$(mktemp)"
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_BIN" || { echo "ERROR: download failed. Is release ${TAG} published?"; rm -f "$TMP_BIN"; exit 1; }

# --- Verify SHA-256 checksum ------------------------------------------------
echo "Verifying checksum..."
TMP_SUM="$(mktemp)"
curl -fsSL "$CHECKSUM_URL" -o "$TMP_SUM" 2>/dev/null || true
if [ -s "$TMP_SUM" ]; then
    EXPECTED="$(grep "${BINARY_NAME}$" "$TMP_SUM" | awk '{print $1}')"
    if [ -n "$EXPECTED" ]; then
        if command -v sha256sum >/dev/null 2>&1; then
            ACTUAL="$(sha256sum "$TMP_BIN" | awk '{print $1}')"
        elif command -v shasum >/dev/null 2>&1; then
            ACTUAL="$(shasum -a 256 "$TMP_BIN" | awk '{print $1}')"
        else
            echo "Warning: no sha256 utility found, skipping checksum verification."
            ACTUAL=""
        fi
        if [ -n "$ACTUAL" ] && [ "$EXPECTED" != "$ACTUAL" ]; then
            echo "ERROR: checksum mismatch for ${BINARY_NAME}."
            echo "  expected: ${EXPECTED}"
            echo "  actual:   ${ACTUAL}"
            rm -f "$TMP_BIN" "$TMP_SUM"
            exit 1
        fi
        echo "Checksum OK."
    else
        echo "Warning: no checksum entry for ${BINARY_NAME}, skipping verification."
    fi
else
    echo "Warning: could not download checksums.txt, skipping verification."
fi
rm -f "$TMP_SUM"

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

# On update, keep a rollback copy of the previous binary.
if [ "$IS_UPDATE" = "1" ] && [ -f "$INSTALL_DIR/pymon" ]; then
    cp -f "$INSTALL_DIR/pymon" "$INSTALL_DIR/pymon.old" 2>/dev/null || true
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
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Creating default config at $CONFIG_FILE ..."
        curl -fsSL "https://raw.githubusercontent.com/${DIST_REPO}/main/apps/monitoring/config.example.yml" -o "$CONFIG_FILE" \
            || cp "$(dirname "$0")/config.example.yml" "$CONFIG_FILE" 2>/dev/null || true
fi

# --- System user and service ------------------------------------------------
echo "[3/4] Configuring system user and service..."
if ! id pymon >/dev/null 2>&1; then
    useradd -r -s /bin/false -d "$INSTALL_DIR" pymon
fi
chown -R pymon:pymon "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR"

systemctl stop $SERVICE_NAME 2>/dev/null || true

cat > /etc/systemd/system/$SERVICE_NAME.service <<EOF
[Unit]
Description=PyMon NOC Monitoring
After=network.target

[Service]
User=pymon
Group=pymon
ExecStart=$INSTALL_DIR/pymon server --config $CONFIG_FILE
Restart=always
RestartSec=5
Environment=CONFIG_PATH=$CONFIG_FILE
Environment=DATA_DIR=$DATA_DIR
Environment=LOG_DIR=$LOG_DIR
Environment=DB_PATH=$DATA_DIR/pymon.db

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
ReadWritePaths=$DATA_DIR $LOG_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $SERVICE_NAME

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
    echo "  Database: $DATA_DIR/pymon.db"
    echo "  Service:  systemctl status $SERVICE_NAME"
fi
echo ""
echo "Dashboard: http://localhost:10000/"
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
    echo "  sudo PYMON_ADMIN_PASSWORD='YourStrongPass123' $INSTALL_DIR/pymon reset-admin --config $CONFIG_FILE"
    echo "  sudo systemctl restart $SERVICE_NAME"
    echo "  Логін: admin / YourStrongPass123"
fi
echo ""
echo "Installed version: $("$INSTALL_DIR/pymon" --version)"
