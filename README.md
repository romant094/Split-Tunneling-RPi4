# RPi VPN Gateway

Raspberry Pi 4 configured as a split-tunnel VPN gateway — non-RU traffic exits via AmneziaWG VPN, Russian IP ranges exit direct via ISP, transparent to all LAN devices.

[Документация на русском](docs/README.ru.md)

---

## What This Does

The RPi acts as the default gateway for all LAN devices. All outbound traffic is routed through
the RPi, which splits it into two paths:

- **Non-RU traffic** exits through the AmneziaWG VPN tunnel (`awg0`).
- **Russian IP ranges** (downloaded daily from `russia.iplist.opencck.org`) exit direct via the
  ISP gateway (router at `192.168.1.1`).
- **Custom exceptions** (`/etc/white-list-extended.txt`) can force additional CIDRs via ISP.
- **VPN server host route** (`YOUR_VPN_SERVER_IP/32`) is always kept via ISP to prevent a routing loop.

LAN devices are configured to use the RPi as their gateway via a router DHCP option. They
require no individual configuration — the split is fully transparent.

```
Internet
  ↓
Router (192.168.1.1) — ISP uplink
  ↓ eth0
RPi4 (192.168.1.254) — VPN gateway
  ↓
LAN devices (default gateway = 192.168.1.254 via router DHCP)

Traffic routing:
  Non-RU → awg0 → AmneziaWG VPN (endpoint: YOUR_VPN_SERVER_IP:36348)
  RU CIDRs + exceptions → eth0 → ISP direct (via 192.168.1.1)
```

Key environment variables (from `/etc/vpn-gateway.env` on the RPi, sourced from `.env` in this repo):

| Variable | Value | Description |
|----------|-------|-------------|
| `RPI_LAN_IP` | `192.168.1.254` | RPi LAN IP address |
| `KEENETIC_GW` | `192.168.1.1` | ISP gateway (your router) |
| `VPN_SERVER_IP` | `YOUR_VPN_SERVER_IP` | AmneziaWG server endpoint IP |
| `VPN_IFACE` | `awg0` | VPN tunnel interface name |
| `LAN_SUBNET` | `192.168.1.0/24` | Local LAN subnet |
| `RU_SUBNET_URL` | `https://russia.iplist.opencck.org/?format=text&data=cidr4` | RU CIDR list source |
| `CRON_UPDATE_HOUR` | `5` | Hour (0-23) for daily subnet refresh cron |

---

## Prerequisites

### SSH alias

`deploy.sh` connects to the RPi via the SSH alias `pi4`. Add this to `~/.ssh/config` on your
Mac:

```
Host pi4
    HostName 192.168.1.254
    User ar
    IdentityFile ~/.ssh/id_ed25519
```

Verify: `ssh pi4 "echo ok"` — must succeed without a password prompt. `deploy.sh` uses
`BatchMode=yes` which blocks password fallback.

### Keys and .env.secrets

VPN private/public/preshared keys are stored in `.env.secrets` (gitignored — never committed).

```bash
cp .env.secrets.example .env.secrets
# Edit .env.secrets and fill in the three keys:
#   AWG_PRIVATE_KEY=<44-char base64>
#   AWG_PUBLIC_KEY=<44-char base64>
#   AWG_PRESHARED_KEY=<44-char base64>
```

Each key must be a valid 44-character base64 string (43 alphanumeric chars + one `=` pad).
`deploy.sh` validates all three before any remote operation.

`deploy.sh` renders `awg0.conf` from `amnezia.key.template.txt` by substituting the placeholders
`{{PrivateKey}}`, `{{PublicKey}}`, and `{{PresharedKey}}` with the values from `.env.secrets`
via a sed pipeline. The rendered config is written to a mode-600 temp file and SCPed to
`/etc/amnezia/amneziawg/awg0.conf` (mode 600, root:root) on the RPi.

### Router DHCP

After the RPi is fully deployed and verified, configure your router to advertise it as the
LAN gateway:

1. Open your router web UI: `http://192.168.1.1`
2. Home network → Segments → Default → IP parameters
3. Set **Gateway address** to `192.168.1.254`
4. Save

After saving, LAN devices will use the RPi as their gateway on next DHCP lease renewal.
To apply immediately: disconnect/reconnect Wi-Fi, or run `ipconfig /renew` on Windows.

