#!/bin/bash
# subnet-seed.sh - одноразове (ідемпотентне) налаштування subnet-моніторів
# Uptime-Monitor: створює/оновлює по одному монітору на кожну підмережу,
# ставить шлюз .1 якорем і безпечні пороги (120с, UP-поріг 5).
#
# Канонічна копія: dist/apps/uptime-monitor/subnet-seed.sh; дубль у
# Uptime-Monitor/scripts/ — правити ОБИДВІ (як install.sh).
#
# Приклади:
#   curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/subnet-seed.sh | sudo bash
#   sudo ./subnet-seed.sh 10.100.2.0/24 10.100.3.0/24=10.100.3.254
#   NOTIFY='' sudo ./subnet-seed.sh        # нові монітори — без каналів
#   FORCE_NOTIFY=1 sudo ./subnet-seed.sh   # перезаписати канали й у НАЯВНИХ моніторів
#   RESET=0 sudo ./subnet-seed.sh          # не скидати стан/тривогу моніторів
#
# Потрібна версія >= 3.8.20 (команда `uptime-monitor subnet`).
set -euo pipefail

DEFAULT_SUBNETS="10.100.2.0/24 10.100.3.0/24 10.100.4.0/24 10.100.5.0/24 10.100.6.0/24 10.100.7.0/24 10.100.8.0/24 10.100.9.0/24 10.100.10.0/24"

# Канали для НОВИХ моніторів (JSON notify_methods). Порожньо = без каналів.
if [ -z "${NOTIFY+x}" ]; then NOTIFY='["telegram"]'; fi
INTERVAL="${INTERVAL:-120}"
UP_THRESHOLD="${UP_THRESHOLD:-5}"
RESET="${RESET:-1}"
FORCE_NOTIFY="${FORCE_NOTIFY:-0}"

BIN="${UM_BIN:-/opt/uptime-monitor/uptime-monitor}"
CONFIG="${UM_CONFIG:-/etc/uptime-monitor/config.json}"
DB="${UM_DB:-/var/lib/uptime-monitor/sites.db}"

die() { echo "ПОМИЛКА: $*" >&2; exit 1; }

[ -x "$BIN" ] || die "не знайдено $BIN — спершу встанови/онови Uptime-Monitor"
[ -f "$CONFIG" ] || die "не знайдено $CONFIG"
[ -f "$DB" ] || die "не знайдено $DB"

# Сервіс працює під користувачем uptime: запускаємо CLI від нього, щоб не
# змінити власника WAL-файлів БД.
RUN=("$BIN")
if [ "$(id -u)" -eq 0 ] && id uptime >/dev/null 2>&1; then
  RUN=(sudo -u uptime "$BIN")
fi

# Перевірка можливості: команда `subnet` з'явилась у 3.8.19, актуальне
# фінальне наповнення — у 3.8.20.
if ! "${RUN[@]}" subnet list --config "$CONFIG" --db "$DB" >/dev/null 2>&1; then
  die "встановлений бінарник не має команди 'subnet' (потрібна версія >= 3.8.20, зараз: $("$BIN" --version 2>/dev/null || echo '?')). Онови: curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/install.sh | sudo bash"
fi

subnets=("$@")
if [ "${#subnets[@]}" -eq 0 ]; then
  read -r -a subnets <<< "$DEFAULT_SUBNETS"
fi

echo "Налаштовую ${#subnets[@]} підмереж(і): interval=${INTERVAL}s, up-threshold=${UP_THRESHOLD}, notify=${NOTIFY:-<без змін>}"
for entry in "${subnets[@]}"; do
  cidr="${entry%%=*}"
  gw=""
  [ "$entry" != "$cidr" ] && gw="${entry#*=}"
  args=( subnet ensure --cidr "$cidr" --interval "$INTERVAL" --up-threshold "$UP_THRESHOLD" --config "$CONFIG" --db "$DB" )
  [ "$RESET" = "1" ] && args+=( --reset-state )
  [ -n "$gw" ] && args+=( --targets "$gw" )
  [ -n "$NOTIFY" ] && args+=( --notify-methods "$NOTIFY" )
  [ "$FORCE_NOTIFY" = "1" ] && args+=( --force-notify )
  "${RUN[@]}" "${args[@]}"
done

echo
echo "Готово. Поточний стан:"
"${RUN[@]}" subnet list --config "$CONFIG" --db "$DB"
echo
echo "Політика: алерт лише коли шлюз мовчить 2 цикли підряд або 0/N цілей; нагадування — раз на годину;"
echo "часткова недоступність показується в дашборді, але не шле сповіщень."
