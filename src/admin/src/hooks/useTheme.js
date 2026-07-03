import { useState, useEffect } from 'react'

function applyTheme(pref) {
  const isDark = pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => localStorage.getItem('sg-theme') || 'system')

  function setTheme(t) {
    localStorage.setItem('sg-theme', t)
    setThemeState(t)
    applyTheme(t)
  }

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  return { theme, setTheme }
}
