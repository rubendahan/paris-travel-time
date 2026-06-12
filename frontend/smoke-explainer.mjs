// Explainer smoke test: open the modal, check the sections, step through
// the player and verify the connection statuses.
import { chromium } from 'playwright'

const URL = 'http://localhost:5173/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(URL, { timeout: 60_000 })
await page.click('button[title="How does it work?"]')
await page.waitForSelector('text=Under the hood: the Connection Scan')

const sections = await page.locator('h3').allTextContents()
await page.screenshot({ path: 'smoke-explainer-0.png' })

// step to the missed-by-a-minute connection (step 5)
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
await page.waitForSelector('text=Missed, too bad')

// all the way: every status should be settled
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
await page.waitForSelector('text=End of the scan')
const taken = await page.locator('ol >> text=taken').count()
const skipped = await page.locator('ol >> text=skipped').count()
const boarded = await page.locator('ol >> text=on board').count()
await page.screenshot({ path: 'smoke-explainer-end.png' })

console.log('SECTIONS:', sections.length, '|', sections.join(' | '))
console.log('STATUSES: taken=' + taken, 'skipped=' + skipped, 'onboard=' + boarded, '(expected 4/2/1)')
console.log('CONSOLE_ERRORS:', errors.length ? errors.join(' | ') : 'none')
await browser.close()
