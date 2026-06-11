import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import type { Bounds, StopsCatalog, TravelTimeResult } from '../lib/types'
import { BAND_COLORS, MIN_CIRCLE_RADIUS_M, WALK_SPEED_M_PER_MIN } from '../lib/colors'

/**
 * Imperative heatmap layer: one filled circle per reachable stop, radius =
 * walking distance coverable in the remaining time of its band.
 *
 * Deliberately NOT react-leaflet <Circle> components: ~40k of them would
 * choke both React reconciliation and the default SVG renderer. All circles
 * share a single canvas renderer and are non-interactive.
 */
export default function CirclesLayer({
  catalog,
  result,
  bounds,
}: {
  catalog: StopsCatalog | null
  result: TravelTimeResult | null
  bounds: Bounds
}) {
  const map = useMap()
  const rendererRef = useRef<L.Canvas | null>(null)
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!rendererRef.current) {
      // Opaque circles in a dedicated pane faded via CSS: overlapping circles
      // then composite ONCE at 40%, instead of per-circle alpha stacking up
      // to a saturated blob (the tflmap trick).
      const pane = map.createPane('heatmap')
      pane.style.opacity = '0.4'
      pane.style.pointerEvents = 'none'
      rendererRef.current = L.canvas({ padding: 0.5, pane: 'heatmap' })
    }
    const timer = window.setTimeout(() => {
      groupRef.current?.remove()
      groupRef.current = null
      if (!catalog || !result) return

      const circles: { lat: number; lon: number; radius: number; color: string }[] = []
      for (let i = 0; i < result.idx.length; i++) {
        const minutes = result.minutes[i]
        const band = bounds.findIndex((b) => minutes <= b)
        if (band === -1) continue
        const radius = WALK_SPEED_M_PER_MIN * (bounds[band] - minutes)
        if (radius < MIN_CIRCLE_RADIUS_M) continue
        const stop = result.idx[i]
        circles.push({ lat: catalog.lats[stop], lon: catalog.lons[stop], radius, color: BAND_COLORS[band] })
      }
      // largest first so tighter (better) bands paint on top
      circles.sort((a, b) => b.radius - a.radius)

      const group = L.layerGroup(
        circles.map((c) =>
          L.circle([c.lat, c.lon], {
            radius: c.radius,
            renderer: rendererRef.current!,
            pane: 'heatmap',
            stroke: false,
            fillColor: c.color,
            fillOpacity: 1,
            interactive: false,
          }),
        ),
      )
      group.addTo(map)
      groupRef.current = group
    }, 100) // debounce slider drags: rebuild is the only cost, no network

    return () => window.clearTimeout(timer)
  }, [map, catalog, result, bounds])

  useEffect(
    () => () => {
      groupRef.current?.remove()
    },
    [],
  )

  return null
}
