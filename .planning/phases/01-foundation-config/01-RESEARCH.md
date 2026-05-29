# Phase 1: Foundation & Config - Research

**Researched:** 2026-05-19
**Domain:** AmneziaWG installation on Raspberry Pi OS (Debian Bookworm, arm64) + deploy.sh scripting
**Confidence:** MEDIUM — installation path confirmed via multiple community sources; RPi arm64 DKMS reliability has known risks that need verification at runtime

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Primary install method: official AmneziaWG installer script from amnezia.org
- **D-02:** Fallback if installer fails: download pre-built `.deb` from AmneziaWG GitHub releases page
- **D-03:** RPi OS already running (Raspberry Pi OS / Debian, arm64) — no OS install step needed
- **D-04:** deploy.sh connects via SSH using system SSH config; host alias is `pi4`
- **D-05:** SSH user on RPi: `ar` (not default `pi`); has passwordless sudo
- **D-06:** Auth method: SSH key (pre-configured via ssh-copy-id); no password prompts
- **D-07:** Real VPN keys live in `.env.secrets` (gitignored, never committed)
- **D-08:** Variable names in `.env.secrets`: `AWG_PRIVATE_KEY`, `AWG_PUBLIC_KEY`, `AWG_PRESHARED_KEY`
- **D-09:** deploy.sh reads `.env.secrets`, substitutes placeholders in `amnezia.key.claude.txt` via `sed`, SCPs result to `/etc/amnezia/amneziawg/awg0.conf` on RPi
- **D-10:** deploy.sh validates keys before deployment: non-empty check + basic base64 format check; fails fast with clear error message if invalid

### Claude's Discretion

- Exact sed substitution approach (inline sed pipeline vs temp file) — Claude picks safer/cleaner method
- Whether deploy.sh also verifies SSH connectivity before starting deployment
- Exact error message wording for validation failures

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INST-01 | AmneziaWG installed; `awg` binary available on RPi | Install method, package names, binary location confirmed |
| INST-02 | IP forwarding enabled persistently (sysctl, survives reboot) | `/etc/sysctl.d/` approach documented |
| CONF-01 | awg0.conf deployed to `/etc/amnezia/amneziawg/awg0.conf` from template | Config dir confirmed; sed substitution approach researched |
| CONF-02 | `/etc/vpn-gateway.env` deployed with all variables from `.env` | SCP pattern straightforward; deploy.sh handles this |
</phase_requirements>

---

## Summary

AmneziaWG is a fork of WireGuard with protocol obfuscation fields (Jc, Jmin, Jmax, S1, S2, H1–H4). The RPi acts as a **client** connecting to an existing AmneziaWG server — not as a server itself. This distinction matters: the installer scripts (bivlked, wiresock) are designed to set up an AmneziaWG *server*; for client use on the RPi, only the kernel module + awg-quick tooling are needed, not the full server management stack.

Installation on Raspberry Pi OS Bookworm arm64 has a known risk path: the Amnezia Launchpad PPA targets Ubuntu codenames, not Debian. On RPi, the kernel has a `+rpt` or `-rpi` suffix which changes which headers package is needed (`linux-headers-rpi-v8` for RPi 4 64-bit, not `linux-headers-arm64`). The bivlked installer (v5.9.0+) handles this with a prebuilt `.ko` path (2–3 min) or DKMS fallback (10–30 min). The key risk is kernel version mismatch between the prebuilt `.ko` and the running kernel — if they don't match, DKMS compilation runs and must succeed.

The deploy.sh script is straightforward: source `.env` + `.env.secrets`, validate keys, run `sed` substitution on the template, `mkdir -p` the target directory on RPi via SSH, then SCP the rendered config. Idempotency is naturally guaranteed by overwriting files with the same content on re-run.

