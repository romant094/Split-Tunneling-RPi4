# Phase 5: Custom Route Exceptions - Research

**Researched:** 2026-05-21
**Domain:** Linux routing (ip route), Bash scripting, deploy orchestration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Exception File**
- D-01: IP/CIDR only — no domain-based exceptions. Domain names resolved manually by user before adding as CIDRs.
- D-02: Format: one CIDR per line, identical to iplist output (no labels, no comments).
- D-03: Deployed path: `/etc/white-list-extended.txt`.
- D-04: Repo path: `config/white-list-extended.txt` (gitignored). Example file: `config/white-list-extended.txt.example` (committed, not deployed).
- D-05: If `/etc/white-list-extended.txt` absent at routing.sh run time → skip silently, no error.

**File Rename**
- D-06: `/etc/vpn-ru-subnets.txt` → `/etc/white-list.txt`. Update routing.sh constant `SUBNET_FILE` and any other references.
- D-07: Rename applied atomically — routing.sh Stage 1 download target changed to white-list.txt. Old file on RPi may be stale; routing.sh now writes to new path.

**routing.sh Changes**
- D-08: After adding all RU subnets from white-list.txt, add a new sub-stage loading white-list-extended.txt (if present). Same loop pattern, same `|| true` suppression, same log output.
- D-09: Stage 3 flush: no change needed — exception routes are via KEENETIC_GW (not awg0), so existing awg0 flush does not remove them.

**vpn-status.sh Changes**
- D-10: Add `--via=vpn` and `--via=isp` flags. When `--via=vpn` set, output includes only rows where routing decision is `VPN`. When `--via=isp`, only `ISP` rows.
- D-11: `--via` is composable with existing `--filter`, `--device`, `--last` flags.

**Deploy Integration**
- D-12: deploy.sh gets one new stage: check if `config/white-list-extended.txt` exists; if yes, SCP to `/tmp/white-list-extended.tmp` → `sudo mv` → `sudo chmod 644`. If absent, log skip and continue.
- D-13: Exception deploy stage executes before routing.sh activation stage.

**Rollback**
- D-14: vpn-rollback.sh: add removal of `/etc/white-list-extended.txt` (if exists) during rollback. Exception routes via KEENETIC_GW cleared by existing route flush logic.

### Claude's Discretion
- Exact routing.sh constant name for exceptions file path (`EXCEPTIONS_FILE` or similar)
- Whether to log the count of loaded exception CIDRs (recommended: yes, consistent with RU subnet count log)
- Whether deploy.sh stage number slots before or after rollback script stage

### Deferred Ideas (OUT OF SCOPE)
- Domain-based exceptions (would require ipset + dnsmasq --ipset for dynamic resolution)
- Management helper script (add-exception.sh)
</user_constraints>

---

## Summary

Phase 5 is a pure Bash/Linux routing extension — no new packages, no new services, no new external dependencies. All work is extending four existing scripts (`routing.sh`, `vpn-status.sh`, `vpn-rollback.sh`, `deploy.sh`) and adding two config files (`config/white-list-extended.txt.example` committed, `config/white-list-extended.txt` gitignored).

The core routing mechanism is straightforward: exception CIDRs added via `ip route add <cidr> via KEENETIC_GW` work exactly like existing RU subnet routes. Linux longest-prefix match ensures more-specific routes take priority over the default via awg0. The Stage 3 flush in routing.sh only flushes `dev awg0` routes — exception routes point to KEENETIC_GW (via eth0), so they are not disturbed by the flush. This means idempotency is preserved without any new logic.

The one structural risk is a directory name discrepancy: CONTEXT.md D-04 specifies `config/` (singular) but the repo uses `configs/` (plural) for `dnsmasq.conf`. The planner must decide whether to use `config/` (creating a new directory) or `configs/` (consistent with existing convention). This is documented in Open Questions.

**Primary recommendation:** Implement all changes as described in CONTEXT.md decisions. No external dependencies required. Stage ordering for deploy.sh: exception file deploy → existing routing.sh activation stage. Constant name `EXCEPTIONS_FILE` is natural and consistent with `SUBNET_FILE`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Exception CIDR routing | RPi kernel routing table | — | `ip route` entries live in kernel; same tier as existing RU routes |
| Exception file deployment | macOS deploy script (deploy.sh) | RPi filesystem | SCP pattern already established for all config files |
| Exception file loading | RPi routing.sh | — | Reads and applies routes; same script that loads white-list.txt |
| Rollback cleanup | RPi vpn-rollback.sh | — | Mirrors all setup steps; no separate rollback tooling needed |
| Status filtering (`--via`) | RPi vpn-status.sh | — | Post-processing of journald entries; no kernel changes needed |

