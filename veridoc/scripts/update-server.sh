#!/usr/bin/env bash
# Pull the latest code on the server and restart VeriDoc.
# Usage (on the server, as the site user):  bash scripts/update-server.sh
#
# Workflow: change code locally -> git push -> run this on the server.
# It never touches .env, data/ (the database) or deployments/localhost.json.
set -euo pipefail
cd "$(dirname "$0")/.."

lock_before=$(sha1sum package-lock.json | cut -d' ' -f1)
sol_before=$(cat contracts/*.sol | sha1sum | cut -d' ' -f1)

echo "==> Pulling latest code"
git pull --ff-only

if [ "$(sha1sum package-lock.json | cut -d' ' -f1)" != "$lock_before" ] || [ ! -d node_modules ]; then
  echo "==> Dependencies changed: npm ci"
  npm ci --no-audit --no-fund
fi

echo "==> Compiling contract (the server reads the ABI from artifacts/)"
npx hardhat compile --quiet

echo "==> Restarting app"
pm2 startOrReload ecosystem.config.js --update-env
pm2 save

if [ "$(cat contracts/*.sol | sha1sum | cut -d' ' -f1)" != "$sol_before" ]; then
  echo
  echo "!!  contracts/VeriDoc.sol changed. Existing deployments keep the OLD contract code."
  echo "!!  Redeploy it (see docs/DEPLOYMENT_GUIDE.md, section 7) if the change must go live."
fi

sleep 2
pm2 logs veridoc --lines 8 --nostream
