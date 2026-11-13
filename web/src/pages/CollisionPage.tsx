import { useEffect, useMemo, useState } from 'react'
import { Frame, INK, SERIES, barPath, linePath, linear, log10Scale } from '../components/charts'
import Footer from '../components/Footer'
import { fmt, fmtInt, loadJson } from '../lib/format'
import { gated, outcome, score, type Outcome } from '../lib/score'
import './pages.css'

interface Result {
  key: string
  name: string
  kind: string
  cv_L: number | null
  threshold?: number
  L: number
  mse_hr: number
  f2: number
  precision: number
  recall: number
  tp: number
  fp: number
  fn: number
  L_ci95: [number, number]
  delta_vs_reference_ci95: [number, number]
  p_better_than_reference: number
}
interface Bin {
  lo: number
  hi: number
  n: number
  n_high_final: number
  p_high_final: number | null
}
interface Reliability {
  bins: { mean_predicted: number; observed: number; n: number }[]
  ece: number
  brier: number
  base_rate: number
}
interface FnProfile {
  n: number
  latest_risk_below_minus_10: number
  latest_risk_floor_minus_30: number
  latest_risk_between_minus_7_and_minus_6: number
  median_latest_risk: number
  median_true_risk: number
}
export interface CollisionData {
  meta: {
    generated_at: string
    code_version: string
    runtime_s: number
    dataset: { name: string; doi: string; license: string; md5: string; citation: string }
    protocol: Record<string, number | number[]>
  }
  dataset: {
    train: Record<string, number>
    test: Record<string, number>
  }
  results: Result[]
  published: { team: string; L: number; mse_hr: number | null; f2: number | null }[]
  selection: {
    cv_L_lrp: number
    cv_L_gbm_gate: number
    /** threshold and value model chosen inside each fold */
    cv_L_gbm_gate_nested?: number
    selected_by_rule: string
    oracle_threshold_diagnostic: { threshold: number; L: number }
  }
  transition: { train_protocol: Bin[]; test: Bin[] }
  calibration: Record<string, Reliability>
  false_negatives: Record<string, FnProfile>
  importance: { feature: string; gain: number }[]
  examples: { event_id: number; label: string; time_to_tca: number[]; risk: number[] }[]
  events: {
    event_id: number[]
    true_risk: number[]
    latest_risk: number[]
    gbm_prob: number[]
    gbm_value: number[]
    gbm_direct: number[]
    gru_pred?: number[]
  }
}

const OUTCOME: Record<Outcome, { label: string; color: string }> = {
  tp: { label: 'High risk, flagged', color: SERIES[0] },
  fn: { label: 'High risk, missed (false negative)', color: SERIES[4] },
  fp: { label: 'Low risk, flagged (false alarm)', color: SERIES[1] },
  tn: { label: 'Low risk, not flagged', color: '#c3c9dc' },
}
const binLabel = (b: Bin) => (b.lo <= -30 ? '−30' : `${b.lo}`.replace('-', '−'))

