# RPi VPN Gateway — Technical Reference

[← README](../README.md) | [Документация на русском](README.ru.md)

---

## Environment Variables

Source is `.env` in this repo. All except `SSH_HOST` are deployed to `/etc/splitgate/vpn-gateway.env` on the RPi.

| Variable | Value | Description |
|----------|-------|-------------|
| `SSH_HOST` | `pi4` | SSH alias for the RPi — used by `deploy.sh` on macOS only; not deployed to RPi |
| `RPI_LAN_IP` | `192.168.1.254` | RPi LAN IP address |
| `KEENETIC_GW` | `192.168.1.1` | ISP gateway (your router) |
| `VPN_SERVER_IP` | *(in `.env.secrets`)* | AmneziaWG server endpoint IP — kept secret, not committed |
| `VPN_IFACE` | `awg0` | VPN tunnel interface name |
| `LAN_SUBNET` | `192.168.1.0/24` | Local LAN subnet |
| `RU_SUBNET_URL` | `https://russia.iplist.opencck.org/?format=text&data=cidr4` | RU CIDR list source |
| `CRON_UPDATE_HOUR` | `5` | Hour (0-23) for daily subnet refresh cron |

---

## Deploy Stage Groups

`deploy.sh` runs 26 stages from your Mac via SSH. Full deploy: `bash src/deploy.sh`.

| Group | Stages | What happens |
|-------|--------|--------------|
| Preflight | 1–3 | Check required local files, source `.env` + `.env.secrets`, validate keys, verify SSH connectivity |
| AmneziaWG install | 4 | Stream `src/scripts/install-awg.sh` over SSH to the RPi; DKMS build may take 10–30 min |
| Splitgate namespace | 5 | Create `/etc/splitgate/` and `/etc/splitgate/logs/` on the RPi |
| Config deploy | 6–10 | Render and deploy `awg0.conf` (mode 600), deploy `vpn-gateway.env` (mode 644), post-deploy file checks |
| Routing deploy | 11–12 | SCP `routing.sh` to `/etc/splitgate/routing.sh`, deploy `vpn-routing.service` |
| Autostart | 13–14 | Reload systemd, enable `awg-quick@awg0` + `vpn-routing.service` at boot, deploy `update-vpn-routes` |
| Cron + rollback | 15–17 | Write `/etc/cron.d/vpn-routes` (daily at `CRON_UPDATE_HOUR:00`), deploy `vpn-rollback.sh`, ensure dnsmasq installed |
| Logging | 18–20 | Deploy `dnsmasq.conf`, enable and start dnsmasq, deploy `vpn-status.sh`, deploy `watch-routes.py` |
| Custom routes + NM | 21–22 | Conditionally deploy `isp-routes-custom.txt`, `vpn-routes-custom.txt`, and `ru-list-exclude.txt` if present; deploy NM dispatcher `10-vpn-routes` |
| ASN helper | 23 | Deploy `asn-lookup.py` to `/etc/splitgate/asn-lookup.py` |
| Final activation | 24 | Bring up `awg0` tunnel (if not up), run `routing.sh` to apply all routes, iptables LOG rules, and exception routes |
| Splitgate artifacts | 25–27 | Deploy `splitgate` dispatcher to `/usr/local/bin/splitgate` (chmod +x); deploy `logrotate-vpn-gateway`; deploy and enable `splitgate-watch.service` |

---

## Verify Routing

Run on the RPi via SSH after deploy. All commands require `sudo` or run as root.

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
ssh pi4 "ip route get <VPN_SERVER_IP>"
# Expected output contains: via 192.168.1.1
```

### iptables LOG rules check

```bash
ssh pi4 "sudo iptables -L FORWARD -n -v | grep LOG"
# Expected: two LOG rules — [VPN] on awg0, [ISP] on eth0
```

### vpn-status.sh quick check

After generating some LAN traffic:

```bash
ssh pi4 "sudo /etc/splitgate/vpn-status.sh"
```

Example output:

```
TIMESTAMP            SRC-IP             DST-IP             DOMAIN                                   PATH
-------------------- ------------------ ------------------ ---------------------------------------- ----
May 23 11:36:21      192.168.1.175      17.248.209.64      apple.com                                VPN
May 23 11:36:22      192.168.1.175      77.88.8.8          yandex.ru                                ISP
May 23 11:36:23      192.168.1.100      104.64.0.0         store.steampowered.com                   VPN
```

If the DOMAIN column shows raw IPs, set router DNS to `192.168.1.254` (see README → Deploy → Router setup).

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

`/etc/splitgate/vpn-status.sh` reads journald for iptables `[VPN]`/`[ISP]` LOG entries, correlates with
the dnsmasq query log to resolve destination IPs to domain names (with rDNS fallback via `host`),
and prints a human-readable connection table. Output columns: `TIMESTAMP SRC-IP DST-IP DOMAIN ORG PATH`.

The `ORG` column shows the ISP/org name for each destination IP via Team Cymru ASN lookup
(format: `GOOGLE, US (AS15169)` or `-` when unknown). Lookups are cached in
`/tmp/vpn-asn-cache.json`; Cymru unreachable → all ORG cells show `-` (non-fatal).

Must be run as `sudo` — reads kernel journal and dnsmasq logs.

```bash
ssh pi4 "sudo /etc/splitgate/vpn-status.sh"
ssh pi4 "sudo /etc/splitgate/vpn-status.sh --via=vpn --last=100"
ssh pi4 "sudo /etc/splitgate/vpn-status.sh --device=192.168.1.50 --filter=steam"

