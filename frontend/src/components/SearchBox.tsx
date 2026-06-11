import { useEffect, useRef, useState } from 'react'
import type { LatLng } from '../lib/types'

interface NominatimResult {
  display_name: string
  lat: string
  lon: string
}

// Île-de-France bounding box, and >=400ms debounce per Nominatim usage policy
const NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=jsonv2&viewbox=1.4,49.3,3.6,48.1&bounded=1&limit=5'

export default function SearchBox({ onSelect }: { onSelect: (pos: LatLng, name: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NominatimResult[]>([])
  const timer = useRef<number>(undefined)

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (query.trim().length < 3) {
      setResults([])
      return
    }
    timer.current = window.setTimeout(() => {
      fetch(`${NOMINATIM}&q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then(setResults)
        .catch(() => setResults([]))
    }, 450)
    return () => window.clearTimeout(timer.current)
  }, [query])

  return (
    <div className="relative w-72">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Chercher une adresse…"
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-md outline-none focus:border-gray-500"
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.map((r, i) => (
            <li key={i}>
              <button
                className="w-full truncate px-3 py-2 text-left text-xs hover:bg-gray-100"
                title={r.display_name}
                onClick={() => {
                  onSelect({ lat: Number(r.lat), lng: Number(r.lon) }, r.display_name)
                  setQuery('')
                  setResults([])
                }}
              >
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
