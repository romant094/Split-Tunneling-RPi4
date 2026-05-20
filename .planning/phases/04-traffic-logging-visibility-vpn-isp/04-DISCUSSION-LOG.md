# Phase 4: Traffic Logging & Visibility - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20
**Phase:** 4-traffic-logging-visibility-vpn-isp
**Areas discussed:** Log capture mechanism, Domain name resolution, Status & visibility UX, Log granularity & retention, Domain filtering

---

## Log Capture Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| iptables LOG — new connections | Kernel logs each new TCP/UDP connection as it enters the routing decision | ✓ |
| Periodic conntrack snapshot | Cron script reads active connections from nf_conntrack every few minutes | |
| routing.sh startup log only | Only log when routing.sh runs; no per-connection data | |

**User's choice:** iptables LOG for new connections

| Option | Description | Selected |
|--------|-------------|----------|
| FORWARD chain only — LAN device traffic | Logs connections from LAN devices passing through RPi | ✓ |
| FORWARD + OUTPUT chains | Logs both LAN device traffic and RPi's own traffic | |
| Per-interface: separate VPN and ISP rules | Two rules on awg0 and eth0 explicitly | |

**User's choice:** FORWARD chain only

| Option | Description | Selected |
|--------|-------------|----------|
| Two LOG rules with distinct prefix tags | `[VPN]` prefix for awg0, `[ISP]` prefix for eth0, state NEW | ✓ |
| Single LOG rule at FORWARD entry, post-route marking | fwmark-based, more complex | |
| You decide | Claude picks differentiation method | |

**User's choice:** Two LOG rules with `[VPN]` / `[ISP]` prefix tags

| Option | Description | Selected |
|--------|-------------|----------|
| Inside routing.sh | Alongside existing iptables rules, same idempotency pattern | ✓ |
| Separate vpn-logging.sh script | Cleaner separation, another deploy stage | |

**User's choice:** Inside routing.sh

---

## Domain Name Resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Reverse DNS post-hoc | rDNS lookup on IPs when viewing logs (~70% coverage) | |
| DNS query capture via dnsmasq | RPi as DNS forwarder; logs all queries; requires Keenetic DHCP change | ✓ |
| Skip — log IPs only | No domain resolution, raw IPs only | |

**User's choice:** dnsmasq DNS logging
**Notes:** User wants to identify which apps/games generate traffic (e.g., "is Steam going through VPN?"). dnsmasq with query logging gives hostname resolution at query time correlated with connection events.

| Option | Description | Selected |
|--------|-------------|----------|
| Keenetic DHCP: DNS = 192.168.1.254 | One config change, all devices automatically use RPi DNS | ✓ |
| Manual per-device DNS setting | Change DNS on each device individually | |

**User's choice:** Keenetic DHCP + KN-3010 (Speedster) instructions required in deploy docs

| Option | Description | Selected |
|--------|-------------|----------|
| Cloudflare 1.1.1.1 | Fast, privacy-friendly; queries go through VPN | ✓ |
| Keenetic as upstream (192.168.1.1) | Router DNS; queries stay local/ISP | |
| Dual: 1.1.1.1 + 8.8.8.8 fallback | Reliable config; both via VPN | |

**User's choice:** Cloudflare 1.1.1.1

---

## Status & Visibility UX

| Option | Description | Selected |
|--------|-------------|----------|
| vpn-status.sh script | Query script formatting journalctl + dnsmasq entries | ✓ |
| journalctl tags only | No script; user runs journalctl manually | |
| Dedicated log file | rsyslog + logrotate, /var/log/vpn-routing.log | |

**User's choice:** vpn-status.sh

| Option | Description | Selected |
|--------|-------------|----------|
| Last 50 connections — src IP, dest IP, VPN/ISP, rDNS name | Default readable output with filter flags | ✓ |
| Live tail mode | Watch connections in real-time | |
| Summary: top 10 destinations by device | Aggregate view | |

**User's choice:** Last 50 connections (default)

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — tunnel health header + connections | awg0 status + last 50 connections | |
| No — connections only | Keep focused on connection log | ✓ |

**User's choice:** Connections only (no tunnel health header)

---

## Log Granularity & Retention

| Option | Description | Selected |
|--------|-------------|----------|
| Rate-limit LOG rules + journald retention | --limit 10/min; SystemMaxUse=100M | ✓ |
| Dedicated log file + logrotate | rsyslog → /var/log/vpn-routing.log; 7-day rotation | |
| No rate limiting — log everything | High volume on streaming/gaming LAN | |

**User's choice:** Rate-limit LOG rules + journald retention

| Option | Description | Selected |
|--------|-------------|----------|
| journald default (auto-rotation, ~100MB max) | dnsmasq → syslog → journald | ✓ |
| Separate dnsmasq log file with 7-day rotation | log-facility=/var/log/dnsmasq.log + logrotate | |

**User's choice:** journald default

---

## Domain Filtering

| Option | Description | Selected |
|--------|-------------|----------|
| Filter log VIEW by domain/app | `vpn-status.sh --filter=steam` shows matching entries | ✓ |
| Route specific domains via ISP instead of VPN | Domain-based routing — Phase 5 territory | |
| Both | Filter view (Phase 4) + note domain routing for Phase 5 | |

**User's choice:** Log view filtering only (Phase 4)
**Notes:** User wants `--filter=<string>` for partial case-insensitive match on domain name. If no dnsmasq DNS match exists, fall back to rDNS. Also wants `--device=<IP>` as optional extension.

---

## Claude's Discretion

- Exact `dnsmasq.conf` options beyond interface + upstream + log-queries
- Whether to use `listen-address=192.168.1.254` or `interface=eth0`
- vpn-status.sh: exact journalctl query flags for [VPN]/[ISP] extraction + dnsmasq correlation
- Whether rDNS uses `host`, `dig -x`, or `getent hosts`
- iptables LOG rule positioning within FORWARD chain

## Deferred Ideas

- **Domain-based routing** — forcing specific domains/apps via ISP instead of VPN. Phase 5: Custom Route Exceptions.
- **Tunnel health summary in vpn-status.sh** — user declined; `awg show` and `ip route` remain the tools for tunnel health.
