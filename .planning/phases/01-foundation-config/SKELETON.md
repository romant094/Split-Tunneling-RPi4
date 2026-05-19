# Walking Skeleton — RPi VPN Gateway

**Phase:** 1
**Generated:** 2026-05-19

## Capability Proven End-to-End

A developer can run `./deploy.sh` on a macOS workstation and end-to-end (a) install AmneziaWG on the Raspberry Pi (`pi4`), (b) enable persistent IP forwarding, (c) deploy a rendered `awg0.conf` to `/etc/amnezia/amneziawg/awg0.conf` with `chmod 600 root:root`, and (d) deploy `.env` to `/etc/vpn-gateway.env`. After deploy completes, `sudo awg-quick up awg0` succeeds on the RPi and `sudo awg show` reports a peer handshake.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Deployment approach | SSH/SCP from macOS workstation to SSH host alias `pi4` (user `ar`, passwordless sudo, SSH key auth) | D-04, D-05, D-06 — system SSH config carries the connection details; no inline credentials |
| AmneziaWG install method | RPi-side script `scripts/install-awg.sh` invoked over SSH; idempotent (`which awg` short-circuit) | D-01 primary; D-02 deb fallback documented inside the installer |
| Install primary path | bivlked installer (RomikB fork) auto-detects RPi `+rpt` kernel suffix and selects `linux-headers-rpi-v8` | RESEARCH.md Pattern: bivlked is the lowest-friction path for arm64 |
| Install fallback path | Pre-built `.deb` from AmneziaWG GitHub releases page (manual step documented in installer if primary fails) | D-02 |
| Config template | `amnezia.key.claude.txt` with `{{PrivateKey}}`, `{{PublicKey}}`, `{{PresharedKey}}` placeholders | Already authored; only key substitution remains |
| Secrets management | `.env.secrets` (gitignored) with `AWG_PRIVATE_KEY`, `AWG_PUBLIC_KEY`, `AWG_PRESHARED_KEY`; `.env.secrets.example` checked in | D-07, D-08 — keys never enter git |
| Substitution method | Local `sed` pipeline rendering into a `mktemp` file with `chmod 600` before SCP (BSD/GNU compatible) | RESEARCH.md macOS sed pitfall — pipeline form is portable |
| Remote config placement | SCP to `/tmp/awg0.conf.tmp` then `sudo mv` to `/etc/amnezia/amneziawg/awg0.conf` with `chmod 600` + `chown root:root` | Avoids writing as user `ar`; enforces WG permission contract |
| Network config | `.env` checked in, SCP'd verbatim to `/etc/vpn-gateway.env` (mode 644) on RPi | D-09 — sourced by Phase 2 routing scripts |
| IP forwarding persistence | `/etc/sysctl.d/99-vpn-gateway.conf` containing `net.ipv4.ip_forward=1`; `sysctl --system` to apply | INST-02; sysctl.d is standard on Bookworm |
| Tunnel bring-up | NOT performed by deploy.sh (not idempotent); documented as a post-deploy manual command | RESEARCH.md Pitfall 5 |
| Directory layout | `deploy.sh` at repo root; `scripts/install-awg.sh` (RPi-side); `.env`/`.env.secrets` at repo root; `.env.secrets.example` at repo root | Matches RESEARCH.md "Recommended Project Structure" |
| Idempotency contract | All scripts safe to re-run: `mkdir -p`, `which awg` short-circuit, sysctl.d overwrite, SCP overwrite | Phase requirement (project constraint) |

## Stack Touched in Phase 1

- [x] Project scaffold — `deploy.sh` entrypoint, `scripts/install-awg.sh`, `.env.secrets.example` template
- [x] Routing — N/A in Phase 1 (Phase 2 owns split-tunnel routing)
- [x] "Database" equivalent — config files on RPi (`awg0.conf`, `vpn-gateway.env`, sysctl drop-in)
- [x] "UI" equivalent — CLI: developer runs `./deploy.sh`; observes step-by-step progress lines
- [x] Deployment — Real RPi at `pi4` receives all artifacts via SSH/SCP

## Out of Scope (Deferred to Later Slices)

- Split-tunnel routing logic (`scripts/routing.sh`, RU subnet download, host route for VPN server, default-via-awg0) — Phase 2
- iptables MASQUERADE on `awg0`/`eth0` and `iptables-persistent` — Phase 2
- systemd `awg-quick@awg0` enable, `vpn-routing.service` unit, `cron.daily/update-vpn-routes` — Phase 3
- `/etc/vpn-rollback.sh` rollback script — Phase 3
- VRFY-01..04 end-to-end traffic verification (`ip route get`, `curl --interface awg0`) — Phase 3
- Automated tunnel bring-up inside `deploy.sh` (left manual to preserve idempotency)
- Key rotation automation, monitoring/alerting, multi-interface failover (v2 requirements)
- IPv6 routing, Keenetic config changes, tun0/Promwad VPN, Docker container routing (Out of Scope per REQUIREMENTS.md)

## Subsequent Slice Plan

Each later phase adds capability on top of this skeleton without changing the deployment contract (SSH/SCP via `pi4`, env files at canonical paths, idempotent scripts):

- **Phase 2:** `scripts/routing.sh` (RU subnet download, split routes, host route for VPN server, default via awg0) + iptables MASQUERADE persisted via `iptables-persistent`. Deployed using the same `deploy.sh` SSH/SCP pattern; sources `/etc/vpn-gateway.env` on RPi.
- **Phase 3:** systemd units (`awg-quick@awg0` enable, `vpn-routing.service`), `cron.daily/update-vpn-routes`, `/etc/vpn-rollback.sh`. Deployed via the same `deploy.sh` pattern; rollback script restores plain-host routing without touching Phase 1 artifacts (preserves `awg0.conf`, installed packages, `routing.sh`).

## Contract for Phases 2 and 3

- SSH host alias: `pi4`; user `ar`; passwordless sudo via SSH key.
- All deploy artifacts staged through `/tmp/<name>.tmp` then `sudo mv` to final root-owned path.
- All RPi-side scripts read configuration from `/etc/vpn-gateway.env` (sourced).
- All scripts are idempotent and safe to re-run.
- Secrets only ever flow through `.env.secrets` (local, gitignored) and the rendered `awg0.conf` (RPi-only, mode 600 root).