function ResultsChart({ data }: { data: CollisionData }) {
  const rows = data.results.filter((r) => r.key !== 'crp')
  const winner = data.published[0]
  const height = rows.length * 46 + 60
  return (
    <Frame
      title="Challenge loss L on the official test set (lower is better)"
      subtitle="Dot = score · bar = 95% bootstrap interval over the 2,167 test events"
      height={height}
      margin={{ top: 8, right: 24, bottom: 40, left: 196 }}
      x={(w) => linear([0, 3.2], [0, w])}
      y={(h) => linear([0, rows.length], [0, h])}
      xTicks={[0, 0.5, 1, 1.5, 2, 2.5, 3]}
      xLabel="L = MSE_HR / F2"
      legend={[
        { label: 'Baseline', color: '#0b1030' },
        { label: 'Learned model', color: SERIES[0] },
        { label: `Challenge winner (${winner.L})`, color: SERIES[1], shape: 'line' },
      ]}
    >
      {({ x, y, height: h, setTip }) => (
        <>
          <line x1={x(winner.L)} x2={x(winner.L)} y2={h} stroke={SERIES[1]} strokeWidth={1.5} strokeDasharray="4 3" />
          {rows.map((r, k) => {
            const cy = y(k + 0.5)
            const color = r.kind === 'baseline' ? '#0b1030' : SERIES[0]
            return (
              <g
                key={r.key}
                onMouseMove={() =>
                  setTip({
                    x: x(r.L),
                    y: cy,
                    content: (
                      <>
                        {r.name}
                        <br />
                        L <b>{fmt(r.L, 3)}</b> · 95% [{fmt(r.L_ci95[0], 2)}, {fmt(r.L_ci95[1], 2)}]
                        <small>
                          MSE_HR {fmt(r.mse_hr, 3)} · F2 {fmt(r.f2, 3)} · {r.fn} missed · {r.fp} false alarms
                        </small>
                      </>
                    ),
                  })
                }
              >
                <rect x={-196} y={cy - 20} width={x.range[1] + 196} height={40} fill="transparent" />
                <text x={-12} y={cy} dy="0.32em" textAnchor="end" className="mark-label">
                  {r.name}
                </text>
                <line x1={x(r.L_ci95[0])} x2={x(Math.min(r.L_ci95[1], 3.2))} y1={cy} y2={cy} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.35} />
                <circle cx={x(r.L)} cy={cy} r={5.5} fill={color} stroke="#fff" strokeWidth={2} />
                <text x={x(Math.min(r.L_ci95[1], 3.2)) + 8} y={cy} dy="0.32em" className="mark-label mono">
                  {fmt(r.L, 3)}
                </text>
              </g>
            )
          })}
        </>
      )}
    </Frame>
  )
}

function TransitionChart({ data }: { data: CollisionData }) {
  const train = data.transition.train_protocol
  const test = data.transition.test
  return (
    <Frame
      title="Same input, different outcome"
      subtitle="Share of events that end high-risk, by the last risk known two days before closest approach"
      height={300}
      x={(w) => linear([0, train.length], [0, w])}
      y={(h) => linear([0, 1], [h, 0])}
      yTicks={[0, 0.25, 0.5, 0.75, 1]}
      yFormat={(v) => `${Math.round(v * 100)}%`}
      xLabel="Latest known risk, log10 (bin lower edge)"
      legend={[
        { label: 'Training set (same filters as test)', color: SERIES[0], shape: 'square' },
        { label: 'Test set', color: SERIES[1], shape: 'square' },
      ]}
    >
      {({ x, y, height, setTip }) => {
        const band = x(1) - x(0)
        const w = Math.min(22, band * 0.34)
        return (
          <>
            {train.map((b, k) => {
              const cx = x(k + 0.5)
              const pt = b.p_high_final ?? 0
              const pe = test[k].p_high_final ?? 0
              return (
                <g
                  key={b.lo}
                  onMouseMove={() =>
                    setTip({
                      x: cx,
                      y: y(Math.max(pt, pe)),
                      content: (
                        <>
                          Latest risk {binLabel(b)} … {b.hi}
                          <br />
                          train <b>{(pt * 100).toFixed(1)}%</b> ({b.n_high_final}/{fmtInt(b.n)})
                          <br />
                          test <b>{(pe * 100).toFixed(1)}%</b> ({test[k].n_high_final}/{fmtInt(test[k].n)})
                        </>
                      ),
                    })
                  }
                >
                  <rect x={x(k)} width={band} height={height} fill="transparent" />
                  <path d={barPath(cx - w - 1, w, y(0), y(pt))} fill={SERIES[0]} />
                  <path d={barPath(cx + 1, w, y(0), y(pe))} fill={SERIES[1]} />
                  <text x={cx} y={height + 18} textAnchor="middle" className="tick">
                    {binLabel(b)}
                  </text>
                </g>
              )
            })}
          </>
        )
      }}
    </Frame>
  )
}