# Show top-20 orgs by connection count, split by VPN/ISP:
ssh pi4 "sudo /etc/splitgate/vpn-status.sh --summary"
ssh pi4 "sudo /etc/splitgate/vpn-status.sh --summary --via=vpn"
```

All flags compose: `--last`, `--filter`, `--device`, `--via`, `--summary` can be combined freely.

### watch-routes.py

`/etc/splitgate/watch-routes.py` is a real-time iptables log enricher. It spawns `journalctl -f -k` and
parses `[VPN]`/`[ISP]` lines as they appear, resolving destination IPs via cached rDNS lookups.
Each line is enriched with ` | {org}` via a background ASN lookup — new IPs are held in a buffer until
the lookup completes (typically 1–3 s) so every printed line carries the org suffix. If the lookup
stalls, the line flushes after 6 seconds. Repeated IPs print immediately from cache. Press Ctrl+C to stop.

```bash
ssh pi4 "sudo python3 /etc/splitgate/watch-routes.py"
ssh pi4 "sudo python3 /etc/splitgate/watch-routes.py --src 192.168.1.50 --tag VPN"
ssh pi4 "sudo python3 /etc/splitgate/watch-routes.py --no-asn"   # disable org enrichment
```

### journald

Direct kernel log queries without `vpn-status.sh`:

```bash
# Last 50 kernel routing decisions
ssh pi4 "sudo journalctl -k -n 50 --no-pager | grep -E '\[VPN\]|\[ISP\]'"

# vpn-routing.service start/stop events
ssh pi4 "sudo journalctl -u vpn-routing -n 50 --no-pager"

# Daily subnet update log (Phase 9: file-based)
ssh pi4 "sudo grep '\[vpn-routes\]' /etc/splitgate/logs/install.log | tail -20"

# NM dispatcher route restore events (carrier-change recovery — still journald)
ssh pi4 "sudo journalctl -t vpn-routes -n 5 --no-pager"
```

### DNS note

`dnsmasq` on the RPi (`192.168.1.254`) must be set as the DNS server in your router for domain
resolution to work in `vpn-status.sh`. Without it, all queries go directly to the upstream DNS
resolver, bypassing dnsmasq's query log, and the DOMAIN column will show raw IPs.

---

## Custom Route Overrides

Two files let you override the auto-downloaded RU list without modifying it:

| File | Purpose | Priority |
|------|---------|----------|
| `isp-routes-custom.txt` | Extra CIDRs routed via ISP (bypass VPN) | Added on top of RU list |
| `vpn-routes-custom.txt` | CIDRs forced through VPN, even if in RU list | Highest — overrides everything |

If the same CIDR appears in both files, `vpn-routes-custom.txt` wins.

**Current state (Phase 13):** `isp-routes-custom.txt` ships with 11 active RU /24 CIDRs pre-populated
(Selectel ×2, MIRAN-AS/Keenetic captive portals, RU-JSCIOT/Keenetic captive, SonicDuo, SOVAM, MegaFon,
Raiffeisenbank, VimpelCom/Corbina, cloud.example.com RU ASN) — these were confirmed RU but previously
routing via VPN. `vpn-routes-custom.txt` includes a commented candidate block for non-RU false-positives
(Cherry Servers LT, Google PoPs, Cloudflare, CloudFront, EC2, Akamai, Azure EU) — uncomment entries
as needed when those services fail under ISP routing.

---

### ISP-bypass custom routes

Use when traffic that should exit via ISP is being routed via VPN. Common case: a game server,
CDN, or streaming platform whose IP range is not in the RU CIDR list.

**Step 1: Identify traffic exiting via VPN that should use ISP**

```bash
ssh pi4 "sudo /etc/splitgate/vpn-status.sh --via=vpn"
```

Look for domains or IPs that should route via ISP. Note their destination IPs.

**Step 2: Resolve the IP to a CIDR**

```bash
whois <destination-ip>
# Look for "route:" or "CIDR:" field — e.g. 23.55.0.0/16
```

Alternatively: `https://ipinfo.io/<destination-ip>`

