// Same check as smoke.mjs but against the deployed site. Generous timeouts:
// the free-tier API may need a minute to wake up first.
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('https://paris-travel-time.onrender.com/?from=48.8588,2.3470&at=08:30&b=15,30,45,60', { waitUntil: 'networkidle', timeout: 120000 })
await page.waitForSelector('text=arrêts atteignables', { timeout: 120000 })
await page.waitForTimeout(2000)
console.log('STATS:', (await page.locator('text=arrêts atteignables').textContent())?.trim())
await page.screenshot({ path: 'smoke-prod.png' })
console.log('CONSOLE_ERRORS:', errors.length ? errors.join(' | ') : 'none')
await browser.close()
