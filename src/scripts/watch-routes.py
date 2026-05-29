#!/usr/bin/env python3
"""
watch-routes.py — Real-time iptables log enricher for the RPi VPN gateway.

Reads journalctl -f -k output, parses [VPN]/[ISP] LOG lines emitted by
iptables FORWARD rules in routing.sh, performs cached reverse-DNS lookups
and background ASN/org lookups via /etc/splitgate/asn-lookup.py, and prints enriched
human-readable output.

Usage:
    python3 scripts/watch-routes.py [--src IP] [--no-dns] [--no-asn] [--tag {VPN,ISP,both}]
    python3 scripts/watch-routes.py --daemon [...]

Requirements: stdlib only — no pip dependencies.

ASN enrichment: Each destination IP is looked up asynchronously via a daemon
background thread that invokes /etc/splitgate/asn-lookup.py as a subprocess. The live
journalctl stream never blocks — if the lookup is still in flight the line
is printed without the '| org' suffix, and the suffix appears on the next
matching line for the same IP once the result is cached.

Use --no-asn to disable all background ASN lookups (pure no-network mode).

Daemon mode (--daemon): writes to /etc/splitgate/logs/watch-YYYY-MM-DD.log instead of
stdout. Each line includes a conntrack status (✓/✗) after a 3-second delay.
Connections with the same (src, dst, dport) are not re-logged within 30 seconds.
"""

import argparse
import datetime
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time

# ─── DNS cache ────────────────────────────────────────────────────────────────
# Maps IP string → hostname string.
# Failed lookups are stored as the IP itself so we never retry the same address.
_dns_cache: dict[str, str] = {}

socket.setdefaulttimeout(2.0)

# ─── ASN cache ────────────────────────────────────────────────────────────────
# Maps IP string → dict | None.
#   None  : lookup in flight (sentinel — prevents duplicate thread spawn)
#   {}    : lookup completed, no result — prevents re-querying this run
#   {"asn": "...", "org": "..."}  : resolved successfully
_asn_cache: dict = {}
_asn_lock = threading.Lock()
_BUFFER_TIMEOUT = 6.0
_pending: dict[str, list] = {}  # dst_ip → [(enqueue_ts, ts, tag, src, dst, proto, dpt, no_dns[, status]), ...]
_pending_lock = threading.Lock()
ASN_LOOKUP_PATH = "/etc/splitgate/asn-lookup.py"
ASN_SUBPROCESS_TIMEOUT = 5.0

# ─── Daemon mode constants (D-03, D-05, D-06) ────────────────────────────────
STATUS_DELAY = 3          # seconds to wait before conntrack check
DEDUP_TTL = 30            # seconds before same (src, dst, dport) logged again
LOG_DIR = "/etc/splitgate/logs"   # base directory for dated log files

# ─── Daemon mode state ────────────────────────────────────────────────────────
_DAEMON_MODE: bool = False   # set to True in main() when --daemon flag is active
_dedup: dict = {}            # maps (src, dst, dport) → monotonic timestamp of last log
_log_file = None             # current open file handle for daemon log writes
_log_date = None             # date of _log_file (used to detect midnight rotation)
_daemon_write_lock = threading.Lock()   # protects _log_file access


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


def _check_conntrack(src: str, dst: str, dpt: str) -> str:
    """Return '✓' if an ESTABLISHED or TIME_WAIT conntrack entry exists for this tuple.

    Reads /proc/net/nf_conntrack line-by-line without subprocesses.
    Returns '✗' if the file exists but no matching entry is found.
    Returns '✗' on OSError (file not found, permission denied, etc.).

    dpt argument is a string (e.g. '443') — used as-is in the search.
    """
    try:
        with open("/proc/net/nf_conntrack", "r") as f:
            for line in f:
                if (
                    f"src={src}" in line
                    and f"dst={dst}" in line
                    and f"dport={dpt}" in line
                    and ("ESTABLISHED" in line or "TIME_WAIT" in line)
                ):
                    return "✓"
    except OSError:
        return "✗"
    return "✗"