**Step 3: Create the file**

```bash
cp src/configs/isp-routes-custom.txt.example src/configs/isp-routes-custom.txt
```

Edit and add CIDRs (one per line, whole-line comments only, no inline comments):

```
23.55.0.0/16
95.181.176.0/22
```

Note: `src/configs/isp-routes-custom.txt` is gitignored — never committed.

**Step 4: Deploy**

For routine CIDR edits use the fast path (SCPs only custom-route files, skips full pipeline):

```bash
bash src/deploy-routes.sh
```

For a first-time deploy or when other files have changed:

```bash
bash src/deploy.sh
```

Stage 21 SCPs the file to `/etc/splitgate/isp-routes-custom.txt`. `routing.sh` Stage 5b loads the routes on activation.

**Step 5: Verify**

```bash
ssh pi4 "ip route get <your-exception-ip>"
# Expected output contains: via 192.168.1.1

ssh pi4 "sudo /etc/splitgate/vpn-status.sh --via=isp"
# Your exception traffic should appear here
```

---

### VPN-force custom routes

Use when a CIDR is in the RU list but you want it to exit via VPN anyway (e.g., RU CDN nodes serving
foreign content, or specific ranges you want geo-shifted).

**Step 1: Identify traffic exiting via ISP that should use VPN**

```bash
ssh pi4 "sudo /etc/splitgate/vpn-status.sh --via=isp"
```

Look for domains or IPs that should route via VPN. Note their destination IPs.

**Step 2: Resolve the IP to a CIDR**

```bash
whois <destination-ip>
# Look for "route:" or "CIDR:" field — e.g. 77.88.0.0/18
```

**Step 3: Create the file**

```bash
cp src/configs/vpn-routes-custom.txt.example src/configs/vpn-routes-custom.txt
```

Edit and add CIDRs (one per line, whole-line comments only, no inline comments):

```
77.88.0.0/18
5.255.255.0/24
```

Note: `src/configs/vpn-routes-custom.txt` is gitignored — never committed.

**Step 4: Deploy**

For routine CIDR edits use the fast path (SCPs only custom-route files, skips full pipeline):

```bash
bash src/deploy-routes.sh
```

For a first-time deploy or when other files have changed:

```bash
bash src/deploy.sh
```

Stage 21b SCPs the file to `/etc/splitgate/vpn-routes-custom.txt`. `routing.sh` Stage 5c deletes any existing ISP route for each CIDR and adds it via `awg0`.

**Step 5: Verify**

```bash
ssh pi4 "ip route get <your-vpn-force-ip>"
# Expected output contains: dev awg0

ssh pi4 "sudo /etc/splitgate/vpn-status.sh --via=vpn"
# Your forced traffic should appear here
```

---

## RU IP List Exclusion Filter

Use this when a CIDR range is incorrectly included in the RU IP list (e.g. a Google or Cloudflare
range that iplist marks as RU) and you want it to route through the VPN.

Unlike custom exceptions which add ISP-bypass routes on top of the downloaded list, the exclusion
filter removes CIDRs from the downloaded list at the source — they never appear in
`/etc/splitgate/white-list.txt` and follow the default route (VPN).

**How it works:** When `/etc/splitgate/ru-list-exclude.txt` is present, `update-vpn-routes` appends
`&exclude[cidr4]=CIDR` query parameters to `RU_SUBNET_URL` before calling curl. The iplist
service filters those ranges server-side. If the file is absent or empty, behavior is unchanged.

**Step 1: Identify CIDRs to exclude**

```bash
ssh pi4 "sudo /etc/splitgate/vpn-status.sh --via=isp"
```

Look for traffic that should be VPN-routed but exits via ISP. Resolve the destination IP to its
network block using `whois` or `ipinfo.io`.

**Step 2: Create the exclusion file**

```bash
cp src/configs/ru-list-exclude.txt.example src/configs/ru-list-exclude.txt
```

Edit and add CIDRs:

```
# Exclude Google ranges incorrectly listed as RU
142.250.0.0/16
142.251.0.0/16
```

Note: `src/configs/ru-list-exclude.txt` is gitignored — never committed.

**Step 3: Deploy**

```bash
bash src/deploy.sh
```

Stage 22c SCPs `src/configs/ru-list-exclude.txt` to `/etc/splitgate/ru-list-exclude.txt`.

**Step 4: Trigger a route rebuild**

```bash
ssh pi4 "sudo /etc/splitgate/update-vpn-routes"
ssh pi4 "sudo grep '\[vpn-routes\]' /etc/splitgate/logs/install.log | tail -10"
# expect: "Excluding: CIDR1, CIDR2, ..." followed by rebuild log
```

**Step 5: Verify**