**Primary recommendation:** Use the bivlked installer script on the RPi (handles RPi header detection automatically); write deploy.sh with a safe sed-pipeline that never writes raw key values to disk; use `/etc/sysctl.d/99-vpn-gateway.conf` for persistent ip_forward.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| AmneziaWG kernel module install | RPi OS layer | — | Kernel module must run natively on RPi hardware |
| VPN config deployment | Local deploy script | RPi filesystem | Keys stay local; rendered config SCPs to RPi |
| Key validation | Local deploy script | — | Fail fast before touching RPi |
| IP forwarding (sysctl) | RPi OS layer | — | Kernel parameter, must persist via sysctl.d |
| Config directory creation | RPi filesystem | deploy.sh (via ssh) | `/etc/amnezia/amneziawg/` may not exist post-install |

---

## Standard Stack

### Core

| Component | Version/Source | Purpose | Why Standard |
|-----------|---------------|---------|--------------|
| amneziawg (kernel module) | Latest via bivlked installer | AWG kernel support on RPi | Only way to get `amneziawg.ko` on RPi arm64 |
| amneziawg-tools | Latest via PPA / installer | Provides `/usr/bin/awg` and `/usr/bin/awg-quick` | Official userspace tools |
| awg-quick | Installed with amneziawg-tools | Brings up/tears down awg0 interface | Standard WG-style interface management |

### Supporting

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `sysctl` + `/etc/sysctl.d/` | Persistent ip_forward | Phase requirement INST-02 |
| `sed` (GNU, available on macOS and Linux) | Placeholder substitution in deploy.sh | Template rendering |
| `scp` / `ssh` | Remote file deploy and command execution | All deploy steps |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bivlked installer (server-focused) | Manual PPA + apt | bivlked handles RPi kernel detection; manual is more controlled but requires knowing exact header package |
| sed pipeline | envsubst | envsubst is simpler but requires exact `${VAR}` syntax; template uses `{{VAR}}` so sed is necessary |
| temp file for rendered config | Process substitution | Temp file is safer for secrets in /tmp (if using umask 077); process substitution avoids disk write but is less debuggable |

---

## Package Legitimacy Audit

> This phase installs system packages on the RPi (not via npm/pip on local machine). No local package installs are required for deploy.sh — it uses standard POSIX tools (bash, sed, scp, ssh).

| Package | Registry | Notes | Disposition |
|---------|----------|-------|-------------|
| amneziawg | Launchpad PPA (amnezia/ppa) | Official Amnezia VPN project [CITED: github.com/amnezia-vpn] | Approved — official project |
| amneziawg-tools | Launchpad PPA / GitHub releases | Official Amnezia VPN project | Approved — official project |

*No npm/pip packages are installed in this phase. slopcheck not applicable.*

---

## Architecture Patterns

### System Architecture Diagram

```
Local machine (macOS)
  ├── .env (network config, committed)
  ├── .env.secrets (keys, gitignored)
  └── amnezia.key.claude.txt (template)
         │
         ▼ deploy.sh
    [1. source .env + .env.secrets]
    [2. validate keys (base64 format)]
    [3. sed substitution → rendered config in memory/tmpfile]
    [4. ssh pi4 "mkdir -p /etc/amnezia/amneziawg && ..."]
    [5. scp rendered config → pi4:/etc/amnezia/amneziawg/awg0.conf]
    [6. scp .env → pi4:/etc/vpn-gateway.env]
    [7. ssh pi4 "sudo awg-quick up awg0"]  (optional verification step)
         │
         ▼
RPi 4 (pi4, 192.168.1.254)
  ├── /etc/amnezia/amneziawg/awg0.conf  (rendered, no placeholders)
  ├── /etc/vpn-gateway.env              (sourced by Phase 2 scripts)
  ├── /usr/bin/awg                      (from amneziawg-tools)
  ├── /usr/bin/awg-quick                (from amneziawg-tools)
  ├── amneziawg.ko (kernel module)      (from installer)
  └── sysctl: net.ipv4.ip_forward=1    (from /etc/sysctl.d/99-vpn-gateway.conf)
         │
         ▼
awg0 interface (10.8.1.13/32)
  └── Tunnel to VPN server (YOUR_VPN_SERVER_IP:36348)
```

### Recommended Project Structure

