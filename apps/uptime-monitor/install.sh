#!/bin/bash
# Uptime Monitor (Go) - one-line installer/updater (Ubuntu / Debian)
# The SAME command installs on first run and safely UPDATES on subsequent runs:
#   - keeps config, database, users and admin password
#   - replaces only the binary and restarts the service
# Usage: curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/install.sh | sudo bash

set -e

INSTALL_DIR="/opt/uptime-monitor"
CONFIG_DIR="/etc/uptime-monitor"
DATA_DIR="/var/lib/uptime-monitor"
LOG_DIR="/var/log/uptime-monitor"
SERVICE_NAME="uptime-monitor"
UM_VERSION="${UPTIME_MONITOR_VERSION:-latest}"
# Релізи живуть у публічному dist (кодовий репозиторій приватний), тег uptime-v<version>.
DIST_REPO="ajjs1ajjs/dist"
TAG_PREFIX="uptime-v"
CONFIG_FILE="$CONFIG_DIR/config.json"

if [ "$(id -u)" -ne 0 ]; then
    echo "Please run as root (sudo ./install.sh)"
    exit 1
fi

# --- OS version check -------------------------------------------------------
if [ -f /etc/os-release ]; then
    . /etc/os-release
    if [ "$ID" != "ubuntu" ] && [ "$ID" != "debian" ]; then
        echo "ERROR: This installer supports Ubuntu and Debian only. Detected: $ID"
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
        echo "ERROR: Unsupported $ID version: $VERSION_ID. Supported: Ubuntu/Debian 24, 25, 26 (latest and preview)."
        exit 1
    fi
    echo "[OK] Detected $ID $VERSION_ID ($PRETTY_NAME) — supported."
fi

# --- Detect existing installation -------------------------------------------
IS_UPDATE=0
if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ] || [ -x "$INSTALL_DIR/uptime-monitor" ] || [ -f "$DATA_DIR/sites.db" ]; then
    IS_UPDATE=1
fi
if [ "$IS_UPDATE" = "1" ]; then MODE="Оновлення (update)"; else MODE="Встановлення (install)"; fi

echo "=============================================="
echo "   Uptime Monitor - $MODE"
echo "=============================================="
echo ""

OLD_VERSION=""
if [ -x "$INSTALL_DIR/uptime-monitor" ] && [ ! -d "$INSTALL_DIR/uptime-monitor" ]; then
    OLD_VERSION="$("$INSTALL_DIR/uptime-monitor" --version 2>/dev/null || true)"
fi

# --- Architecture -----------------------------------------------------------
case "$(uname -m)" in
    x86_64|amd64)  ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)
        echo "ERROR: unsupported architecture: $(uname -m)"
        exit 1
        ;;
esac
BINARY_NAME="uptime-monitor-linux-${ARCH}"

# Resolve the tag: 'latest' -> newest uptime-v* release in dist (the repo is
# shared with other products, so /releases/latest would be wrong); otherwise
# normalise the requested version to a dist tag.
if [ "$UM_VERSION" = "latest" ]; then
    TAG="$(curl -fsSL "https://api.github.com/repos/${DIST_REPO}/releases?per_page=100" \
        | grep -o '"tag_name": *"[^"]*"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/' \
        | grep "^${TAG_PREFIX}" | sort -V | tail -n1)"
    [ -n "$TAG" ] || { echo "ERROR: no ${TAG_PREFIX}* release found in ${DIST_REPO}"; exit 1; }
else
    case "$UM_VERSION" in
        ${TAG_PREFIX}*) TAG="$UM_VERSION" ;;
        v*)             TAG="${TAG_PREFIX}${UM_VERSION#v}" ;;
        *)              TAG="${TAG_PREFIX}${UM_VERSION}" ;;
    esac
fi
BASE_URL="https://github.com/${DIST_REPO}/releases/download/${TAG}"
DOWNLOAD_URL="${BASE_URL}/${BINARY_NAME}"
CHECKSUMS_URL="${BASE_URL}/checksums.txt"

# --- Download ----------------------------------------------------------------
echo "[1/4] Downloading Uptime Monitor ${TAG} (${BINARY_NAME})..."
TMP_BIN="$(mktemp)"
if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$DOWNLOAD_URL" -o "$TMP_BIN" || { echo "ERROR: download failed. Is release ${TAG} published?"; rm -f "$TMP_BIN"; exit 1; }
elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$TMP_BIN" "$DOWNLOAD_URL" || { echo "ERROR: download failed. Is release ${TAG} published?"; rm -f "$TMP_BIN"; exit 1; }
else
    echo "ERROR: neither curl nor wget is installed."
    rm -f "$TMP_BIN"
    exit 1
