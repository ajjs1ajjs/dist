#!/usr/bin/env bash
# Run only inside the disposable Ubuntu test container, never on a host.
set -euo pipefail
[ -f /.dockerenv ] || { echo 'This test must run in a disposable container' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends python3 ca-certificates >/dev/null
fixture=$(mktemp -d /root/bck-test.XXXXXX)
export TEST_FIXTURE="$fixture" BCK_HOME="$fixture/home" BCK_DATA_DIR="$fixture/data" BCK_CONFIG_DIR="$fixture/config" BCK_USER=root BCK_GROUP=root
mkdir -p "$fixture/bin" "$fixture/data" "$fixture/artifacts" /etc/systemd/system
printf 'fixture\n' > "$fixture/data/bootstrap_admin.txt"
for version in 1.2.3 1.2.4; do
  mkdir -p "$fixture/build/bin"
  for name in bckd bck-agent bck bck-proxy; do printf '#!/bin/sh\nexit 0\n' > "$fixture/build/bin/$name"; done
  printf '#!/bin/sh\n[ "$1" = "--detect-ip" ] && echo 127.0.0.1\nexit 0\n' > "$fixture/build/bin/bck-network-tls"
  printf '%s\n' "$version" > "$fixture/build/version"
  tar -czf "$fixture/artifacts/$version.tar.gz" -C "$fixture/build" .
  rm -rf "$fixture/build"
done
cat > "$fixture/bin/curl" <<'MOCK'
#!/usr/bin/env bash
url=''; dest=''
while [ "$#" -gt 0 ]; do
  case "$1" in -o) dest="$2"; shift 2;; http*) url="$1"; shift;; *) shift;; esac
done
version=${url#*/bck-v}; version=${version%%/*}
case "$url" in
  *.tar.gz.sha256) (cd "$TEST_FIXTURE/artifacts"; sha256sum "$version.tar.gz" | sed 's/  .*$/  bck-linux-x86_64.tar.gz/') > "$dest";;
  *.tar.gz) cp "$TEST_FIXTURE/artifacts/$version.tar.gz" "$dest";;
  *) exit 22;;
esac
MOCK
cat > "$fixture/bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  is-active) [ -f "$TEST_FIXTURE/active" ];;
  stop) rm -f "$TEST_FIXTURE/active";;
  restart)
    if [ "${TEST_FAIL_VERSION:-}" = '1.2.4' ] && [[ "$(readlink "$BCK_HOME/current")" == *1.2.4* ]]; then
      python3 - "$BCK_DATA_DIR/bck.db" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1]); c.execute("update sentinel set value='changed'"); c.commit(); c.close()
PY
      rm -f "$TEST_FIXTURE/active"
    else touch "$TEST_FIXTURE/active"; fi;;
  *) :;;
esac
MOCK
chmod +x "$fixture/bin/curl" "$fixture/bin/systemctl"
export PATH="$fixture/bin:$PATH"
BCK_VERSION=1.2.3 bash /repo/apps/bck/install.sh > "$fixture/install.log" 2>&1 || { cat "$fixture/install.log"; exit 1; }
original=$(readlink "$BCK_HOME/current")
python3 - "$BCK_DATA_DIR/bck.db" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1]); c.execute('create table sentinel(value text)'); c.execute("insert into sentinel values ('original')"); c.commit(); c.close()
PY
cp "$BCK_CONFIG_DIR/config.toml" "$fixture/original-config"
if BCK_VERSION=1.2.4 TEST_FAIL_VERSION=1.2.4 bash /repo/apps/bck/install.sh > "$fixture/upgrade.log" 2>&1; then
  echo 'Failed upgrade unexpectedly succeeded' >&2; exit 1
fi
[ "$(readlink "$BCK_HOME/current")" = "$original" ]
cmp "$fixture/original-config" "$BCK_CONFIG_DIR/config.toml"
[ -f "$fixture/active" ]
python3 - "$BCK_DATA_DIR/bck.db" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1]); assert c.execute('pragma integrity_check').fetchone()[0] == 'ok'; assert c.execute('select value from sentinel').fetchone()[0] == 'original'
PY
grep -q 'restored the prior release' "$fixture/upgrade.log"
echo 'BCK installer rollback test passed (simulated service failures).'
