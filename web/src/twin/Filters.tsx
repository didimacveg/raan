import { useMemo } from 'react'
import DualRange from '../components/DualRange'
import { fmtInt } from '../lib/format'
import { ALT_MAX, defaultFilters, type Catalog, type Filters } from './catalog'
import { TYPE_COLORS } from './engine'

const TYPE_LABEL: Record<string, string> = {
  active: 'Active payloads',
  inactive: 'Inactive payloads',
  'rocket-body': 'Rocket bodies',
  debris: 'Debris',
  unknown: 'Unidentified',
}

// Slider position (0–100) ↔ altitude (km). 60 % of the travel covers LEO, where the objects are.
export const sliderToAlt = (s: number) =>
  s <= 60 ? Math.round((s / 60) * 2000) : Math.round(2000 + ((s - 60) / 40) * (ALT_MAX - 2000))
export const altToSlider = (a: number) =>
  a <= 2000 ? (a / 2000) * 60 : 60 + ((a - 2000) / (ALT_MAX - 2000)) * 40

interface Props {
  catalog: Catalog
  filters: Filters
  shown: number
  onChange: (f: Filters) => void
}

export default function FiltersPanel({ catalog, filters, shown, onChange }: Props) {
  const counts = useMemo(() => {
    const type = new Array(catalog.dict.type.length).fill(0)
    const regime = new Array(catalog.dict.regime.length).fill(0)
    const cons = new Array(catalog.dict.cons.length).fill(0)
    const owner = new Array(catalog.dict.owner.length).fill(0)
    for (let k = 0; k < catalog.count; k++) {
      type[catalog.cols.type[k]]++
      regime[catalog.cols.regime[k]]++
      cons[catalog.cols.cons[k]]++
      owner[catalog.cols.owner[k]]++
    }
    return { type, regime, cons, owner }
  }, [catalog])

  const toggle = (key: 'types' | 'regimes', index: number) => {
    const next = new Set(filters[key])
    if (next.has(index)) next.delete(index)
    else next.add(index)
    onChange({ ...filters, [key]: next })
  }
  const dirty =
    filters.types.size !== catalog.dict.type.length ||
    filters.regimes.size !== catalog.dict.regime.length ||
    filters.cons !== null ||
    filters.owner !== null ||
    filters.query !== '' ||
    filters.alt[0] !== 0 ||
    filters.alt[1] !== ALT_MAX ||
    filters.inc[0] !== 0 ||
    filters.inc[1] !== 180

  return (
    <div className="filters">
      <div className="filters__count">
        <span className="mono filters__n">{fmtInt(shown)}</span>
        <span className="filters__of">
          of {fmtInt(catalog.count)} objects shown
          {dirty && (
            <button className="link" onClick={() => onChange(defaultFilters(catalog))}>
              reset
            </button>
          )}
        </span>
      </div>

      <input
        className="field"
        type="search"
        placeholder="Search name or catalogue number"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
        aria-label="Search objects"
      />

      <fieldset>
        <legend className="eyebrow">Object type</legend>
        {catalog.dict.type.map((t, k) =>
          counts.type[k] === 0 ? null : (
            <label key={t} className="check">
              <input
                type="checkbox"
                checked={filters.types.has(k)}
                onChange={() => toggle('types', k)}
              />
              <i style={{ background: TYPE_COLORS[k] }} />
              <span>{TYPE_LABEL[t] ?? t}</span>
              <b className="mono">{fmtInt(counts.type[k])}</b>
            </label>
          ),
        )}
      </fieldset>

      <fieldset>
        <legend className="eyebrow">Orbital regime</legend>
        <div className="seg">
          {catalog.dict.regime.map((r, k) => (
            <button
              key={r}
              aria-pressed={filters.regimes.has(k)}
              onClick={() => toggle('regimes', k)}
              title={`${fmtInt(counts.regime[k])} objects`}
            >
              {r}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="eyebrow">Constellation</legend>
        <select
          className="field"
          value={filters.cons ?? ''}
          onChange={(e) =>
            onChange({ ...filters, cons: e.target.value === '' ? null : Number(e.target.value) })
          }
        >
          <option value="">All objects</option>
          {catalog.dict.cons.map((c, k) =>
            c === '' ? null : (
              <option key={c} value={k}>
                {c} ({fmtInt(counts.cons[k])})
              </option>
            ),
          )}
        </select>
      </fieldset>

      <fieldset>
        <legend className="eyebrow">Country / operator (SATCAT owner)</legend>
        <select
          className="field"
          value={filters.owner ?? ''}
          onChange={(e) =>
            onChange({ ...filters, owner: e.target.value === '' ? null : Number(e.target.value) })
          }
        >
          <option value="">All owners</option>
          {catalog.dict.owner.map((o, k) => (
            <option key={o} value={k}>
              {o} ({fmtInt(counts.owner[k])})
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset>
        <legend className="eyebrow">
          Altitude{' '}
          <span className="mono range-v">
            {fmtInt(filters.alt[0])} – {filters.alt[1] >= ALT_MAX ? '40,000+' : fmtInt(filters.alt[1])}{' '}
            km
          </span>
        </legend>
        <DualRange
          label="Altitude"
          min={0}
          max={100}
          step={0.5}
          value={[altToSlider(filters.alt[0]), altToSlider(filters.alt[1])]}
          onChange={([lo, hi]) => onChange({ ...filters, alt: [sliderToAlt(lo), sliderToAlt(hi)] })}
        />
      </fieldset>

      <fieldset>
        <legend className="eyebrow">
          Inclination{' '}
          <span className="mono range-v">
            {filters.inc[0]}° – {filters.inc[1]}°
          </span>
        </legend>
        <DualRange
          label="Inclination"
          min={0}
          max={180}
          value={filters.inc}
          onChange={(inc) => onChange({ ...filters, inc })}
        />
      </fieldset>
    </div>
  )
}
