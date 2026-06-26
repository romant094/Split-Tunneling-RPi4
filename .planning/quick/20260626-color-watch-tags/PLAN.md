---
slug: color-watch-tags
created: 2026-06-26
status: in-progress
---

# Color [VPN] / [ISP] tags in splitgate watch

Add ANSI color to [VPN] and [ISP] tags in watch-routes.py interactive output.

## Tasks

1. Add ANSI color constants (cyan for VPN, yellow for ISP, reset)
2. Add `_colorize(tag, text)` helper — checks sys.stdout.isatty() to skip colors when piped
3. Apply color to `[{tag}]` in `format_line()` and `_flush_entries()` (interactive mode only)
4. Daemon mode writes to log file — no color codes there

## File

`src/scripts/watch-routes.py`