**DNS for domain resolution:** To enable domain name display in `vpn-status.sh`, also set
the DNS server in your router:

1. Home network → Segments → Default → DNS server
2. Set to `192.168.1.254` (dnsmasq on the RPi)
3. Save

Without this step, the DOMAIN column in `vpn-status.sh` will show raw IPs.

**Rollback:** Clear the Gateway address field in your router (set it back to empty or `192.168.1.1`).

---

## Deploy

`deploy.sh` is the single deploy orchestrator. It runs 23 stages in sequence from your Mac,
connecting to the RPi via SSH. You never run individual scripts manually during initial setup.

### Stage groups

| Group | Stages | What happens |
|-------|--------|--------------|
| Preflight | 1–3 | Check required local files, source `.env` + `.env.secrets`, validate keys, verify SSH connectivity |
| AmneziaWG install | 4 | Stream `scripts/install-awg.sh` over SSH to the RPi; DKMS build may take 10–30 min |
| Config deploy | 5–9 | Render and deploy `awg0.conf` (mode 600), deploy `vpn-gateway.env` (mode 644), post-deploy file checks |
| Routing deploy | 10–11 | SCP `routing.sh` to `/etc/routing.sh`, activate split-tunnel routing (unless `--no-run`) |
| Autostart | 12–13 | Deploy `vpn-routing.service`, reload systemd, enable `awg-quick@awg0` + `vpn-routing.service` at boot |
| Cron + rollback | 14–16 | Deploy `update-vpn-routes`, write `/etc/cron.d/vpn-routes` (daily at `CRON_UPDATE_HOUR:00`), deploy `vpn-rollback.sh` |
| Logging | 17–20 | Install dnsmasq (before config), deploy `dnsmasq.conf`, deploy `vpn-status.sh`, deploy `watch-routes.py` |
| Exceptions + NM | 21–22 | Conditionally deploy `white-list-extended.txt` if present; deploy NM dispatcher `10-vpn-routes` |
| Final activation | 23 | Re-run `routing.sh` to apply all iptables LOG rules and exception routes |

### Run commands

Full deploy (deploy all files + activate routing):

```bash
./deploy.sh
```

Deploy without activating routing (use for first-time deploy before the tunnel is brought up,
or when testing config changes without changing active routes):

```bash
./deploy.sh --no-run
```

If `--no-run` was used, activate routing manually later:

```bash
ssh pi4 "sudo /etc/routing.sh"
```

### AmneziaWG installer note

`deploy.sh` Stage 4 streams `scripts/install-awg.sh` over SSH and runs it on the RPi as root.
You do not invoke `install-awg.sh` directly — it is an internal RPi-side installer called by
the deploy orchestrator only.

### Bring up the tunnel (manual step)

Tunnel bring-up is **not automated** by `deploy.sh`. `awg-quick up` is not idempotent — if the
interface already exists, it errors. Run manually after deploy:

```bash
# Bring up the VPN tunnel
ssh pi4 "sudo awg-quick up awg0"

# Verify peer handshake
ssh pi4 "sudo awg show"
```

If the tunnel is already up, bring it down first:

```bash
ssh pi4 "sudo awg-quick down awg0 && sudo awg-quick up awg0"
```

---

## Verify Routing

Run these checks on the RPi via SSH. All commands require `sudo` or run as root.

### 4 routing checks

```bash
# 1. Default route must go through the VPN tunnel
ssh pi4 "ip route show default"
# Expected output contains: default dev awg0

# 2. Foreign IP (8.8.8.8) must route via VPN
ssh pi4 "ip route get 8.8.8.8"
# Expected output contains: dev awg0

# 3. Russian IP (77.88.8.8 — Yandex) must route via ISP
ssh pi4 "ip route get 77.88.8.8"
# Expected output contains: via 192.168.1.1

# 4. VPN server IP must route via ISP (loop prevention)
ssh pi4 "ip route get YOUR_VPN_SERVER_IP"
# Expected output contains: via 192.168.1.1
```

### iptables LOG rules check

```bash
ssh pi4 "sudo iptables -L FORWARD -n -v | grep LOG"
# Expected: two LOG rules — [VPN] on awg0, [ISP] on eth0
```

### vpn-status.sh quick check

After generating some LAN traffic, run:

```bash
ssh pi4 "sudo /etc/vpn-status.sh"
```

Example output:

```
TIMESTAMP            SRC-IP             DST-IP             DOMAIN                                   PATH
-------------------- ------------------ ------------------ ---------------------------------------- ----
May 23 11:36:21      192.168.1.175      17.248.209.64      apple.com                                VPN
May 23 11:36:22      192.168.1.175      77.88.8.8          yandex.ru                                ISP
May 23 11:36:23      192.168.1.100      104.64.0.0         store.steampowered.com                   VPN
```

If the DOMAIN column shows raw IPs, set router DNS to `192.168.1.254` (see Prerequisites).

### Autostart checks

```bash
ssh pi4 "systemctl is-active awg-quick@awg0"       # expect: active
ssh pi4 "systemctl is-active vpn-routing.service"  # expect: active
ssh pi4 "systemctl is-enabled awg-quick@awg0"      # expect: enabled
ssh pi4 "systemctl is-enabled vpn-routing.service" # expect: enabled
```

---

## Monitoring & Logs

### vpn-status.sh

`/etc/vpn-status.sh` reads journald for iptables `[VPN]`/`[ISP]` LOG entries, correlates with
the dnsmasq query log to resolve destination IPs to domain names (with rDNS fallback via `host`),
and prints a human-readable connection table.

Must be run as `sudo` — reads kernel journal and dnsmasq logs.

```bash
ssh pi4 "sudo /etc/vpn-status.sh"
ssh pi4 "sudo /etc/vpn-status.sh --via=vpn --last=100"
ssh pi4 "sudo /etc/vpn-status.sh --device=192.168.1.50 --filter=steam"
```

All flags compose: `--last`, `--filter`, `--device`, `--via` can be combined freely.

### watch-routes.py

`/etc/watch-routes.py` is a real-time iptables log enricher. It spawns `journalctl -f -k` and
parses `[VPN]`/`[ISP]` lines as they appear, resolving destination IPs via cached rDNS lookups.
Press Ctrl+C to stop.

```bash
ssh pi4 "sudo /etc/watch-routes.py"
ssh pi4 "sudo /etc/watch-routes.py --src 192.168.1.50 --tag VPN"
```

### journald

Direct kernel log queries without `vpn-status.sh`:

```bash
# Last 50 kernel routing decisions
ssh pi4 "sudo journalctl -k -n 50 --no-pager | grep -E '\[VPN\]|\[ISP\]'"

# vpn-routing.service start/stop events
ssh pi4 "sudo journalctl -u vpn-routing -n 50 --no-pager"

# Daily subnet update log
ssh pi4 "sudo journalctl -t vpn-routes -n 20 --no-pager"

# NM dispatcher route restore events (carrier-change recovery)
ssh pi4 "sudo journalctl -t vpn-routes -n 5 --no-pager"
```

### DNS note

`dnsmasq` on the RPi (`192.168.1.254`) must be set as the DNS server in your router for domain
resolution to work in `vpn-status.sh`. Without it, all queries go directly to the upstream DNS
resolver, bypassing dnsmasq's query log, and the DOMAIN column will show raw IPs.

---

## Custom Exceptions

Use this workflow when traffic that should exit via ISP is being routed via VPN. Common case:
a service (game server, CDN, streaming platform) whose IP range is not in the RU CIDR list.

### Discovery to deploy walkthrough

**Step 1: Identify traffic exiting via VPN that should use ISP**

```bash
ssh pi4 "sudo /etc/vpn-status.sh --via=vpn"
```

Look for domains or IPs that you know should route via ISP. Note their destination IPs.

**Step 2: Resolve the IP to a CIDR**

Use `whois` or `ipinfo.io` to find the network block that owns the IP:

```bash
whois <destination-ip>
# Look for "route:" or "CIDR:" field — e.g. 23.55.0.0/16
```

Alternatively, open `https://ipinfo.io/<destination-ip>` in a browser.

**Step 3: Create the exception file**

```bash
cp configs/white-list-extended.txt.example configs/white-list-extended.txt
```

Edit `configs/white-list-extended.txt` and add your CIDRs (one per line):

```
# Format rules:
# - One CIDR per line (e.g. 23.55.0.0/16)
# - Whole-line comments only (lines starting with #)
# - NO inline comments after a CIDR — ip route add will reject the line
# - No labels, no extra whitespace after the CIDR
23.55.0.0/16
95.181.176.0/22
```

