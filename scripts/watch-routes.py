#!/usr/bin/env python3
"""
watch-routes.py — Real-time iptables log enricher for the RPi VPN gateway.

Reads journalctl -f -k output, parses [VPN]/[ISP] LOG lines emitted by
iptables FORWARD rules in routing.sh, performs cached reverse-DNS lookups,
and prints enriched human-readable output.

Usage:
    python3 scripts/watch-routes.py [--src IP] [--no-dns] [--tag {VPN,ISP,both}]

Requirements: stdlib only — no pip dependencies.
"""

import argparse
import re
import socket
import subprocess
import sys

# ─── DNS cache ────────────────────────────────────────────────────────────────
# Maps IP string → hostname string.
# Failed lookups are stored as the IP itself so we never retry the same address.
_dns_cache: dict[str, str] = {}

socket.setdefaulttimeout(2.0)


def resolve(ip: str, no_dns: bool) -> str:
    """Return hostname for *ip*, using the module-level cache.

    If *no_dns* is True, or if the lookup fails, returns the raw IP string.
    The result (including failures) is cached so each IP is looked up at most
    once per invocation.
    """
    if no_dns:
        return ip
    if ip not in _dns_cache:
        try:
            _dns_cache[ip] = socket.gethostbyaddr(ip)[0]
        except (socket.herror, socket.gaierror, socket.timeout, OSError):
            _dns_cache[ip] = ip  # cache failure as the IP itself
    return _dns_cache[ip]


# ─── Log-line regex ───────────────────────────────────────────────────────────
# Matches journalctl short-iso lines that contain [VPN] or [ISP] iptables LOG
# prefixes, e.g.:
#   2026-05-21T11:36:21+0300 raspberrypi kernel: [VPN] IN=eth0 OUT=awg0 ... SRC=192.168.1.175 DST=17.248.209.64 ... PROTO=TCP ... DPT=443 ...
_LOG_RE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"  # ISO timestamp prefix (19 chars)
    r"[^\[]*"                                            # anything before the tag
    r"\[(?P<tag>VPN|ISP)\]"                             # [VPN] or [ISP]
    r".*?\bSRC=(?P<src>\S+)"                            # SRC=<ip>
    r".*?\bDST=(?P<dst>\S+)"                            # DST=<ip>
    r".*?\bPROTO=(?P<proto>\S+)"                        # PROTO=<proto>
    r"(?:.*?\bDPT=(?P<dpt>\d+))?"                       # DPT=<port> (optional — absent for ICMP)
)


def format_line(ts: str, tag: str, src: str, dst: str, proto: str, dpt: str, no_dns: bool) -> str:
    """Compose the output line from parsed fields."""
    hostname = resolve(dst, no_dns)
    if hostname != dst:
        # Truncate long hostnames to 40 chars for readability
        hostname_display = hostname[:40]
        dst_part = f"{dst} ({hostname_display})"
    else:
        dst_part = dst

    port_part = f"{proto}:{dpt}" if dpt else proto
    return f"{ts} [{tag}] {src} → {dst_part} {port_part}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Real-time iptables log enricher for the RPi VPN gateway.\n"
            "\n"
            "Spawns: journalctl -f -k --no-pager -o short-iso\n"
            "\n"
            "Parses [VPN]/[ISP] lines emitted by routing.sh LOG rules and prints\n"
            "enriched output with cached reverse-DNS hostnames."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--src",
        metavar="IP",
        default=None,
        help="Only show lines where SRC matches this IP address.",
    )
    parser.add_argument(
        "--no-dns",
        action="store_true",
        default=False,
        help="Skip reverse DNS lookups; show raw destination IPs.",
    )
    parser.add_argument(
        "--tag",
        choices=["VPN", "ISP", "both"],
        default="both",
        help="Filter by routing tag: VPN, ISP, or both (default: both).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    cmd = ["journalctl", "-f", "-k", "--no-pager", "-o", "short-iso"]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,  # line-buffered
        )
    except FileNotFoundError:
        print("error: journalctl not found — is this running on a systemd host?", file=sys.stderr)
        sys.exit(1)
    except OSError as exc:
        print(f"error: failed to spawn journalctl: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        for line in proc.stdout:
            line = line.rstrip("\n")
            m = _LOG_RE.search(line)
            if not m:
                continue

            tag = m.group("tag")
            src = m.group("src")
            dst = m.group("dst")
            proto = m.group("proto")
            dpt = m.group("dpt") or "-"
            ts = m.group("ts")

            # Apply --tag filter
            if args.tag != "both" and tag != args.tag:
                continue

            # Apply --src filter
            if args.src and src != args.src:
                continue

            output = format_line(ts, tag, src, dst, proto, dpt, args.no_dns)
            print(output, flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