```bash
ssh pi4 "ip route get <excluded-cidr-ip>"
# Expected output contains: dev awg0  (routes via VPN, not ISP)
```

---

## Rollback

`/etc/splitgate/vpn-rollback.sh` fully undoes the VPN gateway in one idempotent command.

```bash
ssh pi4 "sudo /etc/splitgate/vpn-rollback.sh"
```

### What rollback removes

- Stops and disables `vpn-routing.service` and `awg-quick@awg0`
- Stops and disables `dnsmasq`
- Flushes all routes on `awg0` and the VPN server host route
- Removes MASQUERADE iptables rules on `awg0` + `eth0`
- Removes iptables FORWARD ACCEPT and LOG rules
- Removes `/etc/cron.d/vpn-routes`
- Restores default route via `KEENETIC_GW` (`192.168.1.1`)
- Removes `/usr/local/bin/splitgate`
- Removes `/etc/splitgate/` tree entirely — scripts, data files, env

### What rollback preserves

- `/etc/amnezia/amneziawg/awg0.conf` (mode 600) — kept for re-activation
- AmneziaWG packages — not uninstalled
- `/etc/dnsmasq.conf` — remains on disk (system file); dnsmasq is stopped

### After rollback

Revert the router DHCP gateway back to `192.168.1.1`:

1. `http://192.168.1.1` → Home network → Segments → Default → IP parameters
2. Clear the Gateway address field (or set to `192.168.1.1`) → Save

### Re-activate after rollback

```bash
bash src/deploy.sh
```

---

## Filesystem Layout on the RPi

```
/etc/splitgate/
├── routing.sh
├── vpn-rollback.sh
├── vpn-status.sh
├── update-vpn-routes
├── watch-routes.py
├── asn-lookup.py
├── vpn-gateway.env
├── white-list.txt              (generated at runtime)
├── isp-routes-custom.txt       (optional — ISP-bypass custom routes; 11 active RU CIDRs pre-populated)
├── vpn-routes-custom.txt       (optional — VPN-force custom routes; commented candidate block included)
├── ru-list-exclude.txt         (optional — server-side RU list exclusions)
└── logs/
    ├── install.log             (output from routing.sh and update-vpn-routes)
    ├── watch-YYYY-MM-DD.log    (daily connection log written by splitgate-watch.service)
    └── watch-error.log         (stderr from watch-routes.py --daemon)

/usr/local/bin/splitgate         (dispatcher CLI)
/etc/systemd/system/splitgate-watch.service  (route watcher daemon)
/etc/logrotate.d/vpn-gateway     (rotates install.log; deletes watch-*.log files older than 14 days)
```

Files that stay at system locations (required by their consuming daemon):

- `/etc/systemd/system/vpn-routing.service` — systemd requires exact path
- `/etc/cron.d/vpn-routes` — cron daemon requires exact path
- `/etc/dnsmasq.conf` — dnsmasq requires exact path
- `/etc/NetworkManager/dispatcher.d/10-vpn-routes` — NM dispatcher requires exact path
- `/etc/iptables/rules.v4` — iptables-persistent requires exact path
- `/etc/amnezia/amneziawg/awg0.conf` — AmneziaWG requires exact path

---

## Script CLI Reference

### src/deploy.sh

**Synopsis:** `bash src/deploy.sh [--no-run]`

Runs from your Mac. Connects to the RPi via `SSH_HOST=pi4` (from `.env`). 28 stages.
Sources `.env` and `.env.secrets`; validates keys before any remote operation.

| Flag | Description |
|------|-------------|
| `--no-run` | Deploy all files but skip `routing.sh` activation. Use for first-time deploys before the tunnel is up, or when testing config changes without activating routes. |

```bash
bash src/deploy.sh              # full deploy + activate routing
bash src/deploy.sh --no-run     # deploy only — activate routing manually later
ssh pi4 "sudo /etc/splitgate/routing.sh"   # activate after --no-run deploy
```

---

### src/deploy-routes.sh

**Synopsis:** `bash src/deploy-routes.sh`

Fast custom-routes-only deploy. Runs from your Mac. 3 stages: SSH preflight, conditional SCP of each custom-route file, then `routing.sh --no-update` on the RPi.

**When to use:** After editing `src/configs/isp-routes-custom.txt` or `src/configs/vpn-routes-custom.txt` for routine CIDR changes. Skips AmneziaWG install, key validation, and systemd setup — takes seconds instead of the full 28-stage deploy.

**When to use `src/deploy.sh` instead:** First-time deploy, AmneziaWG reinstall, systemd changes, or any change outside the two custom-route files.

