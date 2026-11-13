#!/bin/bash
# Builds Capacitor and Cordova for iPhone, the iPhone simulator and the Mac
# (Catalyst) from Capacitor's own source, at the version in node_modules, into
# ios/App/capacitor-swift-pm. The published package ships no Mac build.
# Run once after cloning, and again whenever @capacitor/ios is upgraded.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./node_modules/@capacitor/ios/package.json').version")
out="$PWD/ios/App/capacitor-swift-pm"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git clone --quiet --depth 1 --branch "$version" https://github.com/ionic-team/capacitor.git "$work/src"
# The source must be what npm installed, or the app and its JavaScript
# disagree. Cordova's too: it ships, and is signed, as well.
diff -rq "$work/src/ios/Capacitor/Capacitor" node_modules/@capacitor/ios/Capacitor/Capacitor >/dev/null
diff -rq "$work/src/ios/CapacitorCordova/CapacitorCordova" node_modules/@capacitor/ios/CapacitorCordova/CapacitorCordova >/dev/null

for scheme in Cordova Capacitor; do
  frameworks=()
  for dest in "generic/platform=iOS" "generic/platform=iOS Simulator" "generic/platform=macOS,variant=Mac Catalyst"; do
    archive="$work/$scheme-${dest//[^A-Za-z]/_}.xcarchive"
    xcodebuild archive -quiet -workspace "$work/src/ios/Capacitor/Capacitor.xcworkspace" -scheme "$scheme" \
      -destination "$dest" -archivePath "$archive" \
      SKIP_INSTALL=NO BUILD_LIBRARY_FOR_DISTRIBUTION=YES SUPPORTS_MACCATALYST=YES CODE_SIGNING_ALLOWED=NO
    frameworks+=(-framework "$archive/Products/Library/Frameworks/$scheme.framework")
  done
  rm -rf "$out/$scheme.xcframework"
  xcodebuild -create-xcframework "${frameworks[@]}" -output "$out/$scheme.xcframework"
  # Apple lists Capacitor and Cordova as privacy-impacting SDKs: shipped as
  # prebuilt frameworks they must be signed, or App Store Connect marks the
  # build Invalid Binary (ITMS-91065). Ionic's published copies are signed;
  # these are ours, so they carry our signature.
  codesign --timestamp --sign "Apple Development" "$out/$scheme.xcframework"
done
echo "Capacitor $version built for iOS, the simulator and Mac Catalyst."
