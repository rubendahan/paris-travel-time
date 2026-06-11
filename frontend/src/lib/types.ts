export interface StopsCatalog {
  ids: string[]
  names: string[]
  lats: number[]
  lons: number[]
}

export interface TravelTimeResult {
  departAt: string
  serviceDate: string
  queryMs: number
  idx: number[]
  minutes: number[]
}

export interface LatLng {
  lat: number
  lng: number
}

/** Four ascending time bounds in minutes, e.g. [15, 30, 45, 60]. */
export type Bounds = [number, number, number, number]

/** depart = markers are origins; arrive = markers are destinations ("be there by"). */
export type Direction = 'depart' | 'arrive'

/** union = reachable from ANY marker; meet = time for EVERYONE to get there. */
export type CombineMode = 'union' | 'meet'

export const ALL_MODES = ['metro', 'rail', 'tram', 'bus'] as const
export type TransitMode = (typeof ALL_MODES)[number]

export interface RouteLeg {
  kind: 'walk' | 'transit'
  fromName: string
  toName: string
  dep: string
  arr: string
  minutes: number
  route?: string
  mode?: string
}

export interface RouteResponse {
  totalMinutes: number
  arriveAt: string
  legs: RouteLeg[]
}
