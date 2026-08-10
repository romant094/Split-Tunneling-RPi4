---
phase: quick-260810-ixy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/admin/src/lib/pageTitles.js
  - src/admin/src/hooks/useDocumentTitle.js
  - src/admin/src/App.jsx
autonomous: true
requirements: [QUICK-260810-IXY]

must_haves:
  truths:
    - "Navigating to Dashboard shows browser tab title 'Dashboard — Splitgate'"
    - "Each top-level page (Services, Routes, Logs, Diagnostics, Config, Settings) shows its own distinct tab title"
    - "Each Logs sub-route (live, history, install, errors, journal) shows a distinct tab title"
    - "The login screen shows a title distinct from the authenticated pages"
    - "Title logic lives in one shared module — no per-page document.title assignments"
  artifacts:
    - path: "src/admin/src/lib/pageTitles.js"
      provides: "Pure route-path → page title map and titleForPath() resolver"
      exports: ["PAGE_TITLES", "APP_NAME", "titleForPath"]
    - path: "src/admin/src/hooks/useDocumentTitle.js"
      provides: "useDocumentTitle(title) hook + RouteTitle component driven by useLocation"
      exports: ["useDocumentTitle", "RouteTitle"]
    - path: "src/admin/src/App.jsx"
      provides: "RouteTitle mounted inside HashRouter; login screen title"
      contains: "RouteTitle"
  key_links:
    - from: "src/admin/src/hooks/useDocumentTitle.js"
      to: "src/admin/src/lib/pageTitles.js"
      via: "import { titleForPath }"
      pattern: "titleForPath"
    - from: "src/admin/src/App.jsx"
      to: "src/admin/src/hooks/useDocumentTitle.js"
      via: "import { useDocumentTitle, RouteTitle }"
      pattern: "hooks/useDocumentTitle"
---

<objective>
Replace the single static `<title>Splitgate — VPN Gateway Admin</title>` with dynamic per-page document titles in the admin SPA.

Purpose: The admin UI is a HashRouter SPA where every route currently renders the same browser tab title, making multiple open tabs and browser history indistinguishable.
Output: One pure title-map module, one reusable hook + `RouteTitle` component, and a three-line wiring change in `App.jsx`. No per-page edits.
</objective>

<execution_context>
@/Users/antonromankov/Projects/my-projects/split-tunneling-v2/.claude/get-shit-done/workflows/execute-plan.md
@/Users/antonromankov/Projects/my-projects/split-tunneling-v2/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/admin/src/App.jsx
@src/admin/index.html

<interfaces>
<!-- Existing route table in src/admin/src/App.jsx (HashRouter). Titles must cover every path below. -->

/                    -> Dashboard
/services            -> Services
/routes              -> RoutesPage
/logs                -> LogsLayout
  index              -> LogsLive
  /logs/live         -> LogsLive
  /logs/history      -> LogsHistory
  /logs/install      -> LogsInstall
  /logs/errors       -> LogsErrors
  /logs/journal      -> LogsJournal
/diagnostics         -> Diagnostics
/config              -> Config
/settings            -> Settings

<!-- Existing sibling module conventions: src/admin/src/hooks/useTheme.js (hook), src/admin/src/lib/utils.js (pure helper). -->
<!-- Auth gating in App.jsx: authState is 'checking' | 'out' | 'in'. HashRouter is only mounted when authState === 'in'. -->
<!-- Therefore useLocation() is unavailable on the login/checking screens — those set their title directly via useDocumentTitle(). -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add pure page-title map and useDocumentTitle hook</name>
  <files>src/admin/src/lib/pageTitles.js, src/admin/src/hooks/useDocumentTitle.js</files>
  <behavior>
    - titleForPath('/') === 'Dashboard — Splitgate'
    - titleForPath('/services') === 'Services — Splitgate'
    - titleForPath('/routes') === 'Routes — Splitgate'
    - titleForPath('/logs') === 'Logs · Live — Splitgate'
    - titleForPath('/logs/history') === 'Logs · History — Splitgate'
    - titleForPath('/logs/journal') === 'Logs · Journal — Splitgate'
    - titleForPath('/diagnostics') === 'Diagnostics — Splitgate'
    - titleForPath('/config') === 'Config — Splitgate'
    - titleForPath('/settings') === 'Settings — Splitgate'
    - Trailing slash tolerated: titleForPath('/services/') === titleForPath('/services')
    - Unknown path falls back to the plain app title: titleForPath('/nope') === 'Splitgate — VPN Gateway Admin'
  </behavior>
  <action>
