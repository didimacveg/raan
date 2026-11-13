// 1080×1350 artboards for LinkedIn. Every number is read from the same JSON artefacts as the
// rest of the site; captured with `node scripts/content.cjs`.
import { useEffect, useState, type ReactNode } from 'react'
import { BRAND } from '../brand'
import { Logo } from '../components/Nav'
import { fmt, fmtInt, loadJson } from '../lib/format'
import type { CatalogMeta } from '../twin/catalog'
import type { CollisionData } from './CollisionPage'
import type { ManeuverData } from './ManeuverPage'
import './card.css'

interface Data {
  col: CollisionData
  man: ManeuverData
  cat: CatalogMeta
  ver: { vectors: number; tle_max_km: number; omm_max_km: number }
}
interface Bar {
  label: string
  value: number
  text: string
  tone?: 'ink' | 'blue' | 'orange' | 'violet' | 'magenta' | 'mute'
}

function Bars({ bars, max, unit }: { bars: Bar[]; max?: number; unit?: string }) {
  const top = max ?? Math.max(...bars.map((b) => b.value))
  return (
    <div className="cbars">
      {bars.map((b) => (
        <div key={b.label} className="cbars__row">
          <span className="cbars__label">{b.label}</span>
          <div className="cbars__track">
            <i className={`tone-${b.tone ?? 'blue'}`} style={{ width: `${Math.max(1.2, (b.value / top) * 74)}%` }} />
            <b className="mono">
              {b.text}
              {unit}
            </b>
          </div>
        </div>
      ))}
    </div>
  )
}

function Stats({ items }: { items: [string, string][] }) {
  return (
    <div className="cstats">
      {items.map(([v, l]) => (
        <div key={l}>
          <b className="mono">{v}</b>
          <span>{l}</span>
        </div>
      ))}
    </div>
  )
}

function Shell({ n, eyebrow, title, children, source }: { n: string; eyebrow: string; title: ReactNode; children: ReactNode; source: string }) {
  return (
    <div className="card-art" id="card">
      <header>
        <span className="card-art__brand">
          <Logo size={34} /> {BRAND.name}
        </span>
        <span className="mono card-art__n">{n}</span>
      </header>
      <div className="card-art__eyebrow mono">{eyebrow}</div>
      <h1>{title}</h1>
      <div className="card-art__body">{children}</div>
      <footer>
        <span>{source}</span>
        <span className="card-art__flag mono">{BRAND.disclaimer}</span>
      </footer>
    </div>
  )
}

function SpikeStep() {
  // schematic: a bad element set (spike) vs a burn (step)
  const base = (k: number) => 150 - k * 1.6
  const spike = Array.from({ length: 24 }, (_, k) => [20 + k * 19, base(k) - (k === 11 ? 70 : 0)])
  const step = Array.from({ length: 24 }, (_, k) => [20 + k * 19, base(k) - (k >= 12 ? 70 : 0)])
  const path = (p: number[][]) => p.map(([x, y], k) => `${k ? 'L' : 'M'}${x},${y}`).join('')
  return (
    <div className="cpair">
      {(
        [
          ['One bad element set', 'a spike: out and back', spike, 'var(--orange)'],
          ['A manoeuvre', 'a step that stays', step, 'var(--blue)'],
        ] as const
      ).map(([t, s, pts, color]) => (
        <div key={t}>
          <svg viewBox="0 0 480 200">
            <path d={path(pts as number[][])} fill="none" stroke={color} strokeWidth="5" strokeLinejoin="round" />
            {(pts as number[][]).map(([x, y], k) => (
              <circle key={k} cx={x} cy={y} r="6" fill={color} stroke="#fff" strokeWidth="2" />
            ))}
          </svg>
          <b>{t}</b>
          <span>{s}</span>
        </div>
      ))}
    </div>
  )
}

