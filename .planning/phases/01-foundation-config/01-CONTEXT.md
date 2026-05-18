# Phase 1: Foundation & Config - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Install AmneziaWG on RPi and deploy VPN configuration. Phase 1 ends when the awg0 tunnel can be brought up (`awg-quick up awg0`) and the RPi has IP forwarding enabled persistently. Routing, NAT, and autostart are Phase 2 and 3 scope.

</domain>

<decisions>
## Implementation Decisions

### AmneziaWG Installation
- **D-01:** Primary install method: official AmneziaWG installer script from amnezia.org
- **D-02:** Fallback if installer fails: download pre-built `.deb` from AmneziaWG GitHub releases page
- **D-03:** RPi OS already running (Raspberry Pi OS / Debian, arm64) — no OS install step needed

### Deploy Script Authentication
- **D-04:** deploy.sh connects via SSH using system SSH config; host alias is `pi4`
- **D-05:** SSH user on RPi: `ar` (not default `pi`); has passwordless sudo
- **D-06:** Auth method: SSH key (pre-configured via ssh-copy-id); no password prompts

### VPN Key Injection
- **D-07:** Real VPN keys live in `.env.secrets` (gitignored, never committed)
- **D-08:** Variable names in `.env.secrets`: `AWG_PRIVATE_KEY`, `AWG_PUBLIC_KEY`, `AWG_PRESHARED_KEY`
- **D-09:** deploy.sh reads `.env.secrets`, substitutes placeholders in `amnezia.key.claude.txt` via `sed`, SCPs result to `/etc/amnezia/amneziawg/awg0.conf` on RPi
- **D-10:** deploy.sh validates keys before deployment: non-empty check + basic base64 format check; fails fast with clear error message if invalid

### Claude's Discretion
- Exact sed substitution approach (inline sed pipeline vs temp file) — Claude picks safer/cleaner method
- Whether deploy.sh also verifies SSH connectivity before starting deployment
- Exact error message wording for validation failures

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Configuration
- `.env` — network config variables (RPI_LAN_IP, KEENETIC_GW, VPN_SERVER_IP, VPN_IFACE, etc.)
- `amnezia.key.claude.txt` — AmneziaWG config template with `{{PrivateKey}}`, `{{PublicKey}}`, `{{PresharedKey}}` placeholders and real obfuscation params (Jc, Jmin, Jmax, S1, S2, H1-H4)
- `.planning/REQUIREMENTS.md` — Phase 1 requirements: INST-01, INST-02, CONF-01, CONF-02

### Deployment Target
- SSH host alias: `pi4` (resolves via `~/.ssh/config`)
- SSH user: `ar` (passwordless sudo)
- awg0.conf target path on RPi: `/etc/amnezia/amneziawg/awg0.conf`
- env target path on RPi: `/etc/vpn-gateway.env`

### No External Specs
No ADRs or external specs — requirements fully captured in decisions above and REQUIREMENTS.md

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `amnezia.key.claude.txt`: complete awg0.conf structure with real obfuscation params; only keys need substitution
- `.env`: all network config variables already defined; deploy.sh should source this + `.env.secrets`

### Established Patterns
- New project — no existing code patterns. deploy.sh establishes the deployment pattern for this phase; subsequent phases follow the same SSH/SCP approach.

### Integration Points
- deploy.sh → RPi via `ssh pi4` / `scp ... pi4:path`
- `.env.secrets` (local, gitignored) → substituted into awg0.conf → `/etc/amnezia/amneziawg/awg0.conf` on RPi
- `.env` (local, committed) → `/etc/vpn-gateway.env` on RPi (sourced by routing scripts in Phase 2)

</code_context>

<specifics>
## Specific Ideas

- `.env.secrets` format mirrors `.env` (KEY=value lines, bash-sourceable)
- deploy.sh should print each step as it runs so user can see progress
- The `awg-quick up awg0` command requires AmneziaWG (not standard WireGuard) — confirm correct binary is used post-install

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-config*
*Context gathered: 2026-05-18*