---

## Standard Stack

### Core (all already installed — no new packages)
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| bash | 5.x (Raspbian) | Scripting runtime | All existing scripts use bash; `set -euo pipefail` established |
| iproute2 (`ip`) | installed | Route manipulation | Already used in routing.sh Stage 5 loop |
| iptables | installed | Firewall rules | Already managed; no new rules in Phase 5 |

### No New Packages
Phase 5 adds no new apt packages, pip packages, or npm packages. All required tools are already present on the RPi.

**Installation:** None required.

---

## Package Legitimacy Audit

No packages are installed in this phase. Section not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
macOS (developer)
    │
    │  ./deploy.sh
    │  ├─ Stage N: check config/white-list-extended.txt → SCP if present
    │  └─ Stage 21 (existing): routing.sh --no-update
    │
    ▼ SSH/SCP
RPi (192.168.1.254)
    │
    │  /etc/routing.sh (extended)
    │  ├─ Stage 1: download → /etc/white-list.txt  (renamed from vpn-ru-subnets.txt)
    │  ├─ Stage 5: loop white-list.txt → ip route add ... via KEENETIC_GW
    │  ├─ Stage 5b (new): if /etc/white-list-extended.txt exists:
    │  │               loop → ip route add ... via KEENETIC_GW
    │  └─ Stage 6: ip route add default dev awg0
    │
    │  Linux kernel routing table (main)
    │  ├─ <RU CIDRs>        via 192.168.1.1  (eth0 → ISP)
    │  ├─ <exception CIDRs> via 192.168.1.1  (eth0 → ISP)
    │  └─ default           dev awg0         (VPN)
    │
    │  Traffic decision: longest-prefix match
    │  Exception CIDRs more specific than default → ISP wins
