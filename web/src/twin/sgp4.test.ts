// Verification of the browser propagator against Vallado's reference vectors.
import { readFileSync, writeFileSync } from 'node:fs'
import { json2satrec, sgp4, twoline2satrec } from 'satellite.js'
import { describe, expect, it } from 'vitest'
import type { CatalogCols } from './catalog'
import { gmst, propagateInto, satrecFromCols, temeToGeodetic } from './sgp4'
import { parseTcppver, parseVerTle } from './vallado'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const cases = parseVerTle(fixture('SGP4-VER.TLE'))
const reference = parseTcppver(fixture('tcppver.out'))

// 1 mm in position, 1e-6 mm/s… in practice the port agrees to ~1e-8 km; see the printed maximum.
// `WRITE_VERIFICATION=1 npx vitest run` stores the measured maxima in public/data so that the
// site and the report quote what the test measured (see `make verify`).
const measured: Record<string, number | string> = {}
const POS_TOL_KM = 1e-6
const VEL_TOL_KM_S = 1e-9

describe('SGP4 vs Vallado tcppver.out', () => {
  it('parses all 33 verification element sets', () => {
    expect(cases.length).toBe(33)
    expect(reference.length).toBe(33)
    cases.forEach((c, k) => expect(reference[k].catnr).toBe(c.catnr))
  })

  it('matches every reference state vector', () => {
    let compared = 0
    let maxPos = 0
    let maxVel = 0
    let worst = ''
    cases.forEach((c, index) => {
      const rows = reference[index].rows
      const rec = twoline2satrec(c.line1, c.line2)
      for (const row of rows) {
        const pv = sgp4(rec, row.tsince)
        if (c.catnr === 33334) {
          // Deliberately invalid element set ("check error code 2", mean motion 1e-5 rev/day).
          // The reference C++ driver prints a stale line for it; a correct port must refuse.
          expect(pv).toBeNull()
          continue
        }
        // otherwise the reference file simply stops when the C++ code reports an error
        expect(pv, `sat ${c.catnr} t=${row.tsince}`).not.toBeNull()
        const p = pv!.position
        const v = pv!.velocity
        const dp = Math.hypot(p.x - row.r[0], p.y - row.r[1], p.z - row.r[2])
        const dv = Math.hypot(v.x - row.v[0], v.y - row.v[1], v.z - row.v[2])
        if (dp > maxPos) {
          maxPos = dp
          worst = `${c.catnr} @ ${row.tsince} min`
        }
        maxVel = Math.max(maxVel, dv)
        compared++
      }
    })
    console.log(
      `[vallado] ${compared} state vectors, max |Δr| = ${maxPos.toExponential(2)} km (${worst}), ` +
        `max |Δv| = ${maxVel.toExponential(2)} km/s`,
    )
    Object.assign(measured, { vectors: compared, tle_max_km: maxPos, tle_worst: worst })
    expect(compared).toBeGreaterThan(600)
    expect(maxPos).toBeLessThan(POS_TOL_KM)
    expect(maxVel).toBeLessThan(VEL_TOL_KM_S)
  })
})

/** TLE "assumed decimal point" exponent field, e.g. " 38792-4" → 0.38792e-4. */
function tleExp(field: string): number {
  const m = field.trim().match(/^([+-]?)(\d+)([+-]\d)$/)
  return m ? Number(`${m[1]}0.${m[2]}e${m[3]}`) : 0
}

/** The OMM fields CelesTrak publishes, read from the fixed columns of a TLE. */
function ommFromTle(line1: string, line2: string) {
  const yy = Number(line1.slice(18, 20))
  const year = yy < 57 ? 2000 + yy : 1900 + yy
  const day = Number(line1.slice(20, 32))
  const micros = Math.round((day - 1) * 86400e6)
  const whole = new Date(Date.UTC(year, 0, 1) + Math.floor(micros / 1000))
  const epoch = whole.toISOString().replace('Z', '') + String(micros % 1000).padStart(3, '0')
  return {
    OBJECT_NAME: 'VERIFICATION',
    OBJECT_ID: '2000-001A',
    EPOCH: epoch,
    MEAN_MOTION: Number(line2.slice(52, 63)),
    ECCENTRICITY: Number(`0.${line2.slice(26, 33).trim()}`),
    INCLINATION: Number(line2.slice(8, 16)),
    RA_OF_ASC_NODE: Number(line2.slice(17, 25)),
    ARG_OF_PERICENTER: Number(line2.slice(34, 42)),
    MEAN_ANOMALY: Number(line2.slice(43, 51)),
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: Number(line1.slice(2, 7)),
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 0,
    BSTAR: tleExp(line1.slice(53, 61)),
    MEAN_MOTION_DOT: Number(line1.slice(33, 43)),
    MEAN_MOTION_DDOT: tleExp(line1.slice(44, 52)),
  }
}

