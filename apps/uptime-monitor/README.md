# Uptime Monitor - інсталятор

Моніторинг доступності та SSL (Go). **Сервер - Ubuntu/Debian 24/25/26** (amd64/arm64).

## Встановлення / оновлення (одна команда)

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/install.sh | sudo bash
```

Та сама команда і встановлює, і оновлює: конфіг (`/etc/uptime-monitor/config.json`),
БД, користувачі та пароль **зберігаються**; замінюється лише бінарник, попередній
лишається як `uptime-monitor.old` (відкат).

Конкретна версія:

```bash
UPTIME_MONITOR_VERSION=3.7.2 curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/install.sh | sudo bash
```

## Як це працює

- Бінарники (`uptime-monitor-linux-amd64` / `-arm64`) публікуються як релізи
  `uptime-v*` у цьому ж репозиторії `dist`.
- `latest` резолвиться як **найновіший `uptime-v*`** реліз (не `/releases/latest` -
  у спільному репо останній реліз може належати іншому продукту).
- Перевірка **SHA-256** з `checksums.txt` - fail-closed
  (`UPTIME_MONITOR_SKIP_CHECKSUM=1` - лише для air-gapped сценаріїв).
- Ставить systemd-юніт з hardening і рестартить службу; невдалий старт не
  рапортується як успішне оновлення (бінарник відкочується).

## Файли

- [`install.sh`](install.sh) - інсталятор/апдейтер (Ubuntu/Debian).
- Повний код - у приватному репозиторії `ajjs1ajjs/Uptime-Monitor`.