Note: `configs/white-list-extended.txt` is gitignored and will not be committed. The
`.example` file (which is committed) documents the format.

**Step 4: Deploy**

```bash
./deploy.sh
```

Stage 21 SCPs `configs/white-list-extended.txt` to `/etc/white-list-extended.txt` on the RPi.
Stage 23 re-runs `routing.sh`, which loads exception routes in Stage 5b.

**Step 5: Verify**

```bash
ssh pi4 "ip route get <your-exception-ip>"
# Expected output contains: via 192.168.1.1
```

Then confirm in `vpn-status.sh`:

```bash
ssh pi4 "sudo /etc/vpn-status.sh --via=isp"
# Your exception traffic should now appear here
```

---

## Rollback

`/etc/vpn-rollback.sh` fully undoes the VPN gateway in one idempotent command.

```bash
ssh pi4 "sudo /etc/vpn-rollback.sh"
```

### What rollback removes

- Stops and disables `vpn-routing.service` and `awg-quick@awg0`
- Stops and disables `dnsmasq`
- Flushes all routes on `awg0` and the VPN server host route
- Removes MASQUERADE iptables rules on `awg0` + `eth0`
- Removes iptables FORWARD ACCEPT and LOG rules
- Removes `/etc/cron.d/vpn-routes`
- Removes `/etc/white-list-extended.txt` (if present)
- Restores the default route via `KEENETIC_GW` (`192.168.1.1`)

### What rollback preserves

- `/etc/amnezia/amneziawg/awg0.conf` (mode 600) — VPN config kept for re-activation
- `/etc/routing.sh` — script kept on disk
- `/etc/white-list.txt` — downloaded RU subnet list kept
- AmneziaWG packages — not uninstalled

Note: `/etc/dnsmasq.conf` and `/etc/vpn-status.sh` remain on disk but dnsmasq is stopped.

### After rollback

Revert the router DHCP gateway back to `192.168.1.1`:

1. Open your router web UI: `http://192.168.1.1`
2. Home network → Segments → Default → IP parameters
3. Clear the Gateway address field (or set to `192.168.1.1`)
4. Save

### Re-activate after rollback

```bash
./deploy.sh
```

Deploy re-installs everything. The existing `awg0.conf` on the RPi is overwritten with a
freshly rendered copy from your template + `.env.secrets`.

---

## Script CLI Reference

### deploy.sh

**Synopsis:** `./deploy.sh [--no-run]`

Runs from your Mac. Connects to the RPi via `SSH_HOST=pi4` (from `.env`). 23 stages.
Sources `.env` and `.env.secrets`; validates keys before any remote operation.

**Flags:**

| Flag | Description |
|------|-------------|
| `--no-run` | Deploy all files but skip `routing.sh` activation. Use for first-time deploys before the tunnel is up, or when testing config changes without activating routes. |

**Examples:**

```bash
# Full deploy + activate routing (normal usage)
./deploy.sh

# Deploy only — activate routing manually later
./deploy.sh --no-run

# Activate routing after --no-run deploy
ssh pi4 "sudo /etc/routing.sh"
```

---

### scripts/routing.sh (deployed to /etc/routing.sh)

**Synopsis:** `sudo /etc/routing.sh [--no-update]`

Flush-and-rebuild split-tunnel routing. Idempotent — safe to re-run at any time.

On each run: downloads RU CIDRs from `RU_SUBNET_URL` → flushes existing VPN routes →
adds VPN server host route → adds RU CIDR routes via `KEENETIC_GW` → loads
`/etc/white-list-extended.txt` (if present) → sets default route via `awg0` → configures
MASQUERADE and iptables LOG rules → saves via `iptables-save`.

Sources `/etc/vpn-gateway.env` for all variables.

**Flags:**

| Flag | Description |
|------|-------------|
| `--no-update` | Skip downloading fresh RU subnets; use existing `/etc/white-list.txt`. Safe when the subnet file is current. Used by `update-vpn-routes` after an atomic file swap to avoid double-download. |

**Examples:**

```bash
# Full run with fresh RU subnet download
ssh pi4 "sudo /etc/routing.sh"

# Rebuild routes using existing subnet file (no download)
ssh pi4 "sudo /etc/routing.sh --no-update"

# Check result
ssh pi4 "ip route show default"     # expect: default dev awg0
ssh pi4 "ip route get 8.8.8.8"      # expect: dev awg0
ssh pi4 "ip route get 77.88.8.8"    # expect: via 192.168.1.1
```

