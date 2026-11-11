// Generates every LinkedIn visual from the running app (no mock-ups):
//   content/images/*.png  — 1080×1350 cards
//   content/video/*.mp4   — 1080×1350, 30 fps, rendered frame by frame with a deterministic clock
//
// Usage:  npm run dev   (in another terminal)
//         node scripts/content.cjs [cards|videos|v1|v2|v3|v4|all]
// Needs: playwright (Chromium) and ffmpeg. BASE overrides the app URL.
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE ?? 'http://localhost:5173/'
const OUT = path.resolve(__dirname, '../../content')
const FRAMES = path.join(OUT, '_frames')
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const W = 1080
const H = 1350
const FPS = 30

const CARDS = [
  ['01-tle-format', 'tle'],
  ['02-sgp4-verification', 'sgp4'],
  ['04-baseline-reproduced', 'baseline'],
  ['05-not-claiming-it', 'notclaiming'],
  ['06-dataset-bias', 'bias'],
  ['07-bug-caught-by-test', 'bug'],
  ['08-negative-results', 'negative'],
  ['09-spike-vs-step', 'spike'],
  ['10-ml-vs-physics', 'mlphysics'],
  ['11-what-data-cannot-see', 'small'],
  ['12-number-guard', 'guard'],
]

const url = (route, params = {}) => {
  const q = new URLSearchParams(params).toString()
  return `${BASE}${q ? '?' + q : ''}#${route}`
}
const int = (n) => Math.round(n).toLocaleString('en-US')

async function twinPage(browser, params) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.goto(url('/', { ui: '0', ...params }))
  await page.waitForFunction(() => window.__raan && !document.querySelector('.spinner'), null, { timeout: 120000 })
  await page.evaluate(() => {
    const e = window.__raan.engine
    e.setManual(true)
    e.controls.enabled = false
    e.setPointSize(4.6)
    // put the globe in the lower part of the frame, under the title
    const { width, height } = e.renderer.domElement.getBoundingClientRect()
    e.camera.setViewOffset(width, height, 0, -height * 0.07, width, height)
  })
  return page
}

function encode(name, frameDir) {
  const out = path.join(OUT, 'video', `${name}.mp4`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frameDir, '%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', process.env.CRF ?? '27', '-preset', 'slow', '-movflags', '+faststart',
    '-vf', `scale=${W}:${H}`, out])
  fs.rmSync(frameDir, { recursive: true, force: true })
  console.log('video', path.relative(process.cwd(), out), `${(fs.statSync(out).size / 1e6).toFixed(1)} MB`)
}

const frameDir = (name) => {
  const dir = path.join(FRAMES, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
const framePath = (dir, k) => path.join(dir, `${String(k).padStart(4, '0')}.png`)

async function cards(browser) {
  fs.mkdirSync(path.join(OUT, 'images'), { recursive: true })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  for (const [file, id] of CARDS) {
    await page.goto(url(`/card/${id}`))
    await page.waitForSelector('#card')
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(OUT, 'images', `${file}.png`) })
    console.log('card', file)
  }
  await page.close()

  // two posters rendered by the real globe
  const cat = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/data/catalog.json'), 'utf8')).meta
  const ageH = (cat.epoch_age_days.median * 24).toFixed(0)
  const posters = [
    ['00-launch', {
      title: 'I am 17 and I built an open lab to study what is in orbit.',
      sub: 'Real catalogue data, reproduced baselines, published negative results. Every number comes from a script you can run.',
      stat: int(cat.count), statl: 'catalogued objects, propagated in your browser',
    }],
    ['03-not-live', {
      title: 'None of these dots is where a satellite “is”.',
      sub: `Each one is a prediction from orbital elements published a median of ${ageH} hours ago. So the app says so, on every object.`,
      stat: `${ageH} h`, statl: 'median age of the data behind each dot',
    }],
  ]
  for (const [file, params] of posters) {
    const p = await twinPage(browser, params)
    const t = await p.evaluate(() => window.__raan.engine.getTime())
    await p.evaluate(async (time) => {
      const e = window.__raan.engine
      e.camera.position.set(3.4, 2.3, 4.6)
      e.camera.lookAt(0, 0, 0)
      await e.renderAt(time)
    }, t)
    await p.screenshot({ path: path.join(OUT, 'images', `${file}.png`) })
    console.log('card', file)
    await p.close()
  }
}

