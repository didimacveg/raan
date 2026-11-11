import { useEffect, useMemo, useState } from 'react'
import { Frame, INK, SERIES, barPath, linePath, linear, niceTicks } from '../components/charts'
import DualRange from '../components/DualRange'
import Footer from '../components/Footer'
import { fmt, fmtInt, fmtUtc, loadJson } from '../lib/format'
import type { Route } from '../lib/router'
import '../twin/twin.css'
import './pages.css'

type Method = 'physics' | 'cusum' | 'ml'
interface Counts {
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
}
interface SatSummary {
  name: string
  satcat: number
  regime: string
  element_sets: number
  span: [number, number]
  reported_maneuvers: number
  maneuver_events: number
  median_set_spacing_days: number
  metrics: Record<Method, Counts & { threshold: number }>
}
export interface ManeuverData {
  meta: {
    generated_at: string
    code_version: string
    runtime_s: number
    dataset: { name: string; url: string; commit: string; paper: string; labels: string }
    protocol: Record<string, string | number>
  }
  totals: { satellites: number; element_sets: number; reported_maneuvers: number; maneuver_events: number }
  summary: Record<Method, Record<'ALL' | 'LEO' | 'GEO', Counts>>
  lag_sensitivity: Record<Method, Record<string, Counts>>
  physics_ablation: Record<string, Record<'ALL' | 'LEO' | 'GEO', Counts>>
  recall_by_size_leo: ({ lo_m: number; hi_m: number | null; n: number } & Record<Method, number>)[]
  large_burn_misses: { missed: number; with_another_reported_burn_within_4_days: number }
  importance: { feature: string; gain: number }[]
  satellites: SatSummary[]
}
interface Detection {
  t_start: number
  t_end: number
  score: number
  matched: boolean
  confidence: number | null
  evidence: {
    da_m: number
    di_mdeg: number
    res_r_km: number
    res_t_km: number
    res_n_km: number
    z_shift_a: number
    z_shift_i: number
    dt_days: number
  }
}
interface Timeline {
  name: string
  satcat: number
  regime: string
  detections: Record<Method, Detection[]>
  truth: ({ t: number } & Record<Method, boolean>)[]
  series: { t: number[]; a_ref_km: number; a_m: number[]; inc_deg: number[] }
}

const METHODS: { key: Method; label: string; short: string; color: string }[] = [
  { key: 'physics', label: 'Physics thresholds', short: 'Physics', color: SERIES[0] },
  { key: 'cusum', label: 'CUSUM change detection', short: 'CUSUM', color: SERIES[1] },
  { key: 'ml', label: 'Gradient-boosted classifier', short: 'ML', color: SERIES[2] },
]
const SCORE_UNIT: Record<Method, string> = { physics: 'σ', cusum: ' (CUSUM)', ml: ' (probability)' }
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)

function MethodBars({ data }: { data: ManeuverData }) {
  const groups = ['precision', 'recall', 'f1'] as const
  const label = { precision: 'Precision', recall: 'Recall', f1: 'F1' }
  return (
    <Frame
      title="Event-level scores, all 15 satellites"
      subtitle={`${fmtInt(data.totals.maneuver_events)} reported manoeuvre events · thresholds and classifier chosen leave-one-satellite-out`}
      height={280}
      margin={{ top: 22, right: 12, bottom: 34, left: 44 }}
      x={(w) => linear([0, groups.length], [0, w])}
      y={(h) => linear([0, 1], [h, 0])}
      yTicks={[0, 0.25, 0.5, 0.75, 1]}
      yFormat={(v) => v.toFixed(2)}
      legend={METHODS.map((m) => ({ label: m.label, color: m.color, shape: 'square' as const }))}
    >
      {({ x, y, height, setTip }) => {
        const band = x(1) - x(0)
        const w = Math.min(46, band / 4.2)
        return (
          <>
            {groups.map((g, gi) => (
              <g key={g}>
                {METHODS.map((m, mi) => {
                  const v = data.summary[m.key].ALL[g]
                  const bx = x(gi + 0.5) + (mi - 1.5) * (w + 2) + w / 2
                  return (
                    <g
                      key={m.key}
                      onMouseMove={() =>
                        setTip({
                          x: bx + w / 2,
                          y: y(v),
                          content: (
                            <>
                              {m.label}
                              <br />
                              {label[g]} <b>{v.toFixed(3)}</b>
                              <small>
                                {data.summary[m.key].ALL.tp} found · {data.summary[m.key].ALL.fn} missed ·{' '}
                                {data.summary[m.key].ALL.fp} false alarms
                              </small>
                            </>
                          ),
                        })
                      }
                    >
                      <path d={barPath(bx, w, y(0), y(v), 4)} fill={m.color} />
                      <text x={bx + w / 2} y={y(v) - 6} textAnchor="middle" className="mark-label mono">
                        {v.toFixed(2)}
                      </text>
                    </g>
                  )
                })}
                <text x={x(gi + 0.5)} y={height + 20} textAnchor="middle" className="axis-label">
                  {label[g]}
                </text>
              </g>
            ))}
          </>
        )
      }}
    </Frame>
  )
}

