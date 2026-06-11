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
  const [data, setData] = useState<TravelTimeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // serialize so the effect only refires on real changes
  const key =
    sources.map((s) => `${s.lat},${s.lng}`).join('_') +
    `@${departAt}|${combine}|${modes.join(',')}|${direction}`

  useEffect(() => {
    if (!sources.length || !modes.length) {
      setData(null)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    fetchTravelTime(sources, departAt, combine, modes, direction, ctrl.signal)
      .then((r) => {
        setData(r)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { data, loading, error }
}