```

### Recommended Project Structure
```
.
├── scripts/
│   ├── routing.sh          # extend: rename SUBNET_FILE, add Stage 5b, add EXCEPTIONS_FILE const
│   ├── vpn-status.sh       # extend: add --via=vpn / --via=isp flag parsing + filter
│   └── vpn-rollback.sh     # extend: add rm -f /etc/white-list-extended.txt step
├── deploy.sh               # extend: add exception file deploy stage + update TOTAL_STAGES
├── config/                 # NEW directory (or configs/ — see Open Questions)
│   ├── white-list-extended.txt.example  # committed; shows format
│   └── white-list-extended.txt          # gitignored; user-populated
└── .gitignore              # add: config/white-list-extended.txt
```

### Pattern 1: Conditional File Loading with Silent Skip (D-05)
**What:** Check file existence before use; skip silently if absent.
**When to use:** Optional user-defined overrides that may or may not be present on any given deploy.
**Example:**
```bash
# Source: routing.sh Stage 5 pattern, extended for exceptions (ASSUMED: direct code derivation)
EXCEPTIONS_FILE="/etc/white-list-extended.txt"
if [[ -f "${EXCEPTIONS_FILE}" ]]; then
    log "Stage 5b: Loading exception CIDRs from ${EXCEPTIONS_FILE}..."
    EX_ADDED=0
    while IFS= read -r subnet; do
        [[ -z "${subnet}" ]] && continue
        [[ "${subnet}" =~ ^[[:space:]]*# ]] && continue
        ip route add "${subnet}" via "${KEENETIC_GW}" 2>/dev/null || true
        (( EX_ADDED++ )) || true
    done < "${EXCEPTIONS_FILE}"
    log "Exception routes added: ${EX_ADDED} routes via ${KEENETIC_GW}"
else
    log "Stage 5b: ${EXCEPTIONS_FILE} not found — no exception routes loaded (D-05)"
fi
```

### Pattern 2: Flag Parsing Extension for --via (D-10, D-11)
**What:** Extend existing case-statement flag parsing; apply filter after all entries collected.
**When to use:** Adding a composable filter flag to an existing flag set.
**Example:**
```bash
# Source: vpn-status.sh argument parsing block (ASSUMED: direct code derivation)
VIA=""  # new variable alongside LAST, FILTER, DEVICE

for arg in "$@"; do
    case "${arg}" in
        --via=*)
            val="${arg#--via=}"
            if [[ "${val}" != "vpn" && "${val}" != "isp" ]]; then
                err "--via value must be 'vpn' or 'isp', got: '${val}'"
                exit 1
            fi
            VIA="${val^^}"  # uppercase: vpn→VPN, isp→ISP (matches 'decision' field)
            ;;
        # ... existing cases unchanged ...
    esac
done

# Applied in output loop (after entries array populated):
for entry in "${entries[@]}"; do
    IFS='|' read -r ts src_ip dst_ip domain decision <<< "${entry}"
    # Apply --via filter
    if [[ -n "${VIA}" ]] && [[ "${decision}" != "${VIA}" ]]; then
        continue
    fi
    printf "%-20s %-18s %-18s %-40s %s\n" "${ts}" "${src_ip}" "${dst_ip}" "${domain}" "${decision}"
done
```

### Pattern 3: Deploy Stage with Optional File (D-12, D-13)
**What:** SCP a file only if it exists in the repo; skip with log message if absent.
**When to use:** User-populated config files that are gitignored.
**Example:**
```bash
# Source: deploy.sh stage template (ASSUMED: direct code derivation)
WHITE_LIST_EXT_LOCAL="config/white-list-extended.txt"   # or configs/ — see Open Questions
WHITE_LIST_EXT_REMOTE="/etc/white-list-extended.txt"
WHITE_LIST_EXT_TMP="/tmp/white-list-extended.tmp"

echo "[N/${TOTAL_STAGES}] Deploying white-list-extended.txt (if present)..."
if [[ -f "${WHITE_LIST_EXT_LOCAL}" ]]; then
    scp -o BatchMode=yes "${WHITE_LIST_EXT_LOCAL}" "${SSH_HOST}:${WHITE_LIST_EXT_TMP}"
    ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${WHITE_LIST_EXT_TMP} ${WHITE_LIST_EXT_REMOTE} && sudo chmod 644 ${WHITE_LIST_EXT_REMOTE} && sudo chown root:root ${WHITE_LIST_EXT_REMOTE}"
    echo "       white-list-extended.txt deployed."
else
    echo "       ${WHITE_LIST_EXT_LOCAL} not found — skipping (D-05)."
fi
```

### Pattern 4: Rollback Cleanup for Optional File (D-14)
**What:** Remove optional file during rollback with `rm -f` (no error if absent).
**When to use:** Any file that may or may not exist on the target system.
**Example:**
```bash
# Source: vpn-rollback.sh step pattern (ASSUMED: direct code derivation)
log "Removing /etc/white-list-extended.txt (if present)..."
rm -f /etc/white-list-extended.txt
log "/etc/white-list-extended.txt: removed (or was not present)"
```

### Anti-Patterns to Avoid
- **Changing Stage 3 flush scope:** Exception routes go via KEENETIC_GW (eth0), not awg0. Do not add flush logic for them — `ip route flush dev awg0` already correctly leaves them untouched.
- **Using `ip route replace` instead of `add ... || true`:** The `|| true` pattern is established and intentional (idempotency). Do not switch to `replace` — it changes semantics.
- **Validating CIDR format in routing.sh:** Phase 2 deliberately does not validate CIDR format from white-list.txt (T-02-02: values passed as args, not eval'd). Apply the same trust model to white-list-extended.txt — the user is responsible for CIDR correctness.
- **Making exception file deploy mandatory:** D-05 and D-12 are clear: absence is normal, not an error. The Stage A preflight check in deploy.sh must NOT add white-list-extended.txt to required files.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Longest-prefix route priority | Custom routing logic | Linux kernel routing table (ip route) | Kernel already does LPM; exception CIDRs more specific than default → automatically win |
| CIDR deduplication | Dedup script | `ip route add ... \|\| true` | Duplicate route attempt is silently suppressed; no data loss, no error |
| Exception file format validation | Parser/validator | User responsibility + example file | iplist format (one CIDR/line) is trivial; validation complexity not justified |

**Key insight:** Linux routing table longest-prefix match is the entire mechanism. No custom logic is needed — adding a more-specific route via ISP automatically bypasses the VPN default.

---

## Runtime State Inventory

This phase renames `/etc/vpn-ru-subnets.txt` → `/etc/white-list.txt`. This is a runtime state change on the live RPi.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `/etc/vpn-ru-subnets.txt` on RPi (populated by current routing.sh Stage 1) | routing.sh Stage 1 now writes to white-list.txt; old file on RPi becomes stale/orphaned. No migration needed — routing.sh rebuilds it on next run. |
| Live service config | vpn-routing.service runs routing.sh on boot — routing.sh already updated to write white-list.txt | No service config change needed |
| OS-registered state | cron at `/etc/cron.d/vpn-routes` calls `/etc/update-vpn-routes` which calls `routing.sh --no-update` | routing.sh --no-update now reads white-list.txt; cron script unchanged but must see new file present |
| Secrets/env vars | No env vars reference the file name; `SUBNET_FILE` is a routing.sh-internal constant | Code rename only; no env var changes |
| Build artifacts | None — no compiled artifacts | None |

**Stale file note:** After routing.sh is updated and first run, `/etc/vpn-ru-subnets.txt` remains on the RPi as an orphan file. It is harmless (not referenced by any active script after the update) but could be cleaned up manually or by rollback. vpn-rollback.sh currently lists it in the PRESERVED section — update that comment to reflect the new path.

**`--no-update` flag interaction:** `routing.sh --no-update` skips the download and uses the existing file. After the rename, the first run must be without `--no-update` (to download to the new white-list.txt path) — OR the operator must manually rename the file on the RPi before running `--no-update`. The plan should note this in verification steps.

---

## Common Pitfalls

### Pitfall 1: Stage A Preflight Incorrectly Requiring Exception File
**What goes wrong:** If deploy.sh Stage A (preflight) adds `config/white-list-extended.txt` to required files, every deploy fails unless the user has populated exceptions.
**Why it happens:** Copy-paste from existing required files check block.
**How to avoid:** Exception file check in Stage A must be absent. Only `config/white-list-extended.txt.example` might appear, and that's committed (always present if checked out). The actual file is never checked in Stage A.
**Warning signs:** Any `if [[ ! -f "${WHITE_LIST_EXT_LOCAL}" ]]; then ... exit 1; fi` for this file.

### Pitfall 2: --no-update After Rename Reads Old Filename
**What goes wrong:** After routing.sh is updated to use `WHITE_LIST_FILE="/etc/white-list.txt"`, running `routing.sh --no-update` on an RPi that still has only `/etc/vpn-ru-subnets.txt` will fail (file not found abort, D-04 behavior).
**Why it happens:** The first deploy updates routing.sh but doesn't force a fresh download.
**How to avoid:** deploy.sh final activation stage currently runs `routing.sh --no-update`. For this phase's first deploy, routing.sh must run without `--no-update` to download to the new path. The plan should use `routing.sh` (no flag) for the activation stage on first deploy, or ensure the old file is renamed before `--no-update` is used.
**Warning signs:** `[routing] ERROR: --no-update passed but /etc/white-list.txt does not exist`

### Pitfall 3: --via Filter Applied Before Domain Resolution
**What goes wrong:** Applying `--via` filter inside the per-entry loop before domain resolution causes the `rDNS` `host` calls to still run for filtered-out entries, adding unnecessary latency.
**Why it happens:** Eager filtering placement.
**How to avoid:** Apply `--via` filter at output time (in the output loop), not during entry collection. This matches how `--filter` is applied (after domain resolution). See Pattern 2 above.
**Warning signs:** `--via=vpn` output is slow when many ISP entries exist.

### Pitfall 4: Directory Name Mismatch (config/ vs configs/)
**What goes wrong:** CONTEXT.md D-04 says `config/white-list-extended.txt` (singular). The repo currently uses `configs/` (plural) for `dnsmasq.conf`. Creating `config/` creates two similar directories, confusing future maintainers.
**Why it happens:** CONTEXT.md was written without checking existing directory name.
**How to avoid:** See Open Questions — planner must resolve before creating directory or deploy.sh variable.
**Warning signs:** Both `config/` and `configs/` directories exist at repo root.

### Pitfall 5: Rollback Summary Comment Still References vpn-ru-subnets.txt
**What goes wrong:** vpn-rollback.sh Step 8 summary text says "Preserved: /etc/vpn-ru-subnets.txt". After the rename this is misleading.
**Why it happens:** Summary text is hardcoded, not derived from constants.
**How to avoid:** Update Step 8 summary in vpn-rollback.sh to reference `/etc/white-list.txt` (the new name).

---

## Code Examples

Verified patterns from existing codebase (sourced from scripts/ in this repo):

### Existing RU Subnet Loop (Stage 5) — Verbatim Basis for Stage 5b
```bash
# Source: scripts/routing.sh lines 150-159 [VERIFIED: read from codebase]
log "Stage 5: Adding RU subnet routes via ${KEENETIC_GW} (ROUT-01)..."
ADDED=0
while IFS= read -r subnet; do
    [[ -z "${subnet}" ]] && continue
    [[ "${subnet}" =~ ^[[:space:]]*# ]] && continue
    ip route add "${subnet}" via "${KEENETIC_GW}" 2>/dev/null || true
    (( ADDED++ )) || true
done < "${SUBNET_FILE}"
log "RU subnet routes added: ${ADDED} routes via ${KEENETIC_GW}"
```
Stage 5b copies this verbatim, replacing `SUBNET_FILE` with `EXCEPTIONS_FILE` and `ADDED` with `EX_ADDED`.

### Existing Flag Parsing Block — Basis for --via Addition
```bash
# Source: scripts/vpn-status.sh lines 46-68 [VERIFIED: read from codebase]
for arg in "$@"; do
    case "${arg}" in
        --last=*)  ...  ;;
        --filter=*)  ...  ;;
        --device=*)  ...  ;;
        *)
            err "Unknown argument: '${arg}'"
            exit 1
            ;;
    esac
