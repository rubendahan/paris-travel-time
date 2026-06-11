import type { StopsCatalog, TravelTimeResult, Walkmask } from './types'
import { WALK_SPEED_M_PER_MIN } from './colors'

/**
 * Travel-time field at the NATIVE resolution of the walkability mask.
 *
 * Computed once per query result with a multi-source Dial (bucket queue)
 * Dijkstra over the 30 m mask grid: barriers and bridges are exact by
 * construction, at every zoom. The viewport then only RESAMPLES this field
 * for display. (The previous design resampled the mask per viewport and
 * propagated on the screen grid; thin rivers vs thin bridges under a 50%
 * threshold made barriers flicker with zoom, with sealed-off areas at some
 * zoom levels.)
 *
 * Cost: seeds + relaxations bounded by the colored area only. Measured
 * around 300-700 ms for a 60 min budget, cached until the result changes;
 * pan and zoom never recompute it.
 */
export interface NativeField {
  /** seconds of total travel (transit + walk), UNREACHED if not reachable */
  secs: Uint16Array
  w: number
  h: number
}

export const UNREACHED = 65535

export function computeNativeField(
  wm: Walkmask,
  catalog: StopsCatalog,
  result: TravelTimeResult,
  maxMinutes: number,
): NativeField {
  const { w, h, data } = wm
  const secs = new Uint16Array(w * h).fill(UNREACHED)

  const latMid = (wm.north + wm.south) / 2
  const cellLatM = ((wm.north - wm.south) * 111_320) / h
  const cellLonM =
    ((wm.east - wm.west) * 111_320 * Math.cos((latMid * Math.PI) / 180)) / w
  const cellM = (cellLatM + cellLonM) / 2
  const orthoS = Math.max(1, Math.round((cellM / WALK_SPEED_M_PER_MIN) * 60))
  const diagS = Math.max(1, Math.round(((cellM * Math.SQRT2) / WALK_SPEED_M_PER_MIN) * 60))
  const budget = maxMinutes * 60

  const buckets: number[][] = Array.from({ length: budget + diagS + 2 }, () => [])

  // --- seeds: every reached stop, snapped off blocked cells if needed ---
  for (let i = 0; i < result.idx.length; i++) {
    const minutes = result.minutes[i]
    if (minutes > maxMinutes) continue
    const s = result.idx[i]
    const lat = catalog.lats[s]
    const lon = catalog.lons[s]
    if (lat < wm.south || lat > wm.north || lon < wm.west || lon > wm.east) continue
    const fx = ((lon - wm.west) / (wm.east - wm.west)) * w
    const fy = ((wm.north - lat) / (wm.north - wm.south)) * h
    let cx = Math.min(w - 1, Math.max(0, Math.floor(fx)))
    let cy = Math.min(h - 1, Math.max(0, Math.floor(fy)))
    if (!data[cy * w + cx]) {
      let found = false
      for (let r = 1; r <= 3 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.max(Math.abs(dy), Math.abs(dx)) !== r) continue
            const ny = cy + dy
            const nx = cx + dx
            if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue
            if (data[ny * w + nx]) {
              cy = ny
              cx = nx
              found = true
            }
          }
        }
      }
      if (!found) continue
    }
    const offM = Math.hypot(fx - (cx + 0.5), fy - (cy + 0.5)) * cellM
    const sec = Math.round(minutes * 60 + (offM / WALK_SPEED_M_PER_MIN) * 60)
    if (sec > budget) continue
    const k = cy * w + cx
    if (sec < secs[k]) {
      secs[k] = sec
      buckets[sec].push(k)
    }
  }

  // --- Dial's algorithm: O(1) bucket queue, integer seconds ---
  for (let t = 0; t < buckets.length; t++) {
    const bucket = buckets[t]
    for (let b = 0; b < bucket.length; b++) {
      const k = bucket[b]
      if (secs[k] !== t) continue // stale entry
      const y = (k / w) | 0
      const x = k - y * w
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (!dy && !dx) continue
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const nk = ny * w + nx
          if (!data[nk]) continue
          const nd = t + (dy && dx ? diagS : orthoS)
          if (nd <= budget && nd < secs[nk]) {
            secs[nk] = nd
            buckets[nd].push(nk)
          }
        }
      }
    }
    bucket.length = 0
  }

  return { secs, w, h }
}
