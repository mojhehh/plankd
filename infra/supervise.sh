#!/usr/bin/env bash
set -euo pipefail
name="$1"
shift
log="/opt/plankd/logs/$name.log"
mkdir -p /opt/plankd/logs /opt/plankd/run
echo $$ > "/opt/plankd/run/$name.pid"
while true; do
  echo "$(date -Is) starting $name" >> "$log"
  "$@" >> "$log" 2>&1 || echo "$(date -Is) $name exited with $?" >> "$log"
  sleep 2
done