done
```
Add `--via=*)` case before the `*` catch-all. Update catch-all usage hint to include `[--via=vpn|isp]`.

### Existing Deploy Stage Pattern — Basis for Exception File Stage
```bash
# Source: deploy.sh lines 332-336 [VERIFIED: read from codebase]
echo "[19/${TOTAL_STAGES}] Deploying vpn-status.sh to ${SSH_HOST}:${VPN_STATUS_REMOTE}..."
scp -o BatchMode=yes "${VPN_STATUS_LOCAL}" "${SSH_HOST}:${VPN_STATUS_TMP}"
ssh -o BatchMode=yes "${SSH_HOST}" "sudo mv ${VPN_STATUS_TMP} ${VPN_STATUS_REMOTE} && sudo chmod +x ${VPN_STATUS_REMOTE} && sudo chown root:root ${VPN_STATUS_REMOTE}"
echo "       vpn-status.sh deployed (chmod +x, root:root)."
```
Exception file stage wraps this in `if [[ -f "${WHITE_LIST_EXT_LOCAL}" ]]; then ... else echo "skipping"; fi`. Use `chmod 644` (not +x) — data file, not executable.

### Existing Rollback Cleanup Pattern
```bash
# Source: scripts/vpn-rollback.sh line 116 [VERIFIED: read from codebase]
rm -f /etc/cron.d/vpn-routes
```
Same pattern applies for `/etc/white-list-extended.txt`: `rm -f /etc/white-list-extended.txt`.

### CONSTANTS block top of routing.sh — Before/After
```bash
# BEFORE (current):
SUBNET_FILE="/etc/vpn-ru-subnets.txt"
SUBNET_TMP="/tmp/ru-subnets.tmp"

