// Two-thumb range slider built from two native inputs (keyboard and touch accessible).
interface Props {
  min: number
  max: number
  step?: number
  value: [number, number]
  onChange: (value: [number, number]) => void
  label: string
}

export default function DualRange({ min, max, step = 1, value, onChange, label }: Props) {
  const [lo, hi] = value
  const pct = (v: number) => ((v - min) / (max - min)) * 100
  return (
    <div className="dual" role="group" aria-label={label}>
      <div className="dual__track" />
      <div className="dual__fill" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={lo}
        aria-label={`${label} minimum`}
        onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={hi}
        aria-label={`${label} maximum`}
        onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
      />
    </div>
  )
}