```
split-tunneling-v2/
├── amnezia.key.claude.txt   # WG config template ({{PrivateKey}} etc.)
├── .env                     # Network config (committed)
├── .env.secrets             # VPN keys (gitignored, KEY=value format)
├── deploy.sh                # Main deploy script (Phase 1 deliverable)
├── scripts/
│   └── install-awg.sh       # RPi-side installer (run via ssh)
└── .planning/
```

### Pattern 1: Safe sed Substitution (No Keys on Disk)

**What:** Render template in memory using a pipeline; write to a temp file with umask 077 only if SCP requires a named source.

**When to use:** Whenever substituting secrets into a config before remote transfer.

**Recommended approach — sed pipeline to SCP via process substitution:**

```bash
# Source: best practice from smallstep.com/blog/command-line-secrets
# Read secrets
source .env.secrets

# Validate before use (see Pattern 2)
validate_keys "$AWG_PRIVATE_KEY" "$AWG_PUBLIC_KEY" "$AWG_PRESHARED_KEY"

# Render template in memory and pipe directly to scp via process substitution
# This avoids writing rendered config (with real keys) to disk
# Note: BSD sed (macOS) requires '' after -i; GNU sed does not
rendered=$(sed \
  -e "s|{{PrivateKey}}|${AWG_PRIVATE_KEY}|g" \
  -e "s|{{PublicKey}}|${AWG_PUBLIC_KEY}|g" \
  -e "s|{{PresharedKey}}|${AWG_PRESHARED_KEY}|g" \
  amnezia.key.claude.txt)

# Write to temp file with restricted permissions, then SCP
tmp=$(mktemp)
chmod 600 "$tmp"
echo "$rendered" > "$tmp"
scp "$tmp" pi4:/tmp/awg0.conf.tmp
rm -f "$tmp"

# Move into place on RPi with correct permissions
ssh pi4 "sudo mkdir -p /etc/amnezia/amneziawg && \
         sudo mv /tmp/awg0.conf.tmp /etc/amnezia/amneziawg/awg0.conf && \
         sudo chmod 600 /etc/amnezia/amneziawg/awg0.conf && \
         sudo chown root:root /etc/amnezia/amneziawg/awg0.conf"
```

**Why temp file + move instead of direct sed | ssh cat:**
SCP requires a source file; piping via `ssh "cat > path"` works but requires `sudo` on the remote which complicates the pipeline. The tmp-file + scp + sudo mv pattern is cleaner and widely used.

### Pattern 2: Key Validation (Base64 Format)

**What:** WireGuard keys are exactly 44 characters of standard base64 (43 chars + `=` padding), encoding 32 bytes.

**Exact regex:** `^[A-Za-z0-9+/]{43}=$`

```bash
# Source: WireGuard key format documentation
validate_key() {
    local key="$1"
    local name="$2"
    if [[ -z "$key" ]]; then
        echo "ERROR: $name is empty in .env.secrets" >&2
        exit 1
    fi
    if ! echo "$key" | grep -qE '^[A-Za-z0-9+/]{43}=$'; then
        echo "ERROR: $name does not look like a valid WireGuard key (expected 44-char base64)" >&2
        exit 1
    fi
}

validate_key "$AWG_PRIVATE_KEY"   "AWG_PRIVATE_KEY"
validate_key "$AWG_PUBLIC_KEY"    "AWG_PUBLIC_KEY"
validate_key "$AWG_PRESHARED_KEY" "AWG_PRESHARED_KEY"
```

### Pattern 3: Persistent IP Forwarding

```bash
# Source: Debian sysctl.d documentation, ASSUMED pattern
# Apply immediately
sudo sysctl -w net.ipv4.ip_forward=1

# Persist across reboots via sysctl.d (preferred over /etc/sysctl.conf on modern Debian)
echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-vpn-gateway.conf
sudo sysctl --system
```

**Why `/etc/sysctl.d/` not `/etc/sysctl.conf`:** On modern Debian (Bookworm), `/etc/sysctl.conf` may not exist by default; `/etc/sysctl.d/` is the standard drop-in location. File named `99-vpn-gateway.conf` sorts last, ensuring it wins over any conflicting entries. [ASSUMED]

