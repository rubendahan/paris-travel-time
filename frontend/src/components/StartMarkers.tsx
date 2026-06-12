import L from 'leaflet'
import { Marker, Popup } from 'react-leaflet'
import type { LatLng } from '../lib/types'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

// Leaflet's default icon URLs break under bundlers; point them at Vite assets.
const DefaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})

export default function StartMarkers({
  sources,
  onMove,
  onRemove,
}: {
  sources: LatLng[]
  onMove: (index: number, pos: LatLng) => void
  onRemove: (index: number) => void
}) {
  return (
    <>
      {sources.map((s, i) => (
        <Marker
          key={i}
          position={s}
          icon={DefaultIcon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const p = (e.target as L.Marker).getLatLng()
              onMove(i, { lat: p.lat, lng: p.lng })
            },
          }}
        >
          <Popup>
            <div className="text-sm">
              Start {i + 1}
              <button
                className="ml-2 rounded bg-red-500 px-2 py-0.5 text-xs text-white hover:bg-red-600"
                onClick={() => onRemove(i)}
              >
                Remove
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  )
}
