# Phase 14 Spec: Domain-Based Routing via dnsmasq ipset

## Problem

Current routing system only accepts CIDR4 notation in:
- `src/configs/isp-routes-custom.txt`
- `src/configs/vpn-routes-custom.txt`

Dynamic CDN/cloud providers (AWS EC2, CloudFront, Akamai) use thousands of IPs across
constantly-changing ranges. Adding them as CIDRs is impractical:
- EC2 instance hostnames like `ec2-52-214-109-233.eu-west-1.compute.amazonaws.com`
  resolve to transient IPs
- CloudFront `*.cloudfront.net` can shift IPs between connections
- Maintaining per-IP CIDRs is manual and never exhaustive

## Goal

Allow domain suffixes (and exact domains) as entries in `isp-routes-custom.txt` and
`vpn-routes-custom.txt`, alongside existing CIDRs. When a LAN device resolves a domain
matching an entry, the returned IP is automatically routed via the configured path — in
real time, for every new connection.

## Approach: dnsmasq ipset

dnsmasq has native `ipset=` directive support. When a DNS response is seen for a
configured domain, dnsmasq inserts the resolved IP into a named kernel ipset. iptables
PREROUTING marks packets destined for IPs in those ipsets. The routing table sends
marked packets via the correct interface.

This is the only approach that works reliably for dynamic CDN IPs — it acts on every
DNS resolution, not just at boot time.

## Architecture

### New kernel ipsets

| Name | Purpose |
|------|---------|
| `sg-isp-domains` | IPs for domains that must exit via ISP (KEENETIC_GW) |
| `sg-vpn-domains` | IPs for domains that must exit via VPN (awg0) |

ipset type: `hash:ip` with TTL matching DNS TTL (or fixed 300s).

### dnsmasq ipset directive

For each domain entry in config files, inject into `/etc/dnsmasq.conf`:

```
# isp-routes-custom.txt domain entries:
ipset=/amazonaws.com/sg-isp-domains
ipset=/cloudfront.net/sg-isp-domains

# vpn-routes-custom.txt domain entries:
ipset=/example.com/sg-vpn-domains
```

dnsmasq matches suffix: `ipset=/amazonaws.com/set` matches `ec2-52-xxx.amazonaws.com`.

### iptables marking

In routing.sh Stage 7 (before MASQUERADE rules), add PREROUTING mark rules:

```bash
# Mark packets destined for sg-isp-domains → mark 0x1
iptables -t mangle -A PREROUTING -m set --match-set sg-isp-domains dst -j MARK --set-mark 0x1
# Mark packets destined for sg-vpn-domains → mark 0x2
iptables -t mangle -A PREROUTING -m set --match-set sg-vpn-domains dst -j MARK --set-mark 0x2
```

### ip rule (policy routing)

Two additional routing tables:

```
# /etc/iproute2/rt_tables additions
200  sg-isp
201  sg-vpn
```

ip rules:
```bash
ip rule add fwmark 0x1 table sg-isp priority 100
ip rule add fwmark 0x2 table sg-vpn priority 101
```

Table sg-isp default route: `ip route add default via $KEENETIC_GW table sg-isp`
Table sg-vpn default route: `ip route add default dev $VPN_IFACE table sg-vpn`

### Config file format (backward compatible)

Lines containing `/` or matching `^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]` → CIDR (existing behavior).
All other non-empty, non-comment lines → domain suffix for dnsmasq ipset.

Example `isp-routes-custom.txt`:
```
# CIDRs (existing)
87.228.71.0/24

# Domains (new) — suffix match, no leading dot needed
amazonaws.com
cloudfront.net
```

## Components Changed

| File | Change |
|------|--------|
| `src/scripts/routing.sh` | Stage 3: flush ipset/mangle/rules; Stage 5b/5c: separate CIDR vs domain lines; new Stage 5d: create ipsets + ip rules; Stage 7: mangle PREROUTING mark rules |
| `src/configs/dnsmasq.conf` | Static template gains `# IPSET_DOMAINS_PLACEHOLDER` comment |
| `src/scripts/update-vpn-routes` | No change needed (CIDRs only) |
| `src/deploy.sh` | New stage: parse domain lines from both custom route files → generate dnsmasq ipset directives → append to deployed dnsmasq.conf; new stage: install `ipset` package |
| `src/scripts/deploy-routes.sh` | After SCP of custom route files: re-generate dnsmasq domain block + restart dnsmasq |
| `src/configs/isp-routes-custom.txt` | Add example domain entries (commented) |
| `src/configs/vpn-routes-custom.txt` | Add example domain entries (commented) |
| `docs/` | Document domain syntax in README.md, README.ru.md, REFERENCE.md |

## Constraints

- **ipset package**: must be installed on RPi (`apt-get install -y ipset`); idempotent
- **dnsmasq ipset support**: Debian bookworm dnsmasq includes ipset support; verify with `dnsmasq --version | grep ipset`
- **ipset persistence**: ipsets are volatile on reboot; routing.sh recreates them on every run (flush-and-rebuild model matches existing D-06)
- **Domain only works for DNS-resolved traffic**: devices using DoH or hardcoded IPs bypass dnsmasq → not covered; acceptable given current arch (all LAN devices use RPi as DNS via Keenetic DHCP)
- **TTL**: ipset entries expire; use `--timeout 0` (no expiry) for routing ipsets — routing table is authoritative, not DNS cache
- **Priority**: domain-based ipset mark overrides CIDR routes in main table (PREROUTING mark + policy table evaluated before main table lookup for forwarded packets); VPN-domains win over ISP-domains if both match (mark 0x2 ip rule has higher priority)
- **Rollback**: `vpn-rollback.sh` must flush ipsets, remove ip rules, remove mangle rules, remove rt_tables entries

## Success Criteria

- [ ] `amazonaws.com` in `isp-routes-custom.txt` → EC2 traffic exits via ISP; verified in `splitgate watch` logs as `[ISP]`
- [ ] `cloudfront.net` in `vpn-routes-custom.txt` → CloudFront traffic exits via VPN; verified as `[VPN]`
- [ ] Existing CIDR entries in both files continue to work unchanged
- [ ] `routing.sh --no-update` recreates ipsets and marks without download
- [ ] After reboot, ipsets and rules are restored by systemd vpn-routing.service (calls routing.sh)
- [ ] `vpn-rollback.sh` cleanly removes all ipset/mangle/rule additions
- [ ] `deploy-routes.sh` fast path (no full deploy) correctly regenerates dnsmasq domain block and restarts dnsmasq

## Open Questions

1. Should domain entries in `vpn-routes-custom.txt` override `isp-routes-custom.txt` domains (like CIDRs do)? → Yes, mark 0x2 ip rule priority 101 > 100.
2. What if dnsmasq on RPi was compiled without ipset support? → deploy.sh should check `dnsmasq --version | grep ipset` and abort with clear error.
3. Should we support wildcard prefix notation (e.g., `*.amazonaws.com`)? → No, dnsmasq ipset suffix match already handles this without `*`.
