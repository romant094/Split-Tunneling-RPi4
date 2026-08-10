---
phase: quick-260810-izt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/admin/src/pages/Logs.jsx
autonomous: true
requirements: [QUICK-260810-IZT]

must_haves:
  truths:
    - "In Logs multi-select mode, clicking the Select All control selects every currently visible log line (post-filter/post-dedupe)"
    - "Clicking the control again when all visible lines are already selected deselects all of them"
    - "The control's label/state reflects current selection state (Select All vs Deselect All)"
    - "After Select All, 'Add N to ISP'/'Add N to VPN' stages exactly the deduped CIDRs extracted from all visible lines"
    - "Select All behaves identically on both the Watch Live tab and the Historical Logs tab"
    - "Changing filters or toggling Hide duplicates while in select mode does not retroactively add/remove selections — Select All only acts at click time on the then-visible set"
  artifacts:
    - path: "src/admin/src/pages/Logs.jsx"
      provides: "selectAll toggle added to useSelection hook and SelectionBar, wired into LogsLive and LogsHistory"
      contains: "selectAll"
  key_links:
    - from: "SelectionBar"
      to: "useSelection.selectAll"
      via: "onToggleAll prop invoked with the page's current `visible` lines array"
      pattern: "onToggleAll"
    - from: "LogsLive / LogsHistory"
      to: "SelectionBar"
      via: "allSelected + onToggleAll props derived from `visible`"
      pattern: "allSelected"
---

<objective>
Add a "Select All" control to the Logs page multi-select toolbar (Watch Live and Historical tabs) that selects/deselects every currently visible log row in one click, using the existing `useSelection` state — no parallel selection mechanism.

Purpose: Multi-select mode (added in phase 16 plan 07) currently requires clicking every row individually before batch-adding to ISP/VPN. Bulk-selecting all visible rows removes that friction for the common case of "stage everything I'm currently looking at."
Output: `useSelection` hook gains a `selectAll` toggle; `SelectionBar` gains a Select All / Deselect All button; both `LogsLive` and `LogsHistory` wire it to their own `visible` (filtered + deduped) line arrays.
</objective>

<execution_context>
@/Users/antonromankov/Projects/my-projects/split-tunneling-v2/.claude/get-shit-done/workflows/execute-plan.md
@/Users/antonromankov/Projects/my-projects/split-tunneling-v2/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/admin/src/pages/Logs.jsx

<interfaces>
<!-- Current state of src/admin/src/pages/Logs.jsx (read in full before editing). Key existing pieces this plan builds on: -->

useSelection() (component-local hook, ~line 201):
```
function useSelection() {
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  function toggle(line) { ... }
  function clear() { setSelected(new Set()) }
  function exit() { setSelectMode(false); clear() }
  return { selectMode, setSelectMode, selected, toggle, clear, exit }
}
```

SelectionBar({ selectMode, onEnter, count, onClear, onAddIsp, onAddVpn }) (~line 231):
renders a plain "Select" button when `!selectMode`; when `selectMode` is true renders
"{count} selected" + "Add {count} to ISP" + "Add {count} to VPN" + "Clear selection".

LogsLive (~line 373): `const { selectMode, setSelectMode, selected, toggle, clear, exit } = useSelection()`.
`filtered = applyFilters(liveLines, filters)`; `visible = dedupe ? dedupeLines(filtered) : filtered`.
Renders `<SelectionBar selectMode={selectMode} onEnter={() => setSelectMode(true)} count={selected.size} onClear={exit} onAddIsp={...} onAddVpn={...} />` then `<LogBox lines={visible} ... selected={selected} onToggleSelect={toggle} .../>`.

LogsHistory (~line 436): same shape — `const { selectMode, setSelectMode, selected, toggle, exit } = useSelection()`
(note: does NOT currently destructure `clear`), same `filtered`/`visible` derivation, same `<SelectionBar>` usage gated behind `histLines.length > 0`.

`selected` is a `Set` of raw line strings (the same strings that appear in `lines`/`visible`), because `LogBox` keys selection membership by exact line text (`selected.has(line)`), not by index or id. `selectAll` must therefore populate `selected` with the exact strings from the passed-in `visible` array, not indices.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add selectAll toggle to useSelection and Select All button to SelectionBar</name>
  <files>src/admin/src/pages/Logs.jsx</files>
  <action>
In the `useSelection()` hook, add a `selectAll(lines)` function: if every entry in `lines` is already present in `selected` AND `lines.length > 0`, call `setSelected(new Set())` (deselect all); otherwise call `setSelected(new Set(lines))` (select all — replaces any partial/prior selection with exactly the passed-in visible set). Add `selectAll` to the hook's return object. Do not change `toggle`, `clear`, or `exit`.

