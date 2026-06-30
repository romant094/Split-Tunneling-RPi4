# Phase 15: Web Admin Interface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-30
**Phase:** 15-web-admin-interface
**Areas discussed:** Scope expansion, System control granularity, Log scope, UI layout, Frontend technology, Repo structure, Secrets scope, Services list

---

## Scope Expansion (user intent)

User stated they want a "полноценную админку" — a complete admin interface to manage the entire system. This expands beyond the original 4-plan DRAFT which covered routes, logs, status, config. The existing 4 DRAFT plans are superseded by this context.

**User's choice:** Expand scope significantly — services control, full logs, settings/secrets editing, commands visualization
**Notes:** User said "все команды, которые сейчас есть у меня — хочу, чтобы они были визуализированы в виде интерфейса на отдельной странице. Для каждой команды отдельная страница."

---

## System Control Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Restart all at once | One button for entire stack | |
| Individual service controls | Per-service start/stop/restart | ✓ |
| Named action buttons | "Apply Routes", "Restart VPN" etc. | |

**User's choice:** Individual service controls — separate page listing all services with three buttons each
**Notes:** User specified exact button state logic — Stop disabled when inactive, Start disabled when active, Restart disabled when inactive (only available when service is running).

---

## Log Scope

| Option | Selected |
|--------|----------|
| watch-routes live stream | ✓ |
| install.log | ✓ |
| systemd journal | ✓ |
| watch-error.log | ✓ |

**User's choice:** All logs
**Notes:** "Мне нужны абсолютно все логи, которые сейчас пишет система. Нужно будет сделать отдельный раздел с логами и там сделать подразделы." Some real-time (watch stream), some static with refresh.

---

## UI Layout for Service Controls

| Option | Description | Selected |
|--------|-------------|----------|
| On Status tab | Cards + restart buttons underneath | |
| Separate "System" tab | 5th tab for system operations | |
| Modal buttons | Floating action bar | |

**User's choice:** Separate page, in Settings area
**Notes:** "Давай куда-нибудь в настройки, сделаем там отдельную страницу для этого." — Services page is a distinct top-level route in the SPA.

---

## Frontend Technology

| Option | Description | Selected |
|--------|-------------|----------|
| Vanilla JS SPA | No build step, hash routing | |
| React + Vite (build step) | Build locally, commit dist | ✓ |
| Inline HTML in Python | Embedded string in Flask file | |

**User's choice:** React + Vite
**Notes:** "Сделаем на реакте, сбилдить не проблема. Это будет один раз разработанная админка и она будет сбилжена и просто лежать в репозитории. Сам дистрибутив уже будет включать готовый билд."

---

## Repo Structure

| Option | Selected |
|--------|----------|
| src/admin/ + src/admin/dist/ | ✓ |
| admin/ (repo root) + admin/dist/ | |
| web/ + web/dist/ | |

**User's choice:** `src/admin/`
**Notes:** User added deploy logic requirement: "Когда будем деплоить, проверяем, есть ли папка src/admin/dist. Если есть — деплоим как обычно. Если нет — деплоим без админки."

---

## Secrets Scope in Settings

| Option | Description | Selected |
|--------|-------------|----------|
| .env only (non-secrets) | Safe vars only | |
| .env + .env.secrets (VPN keys) | Including AWG_PRIVATE_KEY etc. | ✓ |
| Minimal (port + admin password only) | | |

**User's choice:** .env + .env.secrets including VPN keys
**Notes:** User accepted the risk of VPN keys being accessible via browser. LAN-only + Basic Auth provides the gate.

---

## Services Managed on Services Page

| Service | Selected |
|---------|----------|
| awg0 (VPN tunnel) | ✓ |
| splitgate-watch (daemon) | ✓ |
| splitgate-admin (self) | ✗ |
| networking / dnsmasq | ✓ |

**User's choice:** awg0, splitgate-watch, networking, dnsmasq
**Notes:** User did not select splitgate-admin itself — avoids self-disconnection risk.

---

## Claude's Discretion

- Exact React component library (shadcn/ui, custom, etc.) — researcher decides
- SPA routing strategy (hash vs history mode)
- Flask sudo approach (run as root vs sudoers rules)
- bcrypt vs plain-text for admin.secret (researcher evaluates)
- Rollback UI confirmation pattern (modal with typed "ROLLBACK" — Claude's suggestion, user didn't object)
- Mask/reveal toggle for secret values in Settings — Claude's suggestion

## Deferred Ideas

- HTTPS/TLS — LAN-only, HTTP acceptable
- Multi-user auth / RBAC — single shared secret is sufficient
- Mobile-responsive design — not requested
- Real-time metrics / graphs — separate phase if needed
- Phase 14 dnsmasq ipset integration in Routes UI — deferred until Phase 14 is built