function CalibrationChart({ data }: { data: CollisionData }) {
  const series = [
    { key: 'gbm_train_oof', label: 'Training set, out-of-fold', color: SERIES[0] },
    { key: 'gbm_test', label: 'Test set', color: SERIES[1] },
  ]
  const dom: [number, number] = [1e-4, 1]
  const ticks = [1e-4, 1e-3, 1e-2, 1e-1, 1]
  const pf = (v: number) => (v >= 0.01 ? `${Math.round(v * 100)}%` : `${v * 100}%`)
  return (
    <Frame
      title="Calibration of the classifier's probability"
      subtitle="Predicted vs observed share of high-risk events (log axes, 10 equal-size bins)"
      height={300}
      x={(w) => log10Scale(dom, [0, w])}
      y={(h) => log10Scale(dom, [h, 0])}
      xTicks={ticks}
      yTicks={ticks}
      xFormat={pf}
      yFormat={pf}
      xLabel="Predicted probability of ending high-risk"
      yLabel="Observed frequency"
      legend={[
        ...series.map((s) => ({ label: s.label, color: s.color })),
        { label: 'Perfect calibration', color: INK.axis, shape: 'line' as const },
      ]}
    >
      {({ x, y, setTip }) => (
        <>
          <line x1={x(dom[0])} y1={y(dom[0])} x2={x(1)} y2={y(1)} stroke={INK.axis} strokeDasharray="4 3" />
          {series.map((s) => {
            const bins = data.calibration[s.key].bins.filter((b) => b.observed > 0)
            const pts = bins.map((b) => [x(b.mean_predicted), y(b.observed)] as [number, number])
            return (
              <g key={s.key}>
                <path d={linePath(pts)} fill="none" stroke={s.color} strokeWidth={2} />
                {bins.map((b, k) => (
                  <circle
                    key={k}
                    cx={pts[k][0]}
                    cy={pts[k][1]}
                    r={4.5}
                    fill={s.color}
                    stroke="#fff"
                    strokeWidth={2}
                    onMouseMove={() =>
                      setTip({
                        x: pts[k][0],
                        y: pts[k][1],
                        content: (
                          <>
                            {s.label}
                            <br />
                            predicted <b>{(b.mean_predicted * 100).toFixed(2)}%</b> · observed{' '}
                            <b>{(b.observed * 100).toFixed(2)}%</b>
                            <small>{b.n} events in bin</small>
                          </>
                        ),
                      })
                    }
                  />
                ))}
              </g>
            )
          })}
        </>
      )}
    </Frame>
  )
}

