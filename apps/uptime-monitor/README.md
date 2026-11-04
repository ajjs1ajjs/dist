# Uptime Monitor - інсталятор

Моніторинг доступності та SSL (Go). **Сервер — Linux: Ubuntu 24/25/26 або Debian 11/12/13** (amd64/arm64).

Актуальний реліз: [Uptime Monitor 3.10.32](https://github.com/ajjs1ajjs/dist/releases/tag/uptime-v3.10.32).

## Встановлення / оновлення (одна команда)

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/install.sh | sudo bash
```

Та сама команда і встановлює, і оновлює: конфіг (`/etc/uptime-monitor/config.json`),
БД, користувачі та пароль **зберігаються**; замінюється лише бінарник, попередній
лишається як `uptime-monitor.old` (відкат).

Конкретна версія:

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/install.sh | sudo env UPTIME_MONITOR_VERSION=3.10.32 bash
```

## Власний домен та HTTPS (3.10.31+)

За замовчуванням залишається HTTP за IP та портом. HTTPS — додаткова можливість
із готовим PEM-сертифікатом і приватним ключем, без окремого reverse proxy.

- **Через інтерфейс:** Налаштування → DNS та HTTPS. Вкажіть домен і порт,
  виберіть сертифікат/ключ із комп’ютера або серверні шляхи, перевірте та збережіть.
  Нова адреса застосовується після окремого підтвердження перезапуску.
- **Через конфіг:** ті самі параметри доступні в `server` у
  `/etc/uptime-monitor/config.json`. Інші наявні налаштування збережіть.

Штатний інсталятор налаштовує дозвіл на порт 443 і перезапуск із панелі.
DNS-запис, фаєрвол/NAT та поновлення сертифіката налаштовуються окремо.
Загальна покрокова [довідка для початківців і спеціалістів](HTTPS.md) містить
підказки, шляхи, команди, перевірки й повернення до HTTP.

## Зберігання історії (3.10.25)

Історія перевірок зберігається **30 днів за замовчуванням**, у тому числі для
старих конфігурацій без параметра `history_retention_days`. За потреби строк
задається явно в `/etc/uptime-monitor/config.json`; довший строк збільшує БД і
повні бекапи. SLA-звіти показують покриття спостереженнями та невідомий час.
Терміни зберігання сповіщень, бекапів і системного журналу налаштовуються окремо.

## Підмережі однією командою (v3.8.20+)

```bash
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/subnet-seed.sh | sudo bash
```

Створює/оновлює subnet-монітори для списку підмереж (дефолт: `10.100.2.0/24` … `10.100.10.0/24`):
шлюз `.1` — якір, інтервал 120 с, UP-поріг 5, стара тривога моніторів скидається.
Алерт у канал — лише коли **шлюз мовчить 2 цикли підряд або 0/N цілей**; часткова
недоступність показується в дашборді, але не шле сповіщень.

Свій список / канали:

```bash
# свої підмережі (необов'язково зі своїм шлюзом через =)
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/subnet-seed.sh \
  | sudo bash -s -- 10.100.2.0/24 10.100.3.0/24=10.100.3.254

# канали для НОВИХ моніторів (дефолт ["telegram"]; [] — без сповіщень)
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/subnet-seed.sh | sudo NOTIFY='[]' bash

# канали наявних моніторів не змінюються, доки явно не додати FORCE_NOTIFY=1
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/subnet-seed.sh | sudo FORCE_NOTIFY=1 bash
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
- [`subnet-seed.sh`](subnet-seed.sh) - одноразове (ідемпотентне) налаштування subnet-моніторів.
- [`HTTPS.md`](HTTPS.md) — налаштування домену та HTTPS через інтерфейс або конфіг.
- [`config.example.json`](config.example.json) — приклад конфігу; HTTPS вимкнений за замовчуванням.
- Повний код - у приватному репозиторії `ajjs1ajjs/Uptime-Monitor`.