# AFTER (Phase 5):
WHITE_LIST_FILE="/etc/white-list.txt"
SUBNET_TMP="/tmp/ru-subnets.tmp"
EXCEPTIONS_FILE="/etc/white-list-extended.txt"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single subnet file (vpn-ru-subnets.txt) | Two files: white-list.txt (auto) + white-list-extended.txt (user) | Phase 5 | User can add custom ISP-bypass CIDRs without touching the auto-downloaded list |
| vpn-status.sh shows all connections | vpn-status.sh with --via filter shows VPN-only or ISP-only | Phase 5 | Discovery workflow: identify VPN targets to add as exceptions |

**No deprecated patterns introduced by this phase.** Existing patterns (flush-and-rebuild, `|| true`, iptables -C guard, SCP-to-tmp) all continue unchanged.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `config/white-list-extended.txt` (singular) is intentional per D-04, not a typo for `configs/` | Open Questions / Pitfall 4 | Creates two similar directories or uses wrong path; deploy.sh references wrong local path |
| A2 | `--via` filter should be applied at output time (not during entry collection) for performance | Pattern 2, Pitfall 3 | Cosmetic only — either placement is functionally correct |
| A3 | vpn-rollback.sh Step 8 summary comment references `/etc/vpn-ru-subnets.txt` as preserved | Pitfall 5 / Runtime State | Comment is misleading post-rename but functionally harmless |

