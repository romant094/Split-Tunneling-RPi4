# Phase 6: Documentation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 06-documentation
**Areas discussed:** Doc location & format, Language, Script reference depth, Troubleshooting/gotchas, RU translation location, CLI format, Planning links format

---

## Doc Location & Format

| Option | Description | Selected |
|--------|-------------|----------|
| README.md at repo root | Single file, all content inline | ✓ |
| docs/RUNBOOK.md | Keeps root clean, needs docs/ folder | |
| Extend SPEC.md | Repurpose existing doc | |

**User's choice:** README.md at repo root  
**Notes:** Should contain: brief description, main scenarios, how-to workflows, deploy instructions, monitoring, logs. Links to .planning/ phases table at the bottom.

---

## Language

| Option | Description | Selected |
|--------|-------------|----------|
| English primary, Russian secondary | Main doc EN, RU translation linked at top | ✓ |
| Russian only | Match SPEC.md language | |
| Bilingual sections | EN + RU inline per section | |

**User's choice:** English primary, Russian secondary  
**Notes:** RU translation linked at very top of README.md. Planning artifacts NOT translated.

---

## Script Reference Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Full CLI reference | All flags, all scripts, examples | ✓ |
| Common use cases only | Just the happy path | |
| Inline summaries only | One-liner per script | |

**User's choice:** Full CLI reference  
**Notes:** User wants complete understanding of all software capabilities and how to work with them. CLI descriptions mandatory.

---

## Troubleshooting / Gotchas

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated section | Separate "Troubleshooting & Known Gotchas" section | ✓ |
| Inline per script | Gotchas embedded in each script's section | |
| Both | Inline + summary section | |

**User's choice:** Dedicated section  
**Notes:** Separate section. Must cover Phase 4 hard-won discoveries.

---

## RU Translation Location

| Option | Description | Selected |
|--------|-------------|----------|
| README.ru.md at root | Standard bilingual repo convention | |
| docs/README.ru.md | Keeps root clean | ✓ |
| Bottom section in README.md | Single file | |

**User's choice:** docs/README.ru.md

---

## CLI Format

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in README.md | One big doc, Ctrl+F friendly | ✓ |
| docs/scripts/*.md | One file per script | |
| Both | Summary table + full per-script docs | |

**User's choice:** Inline in README.md

---

## Planning Links Format

| Option | Description | Selected |
|--------|-------------|----------|
| Table: phase name + one-line goal + link | Scannable, shows what each phase built | ✓ |
| Just a list of links | Minimal | |
| Skip planning links | README focused on ops only | |

**User's choice:** Table with phase name, one-line goal, and link

---

## Claude's Discretion

- README.md heading levels and anchor names
- Whether to include a quick-reference cheat sheet block at the top
- Exact wording of section titles
- Network topology explanation format (diagram, prose, or both)

## Deferred Ideas

None — discussion stayed within phase scope.
