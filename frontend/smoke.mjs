// One-shot smoke test: load the app with a marker preset in the URL,
// wait for the travel-time result, screenshot, report console errors.
import { chromium } from 'playwright'

const URL = 'http://localhost:5173/?from=48.8588,2.3470&at=08:30&b=15,30,45,60'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 })
await page.waitForSelector('text=stops reachable', { timeout: 60_000 })
await page.waitForTimeout(1500) // let the canvas layer paint after debounce

const stats = await page.locator('text=stops reachable').textContent()
const canvases = await page.locator('.leaflet-container canvas').count()
const markers = await page.locator('.leaflet-marker-icon').count()
await page.screenshot({ path: 'smoke.png' })

console.log('STATS:', stats?.trim())
console.log('CANVAS_LAYERS:', canvases, 'MARKERS:', markers)
console.log('CONSOLE_ERRORS:', errors.length ? errors.join(' | ') : 'none')
await browser.close()
