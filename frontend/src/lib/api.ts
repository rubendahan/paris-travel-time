import type { CombineMode, Direction, LatLng, RouteResponse, StopsCatalog, TransitMode, TravelTimeResult, Walkmask } from './types'
import { ALL_MODES } from './types'
import { MAX_TRAVEL_MINS } from './colors'

// dev: Vite proxies /api -> :8000; prod: VITE_API_URL points at the deployed API
const API_BASE: string = import.meta.env.VITE_API_URL ?? '/api'

function modesParam(modes: TransitMode[]): string | null {
  // omit the param when everything is enabled (the backend default)
  return modes.length === ALL_MODES.length ? null : modes.join(',')
}

export async function fetchWalkmask(): Promise<Walkmask | null> {
  const res = await fetch(`${API_BASE}/walkmask`)
  if (!res.ok) return null // mask is optional: crow-fly fallback
  const j = await res.json()
  const bytes = Uint8Array.from(atob(j.packedBits), (c) => c.charCodeAt(0))
  const n = j.w * j.h
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) data[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1
  // summed-area table: walkable-fraction of any rectangle in O(1), used to
  // sample the mask without aliasing when viewport cells are coarser
  const w1 = j.w + 1
  const sat = new Uint32Array(w1 * (j.h + 1))
  for (let y = 0; y < j.h; y++) {
    let row = 0
    for (let x = 0; x < j.w; x++) {
      row += data[y * j.w + x]
      sat[(y + 1) * w1 + (x + 1)] = sat[y * w1 + (x + 1)] + row
    }
  }
  return { w: j.w, h: j.h, south: j.south, west: j.west, north: j.north, east: j.east, data, sat }
}

export async function fetchStops(): Promise<StopsCatalog> {
  const res = await fetch(`${API_BASE}/stops`)
  if (!res.ok) throw new Error(`GET /stops failed: ${res.status}`)
  return res.json()
}

export async function fetchTravelTime(
  sources: LatLng[],
  at: string,
  combine: CombineMode,
  modes: TransitMode[],
  direction: Direction,
  signal: AbortSignal,
): Promise<TravelTimeResult> {
  const params = new URLSearchParams()
  for (const s of sources) params.append('from', `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`)
  params.set('at', at)
  params.set('max', String(MAX_TRAVEL_MINS))
  if (direction === 'arrive') params.set('dir', 'arrive')
  if (combine === 'meet' && sources.length > 1) params.set('mode', 'meet')
  const m = modesParam(modes)
  if (m) params.set('modes', m)
  const res = await fetch(`${API_BASE}/traveltime?${params}`, { signal })
  if (!res.ok) throw new Error(`GET /traveltime failed: ${res.status}`)
  return res.json()
}

export async function fetchRoute(
  sources: LatLng[],
  at: string,
  to: LatLng,
  modes: TransitMode[],
): Promise<RouteResponse> {
  const params = new URLSearchParams()
  for (const s of sources) params.append('from', `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`)
  params.set('at', at)
  params.set('to', `${to.lat.toFixed(6)},${to.lng.toFixed(6)}`)
  const m = modesParam(modes)
  if (m) params.set('modes', m)
  const res = await fetch(`${API_BASE}/route?${params}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? `GET /route failed: ${res.status}`)
  }
  return res.json()
}
