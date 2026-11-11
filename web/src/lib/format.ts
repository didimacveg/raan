export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')

export const fmt = (n: number, digits = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export function fmtUtc(unixSeconds: number, withSeconds = true): string {
  const iso = new Date(unixSeconds * 1000).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, withSeconds ? 19 : 16)} UTC`
}

/** "3.2 h", "1.4 d" … for element-set age. */
export function fmtAge(seconds: number): string {
  const s = Math.abs(seconds)
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 48 * 3600) return `${(s / 3600).toFixed(1)} h`
  return `${(s / 86400).toFixed(1)} d`
}

export async function loadJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}
