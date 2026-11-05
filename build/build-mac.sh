#!/bin/bash
# Builds "Signal9 Print Studio.app" for Apple silicon Macs and wraps it in a
# drag-to-Applications disk image. Runs on macOS (locally or on GitHub Actions).
#
#   npm install
#   npm run build:mac
#
# Output: dist/Signal9-Print-Studio-<version>-arm64.dmg

set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="Signal9 Print Studio"
VERSION=$(node -p "require('./package.json').version")
OUT=dist
rm -rf "$OUT"
mkdir -p "$OUT"

echo "▸ Making the app icon"
ICONSET="$OUT/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size build/icon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) build/icon.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT/icon.icns"

echo "▸ Building the image-recognition helper"
swiftc -O -target arm64-apple-macos13.0 vision/Signal9Vision.swift -o "$OUT/signal9-vision"
# Check it really recognises something before it ships.
SAMPLE=$(find "/System/Library/Desktop Pictures" /Library/Desktop\ Pictures -maxdepth 2 \( -name '*.heic' -o -name '*.jpg' -o -name '*.png' \) 2>/dev/null | head -1 || true)
"$OUT/signal9-vision" build/icon.png ${SAMPLE:+"$SAMPLE"} | node build/check-vision.cjs

echo "▸ Packaging the app"
npx electron-packager . "$APP_NAME" \
  --platform=darwin --arch=arm64 \
  --out="$OUT" --overwrite --asar \
  --icon="$OUT/icon.icns" \
  --app-bundle-id=studio.signal9.printstudio \
  --app-version="$VERSION" \
  --app-category-type=public.app-category.photography \
  --extra-resource="$OUT/signal9-vision" \
  --ignore='^/(dist|build|test|vision|\.github|\.claude)(/|$)' \
  --ignore='^/start\.command$'

APP="$OUT/$APP_NAME-darwin-arm64/$APP_NAME.app"

# Without a paid Apple Developer ID the app is "ad-hoc" signed: macOS will run
# it, but asks you to approve it once (see README).
echo "▸ Signing (ad-hoc)"
codesign --force --deep --sign - "$APP"

echo "▸ Building the disk image"
STAGE="$OUT/dmg"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="$OUT/Signal9-Print-Studio-$VERSION-arm64.dmg"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null

echo "✓ Built $DMG"
