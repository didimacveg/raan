import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fmtAge, fmtInt, fmtUtc } from '../lib/format'
import type { Route } from '../lib/router'
import { applyFilters, defaultFilters, loadCatalog, type Catalog, type Filters } from './catalog'
import { GlobeEngine, type LiveState, type TickInfo } from './engine'
import FiltersPanel from './Filters'
import ObjectCard from './ObjectCard'
import TimeBar from './TimeBar'
import { BRAND } from '../brand'
import { Logo } from '../components/Nav'
import '../pages/card.css'
import './twin.css'

declare global {
  interface Window {
    __raan?: { engine: GlobeEngine; catalog: Catalog; setFilters: (f: Partial<Filters>) => void }
  }
}

export default function TwinPage({ route }: { route: Route }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GlobeEngine | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters | null>(null)
  const [shown, setShown] = useState(0)
  const [tick, setTick] = useState<TickInfo | null>(null)
  const [ready, setReady] = useState<{ count: number; failed: number; ms: number } | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [live, setLive] = useState<LiveState | null>(null)
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const [sheet, setSheet] = useState(false)
  const anchor = useMemo(() => Date.now() / 1000, [])

  const stress = Number(route.query.get('stress') ?? 0)
  const showFps = route.query.has('fps') || stress > 0
  const bare = route.query.get('ui') === '0'
  const poster = route.query.get('title')

  useEffect(() => {
    loadCatalog(stress)
      .then((cat) => {
        setCatalog(cat)
        setFilters(defaultFilters(cat))
      })
      .catch((e) => setError(String(e.message ?? e)))
  }, [stress])

  // engine lifecycle
  useEffect(() => {
    if (!catalog || !canvasRef.current) return
    const startAt = Number(route.query.get('t')) || anchor
    const engine = new GlobeEngine(canvasRef.current, catalog, startAt)
    engineRef.current = engine
    engine.onReady = setReady
    engine.onTick = (info) => {
      setTick(info)
      setLive(engine.selected !== null ? engine.liveState(engine.selected) : null)
    }
    engine.onSelect = (index) => {
      setSelected(index)
      setLive(index !== null ? engine.liveState(index) : null)
    }
    window.__raan = {
      engine,
      catalog,
      setFilters: (patch) => setFilters((f) => (f ? { ...f, ...patch } : f)),
    }
    const onResize = () => engine.resize()
    window.addEventListener('resize', onResize)
    const observer = new ResizeObserver(onResize)
    observer.observe(canvasRef.current)
    return () => {
      window.removeEventListener('resize', onResize)
      observer.disconnect()
      engine.dispose()
      engineRef.current = null
      delete window.__raan
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog])

  // filters → GPU mask
  const mask = useMemo(() => (catalog ? new Float32Array(catalog.count) : null), [catalog])
  useEffect(() => {
    if (!catalog || !filters || !mask) return
    setShown(applyFilters(catalog, filters, mask))
    engineRef.current?.setMask(mask)
  }, [catalog, filters, mask, ready])

  // pointer interaction (hover is throttled to one pick per animation frame)
  const pendingPick = useRef(0)
  const downAt = useRef<[number, number] | null>(null)
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    cancelAnimationFrame(pendingPick.current)
    pendingPick.current = requestAnimationFrame(() => {
      const engine = engineRef.current
      if (!engine) return
      const index = engine.pick(x, y)
      engine.setHover(index)
      setHover(index === null ? null : { index, x, y })
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const start = downAt.current
    downAt.current = null
    if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return // a drag
    const engine = engineRef.current
    if (!engine) return
    const rect = e.currentTarget.getBoundingClientRect()
    const radius = e.pointerType === 'mouse' ? 9 : 22
    engine.select(engine.pick(e.clientX - rect.left, e.clientY - rect.top, radius))
  }, [])

  const engine = engineRef.current
  const simTime = tick?.simTime ?? anchor
  const meta = catalog?.meta

  return (
    <main className={`twin${bare ? ' twin--bare' : ''}`}>
      <canvas
        ref={canvasRef}
        className="twin__canvas"
        onPointerDown={(e) => (downAt.current = [e.clientX, e.clientY])}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          engineRef.current?.setHover(null)
          setHover(null)
        }}
      />

      {error && (
        <div className="twin__msg glass">
          <h3>Catalogue not available</h3>
          <p>
            <span className="mono">{error}</span>. Run <span className="mono">make catalog</span> to
            build <span className="mono">web/public/data/catalog.json</span>.
          </p>
        </div>
      )}
      {!error && !ready && (
        <div className="twin__msg glass">
          <div className="spinner" />
          <p>{catalog ? `Initialising SGP4 for ${fmtInt(catalog.count)} objects…` : 'Loading catalogue…'}</p>
        </div>
      )}

      {hover && catalog && hover.index !== selected && (
        <div className="twin__tip mono" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {catalog.cols.name[hover.index]} <span>#{catalog.cols.id[hover.index]}</span>
        </div>
      )}

      {catalog && filters && !bare && (
        <>
          <aside className={`twin__left glass${sheet ? ' is-open' : ''}`}>
            <div className="twin__title">
              <div className="eyebrow">Module 01</div>
              <h1>Orbital Digital Twin</h1>
            </div>
            <FiltersPanel catalog={catalog} filters={filters} shown={shown} onChange={setFilters} />
          </aside>
          <button className="twin__sheet-btn glass" onClick={() => setSheet((s) => !s)}>
            {sheet ? 'Close' : `Filters · ${fmtInt(shown)}`}
          </button>

          <aside className="twin__right">
            {selected !== null ? (
              <div className="glass twin__card">
                <ObjectCard
                  catalog={catalog}
                  index={selected}
                  simTime={simTime}
                  live={live}
                  onClose={() => engine?.select(null)}
                />
              </div>
            ) : (
              meta && (
                <div className="glass twin__prov">
                  <div className="eyebrow">What you are looking at</div>
                  <p>
                    Each dot is a catalogued object, placed by propagating its latest published mean
                    elements with SGP4. <b>These are not live observations.</b>
                  </p>
                  <div className="kv">
                    <span>Snapshot</span>
                    <b className="mono">{fmtUtc(Date.parse(meta.generated_at) / 1000, false)}</b>
                  </div>
                  <div className="kv">
                    <span>Median element age</span>
                    <b className="mono">{fmtAge(meta.epoch_age_days.median * 86400)}</b>
                  </div>
                  <div className="kv">
                    <span>Catalogue coverage</span>
                    <b className="mono">
                      {fmtInt(meta.count)} / {fmtInt(meta.satcat_on_orbit.total)}
                    </b>
                  </div>
                  <p className="muted">
                    Coverage = objects with public bulk GP data on CelesTrak vs. objects on orbit in
                    the SATCAT. Most debris and rocket bodies need a Space-Track account and are not
                    shown. Source: CelesTrak GP (18 SDS / Space-Track).
                  </p>
                  {meta.stress && (
                    <p className="warn">
                      STRESS TEST: {fmtInt(meta.stress.synthetic)} synthetic copies added to{' '}
                      {fmtInt(meta.stress.real)} real objects to measure rendering performance.
                    </p>
                  )}
                  <p className="muted">Click any dot for its elements, epoch and source.</p>
                </div>
              )
            )}
          </aside>

          <TimeBar
            anchor={anchor}
            simTime={simTime}
            playing={tick?.playing ?? true}
            speed={tick?.speed ?? 1}
            onPlay={(p) => {
              engine?.setPlaying(p)
              setTick((t) => (t ? { ...t, playing: p } : t))
            }}
            onSpeed={(s) => {
              engine?.setSpeed(s)
              setTick((t) => (t ? { ...t, speed: s } : t))
            }}
            onSeek={(t) => {
              engine?.setTime(t)
              setTick((prev) => (prev ? { ...prev, simTime: t } : prev))
            }}
          />
        </>
      )}

      {bare && poster && (
        <div className="poster">
          <div className="poster__top">
            <span className="card-art__brand">
              <Logo size={34} /> {BRAND.name}
            </span>
            <h1>{poster}</h1>
            {route.query.get('sub') && <p className="poster__sub">{route.query.get('sub')}</p>}
          </div>
          <div className="poster__bottom">
            <div className="poster__stat">
              {route.query.get('stat') && <b className="mono">{route.query.get('stat')}</b>}
              {route.query.get('statl') && <span>{route.query.get('statl')}</span>}
            </div>
            <span className="card-art__flag mono">SGP4 propagation · not live tracking</span>
          </div>
        </div>
      )}

      {showFps && tick && (
        <div className="twin__fps mono glass">
          {tick.fps.toFixed(0)} fps · SGP4 pass {tick.workerMs.toFixed(0)} ms ·{' '}
          {fmtInt(catalog?.count ?? 0)} objects
        </div>
      )}
    </main>
  )
}
