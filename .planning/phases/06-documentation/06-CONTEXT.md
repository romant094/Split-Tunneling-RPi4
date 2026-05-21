# Phase 6: Documentation - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Write a comprehensive ops runbook for the RPi VPN Gateway. All 5 prior phases are complete — this phase produces documentation only (no new code or script changes).

Deliverables:
1. **`README.md`** at repo root — primary English-language reference
2. **`docs/README.ru.md`** — full Russian translation; linked from README.md top

Phase ends when: README.md covers all major workflows with examples; CLI reference covers all scripts with all flags; troubleshooting section captures known gotchas; Russian translation exists at docs/README.ru.md; phase links table at bottom of README.md.

</domain>

<decisions>
## Implementation Decisions

### Doc Location & Format
- **D-01:** Primary doc: `README.md` at repo root (single file, inline everything).
- **D-02:** Russian translation: `docs/README.ru.md`. Link at the very top of README.md: `[Документация на русском](docs/README.ru.md)`.
- **D-03:** Planning folder (`/.planning/`) is NOT translated — link to it as-is from the phase links table.
- **D-04:** No `docs/` subdirectory of separate per-script files — CLI reference is inline in README.md.

### README.md Content Structure (in order)
- **D-05:** Section order:
  1. Title + one-line description
  2. Language link (RU translation)
  3. What this does (brief — network topology, routing logic)
  4. Prerequisites / initial setup (keys, .env, SSH alias `pi4`)
  5. Deploy workflow (`./deploy.sh` — what it does, how to run)
  6. Verify routing (the 4 VRFY checks + vpn-status.sh)
  7. Monitoring & logs (`vpn-status.sh`, `watch-routes.py`, journald)
  8. Custom exceptions workflow (discovery → white-list-extended.txt → deploy)
  9. Rollback (`vpn-rollback.sh`)
  10. Script CLI Reference (full flag-by-flag, all scripts)
  11. Troubleshooting / Known Gotchas
  12. Development phases table (links to .planning/phases)

### Script CLI Reference
- **D-06:** Full CLI reference inline in README.md for every user-facing script: `deploy.sh`, `scripts/vpn-status.sh`, `scripts/vpn-rollback.sh`, `scripts/routing.sh`, `scripts/watch-routes.py`, `scripts/update-vpn-routes`.
- **D-07:** Format per script: synopsis line, all flags with descriptions, usage examples (at least 2 examples per script).
- **D-08:** `deploy.sh` stages: document the high-level stage groups (install, config, routing, autostart, logging, exceptions, activate), NOT 22 individual stages. User needs to understand what deploy does end-to-end, not read a changelog.
- **D-09:** `install-awg.sh` — document as an internal RPi-side installer (not directly invoked by user; called by deploy.sh). Brief mention only, not full CLI reference.

### Language
- **D-10:** README.md in English throughout.
- **D-11:** `docs/README.ru.md` is a full translation of README.md into Russian. Planning artifacts (.planning/) are NOT translated.
- **D-12:** `docs/` folder created as part of this phase (for README.ru.md).

### Troubleshooting / Gotchas
- **D-13:** Dedicated "Troubleshooting & Known Gotchas" section in README.md (and translated into RU).
- **D-14:** Must include at minimum: FORWARD chain DROP policy (Docker), LOG-before-ACCEPT ordering, eth0 MASQUERADE exclusion of LAN subnet, dnsmasq install-before-config ordering, tunnel bring-up is manual (not in deploy.sh).
- **D-15:** Each gotcha format: symptom → cause → fix (3-line pattern). No prose paragraphs.

### Phase Links Table
- **D-16:** Bottom section "Development Phases" — table with columns: Phase, Name, Goal, Link.
- **D-17:** Links point to `.planning/phases/{padded_phase}-{slug}/` directories.
- **D-18:** All 6 phases listed (including Phase 6 itself).

### Claude's Discretion
- README.md heading level choices and anchor names
- Whether to include a quick-reference "cheat sheet" block at the very top (common commands at a glance)
- Exact wording of section titles
- How deep to explain network topology (diagram vs prose vs both)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scripts to Document
- `deploy.sh` — main orchestrator; read before writing deploy section (22 stages, --no-run flag, stage groups)
- `scripts/routing.sh` — split-tunnel routing; read Stage 5/5b for white-list loading logic
- `scripts/vpn-status.sh` — traffic visibility tool; read all flags (--via, --filter, --device, --last)
- `scripts/vpn-rollback.sh` — full rollback; read teardown steps (Phase 4 + Phase 5 additions)
- `scripts/update-vpn-routes` — cron wrapper; brief, but check actual content
- `scripts/watch-routes.py` — real-time iptables log viewer; read for feature description
- `scripts/install-awg.sh` — RPi-side installer; read for brief description only

### Config / Data Files
- `.env` — all env vars deployed to RPi; document all variables and what they control
- `configs/white-list-extended.txt.example` — exception file format; include in custom exceptions section
- `amnezia.key.template.txt` — VPN config template; document the `{{PrivateKey}}`/`{{PublicKey}}`/`{{PresharedKey}}` substitution
- `systemd/vpn-routing.service` — systemd unit; mention in autostart docs

### Prior Context (for troubleshooting section source material)
- `.planning/STATE.md` §"Phase 4 Post-execution Fixes" — source of all Phase 4 gotchas (FORWARD DROP, LOG ordering, eth0 MASQUERADE exclusion, dnsmasq order)
- `.planning/STATE.md` §"Decisions" — D-series decisions; cross-reference for SSH, deploy, routing patterns

### Original Design Spec (RU)
- `SPEC.md` — original Russian design document; useful for RU translation accuracy on terminology

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SPEC.md` §"Инструкция по эксплуатации" — existing Russian ops instructions; reuse as base for Russian translation, expanding with all phases
- `SPEC.md` §"Файлы системы" — file table; expand and update for README.md's system files section

### Established Patterns
- All scripts follow `source /etc/vpn-gateway.env` for config — document once in README, reference from each script entry
- Deploy pattern: `SCP to /tmp → sudo mv → sudo chmod` — explain once in deploy section
- SSH alias `pi4` via `~/.ssh/config` — prerequisite; document in setup section
- `.env.secrets` is gitignored and never committed — document in setup/secrets section

### Integration Points
- `docs/` directory does not exist yet — must be created
- No existing README.md — create from scratch
- `configs/` has `white-list-extended.txt.example` — reference it in the custom exceptions section

</code_context>

<specifics>
## Specific Ideas

- User wants "all instructions for working with awg, how to monitor, logs" — comprehensive ops coverage, not just quick-start
- Discovery → exception workflow should be a prominent walkthrough: `vpn-status.sh --via=vpn` → identify IPs → add to `configs/white-list-extended.txt` → `./deploy.sh`
- Phase links table at end is for dev history / traceability, not end-user ops
- RU translation link at very top of README.md (before anything else)

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-documentation*
*Context gathered: 2026-05-21*
