// Cold-start notice check: with the API unreachable, the wake-up banner
// must appear after ~2.5 s instead of leaving a silently broken map.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

await page.goto('http://localhost:5173/', { timeout: 30_000 })
await page.waitForSelector('text=Réveil du serveur', { timeout: 10_000 })
const visible = await page.locator('text=Réveil du serveur en cours').isVisible()

console.log('BANNER_VISIBLE:', visible)
await browser.close()
process.exit(visible ? 0 : 1)
