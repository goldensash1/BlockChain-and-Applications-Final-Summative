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
git fetch --quiet
# A deploy run on this server writes deployments/<network>.json as an untracked file. Once
# the same file is committed and pushed, `git pull` would refuse to overwrite it. Remove the
# local copy only when it is byte-for-byte identical to the incoming one.
for f in $(git diff --name-only --diff-filter=A HEAD @{u} -- deployments/); do
  if [ -f "$f" ] && ! git ls-files --error-unmatch "$f" >/dev/null 2>&1 && git show "@{u}:$f" | cmp -s - "$f"; then
    echo "    $f is identical to the committed copy; replacing it with the tracked file"
    rm "$f"
  fi
done
git merge --ff-only --quiet @{u}

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
