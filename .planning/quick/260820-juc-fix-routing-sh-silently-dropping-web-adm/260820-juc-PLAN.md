---
quick_id: 260820-juc
slug: fix-routing-sh-silently-dropping-web-adm
date: 2026-08-20
mode: quick
status: planned
---

# Quick Task 260820-juc — Backend/scripts fixes

Part A of a three-part batch (A: backend/scripts, B: Routes page, C: Logs page).
Design approved in conversation.

## Task 1 — Fix `routing.sh` silently dropping routes with inline descriptions

**Files:** `src/scripts/routing.sh`

**Problem.** The web admin writes route files in inline format
(`splitgate-admin.py:172` `write_routes_with_desc`):

```
2.21.65.0/24 # Akamai
```

`routing.sh` Stages 5, 5b and 5c skip only lines *starting* with `#` and pass the
rest of the line verbatim to `ip route`:

```bash
ip route add "${subnet}" dev "${VPN_IFACE}" 2>/dev/null || true
```

`ip route add "2.21.65.0/24 # Akamai" dev awg0` fails, and the failure is
swallowed by `2>/dev/null || true`. The stage counter is still incremented, so
the summary reports success. Net effect: **any route added through the web admin
with a description is never applied**, while routes without a description work.
Repo-managed `src/configs/*.txt` use the leading-comment format, so the bug never
surfaced via `deploy-routes.sh`.

**Action.**
1. Add a shared helper that normalises a route-file line: strip everything from
   the first `#`, trim surrounding whitespace, return empty for comment-only or
   blank lines.
2. Use it in Stages 5, 5b, 5c. Skip empty results instead of feeding them to
   `ip route`.
3. Stop swallowing failures. Capture `ip route add` stderr; on failure log the
   offending line and the error to `install.log` and increment a per-stage
   `*_FAILED` counter.
4. Surface the failure counters in the Stage 9 summary so a future silent-drop
   regression is visible in `install.log`.
5. Stage 5c also runs `ip route del "${subnet}"` before the add — it must use the
   normalised value too.

**Verify.** `bash -n src/scripts/routing.sh` parses. Extract the normalisation
helper into a scratch harness and assert:
`2.21.65.0/24 # Akamai` → `2.21.65.0/24`; `# comment` → empty;
`  10.0.0.0/8  ` → `10.0.0.0/8`; `1.2.3.0/24` → `1.2.3.0/24`.

**Done.** Route files in either format (inline `cidr # desc` or leading-comment)
produce identical `ip route` calls, and a rejected CIDR is logged rather than
silently counted as applied.

## Task 2 — `routes_dirty`: Apply Changes only when there is something to apply

**Files:** `src/scripts/splitgate-admin.py`

**Problem.** The Routes page `Apply Changes` button is always enabled. Staged
entries are not the whole story: `handleAdd`/`handleEdit`/`handleDelete` write to
the server immediately and need an Apply to take effect, so a frontend-only
staging check would disable the button exactly when it is needed.

**Action.**
1. On a successful `routing.sh` run in `/api/config/apply`, touch
   `/etc/splitgate/.last-apply`.
2. Add a `routes_dirty` field to `_collect_status()`: true when the mtime of
   either `vpn-routes-custom.txt` or `isp-routes-custom.txt` is newer than
   `.last-apply`. Missing `.last-apply` (never applied, or fresh install) counts
   as dirty. Missing route files contribute nothing.
3. Keep it cheap — `os.stat` only, no file reads. `/api/status` is polled.

**Verify.** `python3 -m py_compile src/scripts/splitgate-admin.py`. Reason
through the three states: never applied → dirty; applied then edited → dirty;
applied with no later edit → clean.

**Done.** `/api/status` reports `routes_dirty`, and the flag survives a browser
reload and also catches route edits made outside the web admin (e.g. via
`deploy-routes.sh`).

## Task 3 — Honest log-history cap

**Files:** `src/scripts/splitgate-admin.py`

**Problem.** `/api/logs/history` calls `tail_file(log_path, n=5000)` per day and
returns only the truncated tail. The UI renders `5000 / 5000 lines` as if that
were the complete result, so a busy day looks like a small one.

**Action.**
1. Raise the per-day cap to 50000 lines.
2. Have the endpoint report the real per-day line total alongside the returned
   lines: `{lines, count, total, truncated}` where `total` is the true number of
   lines across the requested days and `truncated` is `total > count`.
3. Count lines without holding a second full copy in memory.

**Verify.** `python3 -m py_compile src/scripts/splitgate-admin.py`. Build a
scratch log file larger than the cap and confirm `count < total` with
`truncated: true`; a small file yields `count == total`, `truncated: false`.

**Done.** The endpoint tells the client whether it is looking at a complete day
or a tail, which Part C consumes to render an honest counter.

## Out of scope

- Frontend consumption of `routes_dirty` and `truncated` — Parts B and C.
- Deploying to the RPi. `src/deploy.sh` / `src/deploy-admin.sh` are unchanged;
  the operator runs them.

## Notes

- CLAUDE.md: repo artifacts in English, no `Co-Authored-By` line, `git push`
  after every commit.
- Docs (`README.md`, `docs/README.ru.md`, `docs/REFERENCE.md`) are reviewed at
  the end of Part C, once the whole batch is in.