In `SelectionBar`, add two new props: `total` (number of currently visible lines) and `onToggleAll` (callback, no args — caller closes over its own `visible` array). Compute `allSelected = total > 0 && count === total` inside the component. When `selectMode` is true, render a new button before the ISP/VPN buttons: label `allSelected ? 'Deselect All' : \`Select All (${total})\`'`, `size="sm"` `variant="outline"` `className="h-8"`, `disabled={total === 0}`, `onClick={onToggleAll}`. Keep the existing "{count} selected" span, Add-to-ISP/VPN buttons, and "Clear selection" button unchanged and in their current relative order (Select All button goes immediately after the "{count} selected" span, before "Add {count} to ISP").
  </action>
  <verify>
    <automated>cd src/admin && grep -n "selectAll" src/pages/Logs.jsx | grep -v '^$' | wc -l | grep -qv '^0$' && grep -c "Select All" src/pages/Logs.jsx</automated>
  </verify>
  <done>`useSelection` returns a working `selectAll(lines)` toggle; `SelectionBar` accepts `total`/`onToggleAll` and renders a "Select All (N)" / "Deselect All" button between the count and the Add-to-ISP button whenever `selectMode` is true.</done>
</task>

<task type="auto">
  <name>Task 2: Wire Select All into LogsLive and LogsHistory</name>
  <files>src/admin/src/pages/Logs.jsx</files>
  <action>
In `LogsLive`, destructure `selectAll` from `useSelection()` alongside the existing fields. Pass `total={visible.length}` and `onToggleAll={() => selectAll(visible)}` to its `<SelectionBar>` call (in addition to the existing props).

In `LogsHistory`, destructure `selectAll` from `useSelection()` alongside the existing fields (it currently omits `clear` — leave that as-is, just add `selectAll`). Pass `total={visible.length}` and `onToggleAll={() => selectAll(visible)}` to its `<SelectionBar>` call.

Do not modify `LogBox`, `LogContextMenu`, `useStageActions`, `selectedToEntries`, `FilterBar`, or any of the static-log sub-pages (`LogsInstall`/`LogsErrors`/`LogsJournal`) — they are unaffected by multi-select.
  </action>
  <verify>
    <automated>cd src/admin && npm run lint && npm run build</automated>
  </verify>
  <done>`npm run lint` reports no errors, `npm run build` succeeds, and both `LogsLive` and `LogsHistory` pass `total`/`onToggleAll` to `SelectionBar` using their own `visible` arrays.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Rendered log lines → selection Set | Log line text (server-sourced, displayed as-is) becomes the Set membership key for staging into route lists |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-izt-01 | Tampering | `selectAll(lines)` | accept | Reuses the existing `selected` Set and `selectedToEntries`/`extractCidr` extraction path unchanged — no new parsing surface; a malicious log line was already reachable via manual click-to-select before this change. |
| T-izt-02 | Denial of Service | `selectAll` on very large visible sets | accept | Bounded by the same in-memory line arrays already rendered by `LogBox`; no new unbounded operation introduced (Set construction is O(n) over data already in the DOM). |
| T-izt-SC | Tampering | npm/pip/cargo installs | accept | No new dependencies added — reuses existing `Button` component and native state. |
</threat_model>

<verification>
1. `cd src/admin && npm run lint` — clean.
2. `cd src/admin && npm run build` — succeeds.
3. `cd src/admin && npm run dev`, visit `#/logs/live`, click Select, then Select All (N) — every visible row highlights and the button flips to "Deselect All"; click again — all rows deselect and button reverts to "Select All (N)".
4. On `#/logs/live`, apply a filter, click Select then Select All — only the currently filtered/deduped rows get selected (verify `visible.length` matches count shown).
5. Repeat steps 3-4 on `#/logs/history` after loading a date range.
6. With all rows selected, click "Add {count} to ISP" — Routes page staging area receives exactly the deduped CIDRs from all visible lines.
</verification>

<success_criteria>
- A Select All control exists in the multi-select toolbar on both Watch Live and Historical Logs tabs.
- One click selects every currently visible (filtered + deduped) log row; a second click deselects all.
- Button state accurately reflects whether all visible rows are currently selected.
- No parallel selection mechanism introduced — `selected` Set and existing `toggle`/`clear`/`exit`/staging logic remain the single source of truth.
- `npm run lint` and `npm run build` both pass.
</success_criteria>

<output>
Create `.planning/quick/260810-izt-add-select-all-control-to-logs-page-mult/260810-izt-SUMMARY.md` when done.

Per CLAUDE.md conventions: after implementation, grep the repo for stale references and check whether `README.md`, `docs/README.ru.md`, `docs/REFERENCE.md` document the Logs multi-select toolbar. Update only if they do (phase 16-07 SUMMARY should indicate whether they were touched).
</output>