| Stage | What happens |
|-------|--------------|
| 1/3 | SSH connectivity check (`-o ConnectTimeout=5 -o BatchMode=yes`) |
| 2/3 | If `isp-routes-custom.txt` exists: SCP to `/tmp`, `sudo mv` to `/etc/splitgate/isp-routes-custom.txt` (mode 644, root:root) |
| 2b/3 | If `vpn-routes-custom.txt` exists: SCP to `/tmp`, `sudo mv` to `/etc/splitgate/vpn-routes-custom.txt` (mode 644, root:root) |
| 3/3 | `ssh … sudo /etc/splitgate/routing.sh --no-update` |

Exit codes: `1` if SSH connectivity fails, `1` if neither custom-route file exists locally, `0` on success.

```bash
bash src/deploy-routes.sh

# Verify after deploy:
ssh pi4 "ls -l /etc/splitgate/{isp,vpn}-routes-custom.txt"
ssh pi4 "ip route get <your-exception-ip>"
```

---

### routing.sh (deployed to /etc/splitgate/routing.sh)

**Synopsis:** `sudo /etc/splitgate/routing.sh [--no-update]`

Flush-and-rebuild split-tunnel routing. Idempotent — safe to re-run at any time.

On each run: downloads RU CIDRs → flushes existing VPN routes → adds VPN server host route →
adds RU CIDR routes via `KEENETIC_GW` → loads `isp-routes-custom.txt` (Stage 5b, if present) →
loads `vpn-routes-custom.txt` (Stage 5c, if present — overrides any ISP routes for those CIDRs) →
sets default route via `awg0` → configures MASQUERADE and iptables LOG rules → saves via `iptables-save`.

| Flag | Description |
|------|-------------|
| `--no-update` | Skip downloading fresh RU subnets; use existing `/etc/splitgate/white-list.txt`. Used by `update-vpn-routes` after an atomic file swap to avoid double-download. |

```bash
ssh pi4 "sudo /etc/splitgate/routing.sh"             # full run with download
ssh pi4 "sudo /etc/splitgate/routing.sh --no-update" # rebuild without download
ssh pi4 "ip route show default"     # expect: default dev awg0
ssh pi4 "ip route get 8.8.8.8"      # expect: dev awg0
ssh pi4 "ip route get 77.88.8.8"    # expect: via 192.168.1.1
```

---

### vpn-status.sh (deployed to /etc/splitgate/vpn-status.sh)

**Synopsis:** `sudo /etc/splitgate/vpn-status.sh [--last=N] [--filter=STRING] [--device=IP] [--via=vpn|isp] [--summary]`

Reads journald `[VPN]`/`[ISP]` LOG entries, correlates with dnsmasq query log for domain
resolution, falls back to rDNS (`host`). Output columns: `TIMESTAMP SRC-IP DST-IP DOMAIN ORG PATH`.

The `ORG` column shows `{org} (AS{asn})` via Team Cymru bulk-whois, or `-` when unresolvable.
Results are cached in `/tmp/vpn-asn-cache.json` (mode 0666, shared between root and non-root).

Must run as `sudo`.

| Flag | Description |
|------|-------------|
| `--last=N` | Show last N journald kernel entries (default: 50) |
| `--filter=STRING` | Case-insensitive partial match on the DOMAIN column |
| `--device=IP` | Filter by source LAN device IP (SRC field) |
| `--via=vpn\|isp` | Show only VPN-routed or ISP-routed connections |
| `--summary` | Print top-20 ORG aggregate table (ORG \| VPN_COUNT \| ISP_COUNT \| TOTAL) instead of per-row table |

All flags compose freely.

```bash
sudo /etc/splitgate/vpn-status.sh
sudo /etc/splitgate/vpn-status.sh --via=vpn --last=100
sudo /etc/splitgate/vpn-status.sh --device=192.168.1.50 --filter=steam
sudo /etc/splitgate/vpn-status.sh --summary
sudo /etc/splitgate/vpn-status.sh --summary --device=192.168.1.50 --via=vpn
sudo /etc/splitgate/vpn-status.sh --last=200   # extend window when output is empty
```

---

### vpn-rollback.sh (deployed to /etc/splitgate/vpn-rollback.sh)

**Synopsis:** `sudo /etc/splitgate/vpn-rollback.sh`

No flags. Fully idempotent — safe to re-run.

```bash
ssh pi4 "sudo /etc/splitgate/vpn-rollback.sh"
ssh pi4 "ip route show default"  # expect: default via 192.168.1.1
bash src/deploy.sh               # re-activate after rollback
```

---

### update-vpn-routes (deployed to /etc/splitgate/update-vpn-routes)

**Synopsis:** `sudo /etc/splitgate/update-vpn-routes`

Normally called by cron daily at `CRON_UPDATE_HOUR:00` (default 5:00 AM). Can be run manually.

Behavior:
- Builds `EFFECTIVE_URL` from `RU_SUBNET_URL`; appends `&exclude[cidr4]=CIDR` for each line in
  `/etc/splitgate/ru-list-exclude.txt` (if present)
