import type { Bounds, CombineMode, TransitMode, TravelTimeResult } from '../lib/types'
import { ALL_MODES } from '../lib/types'
import BoundsSliders from './BoundsSliders'

const MODE_LABELS: Record<TransitMode, string> = {
  metro: 'Métro',
  rail: 'RER/Train',
  tram: 'Tram',
  bus: 'Bus',
}

export default function ControlsPanel({
  departAt,
  onDepartAtChange,
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

  return (
    <div className="w-72 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-md backdrop-blur">
      <h1 className="mb-2 text-sm font-bold text-gray-800">Paris Travel Time</h1>

      {sourceCount === 0 && (
        <p className="mb-2 text-xs text-gray-600">
          Cliquez sur la carte (ou cherchez une adresse) pour placer un départ. Clic droit :
          itinéraire détaillé.
        </p>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-gray-700">
          Départ à
          <input
            type="time"
            value={departAt}
            onChange={(e) => e.target.value && onDepartAtChange(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          onClick={onTogglePlay}
          title="Animer la journée (5h → minuit)"
          className={`rounded px-2 py-1 text-sm ${playing ? 'bg-gray-800 text-white' : 'border border-gray-300 hover:bg-gray-100'}`}
        >
          {playing ? '⏸' : '▶'}
        </button>
      </div>

      {sourceCount >= 2 && (
        <div className="mb-2 flex gap-1 rounded-md bg-gray-100 p-0.5 text-xs">
          {(
            [
              ['union', 'Union (l’un de nous)'],
              ['meet', 'Rencontre (nous tous)'],
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
        {loading && <span className="animate-pulse">Calcul en cours…</span>}
        {error && <span className="text-red-600">Erreur : {error}</span>}
        {!loading && !error && result && (
          <span>
            {result.idx.length.toLocaleString('fr-FR')} arrêts atteignables · {result.queryMs} ms ·{' '}
            {result.serviceDate}
          </span>
        )}
        {!loading && !error && !result && sourceCount > 0 && modes.length === 0 && (
          <span className="text-orange-600">Sélectionnez au moins un mode.</span>
        )}
      </div>
    </div>
  )
}
