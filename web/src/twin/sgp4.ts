// Thin, testable wrapper around satellite.js (a port of Vallado's SGP4, WGS-72).
// Used by the worker and by the verification test (src/twin/sgp4.test.ts).
import { json2satrec, sgp4, type SatRec } from 'satellite.js'
import type { CatalogCols } from './catalog'

export type { SatRec }

/** Build a satellite.js record from one row of the columnar catalogue (OMM mean elements). */
export function satrecFromCols(c: CatalogCols, k: number): SatRec | null {
  try {
    return json2satrec({
      OBJECT_NAME: c.name[k],
      OBJECT_ID: c.intl[k] || 'UNKNOWN',
      EPOCH: new Date(c.epoch[k] * 1000).toISOString().replace('Z', ''),
      MEAN_MOTION: c.n[k],
      ECCENTRICITY: c.e[k],
      INCLINATION: c.i[k],
      RA_OF_ASC_NODE: c.raan[k],
      ARG_OF_PERICENTER: c.argp[k],
      MEAN_ANOMALY: c.ma[k],
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: 'U',
      NORAD_CAT_ID: c.id[k],
      ELEMENT_SET_NO: 999,
      REV_AT_EPOCH: 0,
      BSTAR: c.bstar[k],
      MEAN_MOTION_DOT: c.ndot[k],
      MEAN_MOTION_DDOT: c.nddot[k],
    } as never)
  } catch {
    return null
  }
}

/**
 * Propagate to `unixSeconds` and write the TEME position (km) into `out[offset..offset+2]`.
 * Returns false (and writes NaN) when SGP4 reports an error, e.g. a decayed orbit.
 */
export function propagateInto(
  rec: SatRec,
  epochUnix: number,
  unixSeconds: number,
  out: Float32Array,
  offset: number,
): boolean {
  const pv = sgp4(rec, (unixSeconds - epochUnix) / 60)
  const p = pv?.position
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
    out[offset] = out[offset + 1] = out[offset + 2] = NaN
    return false
  }
  out[offset] = p.x
  out[offset + 1] = p.y
  out[offset + 2] = p.z
  return true
}

/** Greenwich mean sidereal time (rad), IAU-82, from Unix seconds (UT1 ≈ UTC assumed). */
export function gmst(unixSeconds: number): number {
  const jd = unixSeconds / 86400 + 2440587.5
  const t = (jd - 2451545.0) / 36525
  let s =
    67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t
  s = ((s % 86400) + 86400) % 86400
  return (s / 86400) * 2 * Math.PI
}

/** TEME position (km) → geodetic latitude/longitude (deg) and altitude (km), WGS-84 ellipsoid. */
export function temeToGeodetic(x: number, y: number, z: number, unixSeconds: number) {
  const g = gmst(unixSeconds)
  const xe = x * Math.cos(g) + y * Math.sin(g)
  const ye = -x * Math.sin(g) + y * Math.cos(g)
  const a = 6378.137
  const f = 1 / 298.257223563
  const e2 = f * (2 - f)
  const r = Math.hypot(xe, ye)
  const lon = Math.atan2(ye, xe)
  let lat = Math.atan2(z, r)
  let c = 1
  for (let k = 0; k < 8; k++) {
    c = 1 / Math.sqrt(1 - e2 * Math.sin(lat) ** 2)
    lat = Math.atan2(z + a * c * e2 * Math.sin(lat), r)
  }
  const alt = r / Math.cos(lat) - a * c
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI, alt }
}
