import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { titleForPath } from '../lib/pageTitles'

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title
  }, [title])
}

export function RouteTitle() {
  const location = useLocation()
  const title = titleForPath(location.pathname)
  useDocumentTitle(title)
  return null
}