Create `src/admin/src/lib/pageTitles.js` as a dependency-free ES module (no React import — it must be importable by plain `node --input-type=module`). Export:
- `APP_NAME` = the string `Splitgate`
- `FALLBACK_TITLE` = the string `Splitgate — VPN Gateway Admin` (matches the static title currently in `src/admin/index.html`, used for unknown paths)
- `PAGE_TITLES` — a plain object mapping every route path listed in the `<interfaces>` block to its page label. Use `Dashboard`, `Services`, `Routes`, `Diagnostics`, `Config`, `Settings` for top-level pages; use `Logs · Live`, `Logs · History`, `Logs · Install`, `Logs · Errors`, `Logs · Journal` for the Logs sub-routes. Map bare `/logs` to the same label as `/logs/live` because the Logs index route renders `LogsLive`.
- `titleForPath(pathname)` — normalizes the input (coerce nullish to `/`, strip a single trailing slash unless the path is exactly `/`), looks up `PAGE_TITLES`, and returns `` `${label} — ${APP_NAME}` `` on hit or `FALLBACK_TITLE` on miss. Use the em dash `—` (U+2014) as separator and the middle dot `·` (U+00B7) inside the Logs labels, matching the existing static title style.

Create `src/admin/src/hooks/useDocumentTitle.js` following the module style of the sibling `src/admin/src/hooks/useTheme.js`. Export:
- `useDocumentTitle(title)` — a hook that assigns `document.title = title` inside a `useEffect` keyed on `title`. No cleanup/restore (the SPA always owns the title).
- `RouteTitle` — a component that calls `useLocation()` from `react-router-dom`, derives the title via `titleForPath(location.pathname)`, passes it to `useDocumentTitle`, and returns `null`. It renders nothing; it exists purely so the hook can run inside the Router context.

Do not add any `document.title` assignment to page components under `src/admin/src/pages/`.
  </action>
  <verify>
    <automated>cd src/admin && node --input-type=module -e "import {titleForPath as t} from './src/lib/pageTitles.js'; const c=[['/','Dashboard — Splitgate'],['/services','Services — Splitgate'],['/services/','Services — Splitgate'],['/routes','Routes — Splitgate'],['/logs','Logs · Live — Splitgate'],['/logs/live','Logs · Live — Splitgate'],['/logs/history','Logs · History — Splitgate'],['/logs/install','Logs · Install — Splitgate'],['/logs/errors','Logs · Errors — Splitgate'],['/logs/journal','Logs · Journal — Splitgate'],['/diagnostics','Diagnostics — Splitgate'],['/config','Config — Splitgate'],['/settings','Settings — Splitgate'],['/nope','Splitgate — VPN Gateway Admin']]; let bad=0; for(const [p,e] of c){const a=t(p); if(a!==e){console.error('FAIL',p,'got',JSON.stringify(a),'want',JSON.stringify(e));bad++;}} if(bad) process.exit(1); console.log('OK', c.length, 'cases');"</automated>
  </verify>
  <done>`node` assertion script prints `OK 14 cases` and exits 0; `src/admin/src/hooks/useDocumentTitle.js` exports both `useDocumentTitle` and `RouteTitle`; no `document.title` string exists under `src/admin/src/pages/`.</done>
</task>

