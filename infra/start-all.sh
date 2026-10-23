#!/usr/bin/env bash
set -euo pipefail
cd /opt/plankd/app
set -a
. ./.env
set +a
bash infra/stop-all.sh
sup=/opt/plankd/app/infra/supervise.sh
setsid nohup bash "$sup" livekit /opt/plankd/bin/livekit-server --config infra/livekit.prod.yaml > /dev/null 2>&1 < /dev/null &
setsid nohup bash "$sup" api /usr/local/bin/node server/index.js > /dev/null 2>&1 < /dev/null &
sleep 2
cd judge
setsid nohup bash "$sup" judge .venv/bin/python main.py > /dev/null 2>&1 < /dev/null &
echo started
