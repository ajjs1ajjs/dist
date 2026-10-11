# PyMon NOC — встановлення

Платформа моніторингу інфраструктури (Go). **Сервер — Ubuntu 24/25/26** (amd64/arm64);
ноди можуть бути Linux (`node_exporter`) і Windows (`windows_exporter`).

## Встановлення / оновлення (одна команда)

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/monitoring/install.sh | sudo bash
```

Та сама команда і встановлює, і оновлює: конфіг (`/etc/pymon/config.yml`), база, користувачі
й пароль **зберігаються**; замінюється лише бінарник, а старий лишається як `pymon.old`
(відкат).

Конкретна версія:

```bash
PYMON_VERSION=3.3.2 curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/monitoring/install.sh | sudo bash
```

## Що робить скрипт

- Визначає архітектуру (`amd64`/`arm64`) і резолвить найновіший реліз `monitoring-v*` у
  цьому репозиторії (не `/releases/latest` — репозиторій спільний для кількох продуктів).
- Перевіряє **SHA-256** з `checksums.txt` — fail-closed (`PYMON_SKIP_CHECKSUM=1` — лише для
  air-gapped дзеркал).
- Ставить systemd-юніт із hardening і створює пароль адміна (показує один раз).

## Ліцензія

Сервіс fail-closed перевіряє ліцензію при кожному старті: без неї він не запускається.
Інсталятор пропонує активувати її одразу — ключ (`AK-…`) або 3-денний Trial (email).
Пропустити безпечно: оновлення відкочується на попередню версію (сервіс далі працює),
свіже встановлення лишається зупиненим — без циклу перезапусків.

Неінтерактивно:

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/monitoring/install.sh | sudo PYMON_TRIAL_EMAIL=you@example.com bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/monitoring/install.sh | sudo PYMON_LICENSE_KEY=AK-XXXX-XXXX-XXXX bash
```

Керування: `sudo pymon license status` (або `activate` / `trial`).

## Файли

- [`install.sh`](install.sh) — інсталятор/оновлювач (Ubuntu).
- [`config.example.yml`](config.example.yml) — зразок конфіга (копіюється при першому встановленні).

Вихідний код — у приватному репозиторії.