---

### scripts/vpn-status.sh (deployed to /etc/vpn-status.sh)

**Synopsis:** `sudo /etc/vpn-status.sh [--last=N] [--filter=STRING] [--device=IP] [--via=vpn|isp]`

Reads journald `[VPN]`/`[ISP]` LOG entries, correlates with dnsmasq query log for domain
resolution, falls back to rDNS (`host`). Output columns: `TIMESTAMP SRC-IP DST-IP DOMAIN PATH`.

Must run as `sudo`.

**Flags:**

| Flag | Description |
|------|-------------|
| `--last=N` | Show last N journald kernel entries (default: 50) |
| `--filter=STRING` | Case-insensitive partial match on the DOMAIN column |
| `--device=IP` | Filter by source LAN device IP (SRC field) |
| `--via=vpn\|isp` | Show only VPN-routed or ISP-routed connections; composes with other filters |

All flags compose freely.

**Examples:**

```bash
# Show last 50 connections (default)
sudo /etc/vpn-status.sh

# Show last 100 VPN-routed connections
sudo /etc/vpn-status.sh --via=vpn --last=100

# Filter by device + domain keyword
sudo /etc/vpn-status.sh --device=192.168.1.50 --filter=steam

# Show only ISP-routed connections
sudo /etc/vpn-status.sh --via=isp

# Extend window when output is empty
sudo /etc/vpn-status.sh --last=200
```

---

### scripts/vpn-rollback.sh (deployed to /etc/vpn-rollback.sh)

**Synopsis:** `sudo /etc/vpn-rollback.sh`

No flags. Fully idempotent — safe to re-run.

**Examples:**

```bash
# Run rollback
ssh pi4 "sudo /etc/vpn-rollback.sh"

# Verify default route restored
ssh pi4 "ip route show default"
# Expected: default via 192.168.1.1

# Re-activate after rollback
./deploy.sh
```

---

### scripts/update-vpn-routes (deployed to /etc/update-vpn-routes)

**Synopsis:** `sudo /etc/update-vpn-routes`

Normally called by cron daily at `CRON_UPDATE_HOUR:00` (default 5:00 AM). Can be run manually
for a one-off update.

Behavior:
- Downloads RU subnet list to a temp file
- SHA256-compares against existing `/etc/white-list.txt`
- If hash matches: exits 0 (no rebuild, no disruption)
- If hash differs: atomically swaps the file, then runs `/etc/routing.sh --no-update`
- If download fails: exits 0 (no cron failure mail; existing routes remain intact)
- On download failure, also checks whether the VPN server host route is missing (carrier-change
  recovery) — if missing, rebuilds routes from the existing subnet file

Logs via `logger -t "vpn-routes"` (visible in journald).

**Examples:**

```bash
# Manual one-off run
ssh pi4 "sudo /etc/update-vpn-routes"

# Check result
ssh pi4 "sudo journalctl -t vpn-routes -n 10 --no-pager"

# Check cron schedule
ssh pi4 "sudo cat /etc/cron.d/vpn-routes"
# Expected: 0 5 * * * root /etc/update-vpn-routes >> /var/log/vpn-routes.log 2>&1
```

---

### scripts/watch-routes.py (deployed to /etc/watch-routes.py)

**Synopsis:** `sudo /etc/watch-routes.py [--src IP] [--no-dns] [--tag {VPN,ISP,both}]`

Real-time iptables log enricher. Spawns `journalctl -f -k --no-pager -o short-iso` and
parses `[VPN]`/`[ISP]` lines as they arrive. Resolves destination IPs via cached rDNS lookups
(in-memory cache, 2-second timeout per lookup). Prints enriched output with timestamp, tag,
source IP, destination IP (with hostname), protocol and port. Press Ctrl+C to stop.

Requires Python 3 (stdlib only — no pip dependencies).

**Flags:**

| Flag | Description |
|------|-------------|
| `--src IP` | Show only entries where SRC matches this IP address |
| `--no-dns` | Skip reverse DNS lookups; show raw destination IPs |
| `--tag VPN\|ISP\|both` | Filter by routing tag (default: both) |

**Examples:**