- Logs download source domain, actual excluded CIDRs, and downloaded route count to `install.log`
- Downloads RU subnet list and SHA256-compares against existing `/etc/splitgate/white-list.txt`
- If hash matches: exits 0 (no rebuild)
- If hash differs: atomically swaps file, then runs `routing.sh --no-update`
- If download fails: exits 0 (existing routes remain intact); checks for missing VPN server host
  route and rebuilds if absent (carrier-change recovery)

Logs to `/etc/splitgate/logs/install.log` (tag `[vpn-routes]`).

```bash
ssh pi4 "sudo /etc/splitgate/update-vpn-routes"
ssh pi4 "sudo grep vpn-routes /etc/splitgate/logs/install.log | tail -10"
ssh pi4 "sudo cat /etc/cron.d/vpn-routes"
```

---

### watch-routes.py (deployed to /etc/splitgate/watch-routes.py)

**Synopsis:** `sudo python3 /etc/splitgate/watch-routes.py [--src IP] [--no-dns] [--tag {VPN,ISP,both}] [--no-asn] [--daemon]`

Real-time iptables log enricher. Spawns `journalctl -f -k --no-pager -o short-iso` and
parses `[VPN]`/`[ISP]` lines as they arrive. Resolves destination IPs via cached rDNS lookups
(in-memory cache, 2-second timeout). Lines for new destination IPs are buffered until the ASN lookup
completes (typically 1–3 s), so every printed line carries ` | {org}`. Repeated IPs print immediately
from cache. Stalled lookups flush after 6 seconds.

In `--daemon` mode a connection status field (✓/✗) is added to each line after the `[TAG]`:
- `✓` = ESTABLISHED or TIME_WAIT found in `/proc/net/nf_conntrack` after a 3-second delay
- `✗` = not found in conntrack (UDP connections always show `✗`)

Output format in daemon mode:
```
2026-05-29T10:14:00 [ISP] ✓ 192.168.1.237 → yandex.ru TCP:443 | TELETECH, RU
2026-05-29T10:14:05 [ISP] ✗ 192.168.1.237 → github.com TCP:443 | FASTLY, US
```

Log files: `/etc/splitgate/logs/watch-YYYY-MM-DD.log`. A new dated file is opened at midnight.
Files older than 14 days are deleted by the `logrotate-vpn-gateway` postrotate hook.

Requires Python 3 (stdlib only — no pip dependencies).

| Flag | Description |
|------|-------------|
| `--src IP` | Show only entries where SRC matches this IP address |
| `--no-dns` | Skip reverse DNS lookups; show raw destination IPs |
| `--tag VPN\|ISP\|both` | Filter by routing tag (default: both) |
| `--no-asn` | Disable background ASN/org enrichment. In daemon mode, status field omitted |
| `--daemon` | Write to dated log file `/etc/splitgate/logs/watch-YYYY-MM-DD.log` instead of stdout. Used by `splitgate-watch.service` |

```bash
sudo python3 /etc/splitgate/watch-routes.py
sudo python3 /etc/splitgate/watch-routes.py --src 192.168.1.50 --tag VPN
sudo python3 /etc/splitgate/watch-routes.py --no-dns
sudo python3 /etc/splitgate/watch-routes.py --tag ISP --no-dns --no-asn
# Start as daemon (normally done by systemd, but can run manually):
sudo python3 /etc/splitgate/watch-routes.py --daemon
```

**Useful grep patterns:**
```bash
# ISP routes that failed to establish (may need VPN forcing)
grep "[ISP] ✗" /etc/splitgate/logs/watch-$(date +%F).log

# All traffic from a specific device
grep "192.168.1.50" /etc/splitgate/logs/watch-$(date +%F).log
```

---

### splitgate-watch.service

**Location:** `/etc/systemd/system/splitgate-watch.service`

Runs `watch-routes.py --daemon` as a persistent background service at boot. Restarts automatically on failure.

| Command | What it does |
|---------|-------------|
| `systemctl status splitgate-watch` | Show service status and recent log entries |
| `systemctl start splitgate-watch` | Start the daemon |
| `systemctl stop splitgate-watch` | Stop the daemon |
| `systemctl restart splitgate-watch` | Restart (e.g. after updating watch-routes.py) |
| `systemctl is-enabled splitgate-watch` | Check if enabled at boot |

```bash
# Check service status
ssh pi4 "systemctl status splitgate-watch"

# View connection logs
ssh pi4 "tail -f /etc/splitgate/logs/watch-$(date +%F).log"

# View daemon errors (startup failures, Python exceptions)
ssh pi4 "cat /etc/splitgate/logs/watch-error.log"

# Verify autostart
ssh pi4 "systemctl is-enabled splitgate-watch"   # expect: enabled
```