fi

# --- Checksum (fail-closed: refuse to install an unverified binary) ---------
# Every release since checksums.txt was introduced publishes one; if it can't
# be fetched, doesn't contain this binary, or no SHA-256 tool is available, we
# do NOT fall back to installing unverified. UPTIME_MONITOR_SKIP_CHECKSUM=1 is
# an explicit, documented opt-out for air-gapped/legacy scenarios only.
echo "Verifying checksum..."
if [ "$UPTIME_MONITOR_SKIP_CHECKSUM" = "1" ]; then
    echo "WARNING: checksum verification explicitly skipped (UPTIME_MONITOR_SKIP_CHECKSUM=1). Installing unverified binary."
else
    # CHECKSUMS_URL already resolved above (dist release for $TAG).
    TMP_SUM="$(mktemp)"
    DL_OK=0
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$CHECKSUMS_URL" -o "$TMP_SUM" && DL_OK=1
    elif command -v wget >/dev/null 2>&1; then
        wget -q -O "$TMP_SUM" "$CHECKSUMS_URL" && DL_OK=1
    fi
    if [ "$DL_OK" != "1" ] || [ ! -s "$TMP_SUM" ]; then
        echo "ERROR: could not download checksums.txt from ${CHECKSUMS_URL}."
        echo "Refusing to install an unverified binary. Re-run once GitHub is reachable,"
        echo "or set UPTIME_MONITOR_SKIP_CHECKSUM=1 to explicitly bypass verification."
        rm -f "$TMP_BIN" "$TMP_SUM"
        exit 1
    fi
    EXPECTED="$(tr -d '\r' < "$TMP_SUM" | grep "${BINARY_NAME}$" | awk '{print $1}')"
    if [ -z "$EXPECTED" ]; then
        echo "ERROR: checksums.txt has no entry for ${BINARY_NAME}; refusing to install an unverified binary."
        rm -f "$TMP_BIN" "$TMP_SUM"
        exit 1
    fi
    if command -v sha256sum >/dev/null 2>&1; then
        ACTUAL="$(sha256sum "$TMP_BIN" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
        ACTUAL="$(shasum -a 256 "$TMP_BIN" | awk '{print $1}')"
    else
        echo "ERROR: neither sha256sum nor shasum is installed; cannot verify checksum."
        echo "Install one of them and re-run, or set UPTIME_MONITOR_SKIP_CHECKSUM=1 to bypass."
        rm -f "$TMP_BIN" "$TMP_SUM"
        exit 1
    fi
    if [ "$EXPECTED" != "$ACTUAL" ]; then
        echo "ERROR: checksum mismatch for ${BINARY_NAME}. Expected ${EXPECTED}, got ${ACTUAL}."
        rm -f "$TMP_BIN" "$TMP_SUM"
        exit 1
    fi
    echo "Checksum OK."
    rm -f "$TMP_SUM"
fi
chmod +x "$TMP_BIN"
"$TMP_BIN" --version >/dev/null 2>&1 || { echo "ERROR: downloaded file is not a valid binary"; rm -f "$TMP_BIN"; exit 1; }
NEW_VERSION="$("$TMP_BIN" --version 2>/dev/null || echo "?")"

# --- Install binary ----------------------------------------------------------
echo "[2/4] Installing binary..."
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR"
if [ -d "$INSTALL_DIR/uptime-monitor" ]; then rm -rf "$INSTALL_DIR/uptime-monitor"; fi
if [ "$IS_UPDATE" = "1" ] && [ -f "$INSTALL_DIR/uptime-monitor" ]; then
    cp -f "$INSTALL_DIR/uptime-monitor" "$INSTALL_DIR/uptime-monitor.old" 2>/dev/null || true
fi
install -m 0755 "$TMP_BIN" "$INSTALL_DIR/uptime-monitor"
rm -f "$TMP_BIN"
if ! "$INSTALL_DIR/uptime-monitor" --version >/dev/null 2>&1; then
    echo "ERROR: installed binary is not runnable. Restoring previous version..."
    [ -f "$INSTALL_DIR/uptime-monitor.old" ] && install -m 0755 "$INSTALL_DIR/uptime-monitor.old" "$INSTALL_DIR/uptime-monitor" || true
    exit 1
fi

