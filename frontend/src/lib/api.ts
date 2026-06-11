import type { CombineMode, LatLng, RouteResponse, StopsCatalog, TransitMode, TravelTimeResult } from './types'
import { ALL_MODES } from './types'
import { MAX_TRAVEL_MINS } from './colors'

function modesParam(modes: TransitMode[]): string | null {
  // omit the param when everything is enabled (the backend default)
  return modes.length === ALL_MODES.length ? null : modes.join(',')
}

export async function fetchStops(): Promise<StopsCatalog> {
  const res = await fetch('/api/stops')
  if (!res.ok) throw new Error(`GET /stops failed: ${res.status}`)
  return res.json()
}

export async function fetchTravelTime(
  sources: LatLng[],
  at: string,
  combine: CombineMode,
  modes: TransitMode[],
  signal: AbortSignal,
): Promise<TravelTimeResult> {
  const params = new URLSearchParams()
  for (const s of sources) params.append('from', `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`)
  params.set('at', at)
  params.set('max', String(MAX_TRAVEL_MINS))
  if (combine === 'meet' && sources.length > 1) params.set('mode', 'meet')
  const m = modesParam(modes)
  if (m) params.set('modes', m)
  const res = await fetch(`/api/traveltime?${params}`, { signal })
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
  const res = await fetch(`/api/route?${params}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? `GET /route failed: ${res.status}`)
  }
  return res.json()
}