### Pattern 4: Idempotent Remote Directory Creation

```bash
# mkdir -p never fails if directory already exists
ssh pi4 "sudo mkdir -p /etc/amnezia/amneziawg"
```

### Anti-Patterns to Avoid

- **Installing the full server-mode installer when RPi is a client:** The bivlked installer sets up key management, server config generation, firewall rules, etc. For Phase 1, only the kernel module and awg-quick tools are needed. Run the installer but do NOT let it generate a server config — or extract just the module install steps.
- **Writing .env.secrets to RPi:** Never SCP `.env.secrets` to the RPi. Only the rendered `awg0.conf` (with keys baked in) goes there.
- **`sudo awg-quick up awg0` in deploy.sh without error handling:** If awg0 is already up, `awg-quick up` fails. Either check status first or use `awg-quick down awg0; awg-quick up awg0` as idempotent pattern. Alternatively, leave tunnel management as a separate manual step (not in deploy.sh).
- **Using `add-apt-repository ppa:amnezia/ppa` on Raspberry Pi OS Bookworm without the correct focal/noble remapping:** RPi OS is Debian, not Ubuntu. The PPA tool requires mapping to a supported Ubuntu codename. The bivlked installer handles this automatically.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AWG kernel module for arm64 | Custom DKMS compilation script | bivlked installer (v5.9.0+) | Handles RPi kernel detection, header package naming, prebuilt .ko download, DKMS fallback |
| WG key format validation | Complex regex from scratch | Use the known 44-char base64 regex | WG key format is well-defined (32 bytes = 44 base64 chars with one `=` pad) |
| Config directory creation | Checking if path exists before mkdir | `mkdir -p` | -p flag is idempotent by definition |
| Persistent sysctl | rc.local or cron | `/etc/sysctl.d/` drop-in file | Systemd-integrated, survives upgrades |

---

## Common Pitfalls

### Pitfall 1: AmneziaWG kernel module not loaded after install

**What goes wrong:** `awg-quick up awg0` fails with "Error: Unknown device type. Unable to access interface: Protocol not supported"

**Why it happens:** The amneziawg.ko kernel module was compiled/installed but not loaded into the running kernel. Or the DKMS build failed silently.

**How to avoid:** After install, explicitly run `sudo modprobe amneziawg` and verify with `lsmod | grep amneziawg`. The service `awg-quick@awg0` should load it automatically on start, but manual verification catches silent failures.

**Warning signs:** `dmesg | grep amneziawg` shows errors; `lsmod | grep amneziawg` returns empty.

[CITED: github.com/amnezia-vpn/amneziawg-linux-kernel-module/issues/155]

### Pitfall 2: Wrong kernel headers package on Raspberry Pi arm64

**What goes wrong:** DKMS compilation fails with "No such file or directory" errors for kernel headers.

**Why it happens:** On Raspberry Pi OS, the kernel has a `+rpt` or `-rpi` suffix. The standard `linux-headers-arm64` package does NOT cover RPi Foundation kernels. The correct package is:
- RPi 4 (64-bit): `linux-headers-rpi-v8`
- RPi 5: `linux-headers-rpi-2712`

**How to avoid:** Use the bivlked installer (v5.9.0+) which auto-detects the `+rpt` suffix and selects the correct headers package. If installing manually, verify with `uname -r` first.

**Warning signs:** `dkms status` shows the module in "build failed" state.

[CITED: github.com/bivlked/amneziawg-installer ADVANCED.en.md]

### Pitfall 3: PPA codename mismatch on Raspberry Pi OS (Debian vs Ubuntu)

**What goes wrong:** `add-apt-repository ppa:amnezia/ppa` fails or installs wrong packages because RPi OS is Debian Bookworm, not Ubuntu Noble/Jammy.

**Why it happens:** The Launchpad PPA is published for Ubuntu codenames. Debian doesn't have `add-apt-repository` by default, and even when installed, it maps to wrong codenames.

