// Small hand-written SVG chart kit. One axis per chart, recessive grid, thin marks, text in ink
// tokens (never in series colours), hover tooltips on every plot.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import './charts.css'

// Categorical order (validated: CVD ΔE ≥ 11.7, normal-vision ΔE ≥ 26 on a white surface).
export const SERIES = ['#1f3bff', '#ff7a1a', '#7a3cff', '#00a6d6', '#f0288c'] as const
export const INK = { grid: 'rgba(16,24,64,0.08)', axis: 'rgba(16,24,64,0.28)', muted: '#7a829f' }

export type Scale = ((v: number) => number) & { domain: [number, number]; range: [number, number] }

export function linear(domain: [number, number], range: [number, number]): Scale {
  const f = ((v: number) =>
    range[0] + ((v - domain[0]) / (domain[1] - domain[0] || 1)) * (range[1] - range[0])) as Scale
  f.domain = domain
  f.range = range
  return f
}

export function log10Scale(domain: [number, number], range: [number, number]): Scale {
  const inner = linear([Math.log10(domain[0]), Math.log10(domain[1])], range)
  const f = ((v: number) => inner(Math.log10(Math.max(v, domain[0])))) as Scale
  f.domain = domain
  f.range = range
  return f
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo
  if (span <= 0) return [lo]
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) {
    out.push(Number(v.toFixed(10)))
  }
  return out
}

export function useWidth<T extends HTMLElement>(fallback = 640): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    if (!ref.current) return
    const update = () => ref.current && setWidth(Math.max(260, ref.current.clientWidth))
    update()
    const obs = new ResizeObserver(update)
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return [ref, width]
}

export interface Tip {
  x: number
  y: number
  content: ReactNode
}

interface FrameProps {
  height: number
  margin?: { top: number; right: number; bottom: number; left: number }
  x: (width: number) => Scale
  y: (height: number) => Scale
  xTicks?: number[]
  yTicks?: number[]
  xFormat?: (v: number) => string
  yFormat?: (v: number) => string
  xLabel?: string
  yLabel?: string
  title?: string
  subtitle?: string
  legend?: { label: string; color: string; shape?: 'dot' | 'line' | 'square' | 'ring' }[]
  children: (ctx: {
    x: Scale
    y: Scale
    width: number
    height: number
    setTip: (tip: Tip | null) => void
  }) => ReactNode
  footer?: ReactNode
}

/** Chart frame: title, legend, axes, grid and a tooltip layer. Children draw the marks. */
export function Frame(props: FrameProps) {
  const margin = props.margin ?? { top: 12, right: 16, bottom: 40, left: 52 }
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const innerW = width - margin.left - margin.right
  const innerH = props.height - margin.top - margin.bottom
  const x = props.x(innerW)
  const y = props.y(innerH)
  const xf = props.xFormat ?? String
  const yf = props.yFormat ?? String
  return (
    <figure className="chart">
      {(props.title || props.legend) && (
        <figcaption>
          {props.title && <b>{props.title}</b>}
          {props.subtitle && <span>{props.subtitle}</span>}
          {props.legend && (
            <ul className="legend">
              {props.legend.map((l) => (
                <li key={l.label}>
                  <i className={`sw sw--${l.shape ?? 'dot'}`} style={{ ['--c' as string]: l.color }} />
                  {l.label}
                </li>
              ))}
            </ul>
          )}
        </figcaption>
      )}
      <div className="chart__plot" ref={ref} onMouseLeave={() => setTip(null)}>
        <svg width={width} height={props.height} role="img" aria-label={props.title}>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {props.yTicks?.map((t) => (
              <g key={`y${t}`} transform={`translate(0,${y(t)})`}>
                <line x2={innerW} stroke={INK.grid} />
                <text x={-8} dy="0.32em" textAnchor="end" className="tick">
                  {yf(t)}
                </text>
              </g>
            ))}
            {props.xTicks?.map((t) => (
              <g key={`x${t}`} transform={`translate(${x(t)},${innerH})`}>
                <line y2={5} stroke={INK.axis} />
                <text y={18} textAnchor="middle" className="tick">
                  {xf(t)}
                </text>
              </g>
            ))}
            <line y1={innerH} y2={innerH} x2={innerW} stroke={INK.axis} />
            {props.xLabel && (
              <text x={innerW / 2} y={innerH + 35} textAnchor="middle" className="axis-label">
                {props.xLabel}
              </text>
            )}
            {props.yLabel && (
              <text
                transform={`translate(${-margin.left + 12},${innerH / 2}) rotate(-90)`}
                textAnchor="middle"
                className="axis-label"
              >
                {props.yLabel}
              </text>
            )}
            {props.children({ x, y, width: innerW, height: innerH, setTip })}
          </g>
        </svg>
        {tip && (
          <div
            className="chart__tip"
            style={{
              left: Math.min(Math.max(tip.x + margin.left, 80), width - 80),
              top: tip.y + margin.top,
            }}
          >
            {tip.content}
          </div>
        )}
      </div>
      {props.footer && <div className="chart__foot">{props.footer}</div>}
    </figure>
  )
}

/** Path string for a polyline. */
export const linePath = (pts: [number, number][]) =>
  pts.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')

/** Vertical bar with a rounded data end, anchored to the baseline. */
export function barPath(x: number, w: number, y0: number, y1: number, r = 3): string {
  const h = y0 - y1
  const rr = Math.max(0, Math.min(r, w / 2, Math.abs(h)))
  if (h <= 0) return ''
  return `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`
}

/** Horizontal bar with a rounded data end. */
export function hbarPath(x0: number, x1: number, y: number, h: number, r = 3): string {
  const w = x1 - x0
  const rr = Math.max(0, Math.min(r, h / 2, Math.abs(w)))
  if (w <= 0) return ''
  return `M${x0},${y}H${x1 - rr}Q${x1},${y} ${x1},${y + rr}V${y + h - rr}Q${x1},${y + h} ${x1 - rr},${y + h}H${x0}Z`
}
