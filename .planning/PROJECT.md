# RPi VPN Gateway

## What This Is

Raspberry Pi 4 (192.168.1.254) configured as a split-tunnel VPN gateway for a home LAN. All outbound traffic routes through AmneziaWG VPN; Russian IP ranges (fetched daily from russia.iplist.opencck.org) route directly via ISP (Keenetic). LAN devices use the RPi as their default gateway via Keenetic DHCP. Scripts and configs are managed in this local repo and deployed to the RPi via SSH/SCP.

## Core Value

Non-RU traffic exits through AmneziaWG VPN; RU traffic exits direct via ISP — transparent to all LAN devices, survives reboots, fully reversible via a single rollback script.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] AmneziaWG installed and awg0 tunnel operational
- [ ] IP forwarding enabled persistently
- [ ] Split-tunnel routing script (RU subnets → ISP, all else → VPN)
- [ ] NAT masquerade for LAN devices, persistent across reboots
- [ ] Systemd autostart for awg0 and routing service
- [ ] Daily cron to refresh RU subnet list
- [ ] Full rollback script (no data loss, preserves config/packages)

### Out of Scope

- Keenetic router config changes — manual step by user after RPi is verified
- tun0 (Promwad corporate VPN) — must not touch
- Docker containers — must not touch
- Mobile/iOS VPN clients — LAN gateway only, not a client VPN server
- IPv6 routing — IPv4 only for now

## Context

- Network: Keenetic router at 192.168.1.1 (PPPoE → Small Telecom ISP), LAN subnet 192.168.1.0/24
- RPi static IP: 192.168.1.254
- VPN server: YOUR_VPN_SERVER_IP:36348 (AmneziaWG)
- VPN client IP: 10.8.1.13/32
- AmneziaWG config template: `amnezia.key.claude.txt` (keys redacted for repo safety; user provides real keys at deploy time)
- All config variables live in `.env` (committed, no secrets) and deployed to `/etc/vpn-gateway.env` on RPi
- Existing OpenVPN tunnel (tun0, Promwad) must remain untouched

## Constraints

- **Hardware**: Raspberry Pi 4 — Debian/Raspbian, arm64
- **VPN protocol**: AmneziaWG (not standard WireGuard) — requires custom kernel module or deb
- **Safety**: Scripts must be idempotent; routing.sh safe to re-run at any time
- **Rollback**: Full reversal must be possible without reinstalling OS
- **Secrets**: VPN private/public/preshared keys never stored in this repo

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| .env for config vars | IPs/URLs safe to commit; keeps scripts DRY and maintainable | — Pending |
| amnezia.key.claude.txt as template | Real keys provided by user at deploy time; template committed for structure | — Pending |
| Sequential phases | Infrastructure deployment is inherently ordered (VPN up → routes → autostart) | — Pending |
| deploy.sh for delivery | Consistent SSH/SCP delivery; avoids manual copy errors | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-18 after initialization*