**How to avoid:** Use the bivlked installer which auto-handles PPA codename remapping (maps Debian Bookworm → focal/noble PPA branch). Alternatively, manually add the PPA with explicit Ubuntu codename in sources.list.

[CITED: forum discussion, mk16.de blog]

### Pitfall 4: `/etc/amnezia/amneziawg/` directory may not be created by `amneziawg-tools` package alone

**What goes wrong:** SCP of awg0.conf fails because the target directory doesn't exist.

**Why it happens:** The amneziawg-tools package may not create `/etc/amnezia/amneziawg/` on installation — this was reported as an issue (github.com/amnezia-vpn/amneziawg-tools/issues/16). The directory is expected to exist but may require manual creation.

**How to avoid:** deploy.sh must `ssh pi4 "sudo mkdir -p /etc/amnezia/amneziawg"` before SCP.

[CITED: github.com/amnezia-vpn/amneziawg-tools/issues/16]

### Pitfall 5: awg0 already up on second deploy.sh run

**What goes wrong:** `sudo awg-quick up awg0` in deploy.sh fails with "already up" error on second run.

**Why it happens:** awg-quick is not idempotent for "up" — running it when the interface is already up fails.

**How to avoid:** deploy.sh should NOT attempt to bring up the tunnel — leave that as a manual verification step or a separate command. The success criterion (awg-quick up awg0 succeeds) is a one-time check, not part of the deploy script's responsibility.

### Pitfall 6: macOS sed vs GNU sed difference

**What goes wrong:** `sed -i 's/old/new/'` fails on macOS (deploy.sh runs on macOS).

**Why it happens:** BSD sed (macOS) requires an empty string argument after `-i`: `sed -i '' 's/old/new/'`. GNU sed (Linux) does not accept the empty string.

**How to avoid:** Use a pipeline (`sed ... file | ...`) instead of in-place editing, or use a variable substitution approach that doesn't touch the original file.

```bash
# Cross-platform: sed reading stdin, output to variable
rendered=$(sed -e "s|{{PrivateKey}}|${AWG_PRIVATE_KEY}|g" amnezia.key.claude.txt)
```

### Pitfall 7: Keys exposed in process list

**What goes wrong:** Running `sed -e "s|placeholder|$KEY|" ...` with keys as arguments may expose key values in `ps aux` output.

**Why it happens:** Command-line arguments are visible in the process table.

**How to avoid:** Use `sed` reading from stdin or a file, with key values injected as shell variables (not command-line args). The pattern above (using `-e "s|...|${VAR}|"` where VAR is a shell variable) is acceptable since the variable expansion happens in the shell's memory before exec. The key is never a separate command-line argument.

---

## Code Examples

### deploy.sh overall structure

