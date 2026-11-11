#!/bin/sh
set -e

VERSION="${SUPERMEMORY_SERVER_VERSION:-0.0.9}"
BIN_DIR=/data/bin
BIN="$BIN_DIR/supermemory-server-$VERSION"
PUBLIC_PORT="${PORT:-6767}"

mkdir -p "$BIN_DIR" "${SUPERMEMORY_DATA_DIR:-/data}"
export DEBIAN_FRONTEND=noninteractive

command -v curl >/dev/null 2>&1 || (
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends curl ca-certificates >/dev/null
)
command -v python3 >/dev/null 2>&1 || (
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends python3 >/dev/null
)

if [ ! -x "$BIN" ]; then
  echo "supermemory-server v$VERSION not cached on volume - downloading..."
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64) PLATFORM=linux-x64 ;;
    aarch64) PLATFORM=linux-arm64 ;;
    *)
      echo "unsupported architecture: $ARCH" >&2
      exit 1
      ;;
  esac
  BASE="https://github.com/supermemoryai/supermemory/releases/download/server-v$VERSION"
  curl -fsSL "$BASE/supermemory-server-$PLATFORM" -o "$BIN.download"
  curl -fsSL "$BASE/supermemory-server-$PLATFORM.sha256" -o "$BIN.download.sha256"
  EXPECTED="$(cut -d ' ' -f1 "$BIN.download.sha256")"
  ACTUAL="$(sha256sum "$BIN.download" | cut -d ' ' -f1)"
  if [ "$EXPECTED" != "$ACTUAL" ] || [ -z "$EXPECTED" ]; then
    echo "checksum verification failed for supermemory-server-$PLATFORM" >&2
    rm -f "$BIN.download" "$BIN.download.sha256"
    exit 1
  fi
  chmod +x "$BIN.download"
  mv "$BIN.download" "$BIN"
  rm -f "$BIN.download.sha256"
  echo "installed supermemory-server v$VERSION -> $BIN"
fi

if [ ! -f /data/sm-console-proxy.py ]; then
  echo "missing /data/sm-console-proxy.py on volume" >&2
  exit 1
fi

# Bind SM privately; public traffic hits the console-fix proxy on $PUBLIC_PORT.
export SUPERMEMORY_HOST=127.0.0.1
export PORT=6768
echo "sm-start: launching binary with PORT=$PORT HOST=$SUPERMEMORY_HOST"
env PORT=6768 SUPERMEMORY_HOST=127.0.0.1 "$BIN" &
SM_PID=$!

i=0
while [ "$i" -lt 90 ]; do
  if curl -fsS "http://127.0.0.1:6768/v3/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SM_PID" 2>/dev/null; then
    echo "supermemory-server exited early" >&2
    wait "$SM_PID" || true
    exit 1
  fi
  i=$((i + 1))
  sleep 2
done

curl -fsS "http://127.0.0.1:6768/v3/health" >/dev/null
export SUPERMEMORY_UPSTREAM=http://127.0.0.1:6768
export PORT="$PUBLIC_PORT"
echo "starting console proxy on :$PORT -> $SUPERMEMORY_UPSTREAM"
exec python3 /data/sm-console-proxy.py
