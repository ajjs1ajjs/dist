# MyGit — встановлення

Self-hosted Git-платформа (Go). **Сервер — Ubuntu 24/25/26** (amd64/arm64), статичні бінарники.

## Встановлення / оновлення (одна команда)

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/mygit/install.sh | sudo bash
```

Та сама команда і встановлює, і оновлює: дані (`/var/lib/mygit`), репозиторії та користувачі
**зберігаються**; замінюється лише бінарник (старий лишається як `mygit.old` для відкату).

Після запуску відкрийте `http://<IP>:9555/` і **зареєструйте перший обліковий запис** — він
стане власником (superuser).

Конкретна версія:

```bash
MYGIT_VERSION=3.7.0 curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/mygit/install.sh | sudo bash
```

## Що робить скрипт

- Визначає архітектуру (`amd64`/`arm64`) і резолвить найновіший реліз `mygit-v*` у цьому
  репозиторії (не `/releases/latest` — репозиторій спільний для кількох продуктів).
- Перевіряє **SHA-256** з `checksums.txt` — fail-closed (`MYGIT_SKIP_CHECKSUM=1` — лише для
  air-gapped дзеркал).
- Генерує обов'язкові секрети (`MYGIT_JWT_SECRET`, `MYGIT_INTERNAL_API_TOKEN`) у `/etc/mygit/mygit.env`.
- Ставить systemd-юніт; порт типово **9555** (`MYGIT_PORT` для зміни).

## CI-раннери

Пайплайни виконуються на ваших машинах. Зареєструй раннер у веб-UI
(**Admin → Runners → Add runner**) і виконай згенеровану команду на хості:

```bash
# Linux (systemd) / macOS (launchd)
curl -sSL <SERVER>/install-runner.sh | sudo bash -s -- \
  --url <SERVER> --token mygit_run_... --cpus 2 --memory 2048 --count 2
```
```powershell
# Windows (Scheduled Task)
powershell -ExecutionPolicy Bypass -Command "$s=irm <SERVER>/install-runner.ps1; & ([scriptblock]::Create($s)) -Url <SERVER> -Token mygit_run_... -Cpus 2 -Memory 2048 -Count 2"
```

Локальний раннер разом із сервером:

```bash
MYGIT_INSTALL_RUNNER=1 MYGIT_RUNNER_CPUS=2 MYGIT_RUNNER_MEMORY=2048 MYGIT_RUNNER_COUNT=2 \
  curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/mygit/install.sh | sudo -E bash
```

> Один Linux-раннер може збирати всі таргети крос-компіляцією; нативні Windows/macOS-збірки
> потребують хоста відповідної ОС. Деталі — `docs/RUNNERS.md` у репозиторії.

Вихідний код — у приватному репозиторії.