---

## Open Questions

1. **`config/` vs `configs/` directory name**
   - What we know: CONTEXT.md D-04 says `config/white-list-extended.txt`. Repo uses `configs/dnsmasq.conf`.
   - What's unclear: Is `config/` intentional (a separate new directory for user-editable files) or was it a typo for `configs/`?
   - Recommendation: Planner should use `configs/` (consistent with existing convention) unless user explicitly chose `config/`. If `configs/` is used, update deploy.sh variable `WHITE_LIST_EXT_LOCAL="configs/white-list-extended.txt"`. The `.gitignore` entry must match the chosen path.

2. **deploy.sh Stage N ordering: before or after Stage 16 (rollback script)?**
   - CONTEXT.md D-13 says "before routing.sh activation stage" but D-Claude says "before or after rollback script stage" is discretionary.
   - Recommendation: Insert exception file stage as Stage 17 (after vpn-rollback.sh Stage 16, before dnsmasq Stage 17 which shifts to 18). This preserves the logical order: deploy all scripts → deploy all data files → activate.
   - TOTAL_STAGES: 21 → 22.

3. **First-deploy `--no-update` concern**
   - What we know: deploy.sh final activation (Stage 21) runs `routing.sh --no-update`. After Phase 5 update, routing.sh expects `/etc/white-list.txt` but RPi may only have `/etc/vpn-ru-subnets.txt`.
   - Recommendation: Change Stage 21 to run `routing.sh` (without `--no-update`) for the Phase 5 activation, ensuring fresh download to the new path. Or add a pre-check that renames the old file. Document this in the plan's verification steps.

---

## Environment Availability

All tools required for this phase are already installed on the RPi and macOS deploy host. No new environment dependencies.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bash | All scripts | ✓ | Already deployed | — |
| ip (iproute2) | routing.sh Stage 5b | ✓ | Already installed on RPi | — |
| ssh/scp | deploy.sh | ✓ | Already used by all stages | — |
| /etc/vpn-gateway.env | routing.sh, vpn-status.sh | ✓ | Deployed in Phase 1 | — |

**Missing dependencies with no fallback:** None.

---

## Security Domain

Phase 5 introduces no new network services, no new iptables rules, and no new user-facing endpoints. The security surface is identical to Phase 2 (routing.sh CIDR loading).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | Partial | CIDRs from white-list-extended.txt passed as args to `ip route` (T-02-02 pattern — no eval) |
| V6 Cryptography | No | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed CIDR in white-list-extended.txt causes ip route error | Tampering | `\|\| true` suppresses error; `ip route add` rejects invalid CIDRs without executing shell code |
| User adds VPN server IP as exception (routing loop) | Tampering | No mitigation needed — KEENETIC_GW routes for specific host already take precedence; VPN server host route (Stage 4) is a /32 and wins over any exception CIDR |
| white-list-extended.txt written by malicious process | Tampering | File chmod 644, owned root:root; requires root to write |

**T-02-02 applies:** CIDR values from white-list-extended.txt are passed as positional arguments to `ip route add` — no eval, no dynamic command construction. Malformed CIDRs cause `ip route` to print an error (suppressed by `|| true`) and increment the counter but do no harm.

---

## Sources

### Primary (HIGH confidence)
- `scripts/routing.sh` — read directly from codebase; Stage 5 loop pattern verified
- `scripts/vpn-status.sh` — read directly from codebase; flag parsing block verified
- `scripts/vpn-rollback.sh` — read directly from codebase; cleanup pattern verified
- `deploy.sh` — read directly from codebase; stage pattern and TOTAL_STAGES verified
- `.planning/phases/05-custom-route-exceptions-ip/05-CONTEXT.md` — all decisions sourced from here

### Secondary (MEDIUM confidence)
- Linux kernel routing: longest-prefix match semantics [ASSUMED — well-established kernel behavior, no change since 2.x kernels]

### Tertiary (LOW confidence)
- None.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all tools verified present from prior phases
- Architecture patterns: HIGH — all patterns derived directly from existing codebase with no speculation
- Pitfalls: HIGH — derived from reading actual code; Pitfall 4 (dir name) is a concrete discrepancy found in code vs CONTEXT.md

**Research date:** 2026-05-21
**Valid until:** Stable — this is pure Bash/iproute2; no fast-moving dependencies