def _open_log_file():
    """Open or rotate the dated log file. Call only while holding _daemon_write_lock."""
    global _log_file, _log_date
    today = datetime.date.today()
    if _log_date == today and _log_file is not None:
        return _log_file
    # Rotate: close old handle if open
    old = _log_file
    _log_file = None
    _log_date = None
    if old is not None:
        try:
            old.close()
        except OSError:
            pass
    os.makedirs(LOG_DIR, exist_ok=True)
    path = f"{LOG_DIR}/watch-{today.isoformat()}.log"
    _log_file = open(path, "a", encoding="utf-8")
    _log_date = today
    return _log_file


def _write_daemon_line(line: str) -> None:
    """Thread-safe write of one line to the current dated log file."""
    with _daemon_write_lock:
        f = _open_log_file()
        f.write(line + "\n")
        f.flush()


def _flush_entries(entries: list, asn_result: dict) -> None:
    """Output buffered lines, enriched with asn_result if it contains an org.

    Entry tuple layout:
      (enqueue_ts, ts, tag, src, dst, proto, dpt, no_dns[, status])
    The 9th element (status) is optional for backward compatibility with
    tests that create 8-element tuples. When present and _DAEMON_MODE is True,
    the status ('✓' or '✗') is inserted between [TAG] and src in the output line.
    """
    org = asn_result.get("org") if isinstance(asn_result, dict) else None
    for entry in entries:
        _, ts, tag, src, dst, proto, dpt, no_dns = entry[:8]
        status = entry[8] if len(entry) > 8 else ""
        hostname = resolve(dst, no_dns)
        dst_part = f"{dst} ({hostname[:40]})" if hostname != dst else dst
        port_part = f"{proto}:{dpt}" if dpt else proto
        if _DAEMON_MODE and status:
            line = f"{ts} [{tag}] {status} {src} → {dst_part} {port_part}"
        else:
            line = f"{ts} [{tag}] {src} → {dst_part} {port_part}"
        if org:
            line += f" | {org}"
        if _DAEMON_MODE:
            _write_daemon_line(line)
        else:
            print(line, flush=True)