```bash
# Real-time view of all connections
sudo /etc/watch-routes.py

# Watch one device's VPN traffic only
sudo /etc/watch-routes.py --src 192.168.1.50 --tag VPN

# Skip DNS lookups for faster output (useful during high traffic)
sudo /etc/watch-routes.py --no-dns

# Watch all ISP-routed traffic without DNS
sudo /etc/watch-routes.py --tag ISP --no-dns
```

---

## Troubleshooting & Known Gotchas

Each entry follows the pattern: **Symptom → Cause → Fix**.

---

**LAN devices cannot reach the internet at all (FORWARD chain DROP)**

Symptom: All LAN device traffic is silently dropped after RPi is set as gateway. `ssh pi4 "sudo iptables -L FORWARD -n"` shows default policy `DROP` with no ACCEPT rules.

Cause: Docker (if installed on the RPi) sets the FORWARD chain default policy to DROP. Without explicit ACCEPT rules, no LAN traffic passes through the RPi.

Fix: Re-run `sudo /etc/routing.sh` — Stage 7c adds `FORWARD -i eth0 ACCEPT` and `FORWARD RELATED,ESTABLISHED ACCEPT` rules. These are always re-applied by routing.sh on every run.

---

**No [VPN] or [ISP] entries appear in journald**

Symptom: `journalctl -k | grep -E '\[VPN\]|\[ISP\]'` returns nothing even after LAN traffic flows through the RPi.

Cause: LOG rules must be added to the FORWARD chain **before** ACCEPT rules. LOG is non-terminating (continues to the next rule); ACCEPT terminates. If ACCEPT is first, the LOG rule is never reached and no entries are written to journald.

Fix: Re-run `sudo /etc/routing.sh` — Stage 7b adds LOG rules; Stage 7c adds ACCEPT rules in the correct order. Every run starts with a flush, so rule order is always correct after re-run.

---

**Router web UI / app becomes inaccessible from LAN devices**

Symptom: Cannot reach `http://192.168.1.1` from LAN devices after RPi is configured as gateway.

Cause: An unconstrained MASQUERADE rule on `eth0` rewrites source IPs for all outbound traffic — including intra-LAN traffic to `192.168.1.1`. The router sees all requests as coming from `192.168.1.254` and blocks them.

Fix: `routing.sh` Stage 7 uses `! -d LAN_SUBNET` in the eth0 MASQUERADE rule, which excludes intra-LAN traffic from MASQUERADE. Re-run `sudo /etc/routing.sh` to restore the correct rule.

---

**dnsmasq fails to start or conflicts with an existing config**

Symptom: Stage 17/18 of `deploy.sh` fails; `systemctl status dnsmasq` shows a config parse error or port conflict.

Cause: If `dnsmasq` config is deployed before the `dnsmasq` package is installed, `apt-get install dnsmasq` will overwrite the deployed config with the package default, or prompt interactively.

Fix: Re-run `./deploy.sh` — Stage 17 always installs `dnsmasq` before Stage 18 deploys the config. The install uses `DEBIAN_FRONTEND=noninteractive` to prevent interactive prompts.

---

**Tunnel bring-up fails or `awg-quick up awg0` returns "already exists"**

Symptom: `sudo awg-quick up awg0` errors with "RTNETLINK answers: File exists" or similar; or the interface is in an unknown state.

Cause: `awg-quick up` is not idempotent. `deploy.sh` intentionally does not bring up the tunnel for this reason (see deploy section).

Fix: Bring the interface down first, then bring it back up:

```bash
ssh pi4 "sudo awg-quick down awg0 && sudo awg-quick up awg0"
```

Or restart via systemd:

```bash
ssh pi4 "sudo systemctl restart awg-quick@awg0"
```

---

**vpn-status.sh shows no entries even after browsing the web**

Symptom: `vpn-status.sh` output shows `(no connections matched — try --last=200 or remove filters)` even though LAN devices are generating traffic.

Cause (A): dnsmasq is not configured as the DNS server in your router — queries bypass the RPi entirely, so dnsmasq has no log to correlate. (This does not directly suppress the `[VPN]`/`[ISP]` entries, but check this first.)

Cause (B): The LAN device has not renewed its DHCP lease since the router gateway was changed — it is still using its old gateway (e.g. `192.168.1.1` directly) and traffic does not pass through the RPi.

