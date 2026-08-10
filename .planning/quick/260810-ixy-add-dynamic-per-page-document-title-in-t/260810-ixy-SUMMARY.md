---
status: complete
---

# Quick Task 260810-ixy: Add dynamic per-page document.title in the admin SPA — Summary

**Tasks:** 2/2 complete

## Commits

- `996d838`: feat(260810-ixy): add pure page-title map and useDocumentTitle hook
- `60ac5dd`: feat(260810-ixy): wire RouteTitle into App.jsx and title the login screen

## What was built

- `src/admin/src/lib/pageTitles.js` (new) — pure, dependency-free route → title map + `titleForPath()` resolver.
- `src/admin/src/hooks/useDocumentTitle.js` (new) — `useDocumentTitle(title)` hook + `RouteTitle` null-rendering component that reads `useLocation()`.
- `src/admin/src/App.jsx` (modified) — mounts `<RouteTitle />` inside `<HashRouter>`; `LoginForm` calls the hook directly for its own title (HashRouter is unmounted on the login/checking screens).

## Notes

- `docs/README.ru.md`/`docs/REFERENCE.md` did not mention title behavior — no doc updates needed.
- `src/admin/dist/` is gitignored (pre-existing) — not rebuilt/committed here; rebuilt at deploy time by `deploy-admin.sh`.
- Verified via `npm run build` (succeeds) and `oxlint` (0 errors, pre-existing warnings only).
