"""Apply, clear and read netem on the namespaces' eth0 (egress).

A profile is a plain netem argument string, e.g. "delay 30ms loss 10%".
The empty string is the `ideal` profile: a default netem with no arguments
(no impairment, but the `tc -s` counters still run).
By default every command acts on both namespaces; --ns limits it to one.

Usage (as root):
    sudo "$(which uv)" run harness/netem.py apply "delay 30ms loss 10%"
    sudo "$(which uv)" run harness/netem.py clear
    sudo "$(which uv)" run harness/netem.py stats [--ns ns_a]

The functions are also imported by the orchestrator and the signaling server.
"""

import argparse
import json
import os
import subprocess
import sys

from netns import PEERS

NAMESPACES = list(PEERS)
DEV = "eth0"


def tc(ns: str, *args: str) -> None:
    """Run a `tc` command inside a namespace; raise if it fails."""
    subprocess.run(["tc", "-n", ns, *args], check=True)


def has_netem(ns: str) -> bool:
    """True if the namespace's eth0 has a netem root qdisc."""
    result = subprocess.run(
        ["tc", "-n", ns, "qdisc", "show", "dev", DEV, "root"],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.startswith("qdisc netem")


def apply(netem_args: str, namespaces: list[str] = NAMESPACES) -> None:
    """Set netem on eth0 of each namespace. Safe to repeat.

    "" (the `ideal` profile) applies a default netem with no arguments: it
    adds no impairment but keeps the `tc -s` counters running, which the
    default veth qdisc (noqueue) does not. Only clear() removes netem.

    `replace` adds the qdisc if there is none and otherwise changes it in
    place, so live profile switching keeps the WebRTC connections up.
    Changing in place keeps the counters running; per-run counters
    therefore need a clear() before the run (the orchestrator clears after
    every run anyway).
    """
    for ns in namespaces:
        tc(ns, "qdisc", "replace", "dev", DEV, "root", "netem", *netem_args.split())


def clear(namespaces: list[str] = NAMESPACES) -> None:
    """Remove netem from eth0 of each namespace. Safe to repeat.

    `qdisc del` fails when there is nothing to delete, so check first
    instead of ignoring errors (which would also hide a missing namespace).
    """
    for ns in namespaces:
        if has_netem(ns):
            tc(ns, "qdisc", "del", "dev", DEV, "root")


def stats(namespaces: list[str] = NAMESPACES) -> dict[str, dict[str, int]]:
    """Per namespace: sent bytes, sent packets and dropped packets from `tc -s`.

    The counters belong to the root qdisc on eth0 and start at 0 when it is
    created. They only count while netem is installed: the default qdisc
    of a veth (noqueue) always reports 0.
    """
    result = {}
    for ns in namespaces:
        out = subprocess.run(
            ["tc", "-n", ns, "-j", "-s", "qdisc", "show", "dev", DEV, "root"],
            capture_output=True, text=True, check=True,
        )
        qdisc = json.loads(out.stdout)[0]
        result[ns] = {
            "sent_bytes": qdisc["bytes"],
            "sent_packets": qdisc["packets"],
            "dropped": qdisc["drops"],
        }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply, clear and read netem on the test namespaces."
    )
    commands = parser.add_subparsers(dest="command", required=True)
    apply_cmd = commands.add_parser("apply", help="set a netem profile")
    apply_cmd.add_argument("netem_args", help='e.g. "delay 30ms loss 10%%"; "" = ideal (netem without arguments)')
    commands.add_parser("clear", help="remove netem")
    commands.add_parser("stats", help="print tc -s counters")
    for cmd in commands.choices.values():
        cmd.add_argument("--ns", choices=NAMESPACES, help="only this namespace")
    args = parser.parse_args()

    if os.geteuid() != 0:
        sys.exit("netem.py must run as root (sudo)")
    namespaces = [args.ns] if args.ns else NAMESPACES

    # The commands take different arguments, so dispatch explicitly.
    if args.command == "apply":
        apply(args.netem_args, namespaces)
    elif args.command == "clear":
        clear(namespaces)
    elif args.command == "stats":
        for ns, counters in stats(namespaces).items():
            print(ns, counters)


if __name__ == "__main__":
    main()
