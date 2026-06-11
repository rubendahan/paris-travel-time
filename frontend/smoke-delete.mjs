import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('console', (m) => { if (m.text().startsWith('DBG')) console.log(m.text()) })
await page.goto('http://localhost:5173/?from=48.8588,2.3470&at=08:30', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForSelector('text=arrêts atteignables', { timeout: 60000 })
await page.evaluate(() => {
  document.addEventListener('click', (e) => {
    const t = e.target
    console.log('DBG capture click on:', t.tagName, t.className?.toString().slice(0, 60),
      '| inPopup:', !!(t instanceof Element && t.closest('.leaflet-popup')))
  }, true)
  document.addEventListener('mouseup', (e) => {
    console.log('DBG mouseup on:', e.target.tagName)
  }, true)
})
await page.locator('.leaflet-marker-icon').click()
await page.waitForSelector('button:has-text("Supprimer")')
await page.locator('button:has-text("Supprimer")').click()
await page.waitForTimeout(800)
console.log('MARKERS:', await page.locator('.leaflet-marker-icon').count())
await browser.close()
