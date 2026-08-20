# RPi VPN Gateway

Raspberry Pi 4 configured as a split-tunnel VPN gateway — non-RU traffic exits via AmneziaWG VPN, Russian IP ranges exit direct via ISP, transparent to all LAN devices.

[Документация на русском](docs/README.ru.md) | [Technical Reference](docs/REFERENCE.md)

---

## What This Does

The RPi acts as the default gateway for all LAN devices. Traffic is split into two paths:

- **Non-RU traffic** exits through the AmneziaWG VPN tunnel (`awg0`)
- **Russian IP ranges** (updated daily from `russia.iplist.opencck.org`) exit direct via ISP
- **LAN devices** require no individual configuration — the split is fully transparent

```
Internet
  ↓
Router (192.168.1.1) — ISP uplink
  ↓ eth0
RPi4 (192.168.1.254) — VPN gateway
  ↓
LAN devices (default gateway = 192.168.1.254 via router DHCP)

Non-RU → awg0 → AmneziaWG VPN (endpoint: <VPN_SERVER_IP>:<port>)
RU CIDRs → eth0 → ISP direct (via 192.168.1.1)
```

---

## Deploy

### 1. SSH alias

Add to `~/.ssh/config` on your Mac:

```
Host pi4
    HostName 192.168.1.254
    User ar
    IdentityFile ~/.ssh/id_ed25519
```

Verify: `ssh pi4 "echo ok"` — must succeed without a password prompt.

### 2. Configure

**VPN keys** (`.env.secrets`):

```bash
cp .env.secrets.example .env.secrets
# Fill in AWG_PRIVATE_KEY, AWG_PUBLIC_KEY, AWG_PRESHARED_KEY (44-char base64 each)
```

**AmneziaWG config template** (`src/configs/amnezia.key.template.txt`): holds server-specific obfuscation parameters (Jc, Jmin, Jmax, S1, S2, H1–H4) and the endpoint. Copy the `[Interface]` and `[Peer]` blocks from your AmneziaWG server's client config, then replace the key values with `{{PrivateKey}}`, `{{PublicKey}}`, `{{PresharedKey}}` placeholders — `deploy.sh` substitutes them at deploy time.

**Network config** (`.env`): committed to the repo, safe to edit. Update if your network differs from defaults:

```
SSH_HOST="pi4"              # SSH alias for the RPi (from ~/.ssh/config)
RPI_LAN_IP=192.168.1.254    # RPi LAN IP
KEENETIC_GW=192.168.1.1     # ISP gateway (your router)
VPN_SERVER_IP=<your-server-ip>  # AmneziaWG server IP — set in .env.secrets
CRON_UPDATE_HOUR=5          # Hour (0–23) for daily RU list refresh
```

**Optional — ISP-bypass custom routes** (`src/configs/isp-routes-custom.txt`): CIDRs that bypass VPN and exit via ISP, added on top of the auto-downloaded RU list. Create from example when needed:

```bash
cp src/configs/isp-routes-custom.txt.example src/configs/isp-routes-custom.txt
```

**Optional — VPN-force custom routes** (`src/configs/vpn-routes-custom.txt`): CIDRs forced through VPN even if present in the auto-downloaded RU list. Highest-priority override. Create from example when needed:

```bash
cp src/configs/vpn-routes-custom.txt.example src/configs/vpn-routes-custom.txt
```

After editing either custom-route file, use `bash src/deploy-routes.sh` instead of a full `bash src/deploy.sh`. It SCPs only the two custom-route files and runs `routing.sh --no-update` — skipping AmneziaWG install, key validation, and systemd setup. Takes seconds instead of minutes.

**Optional — RU list exclusions** (`src/configs/ru-list-exclude.txt`): CIDRs to strip from the downloaded RU list server-side (use when the RU list incorrectly includes a range you want tunneled). Create from example when needed:

```bash
cp src/configs/ru-list-exclude.txt.example src/configs/ru-list-exclude.txt
```

All three files are gitignored. Full workflow: [docs/REFERENCE.md](docs/REFERENCE.md).

### 3. Router setup (Keenetic)

**Gateway** — set RPi as the LAN default gateway:

