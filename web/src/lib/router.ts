// Minimal hash router: works on any static host (GitHub Pages) without rewrite rules.
import { useEffect, useState } from 'react'

export interface Route {
  path: string // e.g. "/collision"
  query: URLSearchParams
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [path, search = ''] = raw.split('?')
  // query parameters may sit before the hash (…/?stress=30000#/) or inside it
  const query = new URLSearchParams(window.location.search)
  new URLSearchParams(search).forEach((v, k) => query.set(k, v))
  return { path: path || '/', query }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const onChange = () => {
      setRoute(parse())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export const href = (path: string) => `#${path}`