// v1 — the whole catalogue, slow camera orbit, 10 simulated minutes per second
async function v1(browser) {
  const cat = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/data/catalog.json'), 'utf8')).meta
  const page = await twinPage(browser, {
    title: `${int(cat.count)} objects in orbit, from public data.`,
    sub: 'Blue: active satellites. Magenta: debris. Time runs 600× faster than real.',
  })
  const dir = frameDir('v1')
  const t0 = await page.evaluate(() => window.__raan.engine.getTime())
  const n = FPS * 16
  for (let k = 0; k < n; k++) {
    await page.evaluate(async ({ t, k, n }) => {
      const e = window.__raan.engine
      const az = 0.6 + (k / n) * 1.3
      const r = 6.0 - 0.6 * Math.sin((k / n) * Math.PI)
      e.camera.position.set(r * Math.cos(az) * 0.86, r * 0.42, r * Math.sin(az) * 0.86)
      e.camera.lookAt(0, 0, 0)
      await e.renderAt(t)
    }, { t: t0 + k * 20, k, n })
    await page.screenshot({ path: framePath(dir, k) })
  }
  await page.close()
  encode('v1-catalogue', dir)
}

// v2 — Starlink only: the shells of one constellation, 300× real time
async function v2(browser) {
  const page = await twinPage(browser, { title: 'One constellation.', sub: 'placeholder' })
  const info = await page.evaluate(() => {
    const { catalog, setFilters } = window.__raan
    const starlink = catalog.dict.cons.indexOf('Starlink')
    setFilters({ cons: starlink })
    const n = catalog.cols.cons.filter((c) => c === starlink).length
    const active = catalog.meta.by_type.active
    return { n, active, share: Math.round((n / active) * 100) }
  })
  await page.close()
  const p2 = await twinPage(browser, {
    title: `${int(info.n)} Starlink satellites.`,
    sub: `${info.share}% of the ${int(info.active)} active satellites in the snapshot. Only Starlink is shown; time runs 300× faster than real.`,
  })
  await p2.evaluate(() => {
    const { catalog, setFilters } = window.__raan
    setFilters({ cons: catalog.dict.cons.indexOf('Starlink') })
  })
  await p2.waitForTimeout(800)
  const dir = frameDir('v2')
  const t0 = await p2.evaluate(() => window.__raan.engine.getTime())
  const n = FPS * 15
  for (let k = 0; k < n; k++) {
    await p2.evaluate(async ({ t, k, n }) => {
      const e = window.__raan.engine
      const az = 2.2 + (k / n) * 0.9
      const r = 5.6
      const el = 0.55 + 0.25 * (k / n) // rise towards the pole to show the 53° shell edge
      e.camera.position.set(r * Math.cos(az) * Math.cos(el), r * Math.sin(el), r * Math.sin(az) * Math.cos(el))
      e.camera.lookAt(0, 0, 0)
      await e.renderAt(t)
    }, { t: t0 + k * 10, k, n })
    await p2.screenshot({ path: framePath(dir, k) })
  }
  await p2.close()
  encode('v2-starlink', dir)
  fs.writeFileSync(path.join(OUT, 'video', 'v2-starlink.json'), JSON.stringify(info, null, 1))
}

