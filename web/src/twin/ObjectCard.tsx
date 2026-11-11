import { fmt, fmtAge, fmtInt, fmtUtc } from '../lib/format'
import { semiMajorAxisKm, type Catalog } from './catalog'
import type { LiveState } from './engine'

interface Props {
  catalog: Catalog
  index: number
  simTime: number
  live: LiveState | null
  onClose: () => void
}

const TYPE_CHIP = ['chip--blue', '', 'chip--violet', 'chip--magenta', '']
const TYPE_NAME = ['Active payload', 'Inactive payload', 'Rocket body', 'Debris', 'Unidentified']

function Row({ k, v, unit }: { k: string; v: string; unit?: string }) {
  return (
    <div className="kv">
      <span>{k}</span>
      <b className="mono">
        {v}
        {unit && <i> {unit}</i>}
      </b>
    </div>
  )
}

export default function ObjectCard({ catalog, index, simTime, live, onClose }: Props) {
  const c = catalog.cols
  const d = catalog.dict
  const epoch = c.epoch[index]
  const ageAtSim = simTime - epoch
  const ageAtSnapshot = Date.parse(catalog.meta.generated_at) / 1000 - epoch
  const stale = Math.abs(ageAtSim) > 5 * 86400
  const synthetic = c.id[index] >= 900000000
  const period = 1440 / c.n[index]
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="eyebrow">
            NORAD {c.id[index]}
            {c.intl[index] && ` · ${c.intl[index]}`}
          </div>
          <h3>{c.name[index]}</h3>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close object card">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </div>
      <div className="card__chips">
        <span className={`chip ${TYPE_CHIP[c.type[index]]}`}>{TYPE_NAME[c.type[index]]}</span>
        <span className="chip">{d.regime[c.regime[index]]}</span>
        {d.cons[c.cons[index]] && <span className="chip">{d.cons[c.cons[index]]}</span>}
        {synthetic && <span className="chip chip--orange">synthetic (stress test)</span>}
      </div>

      <div className="card__sec">
        <div className="eyebrow">
          Propagated state <em>SGP4 · not an observation</em>
        </div>
        {live ? (
          <div className="kv-grid">
            <Row k="Latitude" v={fmt(live.lat, 2)} unit="°" />
            <Row k="Longitude" v={fmt(live.lon, 2)} unit="°" />
            <Row k="Altitude" v={fmt(live.alt, 1)} unit="km" />
            <Row k="Speed" v={fmt(live.speed, 3)} unit="km/s" />
          </div>
        ) : (
          <p className="muted">SGP4 returned no valid state at this time (decayed or invalid).</p>
        )}
      </div>

      <div className="card__sec">
        <div className="eyebrow">Published mean elements (GP / OMM)</div>
        <div className="kv-grid">
          <Row k="Period" v={fmt(period, 2)} unit="min" />
          <Row k="Semi-major axis" v={fmtInt(semiMajorAxisKm(c.n[index]))} unit="km" />
          <Row k="Perigee alt." v={fmtInt(catalog.perigee[index])} unit="km" />
          <Row k="Apogee alt." v={fmtInt(catalog.apogee[index])} unit="km" />
          <Row k="Inclination" v={fmt(c.i[index], 4)} unit="°" />
          <Row k="Eccentricity" v={c.e[index].toFixed(7)} />
          <Row k="RAAN" v={fmt(c.raan[index], 4)} unit="°" />
          <Row k="Arg. of perigee" v={fmt(c.argp[index], 4)} unit="°" />
          <Row k="Mean anomaly" v={fmt(c.ma[index], 4)} unit="°" />
          <Row k="Mean motion" v={c.n[index].toFixed(8)} unit="rev/d" />
          <Row k="B*" v={c.bstar[index].toExponential(4)} unit="1/R⊕" />
          <Row k="Launch year" v={c.launch[index] ? String(c.launch[index]) : '—'} />
        </div>
      </div>

      <div className={`card__sec card__prov${stale ? ' is-stale' : ''}`}>
        <div className="eyebrow">Data provenance</div>
        <Row k="Element epoch" v={fmtUtc(epoch)} />
        <Row k="Age at snapshot" v={fmtAge(ageAtSnapshot)} />
        <Row k="Age at displayed time" v={`${ageAtSim < 0 ? '−' : ''}${fmtAge(ageAtSim)}`} />
        <Row k="Owner (SATCAT)" v={d.owner[c.owner[index]]} />
        <Row k="Source" v={`CelesTrak GP · ${d.group[c.group[index]]}`} />
        {stale && (
          <p className="warn">
            Displayed time is more than 5 days from the element epoch. SGP4 error grows by
            kilometres per day; treat this position as indicative only.
          </p>
        )}
        {!synthetic && (
          <a
            href={`https://celestrak.org/NORAD/elements/gp.php?CATNR=${c.id[index]}&FORMAT=JSON-PRETTY`}
            target="_blank"
            rel="noreferrer"
          >
            Latest element set on CelesTrak ↗
          </a>
        )}
      </div>
    </div>
  )
}
