# Phase 2: Routing & NAT - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 02-routing-nat
**Areas discussed:** Route table strategy, Subnet file management, Idempotency mechanism, Download failure handling, Deploy integration, Script structure

---

## Route table strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Main table | Add all routes directly to default/main table. Simpler, no ip rule needed. | ✓ |
| Custom policy table | Create ip rule + ip route add ... table 100. Isolated but more complex. | |

**User's choice:** Main table  
**Notes:** User asked whether subnets could be saved to a file for manual editing — clarified that downloading to `/etc/vpn-ru-subnets.txt` satisfies this. File can be edited between runs to add/replace subnets.

---

## Subnet file management

| Option | Description | Selected |
|--------|-------------|----------|
| Always refresh on every run | Download fresh list each time; fallback to existing file on failure. | ✓ |
| Only if file is missing | Download once; use existing file on all subsequent runs. | |
| Refresh with --update flag | Default = use existing file; flag forces fresh download. | |

**User's choice:** Always refresh on every run + fallback + `--no-update` flag  
**Notes:** User also wanted timer-based refresh. Clarified that daily cron is Phase 3 scope (AUTO-03). routing.sh's `--no-update` flag supports the cron use case. User confirmed this separation.

---

## Idempotency mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Flush VPN routes then rebuild | Delete all awg0 routes then re-add from subnet file. | ✓ |
| ip route replace (upsert) | Use 'ip route replace' for each subnet — no flush, no gap, but old routes linger. | |

**User's choice:** Flush-and-rebuild  
**Notes:** User also confirmed routing.sh should set the default route via awg0 (ROUT-04) — not delegated to a separate step.

---

## Download failure handling

Resolved during route table discussion:
- Download fresh → save to `/etc/vpn-ru-subnets.txt`
- If download fails AND file exists → warn + continue with existing file
- If download fails AND file missing → abort with error

---

## Deploy integration

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing deploy.sh | Add Phase 2 stage to deploy.sh. One entry point. | ✓ |
| Separate routing-deploy.sh | New script just for routing.sh deploy. More modular. | |

| Option | Description | Selected |
|--------|-------------|----------|
| Run routing.sh automatically after deploy | Default: SSH + run after SCP. | ✓ (default) |
| Manual activation only | User runs manually. | ✓ (via --no-run flag) |

**User's choice:** Extend deploy.sh; automatic activation by default; `--no-run` flag for manual debugging  
**Notes:** User explicitly wants to manually verify the first activation, then have auto activation available. Decision: automatic by default, `--no-run` disables it.

---

## Script structure

| Option | Description | Selected |
|--------|-------------|----------|
| One script | Single routing.sh handles everything. | ✓ |
| Split by function | Separate download/apply/nat scripts. | |

| Option | Description | Selected |
|--------|-------------|----------|
| NAT inside routing.sh | iptables setup in the same script. | ✓ |
| Separate iptables script | routing.sh for routes only; nat-setup.sh separately. | |

**User's choice:** One script, NAT inside routing.sh

---

## Claude's Discretion

- Exact `ip route flush` scope (safe approach that doesn't break non-VPN connectivity)
- Whether to use `ipset` vs. plain `ip route` loop for 5000+ RU subnets
- iptables idempotency check commands (`iptables -C`)
- deploy.sh stage numbering for Phase 2 additions
- Whether routing.sh sources `/etc/vpn-gateway.env` directly

## Deferred Ideas

- **Timer-based subnet refresh**: User wants daily automatic refresh. Deferred to Phase 3 (AUTO-03: `/etc/cron.daily/update-vpn-routes`).
