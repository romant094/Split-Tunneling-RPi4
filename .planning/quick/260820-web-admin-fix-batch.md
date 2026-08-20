# Web Admin Fix Batch — 2026-08-20

Roll-up over four quick tasks plus one out-of-band deploy fix, all shipped in one
session. Individual plans and summaries live in the per-task directories; this
file is the index and the record of what is still open.

| Task | Scope | Artifacts |
|---|---|---|
| `260820-juc` | Backend and scripts | [dir](./260820-juc-fix-routing-sh-silently-dropping-web-adm/) |
| `260820-k3a` | Routes page | [dir](./260820-k3a-routes-page-checkbox-batch-delete-gate-a/) |
| `260820-kcg` | Logs page | [dir](./260820-kcg-logs-page-context-menu-acts-on-selection/) |
| `260820-lo0` | Logs selection ergonomics, two UI bugs, CIDR validation | [dir](./260820-lo0-logs-page-row-checkboxes-in-select-mode-/) |
| — | Deploy no longer clobbers device route files | commit `afdae1c` |

## The bug that started it

Routes added through the web admin **with a description** were never applied.

`splitgate-admin.py` `write_routes_with_desc` writes inline format
(`2.21.65.0/24 # Akamai`). `routing.sh` Stages 5/5b/5c skipped only lines
*starting* with `#` and passed the rest verbatim to `ip route`, so the call became
`ip route add "2.21.65.0/24 # Akamai" dev awg0` — rejected by iproute2, silenced
by `2>/dev/null || true`, and still counted in the stage total, so the log
reported success. Routes without a description worked, and the repo-managed
`src/configs/*.txt` use the leading-comment format, so nothing broke via
`deploy-routes.sh` and the bug stayed invisible for as long as it existed.

Fixed by `normalize_route_line()` (both formats now produce identical `ip route`
calls) and `add_route()` (logs the rejected CIDR and the iproute2 error to
`install.log`, with per-stage failure counters in the Stage 9 summary).

Verified on the device: 68 VPN-force routes applied, and the single remaining
rejection turned out to be unrelated bad data — see below.

## Second-order bug the fix exposed

With failures no longer swallowed, the device log showed one rejection every run:
`ip route add 172.217.20.0/16 ... Invalid prefix for given prefix length`. `/16`
requires zero host bits, so that prefix can never be installed — and **both
validators had accepted it**: the backend used
`ipaddress.IPv4Network(strict=False)`, the frontend checked only octet and prefix
ranges. The admin allowed adding a route that could never work, and the failure
landed on the RPi where nobody looks. Same shape of problem as the original bug.

Now `strict=True` on the backend, matching `networkAddress()`/`cidrError()` on the
frontend, and rejections name the intended network (`Did you mean
172.217.0.0/16?`) rather than saying "invalid CIDR".

## Third-order bug, found while diagnosing

`deploy.sh` replaced `/etc/splitgate/{isp,vpn}-routes-custom.txt` with the
`src/configs/` copies unconditionally and silently. Routes added through the web
admin exist only on the device, so a full deploy destroyed them — which is exactly
what happened during this session: the device went from 129/14 route lines to
84/13, and the loss was unrecoverable from the repo.

`deploy.sh` now preserves an existing remote route file and reports its route
count; `--force-routes` opts into the replacement and takes a timestamped `.bak`
on the device first. `deploy-routes.sh` still pushes by design but backs up first,
prints route counts before and after, and warns when the local file has fewer
routes than the device. `--keep-remote` skips the push.

## Everything else shipped

**Routes page** — checkbox column with batch delete (sequential DELETEs; each
rewrites the whole file server-side); Apply Changes gated on real pending work via
the new `routes_dirty` flag (`.last-apply` stamped by `routing.sh` Stage 8b, so
cron and boot-time applies count too); Fill Descriptions asks for scope instead of
silently filling only the empty ones; the table scrolls inside its own block with
a sticky header.

**Logs page** — exclude filters (include ANDs, exclude ORs, applied before
dedupe); Copy of the filtered lines as raw text; the context menu acts on the
selection when the right-clicked row is part of it, and flips above the cursor
rather than opening off-screen; row checkboxes in select mode with a tri-state
Select all; `Add all` as the single add path, switching to the selection when
there is one; `Apply immediately` preference that writes and activates straight
away; virtualized rendering; honest truncation counter fed by the raised
50000-line-per-day cap.

