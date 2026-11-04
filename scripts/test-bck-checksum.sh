#!/usr/bin/env bash
# Exercise the actual BCK download path as an unprivileged user. The archive
# intentionally has no binaries, so a checksum regression still cannot install.
set -euo pipefail
if [ "$(id -u)" -eq 0 ]; then echo 'Run this test as an unprivileged user' >&2; exit 1; fi
root=$(cd "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/payload" "$fixture/home"
printf 'fixture\n' > "$fixture/payload/placeholder"
tar -czf "$fixture/archive.tar.gz" -C "$fixture/payload" .
cat > "$fixture/bin/id" <<'MOCK'
#!/usr/bin/env bash
if [ "${1:-}" = '-u' ]; then echo 0; else /usr/bin/id "$@"; fi
MOCK
cat > "$fixture/bin/curl" <<'MOCK'
#!/usr/bin/env bash
url=''; dest=''
while [ "$#" -gt 0 ]; do
  case "$1" in -o) dest="$2"; shift 2;; http*) url="$1"; shift;; *) shift;; esac
done
case "$url" in
  *.tar.gz.sha256)
    [ "$TEST_MODE" = mismatch ] || exit 22
    printf '%064d  bck-linux-x86_64.tar.gz\n' 0 > "$dest";;
  *.tar.gz) cp "$TEST_FIXTURE/archive.tar.gz" "$dest";;
  *) exit 22;;
esac
MOCK
chmod +x "$fixture/bin/id" "$fixture/bin/curl"
for mode in missing mismatch; do
  set +e
  output=$(PATH="$fixture/bin:$PATH" TEST_FIXTURE="$fixture" TEST_MODE="$mode" BCK_VERSION=1.2.3 BCK_HOME="$fixture/home" BCK_DATA_DIR="$fixture/data" BCK_CONFIG_DIR="$fixture/config" bash "$root/apps/bck/install.sh" 2>&1)
  status=$?
  set -e
  [ "$status" -ne 0 ] || { echo "$mode checksum unexpectedly accepted" >&2; exit 1; }
  case "$mode:$output" in
    missing:*'No .sha256 checksum asset'*) ;;
    mismatch:*'SHA256 verification failed'*) ;;
    *) printf 'Unexpected %s result:\n%s\n' "$mode" "$output" >&2; exit 1;;
  esac
  [ -z "$(ls -A "$fixture/home")" ] || { echo 'Install directory changed before verification' >&2; exit 1; }
done
echo 'BCK checksum rejection tests passed.'
