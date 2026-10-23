#!/usr/bin/env bash
set -uo pipefail
for name in judge api livekit; do
  pidfile="/opt/plankd/run/$name.pid"
  [ -f "$pidfile" ] || continue
  pid="$(cat "$pidfile")"
  pkill -TERM -s "$pid" 2>/dev/null
  rm -f "$pidfile"
done
