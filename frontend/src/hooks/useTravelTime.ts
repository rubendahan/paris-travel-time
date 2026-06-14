import { useEffect, useState } from 'react'
import { fetchTravelTime } from '../lib/api'
import type { CombineMode, Direction, LatLng, TransitMode, TravelTimeResult } from '../lib/types'

export function useTravelTime(
  sources: LatLng[],
  departAt: string,
  combine: CombineMode,
  modes: TransitMode[],
  direction: Direction,
) {
  // Results and errors are tagged with the query key that produced them, so
  // loading/error are derived during render instead of being written from the
  // fetch effect (a synchronous setState there cascades a render every query).
  const [result, setResult] = useState<{ key: string; data: TravelTimeResult } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)

  const active = sources.length > 0 && modes.length > 0

  // serialize so the effect only refires on real changes
  const key =
    sources.map((s) => `${s.lat},${s.lng}`).join('_') +
    `@${departAt}|${combine}|${modes.join(',')}|${direction}`

  useEffect(() => {
    if (!active) return
    const ctrl = new AbortController()
    fetchTravelTime(sources, departAt, combine, modes, direction, ctrl.signal)
      .then((r) => setResult({ key, data: r }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setFailure({ key, message: e instanceof Error ? e.message : String(e) })
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!active) return { data: null, loading: false, error: null }
  // the query is settled once a result or an error carries the current key;
  // until then keep the previous map on screen, just flagged as loading
  const settled = result?.key === key || failure?.key === key
  return {
    data: result?.data ?? null,
    loading: !settled,
    error: failure?.key === key ? failure.message : null,
  }
}