```bash
#!/usr/bin/env bash
set -euo pipefail

# Source: project convention (D-04 to D-10 from CONTEXT.md)

# --- Config ---
SSH_HOST="pi4"
SSH_USER="ar"
TEMPLATE="amnezia.key.claude.txt"
AWG_CONF_REMOTE="/etc/amnezia/amneziawg/awg0.conf"
ENV_REMOTE="/etc/vpn-gateway.env"

# --- Load environment ---
if [[ ! -f .env ]]; then
    echo "ERROR: .env not found" >&2; exit 1
fi
if [[ ! -f .env.secrets ]]; then
    echo "ERROR: .env.secrets not found — create it with AWG_PRIVATE_KEY, AWG_PUBLIC_KEY, AWG_PRESHARED_KEY" >&2; exit 1
fi
source .env
source .env.secrets

# --- Validate keys ---
validate_key() {
    local key="$1" name="$2"
    [[ -z "$key" ]] && { echo "ERROR: $name is empty" >&2; exit 1; }
    echo "$key" | grep -qE '^[A-Za-z0-9+/]{43}=$' || {
        echo "ERROR: $name is not a valid 44-char base64 WireGuard key" >&2; exit 1
    }
}
validate_key "$AWG_PRIVATE_KEY"   "AWG_PRIVATE_KEY"
validate_key "$AWG_PUBLIC_KEY"    "AWG_PUBLIC_KEY"
validate_key "$AWG_PRESHARED_KEY" "AWG_PRESHARED_KEY"

# --- Optional: verify SSH connectivity ---
echo "[1/4] Verifying SSH connectivity to $SSH_HOST..."
ssh -o ConnectTimeout=5 "$SSH_HOST" true || {
    echo "ERROR: Cannot connect to $SSH_HOST via SSH" >&2; exit 1
}

# --- Render config ---
echo "[2/4] Rendering awg0.conf from template..."
tmp=$(mktemp)
chmod 600 "$tmp"
sed \
  -e "s|{{PrivateKey}}|${AWG_PRIVATE_KEY}|g" \
  -e "s|{{PublicKey}}|${AWG_PUBLIC_KEY}|g" \
  -e "s|{{PresharedKey}}|${AWG_PRESHARED_KEY}|g" \
  "$TEMPLATE" > "$tmp"

# --- Deploy awg0.conf ---
echo "[3/4] Deploying awg0.conf to $SSH_HOST..."
ssh "$SSH_HOST" "sudo mkdir -p /etc/amnezia/amneziawg"
scp "$tmp" "${SSH_HOST}:/tmp/awg0.conf.tmp"
rm -f "$tmp"
ssh "$SSH_HOST" "sudo mv /tmp/awg0.conf.tmp $AWG_CONF_REMOTE && \
                 sudo chmod 600 $AWG_CONF_REMOTE && \
                 sudo chown root:root $AWG_CONF_REMOTE"

# --- Deploy /etc/vpn-gateway.env ---
echo "[4/4] Deploying vpn-gateway.env to $SSH_HOST..."
scp .env "${SSH_HOST}:/tmp/vpn-gateway.env.tmp"
ssh "$SSH_HOST" "sudo mv /tmp/vpn-gateway.env.tmp $ENV_REMOTE && \
                 sudo chmod 644 $ENV_REMOTE"

echo ""
echo "Deploy complete."
echo "Next steps on RPi:"
echo "  sudo awg-quick up awg0   # bring up tunnel"
echo "  sudo awg show            # verify peer handshake"
```

### AmneziaWG install on RPi (manual fallback steps)

```bash
# Source: mk16.de/blog/install-amneziawg-kernel-module-on-debian/ + bivlked ADVANCED.en.md

# Step 1: Install prerequisites
sudo apt-get update
sudo apt-get install -y gnupg2 apt-transport-https

# Step 2: Add Amnezia GPG key
sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/amnezia.gpg \
  --keyserver keyserver.ubuntu.com \
  --recv-keys 57290828

# Step 3: Add PPA (Debian Bookworm — use focal/noble as codename)
echo "deb [signed-by=/usr/share/keyrings/amnezia.gpg] \
  https://ppa.launchpadcontent.net/amnezia/ppa/ubuntu focal main" \
  | sudo tee /etc/apt/sources.list.d/amnezia.list

# Step 4: Install kernel headers for RPi 4 (64-bit)
sudo apt-get install -y linux-headers-rpi-v8

# Step 5: Install amneziawg
sudo apt-get update
sudo apt-get install -y amneziawg

# Verify binaries present
which awg       # should return /usr/bin/awg
which awg-quick # should return /usr/bin/awg-quick

# Verify kernel module loads
sudo modprobe amneziawg
lsmod | grep amneziawg
```

### IP forwarding persistent enable

