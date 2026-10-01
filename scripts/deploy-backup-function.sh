#!/bin/sh
# Deploys the `backup` Catalyst Function with its settings (the Cliq bot, token and allowed domains) taken from a LOCAL file
# that is never committed: functions/backup/.env.cliq, lines like KEY=value:
#   CLIQ_BOT=hitlistbot
#   CLIQ_TOKEN=<the Cliq webhook token>
#   CLIQ_ALLOWED_DOMAINS=yourcompany.com
#   CLIQ_DC=in
# The values are written into the function's catalyst-config.json only for the deploy, then that file is restored, so no
# secret reaches git. Usage (from the repo root): sh scripts/deploy-backup-function.sh
set -e
cd "$(dirname "$0")/.."
CONFIG=functions/backup/catalyst-config.json
ENVFILE=functions/backup/.env.cliq
[ -f "$ENVFILE" ] || { echo "Missing $ENVFILE (see the comment at the top of this script)" >&2; exit 2; }
cp "$CONFIG" "$CONFIG.orig"
trap 'mv "$CONFIG.orig" "$CONFIG"' EXIT
python3 - "$CONFIG" "$ENVFILE" <<'PY'
import json, sys
config, envfile = sys.argv[1], sys.argv[2]
env = {}
for line in open(envfile):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip()
for needed in ('CLIQ_BOT', 'CLIQ_TOKEN', 'CLIQ_ALLOWED_DOMAINS'):
    if not env.get(needed):
        sys.exit(f'{needed} is missing in {envfile}')
d = json.load(open(config))
d['deployment']['env_variables'] = env
json.dump(d, open(config, 'w'), indent='\t')
PY
catalyst deploy --only functions