function Explorer({ data }: { data: CollisionData }) {
  const ev = data.events
  const gate = data.results.find((r) => r.key === 'gbm_gate')!
  const tauCv = gate.threshold!
  // slider works in log10(tau)
  const [logTau, setLogTau] = useState(Math.log10(tauCv))
  const [model, setModel] = useState<'gbm_gate' | 'lrp'>('gbm_gate')
  const tau = 10 ** logTau
  useEffect(() => {
    // capture hook used by scripts/content.cjs to animate the slider deterministically
    ;(window as unknown as { __raanCol?: unknown }).__raanCol = { setLogTau, setModel }
  }, [])
  const pred = useMemo(
    () => (model === 'lrp' ? ev.latest_risk : gated(ev.gbm_prob, ev.gbm_value, tau)),
    [model, tau, ev],
  )
  const s = useMemo(() => score(ev.true_risk, pred), [ev, pred])
  const lrp = useMemo(() => score(ev.true_risk, ev.latest_risk), [ev])
  const order = useMemo(() => {
    // draw the rare, important classes last (on top)
    const rank: Record<Outcome, number> = { tn: 0, fp: 1, tp: 2, fn: 3 }
    return ev.true_risk
      .map((_, k) => k)
      .sort((a, b) => rank[outcome(ev.true_risk[a], pred[a])] - rank[outcome(ev.true_risk[b], pred[b])])
  }, [ev, pred])
  const dom: [number, number] = [-31, -1.5]
  const ticks = [-30, -25, -20, -15, -10, -6, -2]
  // deterministic jitter so the 1,300 events sitting at exactly −30 do not hide each other
  const jit = (k: number, salt: number) => (((k * 2654435761 + salt * 40503) >>> 0) / 4294967296 - 0.5) * 0.9
  return (
    <div className="explorer">
      <div className="explorer__controls panel">
        <div className="seg" role="group" aria-label="Model">
          <button aria-pressed={model === 'gbm_gate'} onClick={() => setModel('gbm_gate')}>
            LightGBM gate
          </button>
          <button aria-pressed={model === 'lrp'} onClick={() => setModel('lrp')}>
            Naive forecast
          </button>
        </div>
        <label className={`slider${model === 'lrp' ? ' is-off' : ''}`}>
          <span>
            Gate threshold τ <b className="mono">{tau.toFixed(4)}</b>
          </span>
          <input
            type="range"
            min={-3}
            max={-0.3}
            step={0.01}
            value={logTau}
            disabled={model === 'lrp'}
            onChange={(e) => setLogTau(Number(e.target.value))}
          />
          <span className="slider__marks">
            <button className="link" onClick={() => setLogTau(Math.log10(tauCv))}>
              τ chosen by cross-validation ({tauCv.toFixed(4)})
            </button>
          </span>
        </label>
        <div className="explorer__stats">
          <div className="stat">
            <span className="stat__v" style={{ color: s.L < lrp.L ? 'var(--blue)' : 'var(--ink)' }}>
              {Number.isFinite(s.L) ? fmt(s.L, 3) : '∞'}
            </span>
            <span className="stat__l">loss L (naive: {fmt(lrp.L, 3)})</span>
          </div>
          <div className="stat">
            <span className="stat__v">{s.fn}</span>
            <span className="stat__l">high-risk events missed, of {s.tp + s.fn}</span>
          </div>
          <div className="stat">
            <span className="stat__v">{s.fp}</span>
            <span className="stat__l">false alarms</span>
          </div>
          <div className="stat">
            <span className="stat__v">{fmt(s.f2, 3)}</span>
            <span className="stat__l">F2 · MSE_HR {fmt(s.mse_hr, 3)}</span>
          </div>
        </div>
        <p className="muted">
          Moving τ on this page is tuning on the test labels. It shows the trade-off; it is not a
          result. The reported score uses the τ fixed beforehand on training data.
        </p>
      </div>
      <Frame
        title="Every test event: what was known two days out vs what happened"
        subtitle="2,167 events · values below −30 are stored as −30 in the dataset · small jitter added"
        height={460}
        x={(w) => linear(dom, [0, w])}
        y={(h) => linear(dom, [h, 0])}
        xTicks={ticks}
        yTicks={ticks}
        xFormat={(v) => `${v}`.replace('-', '−')}
        yFormat={(v) => `${v}`.replace('-', '−')}
        xLabel="Latest known risk (log10), ≥ 2 days before closest approach"
        yLabel="True final risk (log10)"
        legend={(['tp', 'fn', 'fp', 'tn'] as Outcome[]).map((o) => ({
          label: `${OUTCOME[o].label} · ${s[o]}`,
          color: OUTCOME[o].color,
        }))}
      >
        {({ x, y, width, height, setTip }) => (
          <>
            <rect x={0} y={0} width={width} height={y(-6)} fill="rgba(240,40,140,0.045)" />
            <line x1={0} x2={width} y1={y(-6)} y2={y(-6)} stroke={INK.axis} strokeDasharray="4 3" />
            <line x1={x(-6)} x2={x(-6)} y1={0} y2={height} stroke={INK.axis} strokeDasharray="4 3" />
            <text x={width - 6} y={y(-6) - 6} textAnchor="end" className="mark-label mark-label--muted">
              high-risk threshold 10⁻⁶
            </text>
            {order.map((k) => {
              const o = outcome(ev.true_risk[k], pred[k])
              const cx = x(ev.latest_risk[k] + (ev.latest_risk[k] <= -29.9 ? jit(k, 1) : 0))
              const cy = y(ev.true_risk[k] + (ev.true_risk[k] <= -29.9 ? jit(k, 2) : 0))
              return (
                <circle
                  key={k}
                  cx={cx}
                  cy={cy}
                  r={o === 'tn' ? 2.2 : 3.6}
                  fill={OUTCOME[o].color}
                  opacity={o === 'tn' ? 0.55 : 0.9}
                  stroke={o === 'tn' ? 'none' : '#fff'}
                  strokeWidth={0.8}
                  onMouseMove={() =>
                    setTip({
                      x: cx,
                      y: cy,
                      content: (
                        <>
                          Event {ev.event_id[k]} · {OUTCOME[o].label}
                          <br />
                          latest <b>{fmt(ev.latest_risk[k], 2)}</b> → final <b>{fmt(ev.true_risk[k], 2)}</b>
                          <small>
                            P(high) {(ev.gbm_prob[k] * 100).toFixed(2)}% · predicted {fmt(pred[k], 2)}
                          </small>
                        </>
                      ),
                    })
                  }
                />
              )
            })}
          </>
        )}
      </Frame>
    </div>
  )
}