Deployed by `deploy.sh` Stage 28. `vpn-rollback.sh` stops and disables the service as part of rollback.

---

### asn-lookup.py (deployed to /etc/splitgate/asn-lookup.py)

**Synopsis:** `python3 /etc/splitgate/asn-lookup.py [IPs...]`

Shared Team Cymru bulk-whois helper. Reads IPv4 addresses from stdin (one per line) or from
positional arguments, queries `whois.cymru.com:43` in a single batched TCP session, and writes a
JSON dict `{"<ip>": {"asn": "<digits>", "org": "<name>"}}` to stdout.

Results are cached in `/tmp/vpn-asn-cache.json` (mode 0666 — readable by both root and non-root).
Cymru unreachable → returns `{}` (or partial results), exit 0. Never fatal on network errors.

```bash
printf "8.8.8.8\n1.1.1.1\n" | python3 /etc/splitgate/asn-lookup.py
python3 /etc/splitgate/asn-lookup.py 8.8.8.8
rm -f /tmp/vpn-asn-cache.json && printf "8.8.8.8\n" | python3 /etc/splitgate/asn-lookup.py
```

---

## Troubleshooting & Known Gotchas

Each entry: **Symptom → Cause → Fix**.

---

**LAN devices cannot reach the internet at all (FORWARD chain DROP)**

Symptom: All LAN device traffic is silently dropped after RPi is set as gateway. `sudo iptables -L FORWARD -n` shows default policy `DROP` with no ACCEPT rules.

Cause: Docker (if installed on the RPi) sets the FORWARD chain default policy to DROP.

Fix: Re-run `sudo /etc/splitgate/routing.sh` — Stage 7c adds `FORWARD -i eth0 ACCEPT` and `FORWARD RELATED,ESTABLISHED ACCEPT` rules.

---

**No [VPN] or [ISP] entries appear in journald**

Symptom: `journalctl -k | grep -E '\[VPN\]|\[ISP\]'` returns nothing even after LAN traffic flows through the RPi.

Cause: LOG rules must be added to the FORWARD chain **before** ACCEPT rules. LOG is non-terminating; ACCEPT terminates. If ACCEPT is first, LOG is never reached.

Fix: Re-run `sudo /etc/splitgate/routing.sh` — Stage 7b adds LOG rules before Stage 7c adds ACCEPT rules.

---

**Router web UI / app becomes inaccessible from LAN devices**

Symptom: Cannot reach `http://192.168.1.1` from LAN devices after RPi is configured as gateway.

Cause: An unconstrained MASQUERADE rule on `eth0` rewrites source IPs for all outbound traffic — including intra-LAN traffic to `192.168.1.1`. Router sees all requests from `192.168.1.254` and blocks them.

Fix: `routing.sh` Stage 7 uses `! -d LAN_SUBNET` in the eth0 MASQUERADE rule. Re-run `sudo /etc/splitgate/routing.sh` to restore the correct rule.

---

**dnsmasq fails to start or conflicts with an existing config**

Symptom: Stage 17/18 of `deploy.sh` fails; `systemctl status dnsmasq` shows a config parse error or port conflict.

Cause: If `dnsmasq` config is deployed before the package is installed, `apt-get install dnsmasq` overwrites the deployed config.

Fix: Re-run `bash src/deploy.sh` — Stage 18 always installs `dnsmasq` before Stage 19 deploys the config.

---

**Tunnel bring-up fails or `awg-quick up awg0` returns "already exists"**

Symptom: `sudo awg-quick up awg0` errors with "RTNETLINK answers: File exists".

Cause: `awg-quick up` is not idempotent. `deploy.sh` does not bring up the tunnel for this reason.

Fix:
```bash
ssh pi4 "sudo awg-quick down awg0 && sudo awg-quick up awg0"
# or:
ssh pi4 "sudo systemctl restart awg-quick@awg0"
```

---

**vpn-status.sh shows no entries even after browsing the web**

Symptom: `vpn-status.sh` output shows `(no connections matched — try --last=200 or remove filters)`.

Cause A: dnsmasq is not configured as the DNS server in your router — queries bypass the RPi.

Cause B: LAN device has not renewed its DHCP lease since the router gateway was changed.

Fix: In your router web UI: set Gateway address to `192.168.1.254` and DNS server to `192.168.1.254`. Then renew the DHCP lease on the LAN device (disconnect/reconnect Wi-Fi, or `ipconfig /renew` on Windows).

---

**DOMAIN column in vpn-status.sh shows raw IPs instead of hostnames**

Symptom: DOMAIN column shows IP addresses instead of domain names.

Cause: dnsmasq is not the DNS server for LAN devices — DNS queries bypass dnsmasq's query log.

