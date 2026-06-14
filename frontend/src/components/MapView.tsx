import { useEffect } from 'react'
import { MapContainer, Pane, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { ReactNode } from 'react'
import type { LatLng } from '../lib/types'

// clicks inside a popup (e.g. the "Remove" button) bubble up to the map's
// own click listener and would drop a new marker at the button's position.
// By the time the map handler runs the popup may already be closed and its
// content detached (closeOnClick fires first), so a disconnected target is
// also treated as popup-originated: a genuine map click always targets a
// still-connected pane element.
function isFromPopup(e: { originalEvent: Event }): boolean {
  const target = e.originalEvent.target
  if (!(target instanceof Element)) return false
  return !target.isConnected || target.closest('.leaflet-popup') !== null
}

// On mobile the container's real size often isn't known at init (fonts/CSS
// still settling, the address bar collapsing on first scroll), which leaves
// Leaflet with a stale pixel transform: tiles, markers and the isochrone
// overlay end up drawn against different origins, so the colored field looks
// off-center from the pin. Re-measure once the layout settles and whenever the
// viewport changes size or orientation.
function ResizeFix() {
  const map = useMap()
  useEffect(() => {
    const fix = () => map.invalidateSize({ animate: false })
    const raf = requestAnimationFrame(fix)
    window.addEventListener('orientationchange', fix)
    const ro = new ResizeObserver(fix)
    ro.observe(map.getContainer())
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('orientationchange', fix)
      ro.disconnect()
    }
  }, [map])
  return null
}

function ClickHandler({
  onClick,
  onContextMenu,
}: {
  onClick: (pos: LatLng) => void
  onContextMenu: (pos: LatLng) => void
}) {
  useMapEvents({
    click: (e) => {
      if (!isFromPopup(e)) onClick({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
    contextmenu: (e) => {
      if (!isFromPopup(e)) onContextMenu({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
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
      {/* base WITHOUT labels: building texture stays under the bands, while
          street/place names render in a pane ABOVE them (crisp and readable,
          and gray blocks no longer read as fake holes through the colors) */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      <Pane name="labels" style={{ zIndex: 450, pointerEvents: 'none' }}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png" />
      </Pane>
      <ResizeFix />
      <ClickHandler onClick={onMapClick} onContextMenu={onMapContextMenu} />
      {children}
    </MapContainer>
  )
}