# --- Config (kept on update, created on first install) -----------------------
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Creating default config at $CONFIG_FILE ..."
    cat > "$CONFIG_FILE" <<'EOF'
{
  "server": {
    "port": 8080,
    "host": "0.0.0.0",
    "trusted_proxies": [],
    "allow_localhost": false,
    "allow_private_networks": false
  },
  "data_dir": "/var/lib/uptime-monitor",
  "log_dir": "/var/log/uptime-monitor",
  "check_interval": 60,
  "alert_policy": {
    "request_timeout_seconds": 15,
    "grace_period_seconds": 0,
    "up_success_threshold": 3,
    "still_down_repeat_seconds": 600,
    "treat_4xx_as_down": true,
    "verify_ssl": true,
    "ssl_notification_days": [30, 14, 7, 5, 3, 1],
    "ssl_notification_cooldown_seconds": 21600,
    "ssl_check_interval_hours": 6,
    "retry_delays": [10, 10, 10, 10, 10],
    "max_retries": 5
  },
  "backup": {
    "enabled": true,
    "max_backups": 10,
    "backup_dir": "/var/lib/uptime-monitor/backups"
  }
}
EOF
fi

# --- User + service -----------------------------------------------------------
echo "[3/4] Configuring system user and service..."
if ! id uptime >/dev/null 2>&1; then
    useradd -r -s /bin/false -d "$INSTALL_DIR" uptime
fi
chown -R uptime:uptime "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR"
systemctl stop $SERVICE_NAME 2>/dev/null || true

cat > /etc/systemd/system/$SERVICE_NAME.service <<EOF
[Unit]
Description=Uptime Monitor
After=network.target

[Service]
User=uptime
Group=uptime
ExecStart=$INSTALL_DIR/uptime-monitor server --config $CONFIG_FILE
Restart=always
RestartSec=5
Environment=CONFIG_PATH=$CONFIG_FILE
Environment=DATA_DIR=$DATA_DIR
Environment=LOG_DIR=$LOG_DIR
Environment=DB_PATH=$DATA_DIR/sites.db
# Hardening: no privilege escalation, read-only system, private /tmp.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
CapabilityBoundingSet=
ReadWritePaths=$DATA_DIR $LOG_DIR $CONFIG_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $SERVICE_NAME

# --- Admin password (fresh install only, unless UPTIME_MONITOR_ADMIN_PASSWORD) --
# The binary itself never writes admin_password.txt (the password is shown on
# stdout once); remove leftovers created by older versions.
if [ -z "$UPTIME_MONITOR_WRITE_PASSWORD_FILE" ]; then
    rm -f "$DATA_DIR/admin_password.txt"
fi
ADMIN_SET=0
if [ "$IS_UPDATE" = "1" ] && [ -z "$UPTIME_MONITOR_ADMIN_PASSWORD" ] && [ -z "$PYMON_ADMIN_PASSWORD" ]; then
    : # update: keep existing credentials
else
    HAS_ADMIN="$(sudo -u uptime DB_PATH="$DATA_DIR/sites.db" "$INSTALL_DIR/uptime-monitor" has-admin --config "$CONFIG_FILE" 2>/dev/null || echo no)"
    if [ "$HAS_ADMIN" != "yes" ] || [ -n "$UPTIME_MONITOR_ADMIN_PASSWORD" ] || [ -n "$PYMON_ADMIN_PASSWORD" ]; then
        ADMIN_PW="${UPTIME_MONITOR_ADMIN_PASSWORD:-$PYMON_ADMIN_PASSWORD}"
        if [ -z "$ADMIN_PW" ]; then
            ADMIN_PW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 18)"
            if [ -z "$ADMIN_PW" ]; then ADMIN_PW="Uptime$(date +%s)"; fi
        fi
        sudo -u uptime UPTIME_MONITOR_ADMIN_PASSWORD="$ADMIN_PW" DB_PATH="$DATA_DIR/sites.db" \
            "$INSTALL_DIR/uptime-monitor" reset-admin --config "$CONFIG_FILE"
        # Optional on-disk copy for headless/scripted installs (opt-in).
        if [ -n "$UPTIME_MONITOR_WRITE_PASSWORD_FILE" ]; then
            echo "$ADMIN_PW" > "$DATA_DIR/admin_password.txt"
            chown uptime:uptime "$DATA_DIR/admin_password.txt"
            chmod 600 "$DATA_DIR/admin_password.txt"
            echo "Пароль збережено: $DATA_DIR/admin_password.txt (видаліть після входу)"
        fi
        ADMIN_SET=1
    fi
fi

systemctl restart $SERVICE_NAME