const CAPTION_CSS = `
  .cap { position: fixed; left: 0; right: 0; bottom: 0; z-index: 99; display: flex; justify-content: space-between;
    align-items: center; padding: 14px 24px; background: rgba(255,255,255,.94); border-top: 1px solid rgba(16,24,64,.14);
    font: 600 15px 'Space Grotesk Variable', sans-serif; letter-spacing: .14em; color: #0b1030; }
  .cap span { font: 400 10.5px 'JetBrains Mono Variable', monospace; letter-spacing: .06em; text-transform: uppercase;
    color: #b3470a; background: rgba(255,122,26,.11); border: 1px solid rgba(255,122,26,.4); padding: 4px 9px; border-radius: 99px; }
  .footer, .page__head, .verdict { display: none !important; }
  .page { padding-top: 28px !important; }
  .section { margin-top: 0 !important; }`

async function pageAt(browser, route, params, sectionTitle) {
  // 840 CSS px wide at 1.2857× → exactly 1080×1350 output, single-column layouts
  const page = await browser.newPage({ viewport: { width: 840, height: 1050 }, deviceScaleFactor: W / 840 })
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.goto(url(route, { ui: '0', ...params }))
  await page.waitForSelector('.section h2')
  await page.addStyleTag({ content: CAPTION_CSS })
  await page.evaluate((title) => {
    const cap = document.createElement('div')
    cap.className = 'cap'
    cap.innerHTML = 'RAAN <span>Research project, not for operational use</span>'
    document.body.appendChild(cap)
    // keep only the section we are filming
    for (const s of document.querySelectorAll('.section')) {
      if (!s.querySelector('h2')?.textContent?.includes(title)) s.style.display = 'none'
    }
    window.scrollTo(0, 0)
  }, sectionTitle)
  await page.waitForTimeout(1200)
  return page
}

// v3 — manoeuvre timeline: slide a one-year window across Sentinel-3A's history
async function v3(browser) {
  const page = await pageAt(browser, '/maneuvers', { sat: 'Sentinel-3A', method: 'ml' }, 'Timeline by satellite')
  const dir = frameDir('v3')
  const n = FPS * 15
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1)
    const ease = u * u * (3 - 2 * u)
    const lo = Math.round(40 + ease * 780)
    await page.evaluate((range) => window.__raanMan.setRange(range), [lo, lo + 180])
    await page.waitForTimeout(25)
    await page.screenshot({ path: framePath(dir, k) })
  }
  await page.close()
  encode('v3-manoeuvre-timeline', dir)
}

// v4 — collision lab: sweep the gate threshold and watch misses trade against false alarms
async function v4(browser) {
  const page = await pageAt(browser, '/collision', {}, 'Explore the trade-off')
  const tauCv = await page.evaluate(() => fetch('./data/collision.json').then((r) => r.json()).then((d) => d.results.find((r) => r.key === 'gbm_gate').threshold))
  const dir = frameDir('v4')
  const n = FPS * 16
  const stops = [Math.log10(tauCv), -0.5, -3, Math.log10(tauCv)]
  for (let k = 0; k < n; k++) {
    const u = (k / (n - 1)) * (stops.length - 1)
    const seg = Math.min(Math.floor(u), stops.length - 2)
    const f = u - seg
    const ease = f * f * (3 - 2 * f)
    const logTau = stops[seg] + (stops[seg + 1] - stops[seg]) * ease
    await page.evaluate((v) => window.__raanCol.setLogTau(v), logTau)
    await page.waitForTimeout(25)
    await page.screenshot({ path: framePath(dir, k) })
  }
  await page.close()
  encode('v4-collision-tradeoff', dir)
}

async function main() {
  const what = process.argv[2] ?? 'all'
  const browser = await chromium.launch({ args: GL })
  const jobs = { cards, v1, v2, v3, v4 }
  const run = what === 'all' ? Object.keys(jobs) : what === 'videos' ? ['v1', 'v2', 'v3', 'v4'] : [what]
  for (const name of run) {
    const t = Date.now()
    await jobs[name](browser)
    console.log(`${name} done in ${((Date.now() - t) / 1000).toFixed(0)} s`)
  }
  await browser.close()
  fs.rmSync(FRAMES, { recursive: true, force: true })
}
main().catch((e) => { console.error(e); process.exit(1) })
