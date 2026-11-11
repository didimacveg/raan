import { useEffect, useState } from 'react'
import { BRAND } from '../brand'
import { href } from '../lib/router'

const LINKS = [
  ['/', 'Digital Twin'],
  ['/collision', 'Collision Lab'],
  ['/maneuvers', 'Maneuvers'],
  ['/intelligence', 'Intelligence'],
  ['/research', 'Research'],
] as const

export function Logo({ size = 22 }: { size?: number }) {
  // An orbit plane crossing the equator: the ascending node is the highlighted dot.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="5.2" fill="none" stroke="var(--ink)" strokeWidth="1.6" />
      <ellipse
        cx="12"
        cy="12"
        rx="10.6"
        ry="4.1"
        transform="rotate(-28 12 12)"
        fill="none"
        stroke="var(--blue)"
        strokeWidth="1.6"
      />
      <circle cx="21.3" cy="7" r="2.1" fill="var(--orange)" />
    </svg>
  )
}

export default function Nav({ path }: { path: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [path])
  return (
    <header className="nav">
      <a className="nav__brand" href={href('/')}>
        <Logo />
        {BRAND.name}
        <small>{BRAND.tagline}</small>
      </a>
      <span className="nav__flag" title="Positions are propagated from published orbital elements.">
        {BRAND.disclaimer}
      </span>
      <button
        className="nav__menu"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
      </button>
      <nav className="nav__links" data-open={open}>
        {LINKS.map(([to, label]) => (
          <a key={to} href={href(to)} aria-current={path === to ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
    </header>
  )
}
