# MyGit — встановлення

Self-hosted Git-платформа (Go). **Сервер — Ubuntu 24/25/26** (amd64/arm64), статичні бінарники.

## Встановлення / оновлення (одна команда)

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/mygit/install.sh | sudo bash
```

Та сама команда і встановлює, і оновлює: дані (`/var/lib/mygit`), репозиторії та користувачі
**зберігаються**; замінюється лише бінарник (старий лишається як `mygit.old` для відкату).

Після запуску відкрийте `http://<IP>:8060/` і **зареєструйте перший обліковий запис** — він
стане власником (superuser).

Конкретна версія:

```bash
MYGIT_VERSION=3.6.0 curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/mygit/install.sh | sudo bash
```

## Що робить скрипт

- Визначає архітектуру (`amd64`/`arm64`) і резолвить найновіший реліз `mygit-v*` у цьому
  репозиторії (не `/releases/latest` — репозиторій спільний для кількох продуктів).
- Перевіряє **SHA-256** з `checksums.txt` — fail-closed (`MYGIT_SKIP_CHECKSUM=1` — лише для
  air-gapped дзеркал).
- Ставить systemd-юніт, підбирає вільний порт (типово 8060, `MYGIT_PORT` для фіксації).

Вихідний код — у приватному репозиторії.
