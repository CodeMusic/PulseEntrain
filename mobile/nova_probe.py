#!/usr/bin/env python3
"""
Lumenate Nova interactive BLE prober.

Requires: pip install bleak
Run:       python3 nova_probe.py

Connects to the Nova from your Mac, dumps the GATT map with live values,
subscribes to every notify characteristic, then gives you a prompt to write
candidate command bytes and watch what the device does.

Watch TWO things after each write:
  1. Does the mask light up / change?
  2. Does any NOTIFY line print? (that's the device talking back)
Log both — that cause->effect is how we decode the command set.

SAFETY: lay the mask face-DOWN on the desk, not on your face. A write might
start a real strobe sequence. Never poke the SMP characteristic (not listed
here on purpose — it's the firmware/DFU path = brick risk).
"""

import asyncio
import datetime
from bleak import BleakScanner, BleakClient

NAME_HINT = "Nova"  # adjust if the scan shows a different advertised name

# Friendly shortcuts -> the no-CCCD write suspects (Service C first)
SHORT = {
    "cmd": "ABCDEF01-2345-6789-AEF0123456789",  # #1 command suspect (Service C)
    "cfg": "F2C51A4E-2A46-4BEF-B18F-CB00C716CFA6",  # config/cmd?      (Service C)
    "b2":  "51BFC219-FEAB-4227-8B93-8AF8CC5306D4",  # r/w suspect      (Service B)
    "a2":  "3E25A3BF-BFE1-4C71-97C5-5BDB73FAC89E",  # r/w suspect      (Service A)
}

# Device -> app status channels (subscribe to all)
NOTIFY = [
    "12345678-9ABC-4DEF-8012-3456789ABCDE",  # Service C
    "2A84AAFF-6738-4629-894C-346357B89A0C",  # Service B
    "964FBFFE-6940-4371-8D48-FE43B07ED00B",  # Service A
    "2B35EF1F-11A6-4089-8CD5-843C5D0C9C55",  # Service A
]


def ts():
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def on_notify(sender, data):
    b = bytes(data)
    print(f"\n[{ts()}] NOTIFY {sender}: {b.hex(' ')}   ascii={b!r}")


async def read_all(client):
    print(f"\n[{ts()}] --- characteristic map ---")
    for service in client.services:
        for ch in service.characteristics:
            props = ",".join(ch.properties)
            line = f"  {ch.uuid}  [{props}]"
            if "read" in ch.properties:
                try:
                    v = await client.read_gatt_char(ch.uuid)
                    line += f"  = {v.hex(' ')}   ascii={bytes(v)!r}"
                except Exception as e:
                    line += f"  (read err: {e})"
            print(line)
    print("  ---------------------------\n")


async def main():
    print(f"[{ts()}] Scanning for '{NAME_HINT}'…")
    devices = await BleakScanner.discover(timeout=8.0)
    dev = next((d for d in devices if d.name and NAME_HINT.lower() in d.name.lower()), None)
    if not dev:
        print("Not found. Is the Nova disconnected from your phone? Devices seen:")
        for d in devices:
            print("   ", d.name, d.address)
        return

    print(f"[{ts()}] Connecting to {dev.name} ({dev.address})…")
    async with BleakClient(dev.address) as client:
        print(f"[{ts()}] Connected.")
        await read_all(client)

        for u in NOTIFY:
            try:
                await client.start_notify(u, on_notify)
                print(f"  subscribed: {u}")
            except Exception as e:
                print(f"  notify {u[:8]}… failed: {e}")

        print(
            "\nCommands:\n"
            "  w  <name|uuid> <hex>   write WITHOUT response  (e.g.  w cmd 01)\n"
            "  wr <name|uuid> <hex>   write WITH response     (e.g.  wr cmd 01)\n"
            "  fo                   re-read all readable chars\n"
            "  q                      quit\n"
            "Shortcuts: cmd, cfg, b2, a2\n"
        )

        loop = asyncio.get_event_loop()
        while True:
            try:
                raw = (await loop.run_in_executor(None, input, "> ")).strip()
            except (EOFError, KeyboardInterrupt):
                break
            if not raw:
                continue
            if raw == "q":
                break
            if raw == "info":
                await read_all(client)
                continue

            parts = raw.split()
            if parts[0] in ("w", "wr") and len(parts) >= 3:
                uuid = SHORT.get(parts[1].lower(), parts[1])
                try:
                    payload = bytes.fromhex("".join(parts[2:]).replace(",", ""))
                    await client.write_gatt_char(uuid, payload, response=(parts[0] == "wr"))
                    print(f"[{ts()}] wrote {payload.hex(' ')}  ->  {uuid}")
                except Exception as e:
                    print(f"write error: {e}")
            else:
                print("?? use:  w/wr <name|uuid> <hex>  |  info  |  q")

        print("Bye.")


if __name__ == "__main__":
    asyncio.run(main())


