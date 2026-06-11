import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import type { ReactNode } from 'react'
import type { LatLng } from '../lib/types'

function ClickHandler({
  onClick,
  onContextMenu,
}: {
  onClick: (pos: LatLng) => void
  onContextMenu: (pos: LatLng) => void
}) {
  useMapEvents({
    click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }),
    contextmenu: (e) => onContextMenu({ lat: e.latlng.lat, lng: e.latlng.lng }),
  })
  return null
}

export default function MapView({
  onMapClick,
  onMapContextMenu,
  children,
}: {
  onMapClick: (pos: LatLng) => void
  onMapContextMenu: (pos: LatLng) => void
  children: ReactNode
}) {
  return (
    <MapContainer
      center={[48.8566, 2.3522]}
      zoom={12}
      preferCanvas
      className="h-full w-full"
      zoomControl={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      <ClickHandler onClick={onMapClick} onContextMenu={onMapContextMenu} />
      {children}
    </MapContainer>
  )
}
