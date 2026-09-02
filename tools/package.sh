#!/usr/bin/env bash
# Build, verify, and produce the ZIP to upload at https://console.minit.games
#
#   npm run package
#
# The ZIP's root is the CONTENTS of dist/ -- index.html at the top, no dist/
# folder, no src/, no package.json, no vite config. The console rejects an
# upload that still looks like a source tree.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="minit-template-pixi"
OUT="dist/${NAME}.zip"

echo "==> building"
npx vite build

echo "==> pre-flight"
node tools/check-meta.mjs

echo "==> offline"
# The engine bundles its own asset loader containing fetch and XMLHttpRequest,
# so a grep cannot answer this. Measure what the game actually requests.
node tools/verify-offline.mjs

echo "==> audio"
# A build that is silent inside the app looks completely healthy from every
# other angle, so this measures the audio graph rather than trusting a flag.
# It is in the packaging path deliberately: a silent build cannot be shipped.
node tools/verify-audio.mjs

echo "==> packaging"
rm -f "$OUT"
# Zip from inside dist/ so the archive has no leading folder, and exclude any
# previous archive sitting in there.
(cd dist && zip -qr "${NAME}.zip" . -x "${NAME}.zip")

echo
echo "wrote ${OUT} ($(du -h "$OUT" | cut -f1 | tr -d ' '))"
unzip -l "$OUT" | tail -n +2
echo
echo "Upload ${OUT} at https://console.minit.games"