function SizeChart({ data }: { data: ManeuverData }) {
  const rows = data.recall_by_size_leo
  const lab = (r: (typeof rows)[number]) => (r.hi_m === null ? `> ${r.lo_m} m` : `${r.lo_m}–${r.hi_m} m`)
  return (
    <Frame
      title="Small burns are invisible in public element sets"
      subtitle="Recall by size of the step in mean semi-major axis · 10 LEO satellites"
      height={280}
      margin={{ top: 22, right: 12, bottom: 44, left: 44 }}
      x={(w) => linear([0, rows.length], [0, w])}
      y={(h) => linear([0, 1], [h, 0])}
      yTicks={[0, 0.25, 0.5, 0.75, 1]}
      yFormat={(v) => `${Math.round(v * 100)}%`}
      xLabel="Estimated change in semi-major axis"
      legend={METHODS.map((m) => ({ label: m.short, color: m.color }))}
    >
      {({ x, y, height, setTip }) => (
        <>
          {METHODS.map((m) => {
            const pts = rows.map((r, k) => [x(k + 0.5), y(r.n ? r[m.key] / r.n : 0)] as [number, number])
            return (
              <g key={m.key}>
                <path d={linePath(pts)} fill="none" stroke={m.color} strokeWidth={2} />
                {pts.map(([px, py], k) => (
                  <circle
                    key={k}
                    cx={px}
                    cy={py}
                    r={4.5}
                    fill={m.color}
                    stroke="#fff"
                    strokeWidth={2}
                    onMouseMove={() =>
                      setTip({
                        x: px,
                        y: py,
                        content: (
                          <>
                            {m.label} · {lab(rows[k])}
                            <br />
                            <b>
                              {rows[k][m.key]} of {rows[k].n}
                            </b>{' '}
                            found
                          </>
                        ),
                      })
                    }
                  />
                ))}
              </g>
            )
          })}
          {rows.map((r, k) => (
            <text key={k} x={x(k + 0.5)} y={height + 18} textAnchor="middle" className="tick">
              {lab(r)}
            </text>
          ))}
        </>
      )}
    </Frame>
  )
}