describe('SGP4 vs Vallado through the OMM route the app uses', () => {
  it('json2satrec(OMM fields) reproduces the reference vectors', () => {
    let compared = 0
    let maxPos = 0
    let worst = ''
    cases.forEach((c, index) => {
      if (c.catnr === 33334) return // deliberately invalid element set
      const omm = ommFromTle(c.line1, c.line2)
      const rec = json2satrec(omm as never)
      for (const row of reference[index].rows) {
        const pv = sgp4(rec, row.tsince)
        expect(pv, `sat ${c.catnr} t=${row.tsince}`).not.toBeNull()
        const p = pv!.position
        const dp = Math.hypot(p.x - row.r[0], p.y - row.r[1], p.z - row.r[2])
        if (dp > maxPos) {
          maxPos = dp
          worst = `${c.catnr} @ ${row.tsince} min`
        }
        compared++
      }
    })
    console.log(
      `[vallado/omm] ${compared} state vectors, max |Δr| = ${maxPos.toExponential(2)} km (${worst})`,
    )
    Object.assign(measured, { omm_max_km: maxPos, omm_worst: worst })
    if (process.env.WRITE_VERIFICATION) {
      const out = new URL('../../public/data/verification.json', import.meta.url)
      writeFileSync(out, JSON.stringify({ source: 'web/src/twin/sgp4.test.ts', propagator: 'satellite.js', ...measured }, null, 1) + '\n')
    }
    expect(compared).toBeGreaterThan(600)
    // SGP4 integrates time since epoch, so most vectors agree as closely as through the TLE
    // reader. satellite.js reads the OMM EPOCH through a JavaScript Date (milliseconds), which
    // slightly changes the sidereal time used by the deep-space terms: the worst case is a few
    // centimetres on a 14-day, e = 0.97 orbit. Separately, the app labels absolute time with
    // epochs rounded to 1 ms (up to 0.5 ms × ~7.5 km/s ≈ 4 m along-track): fine on screen,
    // but the display is not accurate to 0.1 mm and nothing on the site says it is.
    expect(maxPos).toBeLessThan(1e-4)
  })
})

describe('OMM path used by the app', () => {
  // ISS element set expressed as OMM fields must give the same state as its TLE.
  const l1 = '1 25544U 98067A   19343.69339541  .00001764  00000-0  38792-4 0  9991'
  const l2 = '2 25544  51.6439 211.2001 0007417  17.6667  85.6398 15.50103472202482'
  const cols = {
    id: [25544],
    name: ['ISS (ZARYA)'],
    intl: ['1998-067A'],
    epoch: [Date.UTC(2019, 0, 1) / 1000 + (343.69339541 - 1) * 86400],
    n: [15.50103472],
    e: [0.0007417],
    i: [51.6439],
    raan: [211.2001],
    argp: [17.6667],
    ma: [85.6398],
    bstar: [0.38792e-4],
    ndot: [0.00001764],
    nddot: [0],
  } as unknown as CatalogCols

  it('json2satrec(OMM) ≡ twoline2satrec(TLE)', () => {
    const fromTle = twoline2satrec(l1, l2)
    const fromOmm = satrecFromCols(cols, 0)!
    const out = new Float32Array(3)
    for (const minutes of [0, 45, 720, 4320]) {
      const ref = sgp4(fromTle, minutes)!.position
      expect(propagateInto(fromOmm, cols.epoch[0], cols.epoch[0] + minutes * 60, out, 0)).toBe(true)
      // Float32 storage + epoch rounding to 1 ms: allow 20 m
      expect(Math.hypot(out[0] - ref.x, out[1] - ref.y, out[2] - ref.z)).toBeLessThan(0.02)
    }
  })

  it('geodetic conversion is sane', () => {
    // a point on the +X TEME axis at GMST = 0 is on the Greenwich meridian at the equator
    let t = 946728000 // 2000-01-01 12:00 UTC
    while (Math.abs(gmst(t)) > 1e-4 && Math.abs(gmst(t) - 2 * Math.PI) > 1e-4) t += 1
    const g = temeToGeodetic(7000, 0, 0, t)
    expect(Math.abs(g.lat)).toBeLessThan(1e-6)
    expect(Math.abs(g.lon)).toBeLessThan(0.01)
    expect(g.alt).toBeCloseTo(7000 - 6378.137, 3)
    // GMST at J2000.0 (2000-01-01 12:00 UT1) is 280.4606°
    expect((gmst(946728000) * 180) / Math.PI).toBeCloseTo(280.4606, 3)
  })
})
