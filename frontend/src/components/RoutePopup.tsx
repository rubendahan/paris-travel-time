import { Popup } from 'react-leaflet'
import type { LatLng, RouteResponse } from '../lib/types'

const MODE_BADGE: Record<string, string> = {
  'Métro': 'bg-blue-600',
  'Train/RER': 'bg-red-700',
  'Tram': 'bg-teal-600',
  'Bus': 'bg-emerald-600',
  'Transport': 'bg-gray-600',
}

export default function RoutePopup({
  pos,
  route,
  error,
  onClose,
}: {
  pos: LatLng
  route: RouteResponse | null
  error: string | null
  onClose: () => void
}) {
  return (
    <Popup position={pos} eventHandlers={{ remove: onClose }} maxWidth={320}>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!route && !error && <div className="animate-pulse text-sm">Calcul de l'itinéraire…</div>}
      {route && (
        <div className="min-w-56">
          <div className="mb-1 text-sm font-bold">
            {route.totalMinutes} min · arrivée {route.arriveAt}
          </div>
          <ol className="space-y-1">
            {route.legs.map((leg, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-tight">
                {leg.kind === 'walk' ? (
                  <span className="mt-0.5 shrink-0">🚶</span>
                ) : (
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-bold text-white ${MODE_BADGE[leg.mode ?? 'Transport']}`}
                  >
                    {leg.route}
                  </span>
                )}
                <span>
                  {leg.kind === 'walk' ? 'Marche' : leg.mode} · {leg.fromName} → {leg.toName}
                  <span className="text-gray-500">
                    {' '}
                    ({leg.dep}–{leg.arr}, {leg.minutes} min)
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Popup>
  )
}
