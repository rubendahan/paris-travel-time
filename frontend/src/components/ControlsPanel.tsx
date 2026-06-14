import { useState } from 'react'
import type { Bounds, CombineMode, Direction, TransitMode, TravelTimeResult } from '../lib/types'
import { ALL_MODES } from '../lib/types'
import { clockDisplay } from '../lib/time'
import BoundsSliders from './BoundsSliders'
import AlgoExplainer from './AlgoExplainer'

const MODE_LABELS: Record<TransitMode, string> = {
  metro: 'Metro',
  rail: 'Train/RER',
  tram: 'Tram',
  bus: 'Bus',
}

export default function ControlsPanel({
  departAt,
  onDepartAtChange,
  direction,
  onDirectionChange,
  bounds,
  onBoundsChange,
  combine,
  onCombineChange,
  modes,
  onModesChange,
  playing,
  onTogglePlay,
  result,
  loading,
  error,
  sourceCount,
}: {
  departAt: string
  onDepartAtChange: (v: string) => void
  direction: Direction
  onDirectionChange: (d: Direction) => void
  bounds: Bounds
  onBoundsChange: (b: Bounds) => void
  combine: CombineMode
  onCombineChange: (m: CombineMode) => void
  modes: TransitMode[]
  onModesChange: (m: TransitMode[]) => void
  playing: boolean
  onTogglePlay: () => void
  result: TravelTimeResult | null
  loading: boolean
  error: string | null
  sourceCount: number
}) {
  const toggleMode = (m: TransitMode) =>
    onModesChange(modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m])

  // On phones the panel is full width and would swallow the map; start folded
  // down to just its title bar, with a tap to expand. Always open from sm up.
  const [collapsed, setCollapsed] = useState(
    typeof window !== 'undefined' && window.innerWidth < 640,
  )

  return (
    <div className="w-full rounded-lg border border-gray-200 bg-white/95 p-3 shadow-md backdrop-blur sm:w-72">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-sm font-bold text-gray-800">Paris Travel Time</h1>
        <div className="flex items-center gap-2">
          <AlgoExplainer />
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand controls' : 'Collapse controls'}
            aria-expanded={!collapsed}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[11px] font-bold text-gray-500 hover:bg-gray-100 sm:hidden"
          >
            {collapsed ? '▾' : '▴'}
          </button>
        </div>
      </div>

      <div className={`mt-2 ${collapsed ? 'hidden sm:block' : 'block'}`}>
      {sourceCount === 0 && (
        <p className="mb-2 text-xs text-gray-600">
          Click the map (or search an address) to drop a start. Right-click for the detailed
          route.
        </p>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1 text-xs text-gray-700">
          <select
            value={direction}
            onChange={(e) => onDirectionChange(e.target.value as Direction)}
            className="rounded border border-gray-300 px-1 py-1 text-xs"
          >
            <option value="depart">Leave at</option>
            <option value="arrive">Arrive by</option>
          </select>
          <input
            type="time"
            value={clockDisplay(departAt)}
            onChange={(e) => e.target.value && onDepartAtChange(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          onClick={onTogglePlay}
          title="Animate the day (5 am to midnight)"
          className={`rounded px-2 py-1 text-sm ${playing ? 'bg-gray-800 text-white' : 'border border-gray-300 hover:bg-gray-100'}`}
        >
          {playing ? '⏸' : '▶'}
        </button>
      </div>

      {sourceCount >= 2 && (
        <div className="mb-2 flex gap-1 rounded-md bg-gray-100 p-0.5 text-xs">
          {(
            [
              ['union', 'One of us'],
              ['meet', 'All of us'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => onCombineChange(value)}
              className={`flex-1 rounded px-2 py-1 ${combine === value ? 'bg-white font-semibold shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
        {ALL_MODES.map((m) => (
          <label key={m} className="flex items-center gap-1 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={modes.includes(m)}
              onChange={() => toggleMode(m)}
              className="accent-gray-700"
            />
            {MODE_LABELS[m]}
          </label>
        ))}
      </div>

      <BoundsSliders bounds={bounds} onChange={onBoundsChange} />

      <div className="mt-2 min-h-4 text-xs text-gray-500">
        {loading && <span className="animate-pulse">Computing…</span>}
        {error && <span className="text-red-600">Error: {error}</span>}
        {!loading && !error && result && (
          <span>
            {result.idx.length.toLocaleString('en-GB')} stops reachable · {result.queryMs} ms ·{' '}
            {result.serviceDate}
          </span>
        )}
        {!loading && !error && !result && sourceCount > 0 && modes.length === 0 && (
          <span className="text-orange-600">Select at least one mode.</span>
        )}
      </div>
      </div>
    </div>
  )
}
