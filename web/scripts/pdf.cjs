// Usage: node scripts/pdf.cjs <in.html> <out.pdf> — prints an HTML file to A4 PDF with Chromium.
const { chromium } = require('playwright')
const path = require('path')

async function main() {
  const [input, output] = process.argv.slice(2)
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto('file://' + path.resolve(input))
  await page.pdf({
    path: output,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="font: 7pt sans-serif; color: #777; width: 100%; text-align: center;">' +
      'RAAN technical report · research project, not for operational use · ' +
      '<span class="pageNumber"></span>/<span class="totalPages"></span></div>',
  })
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
