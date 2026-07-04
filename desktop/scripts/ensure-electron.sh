#!/usr/bin/env bash
# npm's postinstall for electron occasionally leaves dist/ half-extracted
# (seen on ai1: only locales/). Verify the binary and fall back to a direct
# GitHub release download if it's missing.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=node_modules/electron/dist/electron
if [ -x "$BIN" ]; then echo "electron binary ok"; exit 0; fi
VER=$(node -p "require('./node_modules/electron/package.json').version")
echo "electron binary missing — fetching v$VER directly"
curl -sL "https://github.com/electron/electron/releases/download/v${VER}/electron-v${VER}-linux-x64.zip" -o /tmp/electron-ci.zip
rm -rf node_modules/electron/dist
mkdir -p node_modules/electron/dist
unzip -qo /tmp/electron-ci.zip -d node_modules/electron/dist
printf "electron" > node_modules/electron/path.txt
test -x "$BIN" && echo "electron binary restored"
