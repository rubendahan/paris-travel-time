// Interaction smoke: markers, time, sliders, URL state, meet mode, mode
// filters, right-click itinerary, day animation.
import { chromium } from 'playwright'

const URL = 'http://localhost:5173/?from=48.8588,2.3470&at=08:30&b=15,30,45,60'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 })
await page.waitForSelector('text=arrêts atteignables', { timeout: 60_000 })

// 1. click the map (west of center) -> second marker, union refetch
await page.locator('.leaflet-container').click({ position: { x: 400, y: 450 } })
await page.waitForTimeout(1200)
const markers = await page.locator('.leaflet-marker-icon').count()

// 2. meet mode appears with 2 markers; toggle it
await page.locator('button:has-text("Rencontre")').click()
await page.waitForTimeout(1200)
const urlMeet = page.url().includes('mode=meet')
const statsMeet = (await page.locator('text=arrêts atteignables').textContent())?.trim()

// 3. uncheck Bus -> refetch with modes filter
await page.locator('label:has-text("Bus") input').uncheck()
await page.waitForTimeout(1200)
const urlModes = decodeURIComponent(page.url()).includes('tm=metro,rail,tram')
const statsNoBus = (await page.locator('text=arrêts atteignables').textContent())?.trim()

// 4. right-click -> itinerary popup
await page.locator('.leaflet-container').click({ position: { x: 700, y: 300 }, button: 'right' })
await page.waitForSelector('text=arrivée', { timeout: 15_000 })
const popupText = (await page.locator('.leaflet-popup-content').textContent())?.trim()

// 5. day animation: play, let it tick twice, pause
const timeBefore = await page.locator('input[type="time"]').inputValue()
await page.locator('button[title*="Animer"]').click()
await page.waitForTimeout(1600)
await page.locator('button[title*="Animer"]').click()
const timeAfter = await page.locator('input[type="time"]').inputValue()

// 6. slider drag -> URL only, no refetch
await page.locator('input[type="range"]').first().fill('25')
await page.waitForTimeout(400)

await page.screenshot({ path: 'smoke2.png' })
console.log('MARKERS_AFTER_CLICK:', markers)
console.log('MEET_URL:', urlMeet, '| MEET_STATS:', statsMeet)
console.log('NO_BUS_URL:', urlModes, '| NO_BUS_STATS:', statsNoBus)
console.log('ROUTE_POPUP:', popupText?.slice(0, 140))
console.log('ANIMATION:', timeBefore, '->', timeAfter)
console.log('URL_BOUNDS:', page.url().match(/b=([\d,%C2]+)/)?.[1])
console.log('CONSOLE_ERRORS:', errors.length ? errors.join(' | ') : 'none')
await browser.close()
