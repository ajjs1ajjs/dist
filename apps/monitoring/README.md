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
PYMON_VERSION=3.3.0 curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/monitoring/install.sh | sudo bash
```

## Що робить скрипт

- Визначає архітектуру (`amd64`/`arm64`) і резолвить найновіший реліз `monitoring-v*` у
  цьому репозиторії (не `/releases/latest` — репозиторій спільний для кількох продуктів).
- Перевіряє **SHA-256** з `checksums.txt` — fail-closed (`PYMON_SKIP_CHECKSUM=1` — лише для
  air-gapped дзеркал).
- Ставить systemd-юніт із hardening і створює пароль адміна (показує один раз).

## Файли

- [`install.sh`](install.sh) — інсталятор/оновлювач (Ubuntu).
- [`config.example.yml`](config.example.yml) — зразок конфіга (копіюється при першому встановленні).

Вихідний код — у приватному репозиторії.