1. `http://192.168.1.1` → Home network → Segments → Default → IP parameters
2. Set **Gateway address** to `192.168.1.254` → Save
3. LAN devices apply on next DHCP renewal (or disconnect/reconnect Wi-Fi)

**DNS** — required for domain names in `splitgate status`:

1. Home network → Segments → Default → DNS server → set to `192.168.1.254` → Save

**Rollback**: clear Gateway address in router (set back to `192.168.1.1`).

### 4. Run deploy

```bash
npm run deploy                       # build admin UI, deploy all files + activate routing
npm run deploy:no-run                # deploy files only (use before tunnel is up)
npm run deploy:force-routes          # ...and replace the device's custom-route files with src/configs/
npm run deploy-routes                # fast push of custom-route files only
npm run deploy-routes:keep-remote    # only re-apply the device's existing route files
npm run deploy:admin                 # build + deploy the admin UI and backend, restart the service
```

Equivalent direct invocations: `bash src/deploy.sh [--no-run] [--force-routes]`,
`bash src/deploy-routes.sh [--keep-remote]`.

**Custom routes are not overwritten by default.** Routes added through the web admin exist only on the RPi, and a full deploy used to replace them with whatever was in `src/configs/`, silently. `deploy.sh` now leaves an existing device file alone and says so; pass `--force-routes` to replace it, which first takes a timestamped `.bak` on the device. `deploy-routes.sh` still pushes by design — that is its whole purpose — but it also backs up first and prints the route counts before and after, warning when the local file has fewer routes than the device.

**Non-destructive redeploy:** `deploy.sh` no longer overwrites an already-present `/etc/splitgate/vpn-gateway.env` or `/etc/amnezia/amneziawg/awg0.conf` on the RPi — it skips the overwrite with a warning if the remote file already exists. Edit these files going forward via the admin **Settings page**, or delete the remote file first to force a fresh deploy from the repo template.

`deploy.sh` also installs the `traceroute` apt package (required by the admin **Diagnostics** page), mirroring the existing dnsmasq install pattern.

### 5. Bring up the tunnel

```bash
ssh pi4 "sudo awg-quick up awg0"   # bring up VPN tunnel (manual — not idempotent)
ssh pi4 "sudo awg show"            # verify peer handshake
```

---

## Commands

Run on RPi via SSH. `splitgate` is the dispatcher CLI at `/usr/local/bin/splitgate`.

| Command | What it does |
|---------|-------------|
| `splitgate status` | Recent connections with VPN/ISP routing and org info |
| `splitgate watch` | Real-time traffic stream |
| `splitgate rollback` | Undo VPN gateway entirely |
| `splitgate routing` | Rebuild split-tunnel routes |
| `splitgate update` | Refresh RU IP list now |

```bash
# Show recent connections
ssh pi4 "splitgate status"
ssh pi4 "splitgate status --via=vpn --last=100"
ssh pi4 "splitgate status --summary"                        # top-20 orgs by connection count

# Watch real-time traffic
ssh pi4 "splitgate watch"
ssh pi4 "splitgate watch --src 192.168.1.x --tag VPN"

# Rollback
ssh pi4 "splitgate rollback"
```

[Full CLI reference, verify routing, troubleshooting →](docs/REFERENCE.md)

---

## Route Monitoring Daemon

`splitgate-watch.service` runs `watch-routes.py --daemon` as a persistent systemd service, writing
connection logs to `/etc/splitgate/logs/watch-YYYY-MM-DD.log` (a new file each day, 14-day rotation).
Deployed by `deploy.sh` Stage 28.

```bash
# Service control
ssh pi4 "systemctl status splitgate-watch"
ssh pi4 "sudo systemctl restart splitgate-watch"

# Check today's log
ssh pi4 "tail -f /etc/splitgate/logs/watch-$(date +%F).log"

# Find ISP routes that failed to connect (✗ = not found in conntrack)
ssh pi4 "grep '[ISP] ✗' /etc/splitgate/logs/watch-$(date +%F).log"
```

Each log line shows routing tag, connection status, source/destination, protocol:port, and org:

```
2026-05-29T07:14:00Z [ISP] ✓ 192.168.1.237 → yandex.ru TCP:443 | TELETECH, RU
2026-05-29T07:14:05Z [ISP] ✗ 192.168.1.237 → github.com TCP:443 | FASTLY, US
```

Timestamps are stored in UTC (`Z` suffix); the web admin Logs page renders them in the browser's local timezone.

`✓` = connection found in conntrack (ESTABLISHED/TIME_WAIT); `✗` = not found (UDP connections always show `✗`).

**Tuning workflow** — if `[ISP] ✗` lines point to RU CIDRs going via ISP that actually should go via VPN, uncomment the candidate block in `src/configs/vpn-routes-custom.txt` and re-run `routing.sh`.

---

## Log Files

| File | Location on RPi | Purpose |
|------|-----------------|---------|
| `install.log` | `/etc/splitgate/logs/install.log` | Output from `routing.sh` and `update-vpn-routes` — download source, excluded CIDRs, route counts |
| `watch-YYYY-MM-DD.log` | `/etc/splitgate/logs/watch-2026-05-29.log` | Daily connection log written by `splitgate-watch.service` in daemon mode |
| `watch-error.log` | `/etc/splitgate/logs/watch-error.log` | stderr from `watch-routes.py --daemon` (startup errors, Python exceptions) |

```bash
# View install/routing log
ssh pi4 "sudo tail -20 /etc/splitgate/logs/install.log"
ssh pi4 "sudo grep vpn-routes /etc/splitgate/logs/install.log | tail -10"

# View today's watch log
ssh pi4 "sudo tail -f /etc/splitgate/logs/watch-$(date +%F).log"
```

---

## Web Admin Interface

A browser-based admin UI runs on the RPi at **http://192.168.1.254:8080**.

**Deploy:**
```bash
cd src/admin && npm run build && cd ../..
bash src/deploy.sh
```

**Access:** Open http://192.168.1.254:8080 from any LAN device. Enter the admin password when prompted.

**Default password:** `admin` — change it on the Settings page or:
```bash
echo 'NEWPASSWORD' | ssh pi4 "sudo tee /etc/splitgate/admin.secret"
```

**Pages:**
- **Dashboard** — VPN tunnel status, daemon state, RU list age, route counts (auto-refreshes 10s)
- **Services** — start/stop/restart awg0, splitgate-watch, networking, dnsmasq
- **Routes** — add/remove CIDRs in vpn-routes-custom.txt and isp-routes-custom.txt. Checkboxes select rows for batch removal; the header checkbox covers the current filtered view. The table scrolls inside its own block with a sticky header, so the toolbar and Apply button stay put. **Apply Changes** is enabled only when something is actually pending — either staged additions or route files edited since `routing.sh` last ran (`routes_dirty`, see REFERENCE.md). **Fill Descriptions** asks which routes to fill: only those without a description, or all of them (re-looking-up and replacing existing text). Lookups run one at a time (can take a while for long lists) and stage the results as pending `~` diff entries — nothing is written to the route files until Apply Changes.
- **Logs** — Watch Live (real-time SSE stream), Historical, Install Log, Watch Errors, System Journal. Two filter rows: the top one keeps lines matching **all** its terms, the bottom one (eye-off icon) hides lines matching **any** of its terms. **Copy** puts the filtered lines on the clipboard as raw text; **Download** writes the same content to a file. Right-clicking a row stages its /24 as a VPN or ISP route — with rows selected, the menu acts on the whole selection. **Add all** turns the whole filtered view into routes in one step, after a dialog stating how many routes that is; its **Apply immediately** checkbox (remembered, and also governing the right-click and selection paths) writes and activates them at once instead of leaving them pending for the Routes page. **Select** switches rows to checkboxes with a tri-state select-all. The view is virtualized, so a full day of logs scrolls without stalling; long lines scroll sideways rather than wrapping.
- **Config** — edit ru-list-exclude.txt; trigger manual RU list refresh
- **Settings** — edit /etc/splitgate/vpn-gateway.env and AWG config; change admin password; Rollback

**CLI management:**
```bash
splitgate admin status    # check if admin service is running
splitgate admin start
splitgate admin stop
splitgate admin restart
```
