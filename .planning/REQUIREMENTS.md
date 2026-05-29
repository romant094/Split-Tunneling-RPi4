# Requirements: RPi VPN Gateway

**Defined:** 2026-05-18
**Core Value:** Non-RU traffic exits through AmneziaWG VPN; RU traffic exits direct via ISP — transparent to LAN devices, survives reboots, fully reversible.

## v1 Requirements

### Install

- [x] **INST-01**: AmneziaWG installed; `awg` binary available on RPi ✓ (01-01, 2026-05-19)
- [x] **INST-02**: IP forwarding enabled persistently (sysctl, survives reboot) ✓ (01-01, 2026-05-19)

### Config

- [x] **CONF-01**: awg0.conf deployed to `/etc/amnezia/amneziawg/awg0.conf` from template ✓ (01-02, 2026-05-19)
- [x] **CONF-02**: `/etc/vpn-gateway.env` deployed with all variables from `.env` ✓ (01-02, 2026-05-19)

### Routing

- [x] **ROUT-01**: `/etc/routing.sh` downloads RU subnet list and applies split routes
- [x] **ROUT-02**: routing.sh is idempotent (safe to re-run without errors)
- [x] **ROUT-03**: routing.sh adds host route for VPN server (YOUR_VPN_SERVER_IP) via ISP (prevents tunnel loop)
- [x] **ROUT-04**: routing.sh sets default route via awg0

### NAT

- [x] **NAT-01**: iptables masquerade on awg0 (VPN-bound LAN traffic)
- [x] **NAT-02**: iptables masquerade on eth0 (ISP-bound LAN traffic)
- [x] **NAT-03**: iptables rules survive reboot (iptables-persistent)

### Autostart

- [ ] **AUTO-01**: awg-quick@awg0 systemd service enabled at boot
- [ ] **AUTO-02**: vpn-routing.service enabled, starts after awg-quick@awg0
- [ ] **AUTO-03**: `/etc/cron.daily/update-vpn-routes` runs routing.sh daily

### Rollback

- [ ] **ROLL-01**: `/etc/vpn-rollback.sh` stops services, flushes routes, removes NAT rules and cron
- [ ] **ROLL-02**: Rollback preserves awg0.conf, installed packages, and routing.sh

### Verify

- [ ] **VRFY-01**: `ip route get 8.8.8.8` → dev awg0 (foreign traffic via VPN)
- [ ] **VRFY-02**: `ip route get 77.88.8.8` → via 192.168.1.1 (RU traffic via ISP)
- [ ] **VRFY-03**: `ip route get YOUR_VPN_SERVER_IP` → via 192.168.1.1 (VPN server via ISP)
- [ ] **VRFY-04**: `curl --interface awg0 https://ifconfig.me` returns VPN server IP

## v2 Requirements

### Monitoring

- **MON-01**: Alert when VPN tunnel handshake is stale > 3 minutes
- **MON-02**: Dashboard or status command showing all routes + tunnel health

### Multi-interface

- **MULTI-01**: Support for multiple VPN providers with failover
- **MULTI-02**: Per-device routing rules (specific LAN IPs bypass VPN)

## Out of Scope

| Feature | Reason |
|---------|--------|
| IPv6 routing | IPv4-only for now; adds complexity without clear need |
| Keenetic config changes | Manual step by user; out of scope for automation |
| tun0 (Promwad VPN) | Existing corporate tunnel; must not be touched |
| Docker container routing | Out of scope; container networking separate concern |
| Mobile VPN client (client mode) | RPi is gateway only, not a VPN server for mobile devices |
| Key management automation | Security concern; user manages keys manually |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INST-01 | Phase 1 | Complete (01-01) |
| INST-02 | Phase 1 | Complete (01-01) |
| CONF-01 | Phase 1 | Pending |
| CONF-02 | Phase 1 | Pending |
| ROUT-01 | Phase 2 | Complete |
| ROUT-02 | Phase 2 | Complete |
| ROUT-03 | Phase 2 | Complete |
| ROUT-04 | Phase 2 | Complete |
| NAT-01 | Phase 2 | Complete |
| NAT-02 | Phase 2 | Complete |
| NAT-03 | Phase 2 | Complete |
| AUTO-01 | Phase 3 | Pending |
| AUTO-02 | Phase 3 | Pending |
| AUTO-03 | Phase 3 | Pending |
| ROLL-01 | Phase 3 | Pending |
| ROLL-02 | Phase 3 | Pending |
| VRFY-01 | Phase 3 | Pending |
| VRFY-02 | Phase 3 | Pending |
| VRFY-03 | Phase 3 | Pending |
| VRFY-04 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-18*
*Last updated: 2026-05-19 — INST-01, INST-02 completed by Plan 01-01*
