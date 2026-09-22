# dist — public distribution channel

Source repositories are private. This repository is the **only public surface**:
it carries the one-line installers and the prebuilt release artifacts.

Nothing here is source code — only install scripts and build output that
end users are meant to download anyway.

## Layout

```
apps/<app>/install.sh     canonical installer, served over raw.githubusercontent.com
apps/<app>/README.md      download / upgrade notes for apps without an installer
releases (tags)           <app>-v<version>  e.g. bck-v0.10.0, calculator-v2.5.0
```

## Release tags

Every app publishes under its own tag prefix, because `/releases/latest` is
global to a repository and would collide across apps:

| App | Tag pattern | Example |
|---|---|---|
| BCK | `bck-v<semver>` | `bck-v0.10.0` |
| Resource Calculator | `calculator-v<semver>` | `calculator-v2.5.0` |

Installers resolve the newest release themselves by filtering the release
list for their own prefix and sorting by semver — never via `/releases/latest`.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/bck/install.sh | sudo bash
```

Resource Calculator is a portable Windows exe (no installer) — download it from the
[releases page](https://github.com/ajjs1ajjs/dist/releases) or see
[`apps/calculator/README.md`](apps/calculator/README.md). The app also self-updates
from this repository.

## Published artifacts

| App | Asset | Platforms |
|---|---|---|
| BCK | `bck-linux-x86_64.tar.gz` (+ `.sha256`) | Ubuntu 24/25/26 x86_64 |
| Resource Calculator | `ITE.ResourceCalculator.exe` (+ `SHA256SUMS.txt`) | Windows 10/11 x64 |

Artifacts are built locally and uploaded here, so no CI minutes are consumed
and no build queue is involved.
