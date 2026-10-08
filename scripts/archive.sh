#!/usr/bin/env bash
# Usage: scripts/archive.sh <APPLE_TEAM_ID>   (10 characters, from developer.apple.com > Membership details)
# Archives an unsigned Release build (no device needed), then the export step signs it for the App Store
# with a cloud-managed distribution certificate and uploads it to App Store Connect using the account signed in to Xcode.
set -euo pipefail
TEAM="${1:?usage: scripts/archive.sh <APPLE_TEAM_ID>}"
cd "$(dirname "$0")/.."
npm run sync
rm -rf build && mkdir build
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/App.xcarchive \
  CODE_SIGNING_ALLOWED=NO archive
cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><true/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportOptionsPlist build/ExportOptions.plist -allowProvisioningUpdates