**Shared** — `routeApply.js` owns flush-then-apply for both the Routes Apply
button and the Logs immediate path, extracted rather than duplicated because the
ordering rules are easy to get subtly wrong.

## Open items

1. **Strict CIDR validation blocks fixing existing bad data.** `DELETE` and the
   `old_cidr` half of `PUT` are *lookups*, not new input, but both run
   `is_valid_cidr`. Any invalid route already in a file therefore cannot be
   deleted or renamed through the admin — the request is rejected before the file
   is ever read. Encountered live: `172.217.20.0/16` was undeletable and had to be
   fixed by hand on the device. The fix is a lenient `is_cidr_ref()` for
   identifier positions; it was prepared and **not applied** at the user's
   request.

2. **Two sources of truth for route files.** `src/configs/*.txt` and the device's
   `/etc/splitgate/*.txt` diverge the moment a route is added through the admin,
   and nothing reconciles them. The deploy fix removes the silent data loss but
   not the divergence. A real fix would have `deploy-routes.sh` pull the device
   state and merge. Documented as a hazard in `REFERENCE.md`.

3. **Nothing in this batch was verified in a browser.** The Chrome extension was
   not connected for this session, including for a delegated agent, so every UI
   change is backed by lint and build only. A stub API server on the production
   bundle was prepared for the purpose and could not be driven. Layout-sensitive
   spots worth a look: the sticky row checkbox in the log box, the flipped context
   menu on the bottom row, the `Add all` Popover placement, and the sticky table
   header inside a scrolling container.

4. **`package.json` is gitignored** (`/package.json`), so the deploy script
   changes are local only and absent on any other machine.

5. **`deploy:force-routes` in `package.json`** was hand-edited to
   `npm run build:admin && npm run deploy-routes`, which builds the admin UI and
   then does not deploy it — `deploy-routes.sh` only touches route files. Likely
   intended `./src/deploy.sh --force-routes`. Also `deploy-routes.sh` has no
   `--force-routes` flag and silently ignores it; it works only because pushing is
   already the default.

6. **"Apply Changes inactive after staging from Logs" never reproduced.** On the
   current build the Routes page shows Pending changes and the button is enabled.
   The gating logic was traced line by line without finding a defect; the likely
   explanation is an older frontend deployed at the time of the report. Recorded
   as unresolved rather than fixed.

## Commits

```
4fcb304 fix(260820-juc): apply routes written in inline 'cidr # desc' format
26774a8 feat(260820-juc): expose routes_dirty so Apply Changes can be gated
2a2c4dd feat(260820-juc): report the real line total from /api/logs/history
bc30e48 docs(quick-260820-juc): plan, summary and state
1881cec feat(260820-k3a): add checkbox batch delete to the Routes table
882bd52 feat(260820-k3a): enable Apply Changes only when something is pending
e8720c9 feat(260820-k3a): let Fill Descriptions ask which routes to fill
e5cc82b docs(quick-260820-k3a): plan, summary and state
4af6053 fix(260820-kcg): make the log context menu act on the selection
671c81f feat(260820-kcg): add exclude filters to the Logs page
97ff1ac feat(260820-kcg): add Copy to the Logs toolbars
a52b87f perf(260820-kcg): virtualize the log view and report truncation honestly
600b663 docs(260820-kcg): document the batch's behaviour changes
0127214 docs(quick-260820-kcg): plan, summary and state
b2aab44 docs(phase-16): commit the phase 16 code-review artifact
6c8a969 chore: gitignore .DS_Store
a6ddb82 fix(260820-lo0): highlight Watch Live at /logs, scroll the Routes table
561f0d1 feat(260820-lo0): add-all dropdown and Select All as a tri-state checkbox
afc5a5b feat(260820-lo0): Apply immediately option for staging from the Logs page
53c500e docs(260820-lo0): document Add all, Apply immediately and layout fixes
c1122ed docs(quick-260820-lo0): plan, summary and state
c2ff15a fix(260820-lo0): reject CIDRs with host bits set, rework the Logs toolbar
7e674e2 docs(260820-lo0): document CIDR host-bit validation and toolbar layout
afdae1c fix(deploy): stop overwriting device custom-route files by default
```
