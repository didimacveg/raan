import { Fragment, useEffect, useState } from 'react'
import Footer from '../components/Footer'
import { fmtUtc, loadJson } from '../lib/format'
import './pages.css'

interface Fact {
  id: string
  text: string
  label: string
  source: string
  link: string
}
interface Report {
  meta: {
    generated_at: string
    title: string
    writer: string
    agents: string[]
    findings_proposed: number
    findings_accepted: number
    findings_rejected: { title: string; agent: string; reason: string }[]
    editor_log: string[]
  }
  sections: {
    agent: string
    title: string
    paragraphs: { title: string; text: string; caveat: string; facts: string[]; writer: string }[]
  }[]
  facts: Record<string, Fact>
}

const AGENTS = [
  ['Catalogue watch', 'reads the daily snapshot and its difference from the previous one'],
  ['Manoeuvre watch', 'ranks orbit changes; reports the detector benchmark'],
  ['Conjunction analyst', 'reads the collision-risk experiment results'],
  ['Reviewer', 'rejects any finding with an uncited fact or an unsupported number'],
  ['Editor', 'writes the text — templates, or Claude behind the same number check'],
] as const

export default function IntelligencePage() {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    loadJson<Report>('report.json').then(setReport).catch((e) => setError(String(e)))
  }, [])
  if (error) return <main className="page"><p className="note">Report not built yet: {error}. Run <span className="mono">make intel</span>.</p></main>
  if (!report) return <main className="page" />
  const m = report.meta
  const facts = Object.values(report.facts)
  return (
    <main className="page">
      <header className="page__head rise">
        <div className="eyebrow">Module 04 · Orbital Intelligence</div>
        <h1>A report where every number has an address</h1>
        <p>
          Five small agents turn the lab's data into a periodic briefing. They are not allowed to
          calculate: each figure below was produced by the deterministic pipeline and is listed with
          the file it came from. Text is rejected automatically if it contains a number that no cited
          fact supports.
        </p>
      </header>

      <div className="pipeline rise">
        {AGENTS.map(([name, role], k) => (
          <Fragment key={name}>
            <div className={`pipeline__node${k >= 3 ? ' is-gate' : ''}`}>
              <span className="eyebrow">{k < 3 ? 'analyst' : k === 3 ? 'gate' : 'writer'}</span>
              <b>{name}</b>
              <span>{role}</span>
            </div>
            {k < AGENTS.length - 1 && <i className="pipeline__arrow">{k === 2 ? '→' : k < 2 ? '+' : '→'}</i>}
          </Fragment>
        ))}
      </div>

      <article className="report">
        <div className="report__head">
          <div>
            <div className="eyebrow">Latest report</div>
            <h2>{fmtUtc(Date.parse(m.generated_at) / 1000, false)}</h2>
          </div>
          <div className="report__chips">
            <span className={`chip ${m.writer === 'claude' ? 'chip--violet' : 'chip--blue'}`}>
              written by: {m.writer === 'claude' ? 'Claude, number-checked' : 'deterministic templates'}
            </span>
            <span className="chip">
              {m.findings_accepted}/{m.findings_proposed} findings passed review
            </span>
            <span className="chip">{facts.length} cited facts</span>
          </div>
        </div>
        {report.sections.map((s) => (
          <section key={s.agent} className="report__section">
            <h3>{s.title}</h3>
            {s.paragraphs.map((p) => (
              <div key={p.title} className="report__para">
                <h4>{p.title}</h4>
                <p>{p.text}</p>
                {p.caveat && <p className="report__caveat">{p.caveat}</p>}
                <div className="report__refs">
                  {p.facts.map((id) => {
                    const f = report.facts[id]
                    const body = (
                      <>
                        <b>{f.text}</b> {f.label}
                      </>
                    )
                    return f.link ? (
                      <a key={id} href={f.link} target={f.link.startsWith('http') ? '_blank' : undefined} rel="noreferrer" title={`${id} · ${f.source}`}>
                        {body}
                      </a>
                    ) : (
                      <span key={id} title={`${id} · ${f.source}`}>
                        {body}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </section>
        ))}
        {(m.findings_rejected.length > 0 || m.editor_log.length > 0) && (
          <section className="report__section">
            <h3>Review log</h3>
            <ul className="report__log mono">
              {m.findings_rejected.map((r) => (
                <li key={r.title}>
                  rejected · {r.title} · {r.reason}
                </li>
              ))}
              {m.editor_log.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}
      </article>

      <section className="section">
        <h2>Sources of every figure</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Fact id</th>
                <th>What</th>
                <th className="num">Value</th>
                <th>Read from</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((f) => (
                <tr key={f.id}>
                  <td className="mono small">{f.id}</td>
                  <td>{f.label}</td>
                  <td className="num">{f.text}</td>
                  <td className="mono small">{f.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>How it stays honest</h2>
        <div className="grid-3">
          <div className="panel prose">
            <div className="eyebrow">No arithmetic in the agents</div>
            <p>
              Analysts read JSON written by the pipeline and register facts. They count and sort;
              models, metrics and propagation live elsewhere and are tested separately.
            </p>
          </div>
          <div className="panel prose">
            <div className="eyebrow">Number guard</div>
            <p>
              Every number in a paragraph must equal the printed value of a fact that paragraph
              cites. A model that writes “up 12.5 %” when no fact says so loses the paragraph to the
              template version. The check is a unit test in the repository.
            </p>
          </div>
          <div className="panel prose">
            <div className="eyebrow">Works without a key</div>
            <p>
              With no API key the editor uses fixed templates — the report above states which
              writer produced it. Orbit changes between snapshots are listed as changes, never as
              detected manoeuvres.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}
