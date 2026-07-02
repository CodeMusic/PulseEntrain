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
  echo "  Mode: --pair (rebuild + install to iOS device, then serve)"
  echo "  Wi-Fi bundler host: ${IP:-unknown}"
  echo "  Phone must be UNLOCKED and plugged in / on the same Wi-Fi."
  echo "  Re-bakes the current IP — no dev-menu repoint needed after."
  echo "────────────────────────────────────────────────────────"
  # Build + install + launch on the device, then serve JS. If this fails on the
  # @expo/cli lockdownd bug, fall back to the Xcode / `xcrun devicectl device
  # install app …` flow in README, then run plain ./start.sh to serve.
  exec npm run ios:device
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
