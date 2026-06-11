import type { Bounds, CombineMode, Direction, LatLng, TransitMode } from './types'
import { ALL_MODES } from './types'

export interface UrlState {
  sources: LatLng[]
  departAt: string
  bounds: Bounds
  combine: CombineMode
  modes: TransitMode[]
  direction: Direction
}

const DEFAULT_BOUNDS: Bounds = [15, 30, 45, 60]

function defaultDepartAt(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** Parse ?from=48.85,2.34_48.89,2.24&at=08:30&b=15,30,45,60&mode=meet&tm=metro,rail */
export function parseUrlState(): UrlState {
  const q = new URLSearchParams(window.location.search)
  const sources: LatLng[] = []
  for (const pair of (q.get('from') ?? '').split('_')) {
    const [lat, lng] = pair.split(',').map(Number)
    if (Number.isFinite(lat) && Number.isFinite(lng)) sources.push({ lat, lng })
  }
  const b = (q.get('b') ?? '').split(',').map(Number)
  const bounds =
    b.length === 4 && b.every((v, i) => Number.isFinite(v) && (i === 0 || v > b[i - 1]))
      ? (b as Bounds)
      : DEFAULT_BOUNDS
  const at = /^\d{1,2}:\d{2}$/.test(q.get('at') ?? '') ? q.get('at')! : defaultDepartAt()
  const combine: CombineMode = q.get('mode') === 'meet' ? 'meet' : 'union'
  const tm = (q.get('tm') ?? '').split(',').filter((m): m is TransitMode =>
    (ALL_MODES as readonly string[]).includes(m),
  )
  const direction: Direction = q.get('d') === 'arrive' ? 'arrive' : 'depart'
  return { sources, departAt: at, bounds, combine, modes: tm.length ? tm : [...ALL_MODES], direction }
}

export function writeUrlState({ sources, departAt, bounds, combine, modes, direction }: UrlState): void {
  const q = new URLSearchParams()
  if (sources.length) q.set('from', sources.map((s) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`).join('_'))
  q.set('at', departAt)
  q.set('b', bounds.join(','))
  if (combine === 'meet') q.set('mode', 'meet')
  if (modes.length && modes.length < ALL_MODES.length) q.set('tm', modes.join(','))
  if (direction === 'arrive') q.set('d', 'arrive')
  history.replaceState(null, '', `?${q}`)
}