```bash
# Source: Debian sysctl.d convention
sudo sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-vpn-gateway.conf
sudo sysctl --system
# Verify
sysctl net.ipv4.ip_forward  # must return net.ipv4.ip_forward = 1
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Manual PPA setup on Debian | bivlked installer v5.7+ handles Debian + RPi header detection automatically | Saves debugging PPA codename mismatches |
| Standard WireGuard (`wg`, `wg-quick`) | AmneziaWG (`awg`, `awg-quick`) — different binaries, same config structure | Must use `awg`/`awg-quick`, not `wg`/`wg-quick` |
| AWG 1.x (7 obfuscation params: Jc, Jmin, Jmax, S1, S2, H1–H4) | AWG 2.0 adds S3, S4, I1 params | Template in repo (amnezia.key.claude.txt) only has H1–H4; confirm server is on compatible version |
| `/etc/sysctl.conf` | `/etc/sysctl.d/99-custom.conf` | Drop-in is preferred on modern Debian; avoids editing system file |

**Note on AWG version:** The template `amnezia.key.claude.txt` uses the AWG 1.x param set (Jc, Jmin, Jmax, S1, S2, H1–H4). AWG 2.0 added S3, S4, I1. Since the template has real obfuscation values already configured for the specific server, no change is needed — but if the server upgrade to 2.0 adds new required params, the template will need updating. [ASSUMED]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `/etc/sysctl.d/99-vpn-gateway.conf` works on Raspberry Pi OS Bookworm for persistent ip_forward | Pattern 3 | Low — sysctl.d is standard across all modern Debian-based systems |
| A2 | AWG template's obfuscation params (Jc, Jmin, etc.) are compatible with the server's AWG version | State of the Art | Medium — if server runs AWG 2.0 and requires S3/S4/I1, tunnel will not establish |
| A3 | PPA codename `focal` works as the Ubuntu codename for Raspberry Pi OS Bookworm | Install Pattern | Medium — bivlked installer uses `noble` in newer versions; verify if manual install path is used |
| A4 | The bivlked installer does not irreversibly modify RPi config if stopped after module install | Pitfall 1 | Low — installer is designed to be reversible (--uninstall flag exists) |
| A5 | `amnezia.key.claude.txt` template uses `{{PrivateKey}}` (double-brace) not `${PrivateKey}` (shell-style) | Pattern 1 | High — confirmed by reading the file; sed uses `\{\{` pattern |

---

## Open Questions

1. **Which AmneziaWG installer does amnezia.org recommend for client-mode use?**
   - What we know: amnezia.org docs focus on the Amnezia GUI client app for desktop; for server-side, multiple community installers exist
   - What's unclear: Whether amnezia.org has an official lightweight installer for "install kernel module + tools only (no server config)"
   - Recommendation: Plan should use bivlked installer as the primary path (most reliable for RPi) or manual PPA install; add a manual fallback task

2. **Is awg0 already installed on the RPi?**
   - What we know: CONTEXT.md D-03 says "RPi OS already running" — no information on whether AmneziaWG was previously installed
   - What's unclear: Whether install task needs to handle "already installed" case
   - Recommendation: Plan install task as idempotent — check `which awg` first, skip install if present

3. **RPi kernel version (affects prebuilt .ko availability)**
   - What we know: RPi 4 runs arm64; bivlked downloads prebuilt .ko if kernel version matches
   - What's unclear: Current kernel version on this specific RPi
   - Recommendation: Plan includes `uname -r` as a verification step; document that DKMS fallback adds 10–30 min to install time

---

## Environment Availability

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| `ssh pi4` (SSH key auth) | All deploy tasks | Assumed (D-06 says pre-configured) | Cannot verify without running `ssh pi4 true` |
| `scp` | Config file deploy | ✓ (macOS standard) | Available on any macOS |
| `sed` | Template substitution | ✓ (macOS standard, BSD sed) | Must use pipeline form, not `-i` |
| `bash` | deploy.sh runtime | ✓ | macOS uses zsh by default but bash available |
| RPi internet access | AmneziaWG install | Assumed | RPi must reach Launchpad/GitHub for package download |

**Missing dependencies with no fallback:**
- SSH connectivity to `pi4` — deploy.sh will fail immediately; plan includes connectivity verification step

**Missing dependencies with fallback:**
- AmneziaWG prebuilt .ko (arm-packages release) — fallback is DKMS compilation (10–30 min)

---

## Validation Architecture

> No automated test framework applies here. This is infrastructure deployment, not application code.

### Phase Requirements → Verification Map

| Req ID | Behavior | Test Type | Verification Command | Automated? |
|--------|----------|-----------|---------------------|-----------|
| INST-01 | `awg` binary available | smoke | `ssh pi4 "which awg"` | Yes — in deploy.sh verify block |
| INST-02 | ip_forward = 1 and persists | smoke | `ssh pi4 "sysctl net.ipv4.ip_forward"` + reboot check | Partial — automated for value, manual for reboot |
| CONF-01 | awg0.conf at correct path | smoke | `ssh pi4 "sudo test -f /etc/amnezia/amneziawg/awg0.conf && echo OK"` | Yes — in deploy.sh verify block |
| CONF-02 | /etc/vpn-gateway.env present | smoke | `ssh pi4 "test -f /etc/vpn-gateway.env && echo OK"` | Yes — in deploy.sh verify block |

**Success criterion 4** (awg show shows peer handshake) is a **manual verification** step — it requires the VPN server to be reachable and depends on correct key configuration. It cannot be fully automated in deploy.sh without network assumptions.

**Wave 0 gaps:** None — no test framework to install. Verification is via SSH commands post-deploy.

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A (VPN keys handle auth) |
| V3 Session Management | No | N/A |
| V4 Access Control | Yes | awg0.conf must be `chmod 600 root:root` on RPi |
| V5 Input Validation | Yes | Key format validation in deploy.sh before use |
| V6 Cryptography | Yes | Never hand-roll key generation — keys provided by user |

**Key security requirements:**
- `/etc/amnezia/amneziawg/awg0.conf` must be `chmod 600` owned by root — WireGuard/AmneziaWG enforces this and will refuse to start if permissions are too open [ASSUMED]
- `.env.secrets` must remain gitignored — verify `.gitignore` includes it
- Rendered config must never persist on local disk with liberal permissions — use `chmod 600 "$tmp"` before writing

---

## Sources

### Primary (HIGH confidence)
- [bivlked/amneziawg-installer ADVANCED.en.md](https://github.com/bivlked/amneziawg-installer/blob/main/ADVANCED.en.md) — binary names, config paths, systemd service, RPi kernel header mapping, ARM support details
- [amnezia-vpn/amneziawg-tools GitHub](https://github.com/amnezia-vpn/amneziawg-tools) — package purpose, binary names (awg, awg-quick)
- [RomikB/amneziawg-install installer script](https://github.com/RomikB/amneziawg-install/blob/main/amneziawg-install.sh) — confirmed: AMNEZIAWG_DIR=/etc/amnezia/amneziawg, service name awg-quick@awg0

### Secondary (MEDIUM confidence)
- [mk16.de AmneziaWG Debian guide](https://mk16.de/blog/install-amneziawg-kernel-module-on-debian/) — manual PPA setup for Debian 12
- [EDIS Global install guide](https://docs.edisglobal.com/advanced-setup-guides/install-amneziawg-on-ubuntu-22_04/install-amneziawg-on-ubuntu-2204) — confirmed config dir `/etc/amnezia/amneziawg/` and service `awg-quick@awg0`
- [amneziawg-tools issue #16](https://github.com/amnezia-vpn/amneziawg-tools/issues/16) — confirms `/etc/amnezia` may not be auto-created
- [kernel module issue #155](https://github.com/amnezia-vpn/amneziawg-linux-kernel-module/issues/155) — "Protocol not supported" error when module not loaded
- [WireGuard key format discussion](https://lists.zx2c4.com/pipermail/wireguard/2020-December/006229.html) — 44-char base64 key format

### Tertiary (LOW confidence)
- WebSearch results about Raspberry Pi Bookworm + DKMS — community reports of compilation challenges, no single authoritative source

---

## Metadata

**Confidence breakdown:**
- Standard stack (binaries, paths, service name): HIGH — confirmed by installer script source code and multiple installation guides
- Installation reliability on RPi arm64: MEDIUM — documented to work but DKMS fallback has known risks; kernel version mismatch possible
- deploy.sh patterns (sed, scp): HIGH — standard POSIX tooling, well-understood
- Pitfalls: MEDIUM — based on GitHub issues and community reports, not direct testing

**Research date:** 2026-05-19
**Valid until:** 2026-08-19 (90 days — AmneziaWG installer updates frequently but core paths/service names are stable)
