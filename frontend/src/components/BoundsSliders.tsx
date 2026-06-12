import type { Bounds } from '../lib/types'
import { BAND_COLORS, MAX_TRAVEL_MINS } from '../lib/colors'

const MIN_GAP = 5

export default function BoundsSliders({
  bounds,
  onChange,
}: {
  bounds: Bounds
  onChange: (b: Bounds) => void
}) {
  const set = (i: number, value: number) => {
    const next = [...bounds] as Bounds
    next[i] = value
    // keep ascending with a minimum gap, pushing neighbours
    for (let j = i - 1; j >= 0; j--) next[j] = Math.min(next[j], next[j + 1] - MIN_GAP)
    for (let j = i + 1; j < 4; j++) next[j] = Math.max(next[j], next[j - 1] + MIN_GAP)
    if (next.every((v) => v >= MIN_GAP && v <= MAX_TRAVEL_MINS)) onChange(next)
  }

  return (
    <div className="space-y-1">
      {bounds.map((b, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: BAND_COLORS[i] }} />
          <input
            type="range"
            min={MIN_GAP}
            max={MAX_TRAVEL_MINS}
            value={b}
            onChange={(e) => set(i, Number(e.target.value))}
            className="w-full accent-gray-700"
          />
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-gray-600">
            {i === 0 ? '0' : bounds[i - 1]}-{b} min
          </span>
        </div>
      ))}
    </div>
  )
}
