---
slug: color-watch-tags
status: complete
---

Added ANSI color to [VPN] (cyan) and [ISP] (yellow) tags in watch-routes.py.
isatty() guard: colors only when stdout is a TTY — piped output and daemon log files stay plain.
Commit: 7f3e23c
