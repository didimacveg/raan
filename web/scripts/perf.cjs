// Frame-rate measurement of the globe in headless Chromium (software WebGL unless a GPU exists).
// Usage: node scripts/perf.cjs [baseUrl] [extraQuery]   e.g. node scripts/perf.cjs http://localhost:4173/ lite=0
// Prints one JSON line per scenario. Numbers from software rendering are a worst case, not what a
// laptop with a GPU shows.
const { chromium, devices } = require('playwright')

const BASE = process.argv[2] || 'http://localhost:4173/'
const EXTRA = process.argv[3] || ''
const SCENARIOS = [
  { name: 'laptop 1366x768 dpr1', context: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 } },
  { name: 'laptop 1440x900 dpr2', context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  { name: 'phone (Pixel 7)', context: { ...devices['Pixel 7'] } },
]

async function measure(page, seconds) {
  return page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const stamps = []
        const start = performance.now()
        const tick = (now) => {
          stamps.push(now)
          if (now - start < ms) requestAnimationFrame(tick)
          else {
            const dt = stamps.slice(1).map((t, k) => t - stamps[k]).sort((a, b) => a - b)
            const mean = (stamps[stamps.length - 1] - stamps[0]) / dt.length
            resolve({ fps: 1000 / mean, p95_frame_ms: dt[Math.floor(dt.length * 0.95)] })
          }
        }
        requestAnimationFrame(tick)
      }),
    seconds * 1000,
  )
}

;(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  for (const sc of SCENARIOS) {
    const ctx = await browser.newContext(sc.context)
    const page = await ctx.newPage()
    const t0 = Date.now()
    await page.goto(`${BASE}?fps=1${EXTRA ? '&' + EXTRA : ''}#/`)
    await page.waitForFunction(() => window.__raan && document.querySelector('.twin__fps'), null, { timeout: 120000 })
    const loadMs = Date.now() - t0
    await page.waitForTimeout(9000) // let the adaptive quality settle
    const r = await measure(page, 6)
    const info = await page.evaluate(() => {
      const e = window.__raan.engine
      const gl = e.renderer.getContext()
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      return {
        objects: window.__raan.catalog.count,
        quality: e.quality ? e.quality() : null,
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a',
        canvas: [e.renderer.domElement.width, e.renderer.domElement.height],
      }
    })
    console.log(JSON.stringify({ scenario: sc.name, ready_ms: loadMs, fps: +r.fps.toFixed(1), p95_frame_ms: +r.p95_frame_ms.toFixed(0), ...info }))
    await ctx.close()
  }
  await browser.close()
})()
