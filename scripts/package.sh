#!/bin/bash
# Builds the ZIP to upload to the Chrome Web Store: only the files the
# extension runs, with manifest.json at the top level.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
OUT="dist/blackbox-$VERSION.zip"
FILES=(manifest.json background.js interceptor.js relay.js devtools.html devtools.js
       popup.html panel.html ui.js ui.css
       icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png LICENSE)

for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "Missing $f" >&2; exit 1; }
done
# Every file the manifest and pages point at must be in the package.
for f in $(grep -ohE '"[A-Za-z0-9_/-]+\.(js|html|css|png)"' manifest.json popup.html panel.html devtools.html devtools.js | tr -d '"' | sort -u); do
  printf '%s\n' "${FILES[@]}" | grep -qx "$f" || { echo "Referenced but not packaged: $f" >&2; exit 1; }
done

mkdir -p dist
rm -f "$OUT"
zip -q -X "$OUT" "${FILES[@]}"
echo "$OUT ($(du -h "$OUT" | cut -f1 | tr -d ' '))"
unzip -l "$OUT" | tail -n +4 | sed '$d' | sed '$d' | awk '{print "  " $4}'
