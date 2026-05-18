<!-- GSD:project-start source:PROJECT.md -->
## Project

**RPi VPN Gateway**

Raspberry Pi 4 (192.168.1.254) configured as a split-tunnel VPN gateway for a home LAN. All outbound traffic routes through AmneziaWG VPN; Russian IP ranges (fetched daily from russia.iplist.opencck.org) route directly via ISP (Keenetic). LAN devices use the RPi as their default gateway via Keenetic DHCP. Scripts and configs are managed in this local repo and deployed to the RPi via SSH/SCP.

**Core Value:** Non-RU traffic exits through AmneziaWG VPN; RU traffic exits direct via ISP — transparent to all LAN devices, survives reboots, fully reversible via a single rollback script.

### Constraints

- **Hardware**: Raspberry Pi 4 — Debian/Raspbian, arm64
- **VPN protocol**: AmneziaWG (not standard WireGuard) — requires custom kernel module or deb
- **Safety**: Scripts must be idempotent; routing.sh safe to re-run at any time
- **Rollback**: Full reversal must be possible without reinstalling OS
- **Secrets**: VPN private/public/preshared keys never stored in this repo
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
