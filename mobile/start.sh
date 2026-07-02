#!/usr/bin/env bash
# Serve the native JS bundle (ONE_METRO_MODE=1 one dev), auto-adapting to whatever
# Wi-Fi you're on. Switching networks changes this Mac's LAN IP; the already-
# installed app caches the OLD IP and then fails with "No script URL provided".
# We detect the current IP, tell the bundler to advertise it, and print the URL
# to punch into the app's dev menu once per new network (no rebuild needed).
set -e

# Find the IP of the active network interface (the one with the default route),
# falling back to the usual Wi-Fi interfaces.
IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
IP="$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)"
[ -z "$IP" ] && IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
[ -z "$IP" ] && IP="$(ipconfig getifaddr en1 2>/dev/null || true)"

if [ -z "$IP" ]; then
  echo "⚠️  Could not detect a LAN IP — are you connected to Wi-Fi?"
else
  # Metro/One reads this to advertise the right host to the device.
  export REACT_NATIVE_PACKAGER_HOSTNAME="$IP"
  echo "────────────────────────────────────────────────────────"
  echo "  Wi-Fi bundler host: $IP"
  echo "  Phone must be on the SAME Wi-Fi as this Mac."
  echo "  If the app can't connect (\"No script URL provided\"):"
  echo "    shake the phone → Dev Menu → Settings →"
  echo "    'Debug server host & port for device' → $IP:8081"
  echo "    then Reload. (Only needed once per new network.)"
  echo "────────────────────────────────────────────────────────"
fi

npm run dev:native