function Examples({ data }: { data: CollisionData }) {
  const picks = data.examples.filter((_, k) => k % 2 === 0)
  return (
    <div className="grid-2">
      {picks.map((e) => (
        <div className="panel" key={e.event_id}>
          <Frame
            title={e.label.replace(/^./, (c) => c.toUpperCase())}
            subtitle={`Training event ${e.event_id} · ${e.risk.length} CDMs`}
            height={210}
            margin={{ top: 10, right: 14, bottom: 40, left: 44 }}
            x={(w) => linear([7, 0], [0, w])}
            y={(h) => linear([-31, -2], [h, 0])}
            xTicks={[7, 6, 5, 4, 3, 2, 1, 0]}
            yTicks={[-30, -20, -10, -6]}
            yFormat={(v) => `${v}`.replace('-', '−')}
            xLabel="Days to closest approach"
          >
            {({ x, y, height, width, setTip }) => {
              const pts = e.time_to_tca
                .map((t, k) => [x(Math.min(t, 7)), y(e.risk[k])] as [number, number])
                .filter((_, k) => e.time_to_tca[k] <= 7)
              return (
                <>
                  <rect x={x(2)} width={width - x(2)} height={height} fill="rgba(255,122,26,0.09)" />
                  <text x={x(2) + 6} y={12} className="mark-label mark-label--muted">
                    hidden from the model
                  </text>
                  <line x1={0} x2={width} y1={y(-6)} y2={y(-6)} stroke={INK.axis} strokeDasharray="4 3" />
                  <path d={linePath(pts)} fill="none" stroke={SERIES[0]} strokeWidth={2} />
                  {pts.map(([px, py], k) => (
                    <circle
                      key={k}
                      cx={px}
                      cy={py}
                      r={4}
                      fill={SERIES[0]}
                      stroke="#fff"
                      strokeWidth={1.5}
                      onMouseMove={() =>
                        setTip({
                          x: px,
                          y: py,
                          content: (
                            <>
                              risk <b>{fmt(e.risk[k], 2)}</b>
                              <small>{fmt(e.time_to_tca[k], 2)} days before closest approach</small>
                            </>
                          ),
                        })
                      }
                    />
                  ))}
                </>
              )
            }}
          </Frame>
        </div>
      ))}
    </div>
  )
}

