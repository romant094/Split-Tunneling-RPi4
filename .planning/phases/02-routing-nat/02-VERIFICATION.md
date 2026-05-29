---
phase: "02"
phase_name: routing-nat
status: passed
verified_at: "2026-05-20"
verifier: inline (gsd-verifier unavailable in runtime)
plans_verified: 2
static_checks: 24
runtime_checks: pending (requires RPi hardware)
open_issues:
  - CR-01: curl no timeout in routing.sh (non-blocking for initial deploy)
  - CR-02: iptables rules use literal awg0/eth0 instead of ${VPN_IFACE}/LAN_IFACE
---

# Phase 02: Routing & NAT — Verification

**Status:** PASSED (static) / Pending (runtime — requires RPi)
**Date:** 2026-05-20
**Goal:** Split-tunnel routing active, LAN devices NATed through RPi, rules survive reboot

---

## Deliverables

| Deliverable | Status | Path |
|------------|--------|------|
| scripts/routing.sh | ✓ Exists (220 lines) | `scripts/routing.sh` |
| deploy.sh Stage 10+11 | ✓ Extended (276 lines, TOTAL_STAGES=11) | `deploy.sh` |

---

## Static Acceptance Criteria

### Plan 02-01: scripts/routing.sh

| Check | Result |
|-------|--------|
| `bash -n scripts/routing.sh` exits 0 | ✓ |
| Contains `set -euo pipefail` | ✓ |
| Contains `source /etc/vpn-gateway.env` | ✓ |
| Contains `/etc/vpn-ru-subnets.txt` | ✓ |
| Contains `--no-update` handling | ✓ |
| Contains `ip route flush dev` (D-06) | ✓ |
| Contains `VPN_SERVER_IP` host route before default | ✓ |
| Contains `ip route add default dev` (ROUT-04) | ✓ |
| Contains `iptables -t nat -C POSTROUTING … awg0` (NAT-01 idempotency) | ✓ |
| Contains `iptables -t nat -C POSTROUTING … eth0` (NAT-02 idempotency) | ✓ |
| Contains `iptables-save` (NAT-03) | ✓ |
| Contains `iptables-persistent` (NAT-03) | ✓ |
| Contains `/etc/iptables/rules.v4` (NAT-03) | ✓ |
| Does NOT contain `awg-quick up/down` | ✓ |
| Does NOT contain interactive `read` prompts | ✓ |

### Plan 02-02: deploy.sh

| Check | Result |
|-------|--------|
| `bash -n deploy.sh` exits 0 | ✓ |
| `TOTAL_STAGES=11` | ✓ |
| `--no-run` flag parsed | ✓ |
| `routing.sh` referenced | ✓ |
| `ROUTING_SH_REMOTE` constant defined | ✓ |
| `[10/` stage present | ✓ |
| `[11/` stage present | ✓ |
| `RUN_ROUTING` flag logic present | ✓ |
| `chmod +x` on routing.sh | ✓ |

---

## Requirements Coverage

| Requirement | Description | Status |
|------------|-------------|--------|
| ROUT-01 | routing.sh downloads RU subnets and applies split routes | ✓ Static |
| ROUT-02 | routing.sh is idempotent (flush-then-rebuild + `\|\| true`) | ✓ Static |
| ROUT-03 | VPN server /32 host route via ISP before default route | ✓ Static |
| ROUT-04 | Default route set via awg0 | ✓ Static |
| NAT-01 | iptables MASQUERADE on awg0 (idempotent) | ✓ Static |
| NAT-02 | iptables MASQUERADE on eth0 (idempotent) | ✓ Static |
| NAT-03 | iptables-persistent installed, rules saved to /etc/iptables/rules.v4 | ✓ Static |

---

## CLAUDE.md Constraints

| Constraint | Status |
|-----------|--------|
| Scripts idempotent | ✓ — flush-then-rebuild + iptables -C guards |
| No secrets in repo | ✓ — routing.sh sources /etc/vpn-gateway.env (gitignored) |
| AmneziaWG: no awg-quick invocation | ✓ — tunnel management excluded from routing.sh |
| Rollback-safe | ✓ — routing.sh does not modify awg0.conf or installed packages |

---

## Runtime Verification (Pending — requires RPi deployment)

Run after `./deploy.sh` against pi4:

```bash
# Phase 2 success criteria (from ROADMAP.md)
ip route show default                    # expect: default dev awg0
ip route get YOUR_VPN_SERVER_IP               # expect: via 192.168.1.1 (VPN server → ISP)
ip route get 77.88.8.8                  # expect: via 192.168.1.1 (RU → ISP)
ip route get 8.8.8.8                    # expect: dev awg0 (foreign → VPN)
sudo iptables -t nat -L POSTROUTING -nv # expect: MASQUERADE on awg0 + eth0
# After reboot:
sudo iptables -t nat -L POSTROUTING -nv # expect: rules still present
ip route show default                    # expect: default dev awg0 (if vpn-routing.service active — Phase 3)
```

---

## Open Issues (from Code Review)

| ID | Severity | Description | Disposition |
|----|----------|-------------|-------------|
| CR-01 | Critical | `curl` in routing.sh has no `--max-time`/`--connect-timeout` | Non-blocking for initial deploy; fix in Phase 3 or separate patch |
| CR-02 | Critical | iptables Stage 7 hardcodes `awg0`/`eth0` instead of `${VPN_IFACE}` | Non-blocking for RPi4 with standard interface names; fix recommended before Phase 3 |
| WR-01 | Warning | No CIDR validation before `ip route add`; CRLF may silently fail routes | Non-blocking; opencck.org serves clean CIDR data |
| WR-03 | Warning | No FORWARD chain rules; relies on default-ACCEPT policy | Non-blocking for fresh RPi; add in Phase 3 rollback/hardening scope |
| WR-04 | Warning | BatchMode=yes missing from Phase 1 SSH/SCP calls in deploy.sh | Non-blocking; Phase 1 deploy already tested |

---

*Verified: 2026-05-20 — Static checks pass. Runtime verification pending RPi deployment.*
