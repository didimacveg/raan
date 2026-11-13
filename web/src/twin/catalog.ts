// Catalogue loader. The file is produced by `python -m raan.catalog.build` (columnar JSON).

export interface CatalogMeta {
  generated_at: string
  source: string
  source_urls: Record<string, string>
  groups: Record<string, number>
  count: number
  by_type: Record<string, number>
  by_regime: Record<string, number>
  epoch_min: number
  epoch_max: number
  epoch_age_days: { median: number; p95: number; max: number }
  satcat_on_orbit: {
    total: number
    payloads: number
    rocket_bodies: number
    debris: number
    max_catalog_number: number
  }
  six_digit_ids: number
  disclaimer: string
  stress?: { real: number; synthetic: number }
}

export interface CatalogCols {
  id: number[]
  name: string[]
  intl: string[]
  epoch: number[]
  n: number[]
  e: number[]
  i: number[]
  raan: number[]
  argp: number[]
  ma: number[]
  bstar: number[]
  ndot: number[]
  nddot: number[]
  type: number[]
  regime: number[]
  cons: number[]
  owner: number[]
  group: number[]
  launch: number[]
  rcs: number[]
}

export interface Catalog {
  meta: CatalogMeta
  dict: { type: string[]; regime: string[]; cons: string[]; owner: string[]; group: string[] }
  cols: CatalogCols
  /** derived on load */
  perigee: Float32Array
  apogee: Float32Array
  count: number
}

export const MU = 398600.8 // km^3/s^2 (WGS-72, as used by SGP4)
export const R_EARTH = 6378.135 // km (WGS-72)

export function semiMajorAxisKm(meanMotionRevDay: number): number {
  const n = (meanMotionRevDay * 2 * Math.PI) / 86400
  return Math.cbrt(MU / (n * n))
}

function derive(raw: Omit<Catalog, 'perigee' | 'apogee' | 'count'>): Catalog {
  const count = raw.cols.id.length
  const perigee = new Float32Array(count)
  const apogee = new Float32Array(count)
  for (let k = 0; k < count; k++) {
    const a = semiMajorAxisKm(raw.cols.n[k])
    perigee[k] = a * (1 - raw.cols.e[k]) - R_EARTH
    apogee[k] = a * (1 + raw.cols.e[k]) - R_EARTH
  }
  return { ...raw, perigee, apogee, count }
}

/**
 * Stress mode: replicate real objects with shifted mean anomaly / RAAN until `target` objects
 * exist. Used only to measure rendering performance; the UI labels the result as synthetic.
 */
function inflate(raw: Omit<Catalog, 'perigee' | 'apogee' | 'count'>, target: number) {
  const real = raw.cols.id.length
  if (target <= real) return raw
  const cols = raw.cols as unknown as Record<string, (number | string)[]>
  const out: Record<string, (number | string)[]> = {}
  for (const key of Object.keys(cols)) out[key] = cols[key].slice()
  for (let k = real; k < target; k++) {
    const src = k % real
    const copy = Math.floor(k / real)
    for (const key of Object.keys(cols)) out[key].push(cols[key][src])
    out.id[k] = 900000000 + k
    out.name[k] = `SYNTHETIC COPY OF ${cols.name[src]}`
    out.ma[k] = ((cols.ma[src] as number) + 137.5 * copy) % 360
    out.raan[k] = ((cols.raan[src] as number) + 61.8 * copy) % 360
  }
  return {
    ...raw,
    cols: out as unknown as CatalogCols,
    meta: { ...raw.meta, stress: { real, synthetic: target - real } },
  }
}

export async function loadCatalog(stressTarget = 0): Promise<Catalog> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/catalog.json`)
  if (!res.ok) throw new Error(`catalog.json: HTTP ${res.status}`)
  const raw = await res.json()
  return derive(stressTarget > 0 ? inflate(raw, stressTarget) : raw)
}

export interface Filters {
  types: Set<number>
  regimes: Set<number>
  cons: number | null // index into dict.cons, null = any
  owner: number | null
  alt: [number, number] // km, applied to perigee..apogee overlap
  inc: [number, number] // deg
  query: string
}

export const ALT_MAX = 40000
export const defaultFilters = (cat: Catalog): Filters => ({
  types: new Set(cat.dict.type.map((_, k) => k)),
  regimes: new Set(cat.dict.regime.map((_, k) => k)),
  cons: null,
  owner: null,
  alt: [0, ALT_MAX],
  inc: [0, 180],
  query: '',
})

/** Returns a 0/1 mask and the number of visible objects. */
export function applyFilters(cat: Catalog, f: Filters, mask: Float32Array): number {
  const c = cat.cols
  const q = f.query.trim().toUpperCase()
  const altHiOpen = f.alt[1] >= ALT_MAX
  let shown = 0
  for (let k = 0; k < cat.count; k++) {
    let ok =
      f.types.has(c.type[k]) &&
      f.regimes.has(c.regime[k]) &&
      (f.cons === null || c.cons[k] === f.cons) &&
      (f.owner === null || c.owner[k] === f.owner) &&
      c.i[k] >= f.inc[0] &&
      c.i[k] <= f.inc[1] &&
      cat.apogee[k] >= f.alt[0] &&
      (altHiOpen || cat.perigee[k] <= f.alt[1])
    if (ok && q) ok = c.name[k].toUpperCase().includes(q) || String(c.id[k]).startsWith(q)
    mask[k] = ok ? 1 : 0
    if (ok) shown++
  }
  return shown
}
