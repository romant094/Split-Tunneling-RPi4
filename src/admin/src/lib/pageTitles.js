export const APP_NAME = 'Splitgate'
export const FALLBACK_TITLE = 'Splitgate — VPN Gateway Admin'

export const PAGE_TITLES = {
  '/': 'Dashboard',
  '/services': 'Services',
  '/routes': 'Routes',
  '/logs': 'Logs · Live',
  '/logs/live': 'Logs · Live',
  '/logs/history': 'Logs · History',
  '/logs/install': 'Logs · Install',
  '/logs/errors': 'Logs · Errors',
  '/logs/journal': 'Logs · Journal',
  '/diagnostics': 'Diagnostics',
  '/config': 'Config',
  '/settings': 'Settings',
}

export function titleForPath(pathname) {
  let path = pathname == null ? '/' : pathname
  if (path !== '/' && path.endsWith('/')) {
    path = path.slice(0, -1)
  }
  const label = PAGE_TITLES[path]
  if (!label) return FALLBACK_TITLE
  return `${label} — ${APP_NAME}`
}