<task type="auto">
  <name>Task 2: Wire RouteTitle into App.jsx and title the login screen</name>
  <files>src/admin/src/App.jsx</files>
  <action>
In `src/admin/src/App.jsx`:
1. Add `import { useDocumentTitle, RouteTitle } from './hooks/useDocumentTitle'` alongside the existing local imports, and add `useLocation` is NOT needed here — `RouteTitle` owns it.
2. Inside the authenticated tree, render `<RouteTitle />` as the first child inside `<HashRouter>` (before the outer `<div className="min-h-screen flex flex-col">`), so it is inside Router context and runs on every navigation including the Logs sub-routes.
3. In `LoginForm`, call `useDocumentTitle('Sign in — Splitgate')` at the top of the component body so the unauthenticated screen has its own title (HashRouter is not mounted at that point, so the map cannot be used).
4. In the `authState === 'checking'` branch of `App`, the title stays as the `index.html` fallback — do not add a hook call there, because hooks must not be added conditionally after the early return. Leave `src/admin/index.html` `<title>` unchanged as the pre-hydration fallback.

Do not modify any file under `src/admin/src/pages/`. Do not introduce a router-level `handle`/loader-based title mechanism — `RouteTitle` + the path map is the whole mechanism.
  </action>
  <verify>
    <automated>cd src/admin && grep -q "hooks/useDocumentTitle" src/App.jsx 2>/dev/null; grep -c "RouteTitle" src/App.jsx && grep -q "useDocumentTitle('Sign in — Splitgate')" src/App.jsx && npm run lint && npm run build</automated>
  </verify>
  <done>`npm run lint` reports no errors, `npm run build` succeeds, `<RouteTitle />` appears inside `<HashRouter>` in `src/admin/src/App.jsx`, and `LoginForm` calls `useDocumentTitle` with the sign-in title.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| URL hash → SPA router | User-controlled `location.hash` reaches `titleForPath` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ixy-01 | Tampering | `titleForPath(pathname)` | mitigate | Titles are read from a fixed `PAGE_TITLES` allowlist; unknown paths return `FALLBACK_TITLE`. Attacker-controlled path text is never concatenated into `document.title`. |
| T-ixy-02 | Information disclosure | `document.title` | accept | Titles contain only static page names — no tokens, hostnames, or secrets. |
| T-ixy-SC | Tampering | npm/pip/cargo installs | accept | No new dependencies added; `react`, `react-dom`, `react-router-dom` already present in `src/admin/package.json`. |
</threat_model>

<verification>
1. `cd src/admin && npm run lint` — clean.
2. `cd src/admin && npm run build` — succeeds, `dist/` regenerated.
3. `cd src/admin && npm run dev`, then visit `#/`, `#/services`, `#/routes`, `#/logs/live`, `#/logs/history`, `#/logs/install`, `#/logs/errors`, `#/logs/journal`, `#/diagnostics`, `#/config`, `#/settings` — each browser tab title differs and matches `{Page Name} — Splitgate`.
4. `grep -rn "document.title" src/admin/src` returns exactly one hit, in `src/admin/src/hooks/useDocumentTitle.js`.
</verification>

<success_criteria>
- Every route in the admin SPA (including all five Logs sub-routes) sets a distinct `document.title` of the form `{Page Name} — Splitgate`.
- Title logic exists in exactly two new files; `App.jsx` is the only modified existing file; zero page components touched.
- `npm run lint` and `npm run build` both pass.
- Unknown/garbage hash paths fall back to `Splitgate — VPN Gateway Admin` rather than rendering user-controlled text.
</success_criteria>

<output>
Create `.planning/quick/260810-ixy-add-dynamic-per-page-document-title-in-t/260810-ixy-SUMMARY.md` when done.

Per CLAUDE.md conventions: after implementation, grep the repo for stale references and check whether `README.md`, `docs/README.ru.md`, `docs/REFERENCE.md` document the admin UI title behavior — update only if they do.
</output>
