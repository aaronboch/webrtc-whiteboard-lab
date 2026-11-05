"""Smoke test: launch Chrome inside a namespace via chrome-ns.sh and load a page.

Usage (as root, network up):
    sudo "$(which uv)" run harness/chrome_smoke.py [--ns ns_a] [--url URL] [--headed]
"""

import argparse
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from netns import PEERS

WRAPPER = Path(__file__).with_name("chrome-ns.sh")


def main() -> None:
    parser = argparse.ArgumentParser(description="Launch Chrome in a namespace.")
    parser.add_argument("--ns", choices=PEERS, default="ns_a")
    parser.add_argument("--url", default="http://10.10.0.1:8000")
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        sys.exit("chrome_smoke.py must run as root (sudo)")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=str(WRAPPER),
            headless=not args.headed,
            env={**os.environ, "NETNS": args.ns},  # replaces, so keep the rest
        )
        page = browser.new_page()
        page.goto(args.url)
        print(f"{args.ns}: Chrome {browser.version}, title {page.title()!r}")
        if args.headed:
            input("Press Enter to close the browser...")
        browser.close()


if __name__ == "__main__":
    main()
