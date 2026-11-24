#!/bin/bash
# Renders the Chrome Web Store images in store/ from store/screenshots.html,
# using headless Google Chrome. macOS paths; set CHROME to override.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
PAGE="file://$PWD/store/screenshots.html"

shoot() { # name width height shot
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --user-data-dir="$PROFILE" --allow-file-access-from-files --virtual-time-budget=3000 \
    --window-size="$2,$3" --screenshot="$PWD/store/$1.png" "$PAGE?shot=$4" >/dev/null 2>&1
  echo "store/$1.png"
}

shoot screenshot-1-graphql 1280 800 graphql
shoot screenshot-2-network 1280 800 network
shoot screenshot-3-console 1280 800 console
shoot promo-small 440 280 promo
