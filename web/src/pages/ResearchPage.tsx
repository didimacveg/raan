import { useEffect, useState } from 'react'
import { BRAND } from '../brand'
import Footer from '../components/Footer'
import { fmt, fmtInt, loadJson } from '../lib/format'
import { href } from '../lib/router'
import type { CatalogMeta } from '../twin/catalog'
import type { CollisionData } from './CollisionPage'
import type { ManeuverData } from './ManeuverPage'
import './pages.css'

interface Card {
  name: string
  module: string
  does: string
  data: string
  metric: string
  limits: string
  verdict: 'reference' | 'works' | 'negative'
}

const VERDICT = {
  reference: ['reference', 'chip'],
  works: ['useful, with limits', 'chip chip--blue'],
  negative: ['negative result', 'chip chip--orange'],
} as const

export default function ResearchPage() {
  const [col, setCol] = useState<CollisionData | null>(null)
  const [man, setMan] = useState<ManeuverData | null>(null)
  const [cat, setCat] = useState<CatalogMeta | null>(null)
  useEffect(() => {
    loadJson<CollisionData>('collision.json').then(setCol).catch(() => {})
    loadJson<ManeuverData>('maneuvers.json').then(setMan).catch(() => {})
    loadJson<{ meta: CatalogMeta }>('catalog.json').then((c) => setCat(c.meta)).catch(() => {})
  }, [])
  if (!col || !man) return <main className="page" />
  const by = Object.fromEntries(col.results.map((r) => [r.key, r]))
  const S = man.summary
  const cards: Card[] = [
    {
      name: 'Latest-risk forecast (LRP)',
      module: 'Collision',
      does: 'Predicts that the final risk equals the last risk known two days before closest approach.',
      data: 'No training.',
      metric: `L = ${fmt(by.lrp.L, 3)} (published: 0.694). Misses ${by.lrp.fn} of ${by.lrp.tp + by.lrp.fn} high-risk events.`,
      limits: 'Blind to risk that appears in the last two days.',
      verdict: 'reference',
    },
    {
      name: 'LightGBM gate + value',
      module: 'Collision',
      does: 'Classifier decides whether the event will end high-risk; a two-parameter linear model sets the value.',
      data: `${fmtInt(col.dataset.train.events_protocol)} training events (${col.dataset.train.events_protocol_high_risk} high-risk), each also seen 3 and 4 days out.`,
      metric: `L = ${fmt(by.gbm_gate.L, 3)} on test, ${fmt(by.gbm_gate.cv_L ?? 0, 2)} in cross-validation (naive: ${fmt(by.lrp.cv_L ?? 0, 2)}).`,
      limits: 'Not selected by the pre-declared rule. Test gain is within the bootstrap interval and tied to the test set’s higher prevalence.',
      verdict: 'negative',
    },
    {
      name: 'LightGBM direct regression',
      module: 'Collision',
      does: 'Regresses the final log-risk directly from event features.',
      data: 'Same as above.',
      metric: `L = ${fmt(by.gbm_direct.L, 2)}.`,
      limits: 'Collapses towards the low-risk floor; worse than both baselines on high-risk events.',
      verdict: 'negative',
    },
    ...(by.gru
      ? [
          {
            name: 'GRU sequence model',
            module: 'Collision',
            does: 'Recurrent network over the last 8 CDMs of each event, with a gate head and a value head.',
            data: 'Same events; 12 features per CDM; 3 seeds averaged.',
            metric: `L = ${fmt(by.gru.L, 2)}; misses ${by.gru.fn} high-risk events with ${by.gru.fp} false alarms.`,
            limits: 'Over-fits: thousands of parameters, 66 positive events.',
            verdict: 'negative' as const,
          },
        ]
      : []),
    {
      name: 'Physics step detector',
      module: 'Manoeuvres',
      does: 'Flags a drift-compensated step in mean semi-major axis or inclination, measured in robust sigmas.',
      data: 'No training; one threshold per regime chosen on the other satellites.',
      metric: `F1 ${fmt(S.physics.ALL.f1, 2)} (precision ${fmt(S.physics.ALL.precision, 2)}, recall ${fmt(S.physics.ALL.recall, 2)}). Semi-major axis alone: ${fmt(man.physics_ablation.a.ALL.f1, 2)}.`,
      limits: 'Needs three later element sets; blind below ~1 m of semi-major-axis change.',
      verdict: 'works',
    },
    {
      name: 'CUSUM change detector',
      module: 'Manoeuvres',
      does: 'Two-sided cumulative-sum test on day-to-day changes of semi-major axis and inclination.',
      data: 'No training; threshold chosen on the other satellites.',
      metric: `F1 ${fmt(S.cusum.ALL.f1, 2)}.`,
      limits: 'Accumulates noisy stretches into false alarms; worse than the simple step detector here.',
      verdict: 'negative',
    },
    {
      name: 'Gradient-boosted manoeuvre classifier',
      module: 'Manoeuvres',
      does: 'LightGBM on step statistics, RTN residuals and their neighbours two element sets each way.',
      data: `${man.totals.satellites - 1} satellites for training, 1 held out, rotated ${man.totals.satellites} times.`,
      metric: `F1 ${fmt(S.ml.ALL.f1, 2)} (precision ${fmt(S.ml.ALL.precision, 2)}, recall ${fmt(S.ml.ALL.recall, 2)}).`,
      limits: 'Trained on impulsive station-keeping of 15 well-tracked satellites; not validated on low-thrust or sparse tracking.',
      verdict: 'works',
    },
  ]
  return (
    <main className="page">
      <header className="page__head rise">
        <div className="eyebrow">Module 05 · Research &amp; benchmarking</div>
        <h1>Experiments, data and how to rerun them</h1>
        <p>
          {BRAND.name} is a student research project. Everything on this site is produced by a public
          pipeline from public data. This page lists what was run, on which version of which dataset,
          what each model can and cannot do, and the commands that regenerate every figure.
        </p>
        <p style={{ marginTop: 14 }}>
          <a className="btn" href="./RAAN_technical_report.pdf" target="_blank" rel="noreferrer">
            Technical report (PDF) ↗
          </a>{' '}
          <a className="btn btn--ghost" href={BRAND.repo} target="_blank" rel="noreferrer">
            Source code ↗
          </a>
        </p>
      </header>

      <section className="section" style={{ marginTop: 0 }}>
        <h2>Experiments</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Experiment</th>
                <th>Question</th>
                <th>Protocol</th>
                <th>Headline result</th>
                <th>Run</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <a href={href('/')}>SGP4 verification</a>
                </td>
                <td>Does the browser propagator match the reference implementation?</td>
                <td>666 state vectors of Vallado's 33 verification element sets</td>
                <td className="mono small">max |Δr| = 1.2e-7 km</td>
                <td className="mono small">make test</td>
              </tr>
              <tr>
                <td>
                  <a href={href('/collision')}>Final-risk prediction</a>
                </td>
                <td>Can a model beat the naive forecast two days before closest approach?</td>
                <td>ESA challenge split and metric; selection by 5-fold CV on training data; 2,000 bootstrap resamples</td>
                <td className="mono small">
                  naive {fmt(by.lrp.L, 3)} · best model {fmt(by.gbm_gate.L, 3)} (not validated)
                </td>
                <td className="mono small">
                  {col.meta.generated_at.slice(0, 10)} · {col.meta.code_version}
                </td>
              </tr>
              <tr>
                <td>
                  <a href={href('/maneuvers')}>Manoeuvre detection</a>
                </td>
                <td>Can reported manoeuvres be recovered from public element sets?</td>
                <td>Leave-one-satellite-out over {man.totals.satellites} satellites, event-level matching</td>
                <td className="mono small">
                  F1 {fmt(S.ml.ALL.f1, 2)} ML · {fmt(S.physics.ALL.f1, 2)} physics · {fmt(S.cusum.ALL.f1, 2)} CUSUM
                </td>
                <td className="mono small">
                  {man.meta.generated_at.slice(0, 10)} · {man.meta.code_version}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Datasets and versions</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Version used</th>
                <th>Licence / terms</th>
                <th>What is redistributed here</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <a href="https://celestrak.org/NORAD/elements/" target="_blank" rel="noreferrer">
                    CelesTrak GP (OMM CSV) + SATCAT
                  </a>
                </td>
                <td className="mono small">
                  snapshot {cat ? cat.generated_at.replace('T', ' ').slice(0, 16) : '—'} UTC
                  <br />
                  {cat ? fmtInt(cat.count) : '—'} objects
                </td>
                <td>
                  Free access under CelesTrak's usage policy (one download per 2-hour update). Data
                  originate from 18 SDS / Space-Track, whose basic data may be redistributed with
                  citation.
                </td>
                <td>Compact daily snapshot of mean elements, with attribution.</td>
              </tr>
              <tr>
                <td>
                  <a href={`https://doi.org/${col.meta.dataset.doi}`} target="_blank" rel="noreferrer">
                    ESA Collision Avoidance Challenge dataset
                  </a>
                </td>
                <td className="mono small">
                  DOI {col.meta.dataset.doi}
                  <br />
                  md5 {col.meta.dataset.md5.slice(0, 12)}…
                </td>
                <td>CC BY 4.0</td>
                <td>Derived per-event tables (risk values and model outputs) for the test set.</td>
              </tr>
              <tr>
                <td>
                  <a href={man.meta.dataset.url} target="_blank" rel="noreferrer">
                    TLE observation benchmark (Shorten et al.)
                  </a>
                </td>
                <td className="mono small">
                  commit {man.meta.dataset.commit.slice(0, 10)}
                  <br />
                  {fmtInt(man.totals.element_sets)} element sets
                </td>
                <td>
                  No licence file in the repository. Element sets are Space-Track basic data; labels
                  are operator reports published through the International DORIS Service.
                </td>
                <td>Not vendored. Only derived series (mean elements, detections) are published.</td>
              </tr>
              <tr>
                <td>
                  <a href="https://celestrak.org/publications/AIAA/2006-6753/" target="_blank" rel="noreferrer">
                    SGP4 verification vectors
                  </a>
                </td>
                <td className="mono small">AIAA 2006-6753</td>
                <td>Distributed with the reference SGP4 code and with the MIT-licensed sgp4 package.</td>
                <td>Two small text fixtures used by the tests.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Model cards</h2>
        <div className="cards">
          {cards.map((c) => (
            <div className="panel mcard" key={c.name}>
              <div className="eyebrow">{c.module}</div>
              <h3>{c.name}</h3>
              <span className={VERDICT[c.verdict][1]} style={{ alignSelf: 'flex-start' }}>
                {VERDICT[c.verdict][0]}
              </span>
              <dl>
                <dt>Does</dt>
                <dd>{c.does}</dd>
                <dt>Data</dt>
                <dd>{c.data}</dd>
                <dt>Result</dt>
                <dd>{c.metric}</dd>
                <dt>Limits</dt>
                <dd>{c.limits}</dd>
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Reproduce everything</h2>
        <p className="lede">
          Ubuntu or WSL, Python ≥ 3.11 and Node ≥ 20. The full run takes about ten minutes on a laptop
          and downloads 221 MB.
        </p>
        <div className="cmd">
          {`git clone ${BRAND.repo}.git && cd kessler
make setup        `}
          <span># virtualenv + npm dependencies</span>
          {`
make data         `}
          <span># ESA CDMs from Zenodo (checksum verified) + TLE benchmark at a pinned commit</span>
          {`
make reproduce    `}
          <span># collision models, manoeuvre detectors, report, PDF, site build</span>
          {`
make test         `}
          <span># SGP4 vs Vallado, metric definitions, pipeline and agent logic</span>
        </div>
      </section>

      <section className="section">
        <h2>What this is not</h2>
        <div className="grid-2">
          <div className="panel prose">
            <div className="eyebrow">Not an operational service</div>
            <p>
              Operational collision avoidance is done by teams and products with sensor data,
              covariance realism and 24/7 processes: GMV (Focusoc), Neuraspace, LeoLabs, Slingshot
              and agency flight-dynamics groups. Catalogue viewers such as KeepTrack and Stuff in
              Space are far more complete than the globe here. The open-source{' '}
              <span className="mono">kessler</span> library already covers probabilistic CDM
              forecasting.
            </p>
          </div>
          <div className="panel prose">
            <div className="eyebrow">What it tries to be instead</div>
            <p>
              Open, reproducible and explained: public data only, every figure regenerated by one
              command, baselines reproduced before models are trained, and negative results
              published with the analysis of why. The positions on the globe are propagated from
              published elements; nothing here is a live observation.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}