function TimelineChart({
  tl,
  method,
  window,
  selected,
  onSelect,
}: {
  tl: Timeline
  method: Method
  window: [number, number]
  selected: Detection | null
  onSelect: (d: Detection | null) => void
}) {
  const { t, a_m } = tl.series
  const [t0, t1] = window
  const idx = useMemo(() => {
    const out: number[] = []
    for (let k = 0; k < t.length; k++) if (t[k] >= t0 && t[k] <= t1) out.push(k)
    return out
  }, [t, t0, t1])
  const values = idx.map((k) => a_m[k])
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = Math.max((hi - lo) * 0.08, 1)
  const dets = tl.detections[method].filter((d) => d.t_end >= t0 && d.t_start <= t1)
  const truth = tl.truth.filter((u) => u.t >= t0 && u.t <= t1)
  const color = METHODS.find((m) => m.key === method)!.color
  const years = (t1 - t0) / (365.25 * 86400)
  const ticks = useMemo(() => {
    const out: number[] = []
    const start = new Date(t0 * 1000)
    const stepMonths = years > 6 ? 24 : years > 3 ? 12 : years > 1.2 ? 6 : years > 0.5 ? 2 : 1
    const d = new Date(Date.UTC(start.getUTCFullYear(), 0, 1))
    while (d.getTime() / 1000 <= t1) {
      if (d.getTime() / 1000 >= t0) out.push(d.getTime() / 1000)
      d.setUTCMonth(d.getUTCMonth() + stepMonths)
    }
    return out
  }, [t0, t1, years])
  const LANE = 46 // px reserved above the plot for the two event lanes
  return (
    <Frame
      title={`${tl.name} · mean semi-major axis`}
      subtitle={`Relative to ${fmtInt(tl.series.a_ref_km)} km · one point per published element set · click a detection for its evidence`}
      height={400}
      margin={{ top: LANE + 14, right: 16, bottom: 34, left: 58 }}
      x={(w) => linear([t0, t1], [0, w])}
      y={(h) => linear([lo - pad, hi + pad], [h, 0])}
      xTicks={ticks}
      xFormat={(v) => new Date(v * 1000).toISOString().slice(0, years > 3 ? 4 : 7)}
      yTicks={niceTicks(lo - pad, hi + pad, 5)}
      yFormat={(v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtInt(Math.abs(v))} m`}
      legend={[
        { label: 'Reported manoeuvre, found', color: '#0b1030' },
        { label: 'Reported manoeuvre, missed', color: SERIES[4] },
        { label: 'Detection matching a report', color },
        { label: 'Detection with no report (false alarm)', color: SERIES[1], shape: 'ring' },
      ]}
    >
      {({ x, y, width, height, setTip }) => (
        <>
          <text x={-8} y={-LANE + 6} textAnchor="end" className="tick">
            reported
          </text>
          <text x={-8} y={-LANE + 28} textAnchor="end" className="tick">
            detected
          </text>
          <line x1={0} x2={width} y1={-LANE + 2} y2={-LANE + 2} stroke={INK.grid} />
          <line x1={0} x2={width} y1={-LANE + 24} y2={-LANE + 24} stroke={INK.grid} />
          {selected && selected.t_end >= t0 && selected.t_start <= t1 && (
            <rect
              x={x(Math.max(selected.t_start, t0))}
              width={Math.max(3, x(Math.min(selected.t_end, t1)) - x(Math.max(selected.t_start, t0)))}
              y={-LANE + 14}
              height={height + LANE - 14}
              fill={color}
              opacity={0.1}
            />
          )}
          <path
            d={linePath(idx.map((k) => [x(t[k]), y(a_m[k])] as [number, number]))}
            fill="none"
            stroke="#0b1030"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
          {idx.length < 500 &&
            idx.map((k) => <circle key={k} cx={x(t[k])} cy={y(a_m[k])} r={1.8} fill="#0b1030" />)}
          {truth.map((u) => (
            <g
              key={u.t}
              onMouseMove={() =>
                setTip({
                  x: x(u.t),
                  y: -LANE + 2,
                  content: (
                    <>
                      Reported manoeuvre
                      <br />
                      <b>{fmtUtc(u.t, false)}</b>
                      <small>{u[method] ? 'found by this detector' : 'missed by this detector'}</small>
                    </>
                  ),
                })
              }
            >
              <line x1={x(u.t)} x2={x(u.t)} y1={-LANE + 8} y2={height} stroke={u[method] ? 'rgba(11,16,48,0.14)' : 'rgba(240,40,140,0.3)'} />
              <circle cx={x(u.t)} cy={-LANE + 2} r={4.5} fill={u[method] ? '#0b1030' : SERIES[4]} stroke="#fff" strokeWidth={1.5} />
            </g>
          ))}
          {dets.map((d) => {
            const cx = x((d.t_start + d.t_end) / 2)
            const on = selected === d
            return (
              <g
                key={d.t_start}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(on ? null : d)}
                onMouseMove={() =>
                  setTip({
                    x: cx,
                    y: -LANE + 24,
                    content: (
                      <>
                        Detection {day(d.t_start)} → {day(d.t_end)}
                        <br />
                        score <b>{d.score}</b>
                        {SCORE_UNIT[method]}
                        <small>{d.matched ? 'matches a reported manoeuvre' : 'no manoeuvre reported'}</small>
                      </>
                    ),
                  })
                }
              >
                <circle cx={cx} cy={-LANE + 24} r={11} fill="transparent" />
                {d.matched ? (
                  <circle cx={cx} cy={-LANE + 24} r={on ? 6.5 : 4.5} fill={color} stroke="#fff" strokeWidth={1.5} />
                ) : (
                  <circle cx={cx} cy={-LANE + 24} r={on ? 6 : 4} fill="#fff" stroke={SERIES[1]} strokeWidth={2.2} />
                )}
              </g>
            )
          })}
        </>
      )}
    </Frame>
  )
}

function Evidence({ d, method }: { d: Detection; method: Method }) {
  const e = d.evidence
  const row = (k: string, v: string, hint?: string) => (
    <div className="kv">
      <span>
        {k}
        {hint && <small> {hint}</small>}
      </span>
      <b className="mono">{v}</b>
    </div>
  )
  return (
    <div className="panel evidence">
      <div className="eyebrow">Detection evidence</div>
      <h3>
        {day(d.t_start)} → {day(d.t_end)}
      </h3>
      <div className="card__chips">
        <span className={`chip ${d.matched ? 'chip--blue' : 'chip--orange'}`}>
          {d.matched ? 'matches a reported manoeuvre' : 'no manoeuvre reported'}
        </span>
        {d.confidence !== null && (
          <span className="chip" title="Share of detections with at least this score, on the other satellites, that matched a reported manoeuvre">
            confidence {Math.round(d.confidence * 100)}%
          </span>
        )}
      </div>
      {row('Detector score', `${d.score}${SCORE_UNIT[method]}`)}
      {row('Δ semi-major axis', `${fmt(e.da_m, 1)} m`, 'between consecutive sets')}
      {row('Δ inclination', `${fmt(e.di_mdeg, 2)} mdeg`)}
      {row('Step in a', `${fmt(e.z_shift_a, 1)} σ`, 'level shift, 3 sets each side')}
      {row('Step in i', `${fmt(e.z_shift_i, 1)} σ`)}
      {row('RTN residual · radial', `${fmt(e.res_r_km, 2)} km`)}
      {row('RTN residual · along-track', `${fmt(e.res_t_km, 2)} km`)}
      {row('RTN residual · cross-track', `${fmt(e.res_n_km, 2)} km`)}
      {row('Gap between element sets', `${fmt(e.dt_days, 2)} d`)}
      <p className="muted">
        RTN residual = previous element set propagated with SGP4 to the epoch of the next one, minus
        the position the next one gives. Confidence is empirical: the share of detections scoring at
        least this high, on the other satellites of the same regime, that matched a report.
      </p>
    </div>
  )
}

export default function ManeuverPage({ route }: { route: Route }) {
  const [data, setData] = useState<ManeuverData | null>(null)
  const [error, setError] = useState('')
  const [sat, setSat] = useState(route.query.get('sat') ?? 'Sentinel-3A')
  const [method, setMethod] = useState<Method>((route.query.get('method') as Method) ?? 'ml')
  const [tl, setTl] = useState<Timeline | null>(null)
  const [range, setRange] = useState<[number, number]>([0, 1000])
  const [selected, setSelected] = useState<Detection | null>(null)

  useEffect(() => {
    loadJson<ManeuverData>('maneuvers.json').then(setData).catch((e) => setError(String(e)))
  }, [])
  useEffect(() => {
    setSelected(null)
    loadJson<Timeline>(`maneuvers/${sat}.json`)
      .then((timeline) => {
        setTl(timeline)
        setRange([700, 1000]) // most recent 30 % of the labelled period
      })
      .catch((e) => setError(String(e)))
  }, [sat])
  useEffect(() => setSelected(null), [method])

  if (error) return <main className="page"><p className="note">Results not built yet: {error}. Run <span className="mono">make maneuvers</span>.</p></main>
  if (!data) return <main className="page" />
  const S = data.summary
  const A = data.physics_ablation
  const summary = data.satellites.find((s) => s.name === sat)
  const span = tl ? [tl.series.t[0], tl.series.t[tl.series.t.length - 1]] : [0, 1]
  const win: [number, number] = [
    span[0] + (range[0] / 1000) * (span[1] - span[0]),
    span[0] + (range[1] / 1000) * (span[1] - span[0]),
  ]
  const small = data.recall_by_size_leo[0]
  return (
    <main className="page">
      <header className="page__head rise">
        <div className="eyebrow">Module 03 · Manoeuvre detection</div>
        <h1>Did that satellite just move?</h1>
        <p>
          Operators rarely announce manoeuvres, but a burn leaves a mark in the public orbital
          elements: the semi-major axis steps, and yesterday's elements stop predicting today's
          position. Three detectors were tested on {fmtInt(data.totals.element_sets)} element sets of{' '}
          {data.totals.satellites} satellites whose operators <em>do</em> publish their manoeuvres —{' '}
          {fmtInt(data.totals.reported_maneuvers)} reported burns.
        </p>
      </header>

      <section className="verdict rise">
        <div className="verdict__main">
          <div className="eyebrow">Result</div>
          <h2>
            A classifier finds {Math.round(S.ml.ALL.recall * 100)}% of reported manoeuvres with{' '}
            {Math.round(S.ml.ALL.precision * 100)}% precision. One physical quantity gets most of the way.
          </h2>
          <p>
            F1: classifier {fmt(S.ml.ALL.f1, 2)}, physics baseline {fmt(S.physics.ALL.f1, 2)}, CUSUM{' '}
            {fmt(S.cusum.ALL.f1, 2)}. The ablation is the humbling part: a detector that looks only
            at the step in semi-major axis scores {fmt(A.a.ALL.f1, 2)}. The machine-learning model
            adds about {Math.round((S.ml.ALL.f1 - A.a.ALL.f1) * 100)} points over that, not {Math.round((S.ml.ALL.f1 - S.physics.ALL.f1) * 100)}.
          </p>
        </div>
        <div className="verdict__stats">
          <div className="stat">
            <span className="stat__v">{fmt(S.ml.ALL.f1, 3)}</span>
            <span className="stat__l">F1, gradient-boosted classifier</span>
          </div>
          <div className="stat">
            <span className="stat__v">{fmt(S.physics.ALL.f1, 3)}</span>
            <span className="stat__l">F1, physics baseline (a + i)</span>
          </div>
          <div className="stat">
            <span className="stat__v">{fmt(S.cusum.ALL.f1, 3)}</span>
            <span className="stat__l">F1, CUSUM change detector</span>
          </div>
          <div className="stat">
            <span className="stat__v">
              {small.ml}/{small.n}
            </span>
            <span className="stat__l">burns under 1 m in semi-major axis found by the best detector</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Timeline by satellite</h2>
        <p className="lede">
          Pick a satellite and a detector. The top lane shows what the operator reported, the second
          what the detector flagged. Every number for a satellite comes from thresholds and models
          that never saw that satellite's labels.
        </p>
        <div className="sat-list" role="group" aria-label="Satellite">
          {data.satellites.map((s) => (
            <button key={s.name} aria-pressed={s.name === sat} onClick={() => setSat(s.name)}>
              {s.name}
            </button>
          ))}
        </div>
        <div className="tl-controls">
          <div className="seg" role="group" aria-label="Detector">
            {METHODS.map((m) => (
              <button key={m.key} aria-pressed={method === m.key} onClick={() => setMethod(m.key)}>
                {m.short}
              </button>
            ))}
          </div>
          {summary && (
            <div className="tl-stats mono">
              <span className="chip">{summary.regime}</span>
              <span>NORAD {summary.satcat}</span>
              <span>{fmtInt(summary.element_sets)} element sets</span>
              <span>{summary.maneuver_events} manoeuvre events</span>
              <span>
                P {fmt(summary.metrics[method].precision, 2)} · R {fmt(summary.metrics[method].recall, 2)} · F1{' '}
                {fmt(summary.metrics[method].f1, 2)}
              </span>
            </div>
          )}
        </div>
        {tl && (
          <div className="tl-grid">
            <div className="panel">
              <TimelineChart tl={tl} method={method} window={win} selected={selected} onSelect={setSelected} />
              <div className="tl-range">
                <span className="mono">{day(win[0])}</span>
                <DualRange
                  label="Time window"
                  min={0}
                  max={1000}
                  value={range}
                  onChange={([a, b]) => setRange(b - a < 15 ? range : [a, b])}
                />
                <span className="mono">{day(win[1])}</span>
              </div>
            </div>
            {selected ? (
              <Evidence d={selected} method={method} />
            ) : (
              <div className="panel evidence evidence--empty">
                <div className="eyebrow">Detection evidence</div>
                <p>
                  Click a marker in the “detected” lane to see what the detector saw: the step in
                  semi-major axis and inclination, the RTN residual, and how often a detection this
                  strong was right on other satellites.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="section">
        <h2>Three detectors, one protocol</h2>
        <div className="grid-3">
          <div className="panel prose">
            <div className="eyebrow">1 · Physics</div>
            <p>
              Step in mean semi-major axis and inclination: median of the three element sets after
              minus the three before, minus the drag trend, in robust sigmas of the satellite's own
              recent noise. A bad element set is a spike; a burn is a step that stays.
            </p>
          </div>
          <div className="panel prose">
            <div className="eyebrow">2 · CUSUM</div>
            <p>
              Page's cumulative-sum test on the day-to-day changes. In theory it catches small
              shifts spread over several sets; in practice it also accumulates every noisy stretch.
            </p>
          </div>
          <div className="panel prose">
            <div className="eyebrow">3 · Classifier</div>
            <p>
              LightGBM on windowed features of each interval: the steps above, RTN residuals,
              raw magnitudes and their neighbours two sets each way. Trained on 14 satellites, tested
              on the 15th, fifteen times.
            </p>
          </div>
        </div>
        <div className="grid-2" style={{ marginTop: 20 }}>
          <div className="panel">
            <MethodBars data={data} />
          </div>
          <div className="panel">
            <SizeChart data={data} />
          </div>
        </div>
        <p className="note note--blue" style={{ marginTop: 20 }}>
          The drop for the largest burns is not a sensitivity problem: {data.large_burn_misses.with_another_reported_burn_within_4_days} of the{' '}
          {data.large_burn_misses.missed} missed burns above 100 m have another reported burn within four days.
          They are orbit-change campaigns; at one element set per day the detector sees one long
          event, and the one-to-one matching credits it once.
        </p>
      </section>

      <section className="section">
        <h2>Ablation and per-satellite results</h2>
        <div className="grid-2">
          <div className="panel">
            <div className="eyebrow">Physics baseline variants</div>
            <div className="table-wrap">
              <table className="data" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Signal</th>
                    <th className="num">Precision</th>
                    <th className="num">Recall</th>
                    <th className="num">F1</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['jump', 'Raw jumps + RTN residual (no spike protection)'],
                      ['a', 'Step in semi-major axis'],
                      ['a+i', 'Step in a or inclination (declared baseline)'],
                      ['a+i&rtn', 'Step in a or i, confirmed by RTN residual'],
                    ] as const
                  ).map(([key, label]) => (
                    <tr key={key} className={key === 'a+i' ? 'hl' : ''}>
                      <td>{label}</td>
                      <td className="num">{fmt(A[key].ALL.precision, 2)}</td>
                      <td className="num">{fmt(A[key].ALL.recall, 2)}</td>
                      <td className="num">{fmt(A[key].ALL.f1, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              The first row is what the brief asked for literally: threshold single-interval jumps and
              RTN residuals. Every bad element set fires it twice. Requiring an RTN confirmation
              (last row) removed true detections faster than false ones.
            </p>
          </div>
          <div className="panel">
            <div className="eyebrow">F1 by satellite</div>
            <div className="table-wrap">
              <table className="data" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Satellite</th>
                    <th className="num">Events</th>
                    <th className="num">Physics</th>
                    <th className="num">CUSUM</th>
                    <th className="num">ML</th>
                  </tr>
                </thead>
                <tbody>
                  {data.satellites.map((s) => (
                    <tr key={s.name} className={s.name === sat ? 'hl' : ''} onClick={() => setSat(s.name)} style={{ cursor: 'pointer' }}>
                      <td>
                        {s.name} <span className="chip">{s.regime}</span>
                      </td>
                      <td className="num">{s.maneuver_events}</td>
                      <td className="num">{fmt(s.metrics.physics.f1, 2)}</td>
                      <td className="num">{fmt(s.metrics.cusum.f1, 2)}</td>
                      <td className="num">{fmt(s.metrics.ml.f1, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Method and limits</h2>
        <div className="grid-3">
          <div className="panel prose">
            <div className="eyebrow">Matching rule</div>
            <p>
              Reported burns closer than 1.5 days count as one event. A detection explains an event
              if the burn falls between two days before its first flagged interval and the end of its
              last. One detection, one event. Changing the two days to one or three moves F1 by{' '}
              {fmt(Math.abs(data.lag_sensitivity.ml['3.0'].f1 - data.lag_sensitivity.ml['1.0'].f1), 3)}.
            </p>
          </div>
          <div className="panel prose">
            <div className="eyebrow">Limits</div>
            <p>
              Fifteen well-tracked science and weather satellites doing impulsive station-keeping.
              Nothing here covers low-thrust electric propulsion (Starlink-style), nor objects with
              sparse tracking. Labels are operator reports; an unreported burn counts as a false
              alarm. Detector design was iterated on these same satellites — only thresholds and
              model fits are out-of-sample.
            </p>
          </div>
          <div className="panel prose">
            <div className="eyebrow">Reproduce</div>
            <p className="mono small">make data maneuvers</p>
            <p>
              <a href={data.meta.dataset.url} target="_blank" rel="noreferrer">
                {data.meta.dataset.name}
              </a>{' '}
              at commit {data.meta.dataset.commit.slice(0, 7)} ({data.meta.dataset.paper}). Element sets
              originally from Space-Track.org; labels via the International DORIS Service. Code{' '}
              {data.meta.code_version} · {Math.round(data.meta.runtime_s)} s.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}
