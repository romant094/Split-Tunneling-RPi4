# Phase 3: Autostart, Cron & Rollback - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20
**Phase:** 3-autostart-cron-rollback
**Areas discussed:** Cron disruption

---

## vpn-routing.service Boot Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| With download + D-04 fallback | Run routing.sh (download attempt, fallback to existing file if fails) | ✓ |
| --no-update only | Skip download on boot, use yesterday's subnets | |

**User's choice:** Run with download; fallback to existing file if download fails (D-04 already implemented in routing.sh)
**Notes:** Decided without discussion — user stated directly.

---

## Cron Disruption

| Option | Description | Selected |
|--------|-------------|----------|
| Full routing.sh | Download + flush + rebuild every day (~2-10 sec disruption) | |
| Download only | Update file daily, routes rebuilt on next reboot only | |
| Checksum-based | Download → compare checksum → skip rebuild if unchanged | ✓ |

**User's choice:** Checksum-based (option 3) — zero disruption on no-change days.
**Notes:** Most stable approach for a home router.

---

## Cron Timing

| Option | Description | Selected |
|--------|-------------|----------|
| /etc/cron.daily/ (anacron) | System picks time, survives missed runs | |
| /etc/cron.d/ specific time | Exact time, predictable | ✓ |

**User's choice:** `/etc/cron.d/` at 5:00am daily.
**Notes:** RPi is always-on, so anacron's catch-up feature is unnecessary. User wants 5:00am. Also: `CRON_UPDATE_HOUR=5` added to `.env` so time is configurable without editing cron files.

---

## Rollback Output

| Option | Description | Selected |
|--------|-------------|----------|
| Silent + logs | No stdout, writes to syslog via logger | ✓ |
| Verbose | Print verification output after rollback | |

**User's choice:** Silent + logs.
**Notes:** Decided without discussion — user stated directly.

---

## Deploy Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Extend deploy.sh stages 12+ | Continue existing pattern | ✓ |
| Separate deploy-phase3.sh | New script for Phase 3 only | |

**User's choice:** Extend deploy.sh stages 12+.
**Notes:** Consistent with Phase 2 extension pattern.

---

## Claude's Discretion

- vpn-routing.service unit file details (Type, Restart policy)
- SHA256 vs MD5 for checksum (use sha256sum)
- Cron stdout/stderr redirection (use logger)
- Rollback route restore method (static `ip route add default via ${KEENETIC_GW}` — no DHCP dependency)

## Deferred Ideas

None.
