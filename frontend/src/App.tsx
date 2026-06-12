import { useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView'
import IsochronesLayer from './components/IsochronesLayer'
import StartMarkers from './components/StartMarkers'
import ControlsPanel from './components/ControlsPanel'
import SearchBox from './components/SearchBox'
import RoutePopup from './components/RoutePopup'
import { useTravelTime } from './hooks/useTravelTime'
import { fetchRoute, fetchStops, fetchWalkmask } from './lib/api'
import { parseUrlState, writeUrlState } from './lib/urlState'
import { MAX_SOURCES } from './lib/colors'
import type {
  Bounds,
  CombineMode,
  Direction,
  LatLng,
  RouteResponse,
  StopsCatalog,
  TransitMode,
  Walkmask,
} from './lib/types'

const ANIM_START = 5 * 60 // 05:00, in minutes
const ANIM_END = 26 * 60 // GTFS hours run past midnight: go up to 02:00 ("26:00")
const ANIM_STEP_MIN = 30
const ANIM_TICK_MS = 900

/** GTFS-style times can exceed 24h ("25:30" = 1:30 AM); display them mod 24. */
export function clockDisplay(at: string): string {
  const [h, m] = at.split(':').map(Number)
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

interface RoutePopupState {
  pos: LatLng
  route: RouteResponse | null
  error: string | null
}

export default function App() {
  const initial = useMemo(parseUrlState, [])
  const [sources, setSources] = useState<LatLng[]>(initial.sources)
  const [departAt, setDepartAt] = useState(initial.departAt)
  const [bounds, setBounds] = useState<Bounds>(initial.bounds)
  const [combine, setCombine] = useState<CombineMode>(initial.combine)
  const [modes, setModes] = useState<TransitMode[]>(initial.modes)
  const [direction, setDirection] = useState<Direction>(initial.direction)
  const [playing, setPlaying] = useState(false)
  const [catalog, setCatalog] = useState<StopsCatalog | null>(null)
  const [walkmask, setWalkmask] = useState<Walkmask | null>(null)
  const [routePopup, setRoutePopup] = useState<RoutePopupState | null>(null)
  const routeSeq = useRef(0)

  const { data, loading, error } = useTravelTime(sources, departAt, combine, modes, direction)

  // Render's free tier puts the API to sleep after 15 idle minutes; while it
  // boots, the first fetch can hang for a minute or fail outright. Retry until
  // it answers, and only then fetch the walkmask (optional refinement).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
        try {
          const stops = await fetchStops()
          if (cancelled) return
          setCatalog(stops)
          fetchWalkmask().then(setWalkmask).catch(() => {})
          return
        } catch {
          await new Promise((r) => setTimeout(r, 4000))
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // cold-start notice, shown once the initial load takes noticeably long
  const [waking, setWaking] = useState(false)
  useEffect(() => {
    if (catalog) {
      setWaking(false)
      return
    }
    const id = window.setTimeout(() => setWaking(true), 2500)
    return () => window.clearTimeout(id)
  }, [catalog])

  useEffect(() => {
    writeUrlState({ sources, departAt, bounds, combine, modes, direction })
  }, [sources, departAt, bounds, combine, modes, direction])

  // day animation: advance the departure time in 15-min steps
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      setDepartAt((prev) => {
        const [h, m] = prev.split(':').map(Number)
        let mins = h * 60 + m + ANIM_STEP_MIN
        if (mins >= ANIM_END) mins = ANIM_START
        return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
      })
    }, ANIM_TICK_MS)
    return () => window.clearInterval(id)
  }, [playing])

  const addSource = (pos: LatLng) =>
    setSources((prev) => (prev.length >= MAX_SOURCES ? prev : [...prev, pos]))

  const showRoute = (pos: LatLng) => {
    if (!sources.length) return
    if (direction === 'arrive') {
      setRoutePopup({ pos, route: null, error: 'Detailed routes are only available in "Leave at" mode.' })
      return
    }
    const seq = ++routeSeq.current
    setRoutePopup({ pos, route: null, error: null })
    fetchRoute(sources, departAt, pos, modes)
      .then((route) => {
        if (routeSeq.current === seq) setRoutePopup({ pos, route, error: null })
      })
      .catch((e: unknown) => {
        if (routeSeq.current === seq)
          setRoutePopup({ pos, route: null, error: e instanceof Error ? e.message : String(e) })
      })
  }

  return (
    <div className="relative h-full">
      <MapView onMapClick={addSource} onMapContextMenu={showRoute}>
        <IsochronesLayer catalog={catalog} result={data} bounds={bounds} walkmask={walkmask} />
        <StartMarkers
          sources={sources}
          onMove={(i, pos) => setSources((prev) => prev.map((s, j) => (j === i ? pos : s)))}
          onRemove={(i) => setSources((prev) => prev.filter((_, j) => j !== i))}
        />
        {routePopup && (
          <RoutePopup
            pos={routePopup.pos}
            route={routePopup.route}
            error={routePopup.error}
            onClose={() => setRoutePopup(null)}
          />
        )}
      </MapView>

      {waking && !catalog && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-[1000] w-[min(26rem,90vw)] -translate-x-1/2 rounded-xl bg-gray-900/85 px-5 py-3 text-center text-white shadow-lg backdrop-blur">
          <div className="text-sm font-semibold">
            <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white align-[-1px]" />
            Waking up the server…
          </div>
          <div className="mt-1 text-xs opacity-80">
            Free hosting puts the API to sleep after 15 idle minutes. The first load can take
            up to a minute.
          </div>
        </div>
      )}

      {playing && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-[1000] -translate-x-1/2 rounded-xl bg-gray-900/80 px-6 py-3 text-center text-white shadow-lg backdrop-blur">
          <div className="text-4xl font-bold tabular-nums">{clockDisplay(departAt)}</div>
          <div className="mt-0.5 text-xs tabular-nums opacity-80">
            {data ? `${data.idx.length.toLocaleString('en-GB')} stops reachable` : '…'}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start justify-between gap-2 p-3">
        {/* -m/p halo: near-miss clicks around the controls are absorbed
            instead of falling through to the map and dropping a marker */}
        <div className="pointer-events-auto -m-3 p-3">
          <SearchBox onSelect={addSource} />
        </div>
        <div className="pointer-events-auto -m-3 p-3">
          <ControlsPanel
            departAt={departAt}
            onDepartAtChange={setDepartAt}
            direction={direction}
            onDirectionChange={setDirection}
            bounds={bounds}
            onBoundsChange={setBounds}
            combine={combine}
            onCombineChange={setCombine}
            modes={modes}
            onModesChange={setModes}
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
            result={data}
            loading={loading}
            error={error}
            sourceCount={sources.length}
          />
        </div>
      </div>
    </div>
  )
}
