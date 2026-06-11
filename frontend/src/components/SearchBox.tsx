import { useEffect, useRef, useState } from 'react'
import type { LatLng } from '../lib/types'

interface BanFeature {
  geometry: { coordinates: [number, number] } // [lon, lat]
  properties: {
    label: string
    context: string
    type: 'housenumber' | 'street' | 'locality' | 'municipality'
    score: number
  }
}

// BAN (Base Adresse Nationale): the French government geocoder, built for
// autocomplete (sub-100ms responses, 50 req/s allowed). France-only, which
// is fine here; results are biased toward the map center (Paris).
const BAN = 'https://api-adresse.data.gouv.fr/search/?autocomplete=1&limit=6&lat=48.8566&lon=2.3522'

const TYPE_ICON: Record<string, string> = {
  housenumber: '🏠',
  street: '🛣️',
  locality: '📍',
  municipality: '🏙️',
}

export default function SearchBox({ onSelect }: { onSelect: (pos: LatLng, name: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BanFeature[]>([])
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const timer = useRef<number>(undefined)
  const ctrl = useRef<AbortController | null>(null)

  useEffect(() => {
    window.clearTimeout(timer.current)
    ctrl.current?.abort()
    if (query.trim().length < 3) {
      setResults([])
      setActive(-1)
      setLoading(false)
      return
    }
    setLoading(true)
    timer.current = window.setTimeout(() => {
      const ac = new AbortController()
      ctrl.current = ac
      fetch(`${BAN}&q=${encodeURIComponent(query)}`, { signal: ac.signal })
        .then((r) => r.json())
        .then((d) => {
          setResults(d.features ?? [])
          setActive(-1)
          setLoading(false)
        })
        .catch((e: unknown) => {
          if (!(e instanceof DOMException && e.name === 'AbortError')) {
            setResults([])
            setLoading(false)
          }
        })
    }, 250)
    return () => window.clearTimeout(timer.current)
  }, [query])

  const pick = (f: BanFeature) => {
    const [lon, lat] = f.geometry.coordinates
    onSelect({ lat, lng: lon }, f.properties.label)
    setQuery('')
    setResults([])
    setActive(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, -1))
    } else if (e.key === 'Enter' && (active >= 0 || results.length > 0)) {
      e.preventDefault()
      pick(results[Math.max(active, 0)])
    } else if (e.key === 'Escape') {
      setQuery('')
      setResults([])
    }
  }

  return (
    <div className="relative w-80">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          🔍
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Adresse, rue, ville… (Entrée pour valider)"
          className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-8 text-sm shadow-md outline-none focus:border-gray-500"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          </span>
        )}
        {!loading && query && (
          <button
            onClick={() => {
              setQuery('')
              setResults([])
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-gray-400 hover:text-gray-700"
            aria-label="Effacer"
          >
            ✕
          </button>
        )}
      </div>
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.map((f, i) => (
            <li key={i}>
              <button
                className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs ${
                  i === active ? 'bg-gray-100' : 'hover:bg-gray-50'
                }`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(f)}
              >
                <span className="shrink-0">{TYPE_ICON[f.properties.type] ?? '📍'}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-800">
                    {f.properties.label}
                  </span>
                  <span className="block truncate text-[10px] text-gray-500">
                    {f.properties.context}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