Fix: Set your router DNS server to `192.168.1.254` (see README → Deploy → Router setup).

---

**Split-tunnel routes disappear after router reboots (NM carrier-change)**

Symptom: VPN routing breaks after the router reboots or eth0 link drops. `ip route show | wc -l` drops to ~2. `ip route get 8.8.8.8` no longer shows `dev awg0`.

Cause: When the router reboots, eth0 link drops. NetworkManager flushes all eth0 routes on the link-down event — including all ~1360 RU CIDR routes and the VPN server host route. When eth0 comes back up, NM only restores the local link route. Without the VPN server host route (`<VPN_SERVER_IP>/32 via 192.168.1.1`), traffic to the VPN endpoint resolves via `awg0`, creating a routing loop.

Fix: `deploy.sh` Stage 23 deploys `/etc/NetworkManager/dispatcher.d/10-vpn-routes` — an NM dispatcher script that restores routes by running `routing.sh --no-update` when `eth0 up` is detected.

```bash
ssh pi4 "sudo journalctl -t vpn-routes -n 5 --no-pager"
# Expected: "eth0 up — restoring VPN split-tunnel routes"
```

Manual recovery if routes are currently missing:
```bash
ssh pi4 "sudo /etc/splitgate/routing.sh"
```

---

## Development Phases

| Phase | Name | Goal | Link |
|-------|------|------|------|
| 1 | Foundation & Config | AmneziaWG installed, config deployed, tunnel operational | [.planning/phases/01-foundation-config/](../.planning/phases/01-foundation-config/) |
| 2 | Routing & NAT | Split-tunnel routing active, LAN devices NATed | [.planning/phases/02-routing-nat/](../.planning/phases/02-routing-nat/) |
| 3 | Autostart, Cron & Rollback | Survives reboots, daily refresh, one-command rollback | [.planning/phases/03-autostart-cron-rollback/](../.planning/phases/03-autostart-cron-rollback/) |
| 4 | Traffic Logging & Visibility | Per-connection VPN/ISP routing decisions logged and queryable | [.planning/phases/04-traffic-logging-visibility-vpn-isp/](../.planning/phases/04-traffic-logging-visibility-vpn-isp/) |
| 5 | Custom Route Exceptions | Per-CIDR ISP-bypass exceptions on top of auto-downloaded RU list | [.planning/phases/05-custom-route-exceptions-ip/](../.planning/phases/05-custom-route-exceptions-ip/) |
| 6 | Documentation | Ops runbook: deploy, verify, rollback, add exceptions | [.planning/phases/06-documentation/](../.planning/phases/06-documentation/) |
| 7 | ASN Enrichment & Traffic Attribution | Enrich vpn-status.sh and watch-routes.py with ISP/org via Team Cymru | [.planning/phases/07-asn-enrichment-traffic-attribution/](../.planning/phases/07-asn-enrichment-traffic-attribution/) |
| 8 | RU IP List Exclusion Filter | Exclude specific CIDRs from the downloaded RU list so they route via VPN | [.planning/phases/08-ru-ip-list-exclusion-filter/](../.planning/phases/08-ru-ip-list-exclusion-filter/) |
| 10 | Splitgate Ergonomics | Consolidated RPi files under `/etc/splitgate/`, added `splitgate` dispatcher CLI, log rotation | [.planning/phases/10-splitgate-ergonomics/](../.planning/phases/10-splitgate-ergonomics/) |
| 11 | README Documentation Overhaul | Trim README to 3 quick-start sections; all technical detail in docs/REFERENCE.md | [.planning/phases/11-readme-documentation/](../.planning/phases/11-readme-documentation/) |
| 12 | Buffered ASN Output | Buffer watch-routes.py lines until ASN lookup completes; flush after 6 s on stall | [.planning/phases/12-buffered-asn-output/](../.planning/phases/12-buffered-asn-output/) |
| 13 | Log Monitoring, Routing Refinement & Daemon | splitgate-watch.service daemon with ✓/✗ conntrack status; install.log rename; ru-list-exclude.txt rename; 11 RU CIDRs added to isp-routes-custom.txt | [.planning/phases/13-log-monitoring-daemon/](../.planning/phases/13-log-monitoring-daemon/) |

### Quick Tasks

| ID | Description | Commit |
|----|-------------|--------|
| 260521-jex | Add `scripts/watch-routes.py` — real-time iptables log enricher with rDNS caching | cf6bafa |
| 260523-nmr | Fix NM carrier-change route flush — add NM dispatcher (`10-vpn-routes`) + fallback rebuild in `update-vpn-routes` | 847ff31 |
| 260603-f8c | Add `src/deploy-routes.sh` — fast custom-routes-only deploy (SCP isp/vpn-routes-custom.txt + routing.sh --no-update) | 0d0bec6 |
