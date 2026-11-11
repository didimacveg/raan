import { BRAND } from '../brand'

export default function Footer() {
  return (
    <footer className="footer">
      <span>
        {BRAND.name} · {BRAND.tagline} — built by {BRAND.author}
      </span>
      <span>{BRAND.disclaimer}.</span>
      <a href={BRAND.repo} target="_blank" rel="noreferrer">
        Source and data pipeline ↗
      </a>
      <span>
        Orbital data: CelesTrak / 18 SDS · CDMs: ESA (CC BY 4.0) · Manoeuvre labels: IDS via Shorten
        et al.
      </span>
    </footer>
  )
}
