"""Create, destroy and inspect the test network.

Topology (see docs/plan/01-architecture.md §3.1):

    root ns: br0 10.10.0.1
      ├── veth-a  <->  ns_a: eth0 10.10.0.2
      └── veth-b  <->  ns_b: eth0 10.10.0.3

Usage (as root):
    sudo "$(which uv)" run harness/netns.py up|down|status

The functions are also imported by the orchestrator.
"""

import argparse
import json
import os
import re
import subprocess
import sys

BRIDGE = "br0"
BRIDGE_ADDR = "10.10.0.1/24"

# namespace -> (host-side veth name, address of eth0 inside the namespace)
PEERS = {
    "ns_a": ("veth-a", "10.10.0.2/24"),
    "ns_b": ("veth-b", "10.10.0.3/24"),
}


def ip(*args: str) -> None:
    """Run an `ip` command; raise if it fails."""
    subprocess.run(["ip", *args], check=True)


def link_exists(dev: str, ns: str | None = None) -> bool:
    netns = ["-n", ns] if ns else []
    result = subprocess.run(
        ["ip", *netns, "link", "show", "dev", dev], capture_output=True
    )
    return result.returncode == 0


def netns_exists(ns: str) -> bool:
    # `ip netns add` creates exactly this file.
    return os.path.exists(f"/run/netns/{ns}")


def up() -> None:
    """Create bridge, namespaces and veth pairs. Safe to run repeatedly.

    Each piece is created only if missing, so a half-built state from an
    earlier crash is completed instead of skipped. `addr replace` and
    `link set` are idempotent by themselves and need no check.
    """
    if not link_exists(BRIDGE):
        ip("link", "add", BRIDGE, "type", "bridge")
    ip("addr", "replace", BRIDGE_ADDR, "dev", BRIDGE)
    ip("link", "set", BRIDGE, "up")

    for ns, (veth, addr) in PEERS.items():
        if not netns_exists(ns):
            ip("netns", "add", ns)
        # Both veth ends live and die together, so checking one is enough.
        if not link_exists(veth):
            ip("link", "add", veth, "type", "veth", "peer", "name", "eth0", "netns", ns)
        ip("link", "set", veth, "master", BRIDGE, "up")
        ip("-n", ns, "addr", "replace", addr, "dev", "eth0")
        ip("-n", ns, "link", "set", "eth0", "up")
        ip("-n", ns, "link", "set", "lo", "up")


def down() -> None:
    """Remove namespaces, veth pairs and bridge. Safe to run repeatedly.

    Deleting a namespace normally destroys its eth0 and with it the veth
    partner in the root namespace. But if a process (e.g. a crashed Chrome)
    still lives in the namespace, `netns del` only removes the name and the
    veth survives, so it is deleted explicitly if still there.
    """
    for ns, (veth, _) in PEERS.items():
        if netns_exists(ns):
            ip("netns", "del", ns)
        if link_exists(veth):
            ip("link", "del", veth)
    if link_exists(BRIDGE):
        ip("link", "del", BRIDGE)


def dev_info(dev: str, ns: str | None = None) -> dict | None:
    """Device info (flags, master, addresses) from `ip -j`, or None if missing."""
    netns = ["-n", ns] if ns else []
    result = subprocess.run(
        ["ip", "-j", *netns, "addr", "show", "dev", dev],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return None
    info = json.loads(result.stdout)
    return info[0] if info else None


def describe_dev(
    label: str, info: dict | None, addr: str | None = None, master: str | None = None
) -> tuple[str, bool]:
    """One-line description of a device and whether it matches expectations."""
    if info is None:
        return f"{label} missing".strip(), False
    is_up = "UP" in info.get("flags", [])
    ok = is_up
    parts = [label]
    if addr:
        addrs = [
            f"{a['local']}/{a['prefixlen']}"
            for a in info.get("addr_info", [])
            if a.get("family") == "inet"
        ]
        parts.append(",".join(addrs) or "no-address")
        ok = ok and addr in addrs
    if master:
        actual = info.get("master")
        parts.append(f"-> {actual or 'no-bridge'}")
        ok = ok and actual == master
    parts.append("UP" if is_up else "DOWN")
    return " ".join(p for p in parts if p), ok


def qdisc_desc(ns: str) -> str:
    """The netem settings on the namespace's eth0, or 'none'."""
    result = subprocess.run(
        ["tc", "-n", ns, "qdisc", "show", "dev", "eth0", "root"],
        capture_output=True, text=True,
    )
    line = result.stdout.strip()
    # e.g. "qdisc netem 8001: root refcnt 2 limit 1000 delay 30ms loss 10%"
    match = re.match(r"qdisc netem \S+ root (?:refcnt \d+ )?(?:limit \d+ ?)?(.*)", line)
    if match:
        return f"netem {match.group(1)}".strip()
    return "none"


def status() -> bool:
    """Print the state of bridge and namespaces; True if everything is ok."""
    rows = []

    info = dev_info(BRIDGE)
    desc, ok = describe_dev("", info, addr=BRIDGE_ADDR)
    rows.append((BRIDGE, "ok" if ok else "missing" if info is None else "partial", desc))
    all_ok = ok

    for ns, (veth, addr) in PEERS.items():
        if not netns_exists(ns):
            rows.append((ns, "missing", ""))
            all_ok = False
            continue
        eth0, eth0_ok = describe_dev("eth0", dev_info("eth0", ns), addr=addr)
        host, host_ok = describe_dev(veth, dev_info(veth), master=BRIDGE)
        ok = eth0_ok and host_ok
        all_ok = all_ok and ok
        rows.append((ns, "ok" if ok else "partial",
                     f"{eth0:<22} {host:<20} qdisc: {qdisc_desc(ns)}"))

    for name, state, details in rows:
        print(f"{name:<7} {state:<8} {details}".rstrip())
    return all_ok


COMMANDS = {"up": up, "down": down, "status": status}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create, destroy and inspect the test network."
    )
    parser.add_argument("command", choices=COMMANDS)
    args = parser.parse_args()
    if os.geteuid() != 0:
        sys.exit("netns.py must run as root (sudo)")
    # Only status() returns a result; exit 1 if it reports a problem.
    if COMMANDS[args.command]() is False:
        sys.exit(1)


if __name__ == "__main__":
    main()
