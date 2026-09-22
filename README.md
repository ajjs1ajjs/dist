# dist — public distribution channel

Source repositories are private. This repository is the **only public surface**:
it carries the one-line installers and the prebuilt release artifacts.

Nothing here is source code — only install scripts and build output that
end users are meant to download anyway.

## Layout

```
apps/<app>/install.sh     canonical installer, served over raw.githubusercontent.com
releases (tags)           <app>-v<version>  e.g. bck-v0.10.0
```

## Release tags

Every app publishes under its own tag prefix, because `/releases/latest` is
global to a repository and would collide across apps:

| App | Tag pattern | Example |
|---|---|---|
| BCK | `bck-v<semver>` | `bck-v0.10.0` |

Installers resolve the newest release themselves by filtering the release
list for their own prefix and sorting by semver — never via `/releases/latest`.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/bck/install.sh | sudo bash
```

## Published artifacts

| App | Asset | Platforms |
|---|---|---|
| BCK | `bck-linux-x86_64.tar.gz` (+ `.sha256`) | Ubuntu 24/25/26 x86_64 |

Artifacts are built locally and uploaded here, so no CI minutes are consumed
and no build queue is involved.
