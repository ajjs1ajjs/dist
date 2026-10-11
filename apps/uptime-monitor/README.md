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

## Ліцензія

Сервіс fail-closed перевіряє ліцензію при кожному старті: без неї він не запускається.
Інсталятор пропонує активувати її одразу — ввести ключ (`AK-…`) або отримати безкоштовний
3-денний Trial (потрібен email). Пропустити теж безпечно: оновлення **відкочується** на
попередню версію (сервіс далі працює), а свіже встановлення лишається зупиненим — без
циклу перезапусків systemd.

Для неінтерактивних запусків (CI, cron):

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/install.sh | sudo UPTIME_MONITOR_TRIAL_EMAIL=you@example.com bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/install.sh | sudo UPTIME_MONITOR_LICENSE_KEY=AK-XXXX-XXXX-XXXX bash
```

Керування ліцензією: `sudo uptime-monitor license status` (або `activate` / `trial`).

## Файли

- [`install.sh`](install.sh) - інсталятор/апдейтер (Ubuntu/Debian).
- Повний код - у приватному репозиторії `ajjs1ajjs/Uptime-Monitor`.
