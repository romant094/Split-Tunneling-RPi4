---
status: partial
phase: 05-custom-route-exceptions-ip
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md]
started: 2026-05-21T15:00:00Z
updated: 2026-05-21T15:00:00Z
---

## Current Test

[testing paused — 9 items blocked (SSH unavailable)]

## Tests

### 1. routing.sh uses /etc/white-list.txt (not /etc/vpn-ru-subnets.txt)
expected: |
  After deploy, run sudo /etc/routing.sh then ls -la /etc/white-list.txt.
  Stage 9 summary shows "White list:" count, not "Subnets:". No errors.
result: blocked
blocked_by: server
reason: "SSH to pi4 (192.168.1.254:22) timed out — deploy.sh failed at Stage 3. RPi responds to ping but SSH is unavailable."

### 2. Stage 5b: absent exception file skips silently
expected: |
  sudo rm -f /etc/white-list-extended.txt; sudo /etc/routing.sh — completes without
  error, Stage 5b logs a skip message.
result: blocked
blocked_by: server
reason: "SSH to pi4 timed out — cannot run routing.sh remotely."

### 3. Stage 5b: CIDRs in exception file route via ISP
expected: |
  echo "203.0.113.0/24" | sudo tee /etc/white-list-extended.txt; sudo /etc/routing.sh
  ip route show table main | grep 203.0.113.0 shows a route via KEENETIC_GW.
  Stage 9 summary shows "Exceptions: 1 routes via <KEENETIC_GW>".
result: blocked
blocked_by: server
reason: "SSH to pi4 timed out."

### 4. Rollback removes /etc/white-list-extended.txt
expected: |
  sudo /etc/vpn-rollback.sh — then ls /etc/white-list-extended.txt returns exit 1.
  Rollback summary mentions exception file removal.
result: blocked
blocked_by: server
reason: "SSH to pi4 timed out."

### 5. vpn-status.sh --via=vpn shows only VPN-routed connections
expected: |
  sudo /etc/vpn-status.sh --via=vpn — only VPN rows in output. No ISP rows.
result: blocked
blocked_by: server
reason: "SSH to pi4 timed out."

### 6. vpn-status.sh --via=isp shows only ISP-routed connections
expected: |
  sudo /etc/vpn-status.sh --via=isp — only ISP rows. No VPN rows.
result: blocked
blocked_by: server
reason: "SSH to pi4 timed out."

### 7. --via validation rejects bad values
expected: |
  sudo /etc/vpn-status.sh --via=foo — exits 1 with error mentioning valid values.
result: blocked
blocked_by: server
reason: "SSH to pi4 timed out."

### 8. deploy.sh skips Stage 21 when no local exception file
expected: |
  ./deploy.sh without configs/white-list-extended.txt — Stage 21 logs skip message, no error.
result: blocked
blocked_by: server
reason: "SSH to pi4 timed out at Stage 3 — deploy.sh cannot reach RPi."

### 9. deploy.sh Stage 21 deploys exception file when present
expected: |
  Create configs/white-list-extended.txt, run ./deploy.sh — Stage 21 SCPs file to RPi.
  /etc/white-list-extended.txt exists on RPi after deploy.
result: blocked
blocked_by: server
reason: "SSH to pi4 timed out."

### 10. gitignore: example file tracked, real file ignored
expected: |
  Locally run:
    git check-ignore -v configs/white-list-extended.txt
    git check-ignore -v configs/white-list-extended.txt.example
  Expected:
  - First command: prints .gitignore rule (file IS ignored)
  - Second command: no output / exit code 1 (file is NOT ignored — it's committed)
result: pass

## Summary

total: 10
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 9

## Gaps

[none yet]