Fix: In your router web UI: navigate to DHCP/LAN settings → set Gateway address to `192.168.1.254`. Then renew the DHCP lease on the LAN device (disconnect/reconnect Wi-Fi, or `ipconfig /renew` on Windows). Also set DNS server to `192.168.1.254` in the same settings page.

---

**DOMAIN column in vpn-status.sh shows raw IPs instead of hostnames**

Symptom: The DOMAIN column in `vpn-status.sh` output shows IP addresses instead of domain names.

Cause: dnsmasq is not the DNS server for LAN devices. DNS queries go directly to an upstream resolver, bypassing dnsmasq's query log. Without dnsmasq log entries, `vpn-status.sh` cannot correlate DST IPs to domain names; rDNS fallback also fails for CDN IPs (no PTR records).

Fix: Set your router DNS server to `192.168.1.254` (see Prerequisites → Router DHCP). After renewal, LAN DNS queries flow through dnsmasq, which logs them for correlation.

---

**Split-tunnel routes disappear after router reboots (NM carrier-change)**

Symptom: VPN routing breaks after the router reboots or the eth0 link goes down and comes back up. `ssh pi4 "ip route show | wc -l"` drops to approximately 2 (only local routes). `ip route get 8.8.8.8` no longer shows `dev awg0`.

Cause: When the router reboots, the eth0 link drops (carrier-change event). NetworkManager (NM) flushes all eth0 routes on the link-down event — including the ~1360 RU CIDR routes and the VPN server host route added by `routing.sh`. When eth0 comes back up, only the local link route is restored by NM. Without the VPN server host route (`YOUR_VPN_SERVER_IP/32 via 192.168.1.1`), `ip route get YOUR_VPN_SERVER_IP` resolves via `awg0` (policy table 51820), creating a routing loop. No VPN connection → no internet → the daily cron download also fails → the system cannot self-heal without intervention.

Fix: `deploy.sh` Stage 22 deploys `/etc/NetworkManager/dispatcher.d/10-vpn-routes` — an NM dispatcher script that automatically restores routes by running `routing.sh --no-update` in the background when `eth0 up` is detected.

Verify the dispatcher is working:

```bash
ssh pi4 "sudo journalctl -t vpn-routes -n 5 --no-pager"
# Expected: "eth0 up — restoring VPN split-tunnel routes"
```

Fallback: `update-vpn-routes` also checks for a missing VPN server host route on download failure and triggers a rebuild. Both mechanisms are deployed by `./deploy.sh`.

If routes are currently missing and need manual recovery:

```bash
ssh pi4 "sudo /etc/routing.sh"
```

See quick task `260523-nmr` in the Development Phases section for the full incident timeline.

---

## Development Phases

| Phase | Name | Goal | Link |
|-------|------|------|------|
| 1 | Foundation & Config | AmneziaWG installed, config deployed, tunnel operational | [.planning/phases/01-foundation-config/](.planning/phases/01-foundation-config/) |
| 2 | Routing & NAT | Split-tunnel routing active, LAN devices NATed | [.planning/phases/02-routing-nat/](.planning/phases/02-routing-nat/) |
| 3 | Autostart, Cron & Rollback | Survives reboots, daily refresh, one-command rollback | [.planning/phases/03-autostart-cron-rollback/](.planning/phases/03-autostart-cron-rollback/) |
| 4 | Traffic Logging & Visibility | Per-connection VPN/ISP routing decisions logged and queryable | [.planning/phases/04-traffic-logging-visibility-vpn-isp/](.planning/phases/04-traffic-logging-visibility-vpn-isp/) |
| 5 | Custom Route Exceptions | Per-CIDR ISP-bypass exceptions on top of auto-downloaded RU list | [.planning/phases/05-custom-route-exceptions-ip/](.planning/phases/05-custom-route-exceptions-ip/) |
| 6 | Documentation | Ops runbook: deploy, verify, rollback, add exceptions | [.planning/phases/06-documentation/](.planning/phases/06-documentation/) |

### Quick Tasks

Out-of-band work completed alongside the main phases:

| ID | Description | Commit |
|----|-------------|--------|
| 260521-jex | Add `scripts/watch-routes.py` — real-time iptables log enricher with rDNS caching | cf6bafa |
| 260523-nmr | Fix NM carrier-change route flush — add NM dispatcher (`10-vpn-routes`) to restore split-tunnel routes on eth0 up; add fallback rebuild in `update-vpn-routes` on missing VPN server host route | 847ff31 |
