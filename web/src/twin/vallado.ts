// Parser for Vallado's SGP4 verification files (see fixtures/README.md).
export interface VerCase {
  catnr: number
  line1: string
  line2: string
}
export interface VerRow {
  tsince: number // minutes
  r: [number, number, number] // km, TEME
  v: [number, number, number] // km/s
}

export function parseVerTle(text: string): VerCase[] {
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith('1 ') || l.startsWith('2 '))
  const cases: VerCase[] = []
  for (let k = 0; k + 1 < lines.length; k += 2) {
    cases.push({
      catnr: Number(lines[k].slice(2, 7)),
      line1: lines[k].slice(0, 69),
      line2: lines[k + 1].slice(0, 69), // drop the start/stop/step columns appended to line 2
    })
  }
  return cases
}

/** One block per element set, in file order (catalogue number 20413 appears twice). */
export function parseTcppver(text: string): { catnr: number; rows: VerRow[] }[] {
  const out: { catnr: number; rows: VerRow[] }[] = []
  let rows: VerRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*(\d+)\s+xx\s*$/)
    if (header) {
      rows = []
      out.push({ catnr: Number(header[1]), rows })
      continue
    }
    const f = line.trim().split(/\s+/).map(Number)
    if (f.length >= 7 && f.slice(0, 7).every(Number.isFinite)) {
      rows.push({ tsince: f[0], r: [f[1], f[2], f[3]], v: [f[4], f[5], f[6]] })
    }
  }
  return out
}
