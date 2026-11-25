#!/bin/zsh
set -e
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  print 'Install Node.js 22.13 or newer, then run this launcher again.'
  read -r '?Press Return to close.'
  exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<13)){console.error("FocusSync needs Node 22.13 or newer.");process.exit(1)}'
if [[ ! -x node_modules/.bin/vinext ]]; then npm ci; fi
if [[ ! -f dist/server/wrangler.json ]]; then npm run build; fi
npm run db:local
print '\nFocusSync is starting at http://127.0.0.1:5173'
print 'Keep this window open during your presentation. Press Control-C to stop.\n'
exec npm run dev