export default function CollisionPage() {
  const [data, setData] = useState<CollisionData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    loadJson<CollisionData>('collision.json').then(setData).catch((e) => setError(String(e)))
  }, [])
  if (error) return <main className="page"><p className="note">Results not built yet: {error}. Run <span className="mono">make collision</span>.</p></main>
  if (!data) return <main className="page" />
  const by = Object.fromEntries(data.results.map((r) => [r.key, r]))
  const { train, test } = data.dataset
  const lrp = by.lrp
  const gate = by.gbm_gate
  const fnL = data.false_negatives.lrp
  const tr6 = data.transition.train_protocol.find((b) => b.lo === -6)!
  const te6 = data.transition.test.find((b) => b.lo === -6)!
  return (
    <main className="page">
      <header className="page__head rise">
        <div className="eyebrow">Module 02 · Collision Research Lab</div>
        <h1>Can a model beat “nothing will change”?</h1>
        <p>
          Two days before a close approach, an operator must decide whether to manoeuvre. ESA
          released {fmtInt(train.cdms + test.cdms)} real conjunction messages and asked: from what is
          known at that point, predict the final collision risk. The honest reference is the naive
          forecast — <em>the risk will stay where it is</em>. This page reproduces that reference
          exactly, trains three models against it, and reports what happened.
        </p>
      </header>

      <section className="verdict rise">
        <div className="verdict__main">
          <div className="eyebrow">Result</div>
          <h2>
            No model here is a validated improvement over the naive forecast.
          </h2>
          <p>
            The best learned model scores L = {fmt(gate.L, 3)} on the test set against{' '}
            {fmt(lrp.L, 3)} for the naive forecast — but cross-validation on the training data said
            the opposite ({fmt(data.selection.cv_L_gbm_gate, 2)} vs {fmt(data.selection.cv_L_lrp, 2)}
            {data.selection.cv_L_gbm_gate_nested != null &&
              `, and ${fmt(data.selection.cv_L_gbm_gate_nested, 2)} when the threshold is also chosen inside each fold`}
            ), and the 95% interval of the difference, [{fmt(gate.delta_vs_reference_ci95[0], 2)},{' '}
            {fmt(gate.delta_vs_reference_ci95[1], 2)}],{' '}
            {gate.delta_vs_reference_ci95[0] <= 0 && gate.delta_vs_reference_ci95[1] >= 0
              ? 'includes zero'
              : 'excludes zero'}
            . Choosing a model because it wins on the test set is exactly the mistake this lab is
            built to avoid.
          </p>
        </div>
        <div className="verdict__stats">
          <div className="stat">
            <span className="stat__v">{fmt(lrp.L, 3)}</span>
            <span className="stat__l">naive forecast, reproduced (paper: 0.694)</span>
          </div>
          <div className="stat">
            <span className="stat__v">{fmt(gate.L, 3)}</span>
            <span className="stat__l">best learned model, test set</span>
          </div>
          <div className="stat">
            <span className="stat__v">{Math.round(gate.p_better_than_reference * 100)}%</span>
            <span className="stat__l">of bootstrap resamples where it wins (usual bar: 95%)</span>
          </div>
          <div className="stat">
            <span className="stat__v">{train.events_protocol_high_risk}</span>
            <span className="stat__l">high-risk training events usable under test conditions</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Scores</h2>
        <p className="lede">
          Official metric: L = MSE<sub>HR</sub> / F<sub>2</sub>. An event is high-risk when its final
          collision probability is at least 10⁻⁶. MSE<sub>HR</sub> is the squared error on truly
          high-risk events; F<sub>2</sub> rewards catching them (recall counts four times as much as
          precision).
        </p>
        <div className="panel">
          <ResultsChart data={data} />
        </div>
        <div className="table-wrap" style={{ marginTop: 20 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">L test</th>
                <th className="num">95% interval</th>
                <th className="num">L cross-val.</th>
                <th className="num">MSE_HR</th>
                <th className="num">F2</th>
                <th className="num">Missed</th>
                <th className="num">False alarms</th>
                <th className="num">P(beats naive)</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.key} className={r.key === 'lrp' ? 'hl' : ''}>
                  <td>{r.name}</td>
                  <td className="num">{fmt(r.L, 3)}</td>
                  <td className="num">
                    {fmt(r.L_ci95[0], 2)} – {fmt(r.L_ci95[1], 2)}
                  </td>
                  <td className="num">{r.cv_L === null ? '—' : fmt(r.cv_L, 2)}</td>
                  <td className="num">{fmt(r.mse_hr, 3)}</td>
                  <td className="num">{fmt(r.f2, 3)}</td>
                  <td className="num">
                    {r.fn} / {r.tp + r.fn}
                  </td>
                  <td className="num">{r.fp}</td>
                  <td className="num">
                    {r.key === 'lrp' ? '—' : `${Math.round(r.p_better_than_reference * 100)}%`}
                  </td>
                </tr>
              ))}
              {data.published.slice(0, 3).map((p) => (
                <tr key={p.team} className="ref">
                  <td>
                    {p.team} <span className="chip">published, 2019</span>
                  </td>
                  <td className="num">{fmt(p.L, 3)}</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num">{p.mse_hr === null ? '—' : fmt(p.mse_hr, 3)}</td>
                  <td className="num">{p.f2 === null ? '—' : fmt(p.f2, 3)}</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Published rows are the top three of 97 teams (Uriot et al., Table 3). Only 12 teams beat the
          naive forecast. Cross-validated L is computed on training events filtered like the test set.
        </p>
      </section>

      <section className="section">
        <h2>Why this is hard: the test set is not the training set</h2>
        <p className="lede">
          ESA states that both sets were hand-picked to over-represent high-risk events. The effect is
          measurable. Among training events that satisfy the test conditions, {train.events_protocol_high_risk}{' '}
          of {fmtInt(train.events_protocol)} end high-risk ({(train.prevalence_protocol * 100).toFixed(1)}%). In the
          test set it is {test.events_high_risk} of {fmtInt(test.events)} ({(test.prevalence * 100).toFixed(1)}%).
          And it is not only the base rate: an event whose latest risk is between 10⁻⁶ and 10⁻⁵ ends
          high-risk {((tr6.p_high_final ?? 0) * 100).toFixed(0)}% of the time in training and{' '}
          {((te6.p_high_final ?? 0) * 100).toFixed(0)}% of the time in test.
        </p>
        <div className="grid-2">
          <div className="panel">
            <TransitionChart data={data} />
          </div>
          <div className="panel">
            <CalibrationChart data={data} />
          </div>
        </div>
        <p className="note note--blue" style={{ marginTop: 20 }}>
          Consequence: a classifier trained on the training set under-estimates risk on the test set
          by roughly an order of magnitude (right-hand chart), and a gate threshold tuned for 0.8 %
          prevalence happens to work well at 6.9 %. That is the main reason the LightGBM gate looks
          better on test than in cross-validation — a property of how the split was made, not of the
          model.
        </p>
      </section>

      <section className="section">
        <h2>Explore the trade-off</h2>
        <p className="lede">
          Each dot is one test event. Events above the dashed line ended high-risk. The naive forecast
          flags everything to the right of the vertical line. The gate model flags an event when its
          predicted probability exceeds τ.
        </p>
        <Explorer data={data} />
      </section>

      <section className="section">
        <h2>Error analysis: the events nobody could see coming</h2>
        <p className="lede">
          The naive forecast misses {fnL.n} of {lrp.tp + lrp.fn} high-risk events.{' '}
          {fnL.latest_risk_between_minus_7_and_minus_6} of them were just under the threshold two days
          out (between 10⁻⁷ and 10⁻⁶) — close calls a model can plausibly learn. But{' '}
          {fnL.latest_risk_below_minus_10} had a latest risk below 10⁻¹⁰, {fnL.latest_risk_floor_minus_30} of them at
          the dataset floor: the risk appeared in the final two days, after new tracking data arrived.
          No feature available at decision time separates those from the {fmtInt(data.transition.test[0].n)}{' '}
          other test events at the floor.
        </p>
        <Examples data={data} />
        <div className="grid-2" style={{ marginTop: 20 }}>
          <div className="panel">
            <div className="eyebrow">What the classifier looks at</div>
            <table className="data" style={{ marginTop: 8 }}>
              <tbody>
                {data.importance.slice(0, 8).map((f) => (
                  <tr key={f.feature}>
                    <td className="mono">{f.feature}</td>
                    <td style={{ width: '50%' }}>
                      <div className="hbar">
                        <i style={{ width: `${(f.gain / data.importance[0].gain) * 100}%` }} />
                      </div>
                    </td>
                    <td className="num">{(f.gain * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 8 }}>
              Share of total split gain. The risk history dominates: the model is mostly a smoothed
              naive forecast.
            </p>
          </div>
          <div className="panel prose">
            <div className="eyebrow">What did not work, and why</div>
            <p>
              <b>Direct regression (L = {fmt(by.gbm_direct.L, 2)}).</b> Trained on {(100 - train.prevalence_protocol * 100).toFixed(0)}% low-risk
              events, the regressor pulls every prediction towards the floor and pays for it on the
              high-risk events the metric counts.
            </p>
            {by.gru && (
              <p>
                <b>GRU sequence model (L = {fmt(by.gru.L, 2)}).</b> {fmtInt((by.gru as unknown as { parameters: number }).parameters)}{' '}
                parameters, {train.events_protocol_high_risk} positive events. It over-fits; it misses as many
                high-risk events as the naive forecast ({by.gru.fn}) with more than twice the false
                alarms ({by.gru.fp} vs {lrp.fp}).
              </p>
            )}
            <p>
              <b>The gate (L = {fmt(gate.L, 2)}).</b> Catches {gate.tp} of {gate.tp + gate.fn} high-risk events instead of{' '}
              {lrp.tp}, at the price of {gate.fp} false alarms instead of {lrp.fp}. Whether that trade is
              good depends on the cost of an unnecessary manoeuvre — a question the metric answers
              only implicitly.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Method and limits</h2>
        <div className="grid-3">
          <div className="panel prose">
            <div className="eyebrow">Protocol</div>
            <p>
              Inputs: CDMs issued ≥ 2 days before closest approach. Target: risk in the last CDM,
              issued &lt; 1 day before. Thresholds and blend weights chosen by 5-fold grouped
              cross-validation on training events. Test labels are never used for fitting or tuning; the test set was scored more than once during development.
            </p>
          </div>
          <div className="panel prose">
            <div className="eyebrow">Limits</div>
            <p>
              150 high-risk test events: every interval is wide. Data are from 2015–2019, anonymised,
              ESA missions only. “Risk” is ESA's computed probability, not an outcome — no collision
              is in the data. Nothing here says anything about today's conjunctions.
            </p>
          </div>
          <div className="panel prose">
            <div className="eyebrow">Reproduce</div>
            <p className="mono small">make data collision</p>
            <p>
              {data.meta.dataset.name}, DOI{' '}
              <a href={`https://doi.org/${data.meta.dataset.doi}`} target="_blank" rel="noreferrer">
                {data.meta.dataset.doi}
              </a>
              , {data.meta.dataset.license}. Code {data.meta.code_version} · run{' '}
              {data.meta.generated_at.slice(0, 10)} · {Math.round(data.meta.runtime_s)} s on 4 CPU cores.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}