function render(id: string, d: Data): ReactNode {
  const by = Object.fromEntries(d.col.results.map((r) => [r.key, r]))
  const { col, man, cat } = d
  const S = man.summary
  const A = man.physics_ablation
  const tr6 = col.transition.train_protocol.find((b) => b.lo === -6)!
  const te6 = col.transition.test.find((b) => b.lo === -6)!
  const ds = col.dataset
  switch (id) {
    case 'tle':
      return (
        <Shell n="01" eyebrow="Data · a 60-year-old format ran out of digits" title={<>The two-line element set can no longer describe every satellite.</>} source="Source: CelesTrak GP documentation and the snapshot shown on the site.">
          <div className="cbig mono">{fmtInt(cat.six_digit_ids)}</div>
          <p className="clede">objects in my catalogue snapshot have a 6-digit catalogue number. They exist only in the newer OMM formats.</p>
          <Stats
            items={[
              ['2026-07-11', 'day the 5-digit numbers ran out'],
              [fmtInt(cat.satcat_on_orbit.max_catalog_number), 'highest catalogue number today'],
              [fmtInt(cat.count), 'objects in the snapshot'],
            ]}
          />
        </Shell>
      )
    case 'sgp4':
      return (
        <Shell n="02" eyebrow="Verification · before anything else" title={<>My browser propagator vs the reference SGP4: tested, not assumed.</>} source="Reference: Vallado et al., Revisiting Spacetrack Report #3 (AIAA 2006-6753). Test in the repo.">
          <div className="cbig mono">
            {(d.ver.tle_max_km * 1e6).toFixed(2)} <small>mm</small>
          </div>
          <p className="clede">
            largest position difference over the whole verification set. Through the OMM fields the app
            really uses: {(d.ver.omm_max_km * 1e5).toFixed(1)} cm, on one extreme 14-day orbit.
          </p>
          <Stats
            items={[
              [String(d.ver.vectors), 'reference state vectors compared'],
              ['33', 'element sets, from LEO to deep space'],
              ['1', 'deliberately invalid set that must be rejected, and is'],
            ]}
          />
        </Shell>
      )
    case 'baseline':
      return (
        <Shell n="04" eyebrow="Collision lab · step zero" title={<>Before training anything, I reproduced the number everyone has to beat.</>} source="ESA Collision Avoidance Challenge. Published values: Uriot et al., arXiv:2008.03069.">
          <Bars
            max={2.6}
            bars={[
              { label: 'Challenge winner (published)', value: col.published[0].L, text: fmt(col.published[0].L, 3), tone: 'mute' },
              { label: '“Risk stays the same”, published', value: 0.694, text: '0.694', tone: 'mute' },
              { label: '“Risk stays the same”, my reproduction', value: by.lrp.L, text: fmt(by.lrp.L, 3), tone: 'blue' },
              { label: 'Always predict 10⁻⁵, my reproduction', value: by.crp.L, text: fmt(by.crp.L, 2), tone: 'ink' },
            ]}
          />
          <p className="clede">Loss L, lower is better. Only 12 of 97 teams beat the naive forecast in 2019.</p>
        </Shell>
      )
    case 'notclaiming':
      return (
        <Shell n="05" eyebrow="Collision lab · result" title={<>My model beat the baseline on the test set. I am not claiming it.</>} source="2,167 test events, 150 high-risk. 2,000 bootstrap resamples. Details on the Collision Lab page.">
          <div className="csplit">
            <div>
              <span className="mono csplit__t">TEST SET</span>
              <Bars max={1} bars={[{ label: 'Naive forecast', value: by.lrp.L, text: fmt(by.lrp.L, 3), tone: 'ink' }, { label: 'My LightGBM gate', value: by.gbm_gate.L, text: fmt(by.gbm_gate.L, 3), tone: 'blue' }]} />
            </div>
            <div>
              <span className="mono csplit__t">CROSS-VALIDATION (TRAINING DATA)</span>
              <Bars max={1} bars={[{ label: 'Naive forecast', value: by.lrp.cv_L ?? 0, text: fmt(by.lrp.cv_L ?? 0, 2), tone: 'ink' }, { label: 'My LightGBM gate', value: by.gbm_gate.cv_L ?? 0, text: fmt(by.gbm_gate.cv_L ?? 0, 2), tone: 'orange' }]} />
            </div>
          </div>
          <p className="clede">
            It wins in {Math.round(by.gbm_gate.p_better_than_reference * 100)}% of bootstrap resamples. My rule: keep a model only if cross-validation on the training data agrees. It did not.
          </p>
        </Shell>
      )
    case 'bias':
      return (
        <Shell n="06" eyebrow="Collision lab · dataset bias" title={<>Same input, different outcome: the test set is not the training set.</>} source="ESA states both sets were hand-picked to over-represent high-risk events. Measured on the released data.">
          <p className="clede">An event whose latest risk is between 10⁻⁶ and 10⁻⁵ ends up high-risk…</p>
          <Bars max={1} bars={[{ label: 'in the training set', value: tr6.p_high_final ?? 0, text: `${Math.round((tr6.p_high_final ?? 0) * 100)}%`, tone: 'blue' }, { label: 'in the test set', value: te6.p_high_final ?? 0, text: `${Math.round((te6.p_high_final ?? 0) * 100)}%`, tone: 'orange' }]} />
          <Stats
            items={[
              [`${(ds.train.prevalence_protocol * 100).toFixed(1)}%`, `high-risk events in training (${ds.train.events_protocol_high_risk} of ${fmtInt(ds.train.events_protocol)})`],
              [`${(ds.test.prevalence * 100).toFixed(1)}%`, `high-risk events in test (${ds.test.events_high_risk} of ${fmtInt(ds.test.events)})`],
            ]}
          />
        </Shell>
      )
    case 'bug':
      return (
        <Shell n="07" eyebrow="Engineering · a bug a unit test caught" title={<>One line was silently feeding my model the wrong number.</>} source="Replay: python -m raan.collision.replay_bug. The model was retrained after the fix; all published numbers are post-fix.">
          <pre className="ccode mono">
            <span className="del">- risk.nth(-2).reindex(table.index)</span>
            {'\n'}
            <span className="add">+ risk.apply(lambda s: s.iloc[-2] if len(s) &gt; 1 else s.iloc[-1])</span>
          </pre>
          <p className="clede">
            “Previous risk” was being matched by row label instead of by event. No error, no warning, just a wrong feature. A unit test with duplicated row labels failed and exposed it.
          </p>
          <Stats items={[['0.607 → 0.627', 'test loss of the model, before → after the fix'], ['52%', 'of events had the wrong value in that column']]} />
        </Shell>
      )
    case 'negative':
      return (
        <Shell n="08" eyebrow="Collision lab · negative results" title={<>Two of my three models are worse than doing nothing clever.</>} source="Official challenge metric on the official test set. Lower is better.">
          <Bars
            max={2.6}
            bars={[
              { label: 'Naive forecast (no model)', value: by.lrp.L, text: fmt(by.lrp.L, 3), tone: 'ink' },
              ...(by.gru ? [{ label: 'GRU sequence model', value: by.gru.L, text: fmt(by.gru.L, 2), tone: 'orange' as const }] : []),
              { label: 'LightGBM direct regression', value: by.gbm_direct.L, text: fmt(by.gbm_direct.L, 2), tone: 'magenta' },
            ]}
          />
          <p className="clede">
            {ds.train.events_protocol_high_risk} positive examples in {fmtInt(ds.train.events_protocol)} training events. A recurrent network over-fits them; a regressor collapses to “low risk”. Publishing this is the point.
          </p>
        </Shell>
      )
    case 'spike':
      return (
        <Shell n="09" eyebrow="Manoeuvre detection · first attempt failed" title={<>My first detector flagged every bad data point as a manoeuvre.</>} source={`${fmtInt(man.totals.maneuver_events)} operator-reported manoeuvre events, 15 satellites, leave-one-satellite-out.`}>
          <SpikeStep />
          <Bars max={1} bars={[{ label: 'Threshold on single jumps', value: A.jump.ALL.f1, text: `F1 ${fmt(A.jump.ALL.f1, 2)}`, tone: 'orange' }, { label: 'Median of 3 sets before vs 3 after', value: A.a.ALL.f1, text: `F1 ${fmt(A.a.ALL.f1, 2)}`, tone: 'blue' }]} />
        </Shell>
      )
    case 'mlphysics':
      return (
        <Shell n="10" eyebrow="Manoeuvre detection · ablation" title={<>Machine learning won. The ablation says by {Math.round((S.ml.ALL.f1 - A.a.ALL.f1) * 100)} points, not {Math.round((S.ml.ALL.f1 - S.physics.ALL.f1) * 100)}.</>} source={`Event-level F1 on ${fmtInt(man.totals.maneuver_events)} reported manoeuvres. Thresholds and models chosen leave-one-satellite-out.`}>
          <Bars
            max={1}
            bars={[
              { label: 'CUSUM change detector', value: S.cusum.ALL.f1, text: fmt(S.cusum.ALL.f1, 2), tone: 'mute' },
              { label: 'Physics baseline I declared (a + i)', value: S.physics.ALL.f1, text: fmt(S.physics.ALL.f1, 2), tone: 'ink' },
              { label: 'Physics, semi-major axis only', value: A.a.ALL.f1, text: fmt(A.a.ALL.f1, 2), tone: 'blue' },
              { label: 'Gradient-boosted classifier', value: S.ml.ALL.f1, text: fmt(S.ml.ALL.f1, 2), tone: 'violet' },
            ]}
          />
          <p className="clede">Compare a model with the best simple rule, not with the rule you happened to write first.</p>
        </Shell>
      )
    case 'small':
      return (
        <Shell n="11" eyebrow="Manoeuvre detection · limits" title={<>What public orbital data cannot see.</>} source="Recall of the best detector by size of the step in mean semi-major axis. 10 LEO satellites.">
          <Bars
            max={1}
            bars={man.recall_by_size_leo.filter((r) => r.lo_m > 0).map((r) => ({
              label: r.hi_m === null ? `more than ${r.lo_m} m` : `${r.lo_m} – ${r.hi_m} m`,
              value: r.n ? r.ml / r.n : 0,
              text: `${r.ml}/${r.n}`,
              tone: r.lo_m === 0 ? ('magenta' as const) : ('violet' as const),
            }))}
          />
          <p className="clede">
            Under 3 m most burns are missed: with no burn at all, the same statistic already moves by {man.noise_floor_leo_m ? man.noise_floor_leo_m.median.toFixed(1) : '—'} to {man.noise_floor_leo_m ? man.noise_floor_leo_m.p95.toFixed(1) : '—'} m. Of the {man.large_burn_misses.missed} big ones missed, {man.large_burn_misses.with_another_reported_burn_within_4_days} sit inside multi-burn campaigns.
          </p>
        </Shell>
      )
    case 'guard':
      return (
        <Shell n="12" eyebrow="Agents · the model writes, the pipeline counts" title={<>A report where every number must match a cited fact.</>} source="Number guard: raan/intel/core.py, with unit tests. Works without any API key (templates).">
          <div className="cguard">
            <div className="ok">
              <span className="mono">ACCEPTED</span>
              “The snapshot holds <b>{fmtInt(cat.count)}</b> objects, {Math.round((cat.count / cat.satcat_on_orbit.total) * 100)}% of the <b>{fmtInt(cat.satcat_on_orbit.total)}</b> on orbit.”
            </div>
            <div className="no">
              <span className="mono">REJECTED → TEMPLATE USED</span>
              “The snapshot holds {fmtInt(cat.count)} objects <b>(a 12.5% increase)</b>.”
            </div>
          </div>
          <p className="clede">Every figure in a paragraph must equal a fact that paragraph cites, with the file it came from. Agents may sort and phrase. They may not calculate.</p>
        </Shell>
      )
    default:
      return <div className="card-art">unknown card “{id}”</div>
  }
}

export default function CardPage({ id }: { id: string }) {
  const [data, setData] = useState<Data | null>(null)
  useEffect(() => {
    Promise.all([
      loadJson<CollisionData>('collision.json'),
      loadJson<ManeuverData>('maneuvers.json'),
      loadJson<{ meta: CatalogMeta }>('catalog.json'),
      loadJson<Data['ver']>('verification.json'),
    ]).then(([col, man, cat, ver]) => setData({ col, man, cat: cat.meta, ver }))
  }, [])
  if (!data) return null
  return <div className="card-stage">{render(id, data)}</div>
}