def _do_lookup(ip: str) -> None:
    """Background worker: invoke asn-lookup.py subprocess and populate _asn_cache."""
    try:
        proc = subprocess.run(
            ["python3", ASN_LOOKUP_PATH],
            input=ip + "\n",
            capture_output=True,
            text=True,
            timeout=ASN_SUBPROCESS_TIMEOUT,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            data = json.loads(proc.stdout)
            result = data.get(ip) or {}
        else:
            result = {}
    except Exception:
        result = {}
    with _asn_lock:
        _asn_cache[ip] = result
    with _pending_lock:
        entries = _pending.pop(ip, [])
    if entries:
        _flush_entries(entries, result)


def lookup_async(ip: str) -> None:
    """Trigger a background ASN lookup for *ip* if one is not already in progress.

    Uses _asn_cache[ip] = None as an in-flight sentinel so that concurrent callers
    do not spawn duplicate threads for the same address.
    """
    with _asn_lock:
        if ip in _asn_cache:
            return  # already in flight or resolved
        _asn_cache[ip] = None  # sentinel: in flight
    t = threading.Thread(target=_do_lookup, args=(ip,), daemon=True)
    t.start()


def _pending_watchdog() -> None:
    """Daemon thread: flush buffered lines that have waited longer than _BUFFER_TIMEOUT."""
    while True:
        time.sleep(1.0)
        now = time.monotonic()
        to_flush: list = []
        with _pending_lock:
            timed_out = [
                ip for ip, entries in _pending.items()
                if entries and now - entries[0][0] >= _BUFFER_TIMEOUT
            ]
            for ip in timed_out:
                to_flush.append((ip, _pending.pop(ip)))
        for ip, entries in to_flush:
            with _asn_lock:
                result = _asn_cache.get(ip) or {}
            _flush_entries(entries, result)


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


def format_line(ts: str, tag: str, src: str, dst: str, proto: str, dpt: str, no_dns: bool, *, enable_asn: bool = True) -> str:
    """Compose the output line from parsed fields.

    If *enable_asn* is True (default), checks _asn_cache for the destination
    IP and appends ' | {org}' when a resolved org is available. On a cache
    miss, triggers a background lookup (lookup_async) so subsequent lines for
    the same IP will carry the suffix once the daemon thread completes.
    """
    hostname = resolve(dst, no_dns)
    if hostname != dst:
        # Truncate long hostnames to 40 chars for readability
        hostname_display = hostname[:40]
        dst_part = f"{dst} ({hostname_display})"
    else:
        dst_part = dst

    port_part = f"{proto}:{dpt}" if dpt else proto

    if enable_asn:
        with _asn_lock:
            cached = _asn_cache.get(dst, "__missing__")
        if cached == "__missing__":
            lookup_async(dst)
        elif isinstance(cached, dict) and cached.get("org"):
            return f"{ts} [{tag}] {src} → {dst_part} {port_part} | {cached['org']}"
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
    parser.add_argument(
        "--no-asn",
        action="store_true",
        default=False,
        help="Disable background ASN/org enrichment.",
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        default=False,
        help="Write to dated log file instead of stdout. Used by splitgate-watch.service.",
    )
    return parser.parse_args()


def main() -> None:
    global _DAEMON_MODE, _dedup
    args = parse_args()
    _DAEMON_MODE = args.daemon

    threading.Thread(target=_pending_watchdog, daemon=True).start()

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

            enable_asn = not args.no_asn

            # ── Daemon mode with ASN: dedup → delay → conntrack → buffer ──────
            if _DAEMON_MODE and enable_asn:
                dedup_key = (src, dst, dpt)
                now = time.monotonic()
                last = _dedup.get(dedup_key, 0)
                if now - last < DEDUP_TTL:
                    continue  # same connection logged recently — skip

                # Evict stale dedup entries (bounded memory — T-13-03-02)
                _dedup = {k: v for k, v in _dedup.items() if now - v <= DEDUP_TTL * 4}

                # Wait STATUS_DELAY seconds; fits within _BUFFER_TIMEOUT=6s window
                time.sleep(STATUS_DELAY)

                # Conntrack status check
                status = _check_conntrack(src, dst, dpt)

                # Update dedup timestamp
                _dedup[dedup_key] = time.monotonic()

                # Buffer for ASN lookup (extended 9-element tuple with status)
                with _asn_lock:
                    cached = _asn_cache.get(dst, "__missing__")

                if cached in ("__missing__", None):
                    lookup_async(dst)
                    entry = (time.monotonic(), ts, tag, src, dst, proto, dpt, args.no_dns, status)
                    with _pending_lock:
                        _pending.setdefault(dst, []).append(entry)
                    continue

                # ASN already cached — build and write daemon line directly
                hostname = resolve(dst, args.no_dns)
                dst_part = f"{dst} ({hostname[:40]})" if hostname != dst else dst
                port_part = f"{proto}:{dpt}" if dpt else proto
                daemon_line = f"{ts} [{tag}] {status} {src} → {dst_part} {port_part}"
                if isinstance(cached, dict) and cached.get("org"):
                    daemon_line += f" | {cached['org']}"
                _write_daemon_line(daemon_line)
                continue

            # ── Daemon mode with --no-asn: write immediately, no status ───────
            if _DAEMON_MODE and not enable_asn:
                _write_daemon_line(format_line(ts, tag, src, dst, proto, dpt, args.no_dns, enable_asn=False))
                continue

            # ── Interactive mode (non-daemon): original behavior unchanged ─────
            if enable_asn:
                with _asn_lock:
                    cached = _asn_cache.get(dst, "__missing__")

                if cached in ("__missing__", None):
                    lookup_async(dst)
                    entry = (time.monotonic(), ts, tag, src, dst, proto, dpt, args.no_dns)
                    with _pending_lock:
                        _pending.setdefault(dst, []).append(entry)
                    continue

            output = format_line(ts, tag, src, dst, proto, dpt, args.no_dns, enable_asn=enable_asn)
            print(output, flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
