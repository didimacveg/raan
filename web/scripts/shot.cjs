// Usage: node scripts/shot.cjs <route[?query]> <out.png> [width] [height] [waitMs] [dpr]
// Takes a real screenshot of the running app (BASE, default http://localhost:5173/).
const { chromium } = require('playwright')

const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

async function main() {
  const [hash = '/', out = 'shot.png', w = '1440', h = '900', wait = '6000', dpr = '1'] = process.argv.slice(2)
  const base = process.env.BASE ?? 'http://localhost:5173/'
  const browser = await chromium.launch({ args: GL_ARGS })
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr })
  page.on('console', (m) => m.type() === 'error' && console.log('console.error:', m.text()))
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  const [pathPart, query = ''] = hash.split('?')
  await page.goto(`${base}${query ? '?' + query : ''}#${pathPart}`)
  await page.waitForTimeout(+wait)
  if (process.env.EVAL) console.log(JSON.stringify(await page.evaluate(process.env.EVAL)))
  await page.screenshot({ path: out, fullPage: process.env.FULL === '1' })
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