# --- Health check -------------------------------------------------------------
# A service that never came up must NOT be reported as a successful update.
# This used to print " FAILED" and then fall straight through to "updated
# successfully" with exit code 0, so the operator only found out later, from
# the dashboard.
#
# Two distinct outcomes, because the HTTP probe is not authoritative: the port
# comes from config.json (and the bind host may not be localhost at all), so a
# probe failure does not prove the service is down.
#   - unit not active        -> hard failure, logs + rollback instructions
#   - unit active, no answer -> warning only, the update itself is fine
#
# The window is 60s rather than 15s because startup is not instant on a large
# database: schema and timestamp migrations run before the port opens
# (measured at ~4s for 30 days of history across 20 monitors, and only on the
# first boot after an upgrade).
UM_PORT=8080
if [ -f "$CONFIG_FILE" ]; then
    CFG_PORT="$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]\+' "$CONFIG_FILE" 2>/dev/null | head -1 | grep -o '[0-9]\+$')"
    [ -n "$CFG_PORT" ] && UM_PORT="$CFG_PORT"
fi

echo -n "Waiting for the service to become healthy (port ${UM_PORT})..."
HEALTHY=0
for i in $(seq 1 30); do
    if curl -fsS "http://localhost:${UM_PORT}/health" >/dev/null 2>&1; then
        HEALTHY=1
        echo " OK"
        break
    fi
    if ! systemctl is-active --quiet $SERVICE_NAME; then
        break   # dead unit: no point waiting out the full window
    fi
    echo -n "."
    sleep 2
done

if [ "$HEALTHY" != "1" ]; then
    echo " FAILED"
    echo ""
    if systemctl is-active --quiet $SERVICE_NAME; then
        # Running, but the probe could not reach it. Most likely a non-default
        # bind host, or a port this installer could not read out of config.json.
        echo "WARNING: $SERVICE_NAME is running, but http://localhost:${UM_PORT}/health did not answer."
        echo "If the service listens on another address or port, this is expected - check manually:"
        echo "  curl -fsS http://<host>:<port>/health"
        echo "  systemctl status $SERVICE_NAME --no-pager"
        echo ""
    else
        echo "ERROR: $SERVICE_NAME is not running after the update."
        echo ""
        echo "--- systemctl status ---"
        systemctl status $SERVICE_NAME --no-pager -l 2>&1 | head -20 || true
        echo ""
        echo "--- last log lines ---"
        journalctl -u $SERVICE_NAME -n 30 --no-pager 2>&1 || true
        echo ""
        if [ "$IS_UPDATE" = "1" ] && [ -f "$INSTALL_DIR/uptime-monitor.old" ]; then
            echo "The previous binary is still in place, so this is reversible:"
            echo ""
            echo "  sudo systemctl stop $SERVICE_NAME"
            echo "  sudo mv $INSTALL_DIR/uptime-monitor.old $INSTALL_DIR/uptime-monitor"
            echo "  sudo systemctl start $SERVICE_NAME"
            echo ""
            echo "Config, database and users were not modified by this installer."
        fi
        echo "Refusing to report a successful update."
        exit 1
    fi
fi

# --- Summary ------------------------------------------------------------------
echo "[4/4] Done."
echo ""
if [ "$IS_UPDATE" = "1" ]; then
    echo "Uptime Monitor updated successfully."
    echo "  Version: ${OLD_VERSION:-?} -> ${NEW_VERSION}"
    echo "  Config, database and users were preserved."
    [ -f "$INSTALL_DIR/uptime-monitor.old" ] && echo "  Previous binary kept at: $INSTALL_DIR/uptime-monitor.old"
else
    echo "Uptime Monitor installed successfully."
    echo "  Config:   $CONFIG_FILE"
    echo "  Database: $DATA_DIR/sites.db"
fi
echo ""
echo "Dashboard: http://localhost:${UM_PORT}/"
echo ""
if [ "$ADMIN_SET" = "1" ]; then
    echo "===================================="
    echo "  Логін:    admin"
    echo "  Пароль:   $ADMIN_PW"
    echo "===================================="
    echo "При вході система попросить змінити пароль."
    echo "Пароль більше не зберігається на диску — запишіть його."
    if [ -n "$UPTIME_MONITOR_WRITE_PASSWORD_FILE" ]; then
        echo "Копія пароля: $DATA_DIR/admin_password.txt (видаліть після входу)"
    fi
else
    echo "Існуючі облікові дані збережено (пароль не змінювався)."
    echo "Якщо треба скинути пароль адміна:"
    echo "  sudo UPTIME_MONITOR_ADMIN_PASSWORD='YourStrongPass123' $INSTALL_DIR/uptime-monitor reset-admin --config $CONFIG_FILE"
    echo "  sudo systemctl restart $SERVICE_NAME"
fi
echo ""
echo "Installed version: $("$INSTALL_DIR/uptime-monitor" --version)"
