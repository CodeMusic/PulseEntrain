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
  # `one run:ios --device` with no value falls back to the SIMULATOR — so detect
  # the connected physical device's UDID and pass it explicitly to force a device
  # build + install + launch (One then opens the dev client pointed at our IP).
  UDID="$(xcrun devicectl list devices 2>/dev/null | awk '/available/{print $3; exit}')"
  DEVNAME="$(xcrun devicectl list devices 2>/dev/null | awk '/available/{print $1; exit}')"
  echo "  Mode: --pair (rebuild + install to iOS device, then serve)"
  echo "  Wi-Fi bundler host: ${IP:-unknown}"
  if [ -z "$UDID" ]; then
    echo "  ⚠️  No paired device found — plug in the iPhone, unlock it, and"
    echo "     trust this Mac. (Falling back to interactive device pick.)"
    echo "────────────────────────────────────────────────────────"
    npm run sync-catalog
    exec env ONE_METRO_MODE=1 npx one run:ios --device
  fi
  echo "  Target device: ${DEVNAME:-?} ($UDID)"
  echo "  Keep the phone UNLOCKED. Re-bakes the current IP — no dev-menu repoint."
  echo "────────────────────────────────────────────────────────"
  # sync catalog (the regular path's predev hook does this; --pair skips it) then
  # build+install+launch on the specific device. If this dies on the @expo/cli
  # lockdownd bug, use the Xcode / `xcrun devicectl device install app …` flow in
  # README, then run plain ./start.sh to serve.
  npm run sync-catalog
  exec env ONE_METRO_MODE=1 npx one run:ios --device "$UDID"
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
