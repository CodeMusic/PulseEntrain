#!/usr/bin/env bash
# Serve the native JS bundle, auto-adapting to whatever Wi-Fi you're on.
#
#   ./start.sh           Regular: just serve JS (ONE_METRO_MODE=1 one dev). The
#                        installed app pulls the bundle over the LAN. Fast — use
#                        this for day-to-day JS changes (reload on the phone).
#
#   ./start.sh --pair    New Wi-Fi / first install: rebuild + install to the
#                        connected iOS device, then serve. This re-bakes the
#                        current IP into the app, so you skip the dev-menu
#                        repoint step. Slower (a native build).
#
# Why the switch: switching networks changes this Mac's LAN IP, and an already-
# installed app caches the old one → "No script URL provided". Regular mode fixes
# that with a one-time dev-menu repoint (printed below); --pair fixes it by
# rebuilding so nothing on the phone needs touching.
set -e
cd "$(dirname "$0")" # run from the mobile/ folder regardless of caller's cwd

PAIR=0
for arg in "$@"; do
  case "$arg" in
    --pair) PAIR=1 ;;
    *) echo "Unknown option: $arg (use --pair to rebuild+install to device)"; exit 1 ;;
  esac
done

# Find the IP of the active network interface (the one with the default route),
# falling back to the usual Wi-Fi interfaces.
IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
IP="$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)"
[ -z "$IP" ] && IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
[ -z "$IP" ] && IP="$(ipconfig getifaddr en1 2>/dev/null || true)"

if [ -z "$IP" ]; then
  echo "⚠️  Could not detect a LAN IP — are you connected to Wi-Fi?"
else
  # Metro/One reads this to advertise the right host to the device (and, in
  # --pair mode, to bake into the built app).
  export REACT_NATIVE_PACKAGER_HOSTNAME="$IP"
fi

echo "────────────────────────────────────────────────────────"
if [ "$PAIR" = "1" ]; then
  # One's `run:ios` ignores --device and always targets the Simulator, so drive
  # the device directly: xcodebuild for the phone → devicectl install + launch →
  # serve JS. This is the README's reliable flow (also dodges the @expo/cli
  # lockdownd install bug). Requires the phone plugged in, unlocked, and trusted.
  UDID="$(xcrun devicectl list devices 2>/dev/null | awk '/available/{print $3; exit}')"
  DEVNAME="$(xcrun devicectl list devices 2>/dev/null | awk '/available/{print $1; exit}')"
  echo "  Mode: --pair (build + install to iOS device via xcodebuild/devicectl)"
  echo "  Wi-Fi bundler host: ${IP:-unknown}"
  if [ -z "$UDID" ]; then
    echo "  ⚠️  No paired device found — plug in the iPhone, unlock it, trust this Mac."
    echo "────────────────────────────────────────────────────────"
    exit 1
  fi
  echo "  Target device: ${DEVNAME:-?} ($UDID)"
  echo "  Keep the phone UNLOCKED throughout."
  echo "────────────────────────────────────────────────────────"
  export ONE_METRO_MODE=1
  APP_DD="ios/build" # isolated DerivedData so we know exactly where the .app lands
  APP_PATH="$APP_DD/Build/Products/Debug-iphoneos/PulseEntrain.app"
  npm run sync-catalog
  echo "▶︎ Building for the device (this takes a few minutes)…"
  xcodebuild \
    -workspace ios/PulseEntrain.xcworkspace \
    -scheme PulseEntrain \
    -configuration Debug \
    -destination "id=$UDID" \
    -derivedDataPath "$APP_DD" \
    -allowProvisioningUpdates \
    build
  echo "▶︎ Installing on $DEVNAME…"
  xcrun devicectl device install app --device "$UDID" "$APP_PATH"
  echo "▶︎ Launching…"
  xcrun devicectl device process launch --terminate-existing --device "$UDID" com.codemusic.PulseEntrain || true
  echo "▶︎ Serving JS. In the app's dev-client launcher, tap  ${IP:-<mac-ip>}:8081  (or Reload)."
  exec npm run dev:native
else
  echo "  Mode: regular (serve JS only)"
  echo "  Wi-Fi bundler host: ${IP:-unknown}"
  echo "  Phone must be on the SAME Wi-Fi as this Mac."
  echo "  If the app can't connect (\"No script URL provided\"):"
  echo "    shake the phone → Dev Menu → Settings →"
  echo "    'Debug server host & port for device' → ${IP:-<mac-ip>}:8081"
  echo "    then Reload. (Only needed once per new network.)"
  echo "    …or rerun with:  ./start.sh --pair  to rebuild instead."
  echo "────────────────────────────────────────────────────────"
  exec npm run dev:native
fi
