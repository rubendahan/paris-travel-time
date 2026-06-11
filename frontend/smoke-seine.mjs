import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://localhost:5173/?from=48.8462,2.3700&at=08:30&b=10,20,30,45', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForSelector('text=arrêts atteignables', { timeout: 60000 })
await page.waitForTimeout(1500)
// wheel-zoom toward the Seine (center of viewport)
await page.mouse.move(800, 450)
for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(700) }
await page.waitForTimeout(1500)
await page.screenshot({ path: 'smoke-seine.png' })
console.log('ERRORS:', errors.length ? errors.join('|') : 'none')
await browser.close()
