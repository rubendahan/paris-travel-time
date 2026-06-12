import { BAND_COLORS } from '../../lib/colors'

/* Toy network shared by the scan player and the explainer figures. The
   simulation mirrors the python kernel (csa.py): a single pass over the
   connections sorted by departure time, the trip_reached || board <= dep
   test, and walking propagation after each improvement. Times are in
   minutes after 8:00. */

export type Anchor = 'start' | 'middle' | 'end'

export interface ToyStop {
  name: string
  short: string
  x: number
  y: number
  // label positions for when the default placement crosses a line
  nameAt?: [number, number, Anchor]
  timeAt?: [number, number, Anchor]
}

export const STOPS: ToyStop[] = [
  { name: 'Châtelet', short: 'Châtelet', x: 45, y: 150 },
  { name: 'Hôtel de Ville', short: 'H. de Ville', x: 155, y: 110, nameAt: [141, 102, 'end'] },
  { name: 'République', short: 'République', x: 250, y: 38, timeAt: [236, 63, 'middle'] },
  { name: 'Bastille', short: 'Bastille', x: 290, y: 140, nameAt: [277, 152, 'end'], timeAt: [277, 166, 'end'] },
  { name: 'Gare de Lyon', short: 'G. de Lyon', x: 335, y: 222 },
  { name: 'Nation', short: 'Nation', x: 415, y: 100 },
]

export const LINES = [
  { id: 'M1', color: '#ffcd00', dark: true, path: [0, 1, 3, 5] },
  { id: 'M5', color: '#ff7e2e', dark: false, path: [2, 3, 4] },
]

// a single footpath: Hôtel de Ville <-> République, 4 min
export const WALK = { a: 1, b: 2, min: 4 }

export interface Conn {
  dep: number
  arr: number
  from: number
  to: number
  trip: number
  line: number
}

// trip 0: the M1 train; trips 1 and 2: two successive M5 runs
export const CONNS: Conn[] = [
  { dep: 1, arr: 3, from: 0, to: 1, trip: 0, line: 0 },
  { dep: 2, arr: 5, from: 2, to: 3, trip: 1, line: 1 },
  { dep: 4, arr: 6, from: 1, to: 3, trip: 0, line: 0 },
  { dep: 5, arr: 8, from: 3, to: 4, trip: 1, line: 1 },
  { dep: 7, arr: 10, from: 3, to: 5, trip: 0, line: 0 },
  { dep: 9, arr: 12, from: 2, to: 3, trip: 2, line: 1 },
  { dep: 13, arr: 15, from: 3, to: 4, trip: 2, line: 1 },
]

export type ConnStatus = 'pending' | 'taken' | 'skipped' | 'boarded'

export interface Step {
  connIdx: number | null
  statuses: ConnStatus[]
  arrival: (number | null)[]
  walked: boolean
}

function simulate(): Step[] {
  const arrival: (number | null)[] = STOPS.map(() => null)
  const tripReached = [false, false, false]
  const statuses: ConnStatus[] = CONNS.map(() => 'pending')
  const steps: Step[] = []

  arrival[0] = 0 // the marker sits at Châtelet, it is 8:00
  steps.push({ connIdx: null, statuses: [...statuses], arrival: [...arrival], walked: false })

  CONNS.forEach((c, i) => {
    let walked = false
    const canBoard =
      tripReached[c.trip] || (arrival[c.from] !== null && arrival[c.from]! <= c.dep)
    if (canBoard) {
      tripReached[c.trip] = true
      if (arrival[c.to] === null || c.arr < arrival[c.to]!) {
        statuses[i] = 'taken'
        arrival[c.to] = c.arr
        for (const [s, s2] of [[WALK.a, WALK.b], [WALK.b, WALK.a]]) {
          if (c.to === s && (arrival[s2] === null || c.arr + WALK.min < arrival[s2]!)) {
            arrival[s2] = c.arr + WALK.min
            walked = true
          }
        }
      } else {
        statuses[i] = 'boarded'
      }
    } else {
      statuses[i] = 'skipped'
    }
    steps.push({ connIdx: i, statuses: [...statuses], arrival: [...arrival], walked })
  })

  steps.push({ connIdx: null, statuses: [...statuses], arrival: [...arrival], walked: false })
  return steps
}

export const STEPS = simulate()

export const TEXTS = [
  "A start is dropped at Châtelet, it is 8:00. Every connection of the day (one vehicle, one stop, the next stop) sits in a list sorted by departure time: the algorithm reads it once, in order, and never looks back.",
  "8:01, Châtelet → Hôtel de Ville: we have been at Châtelet since 8:00, we board. Hôtel de Ville is reached at 8:03, and from there 4 minutes on foot are enough for République (8:07).",
  "8:02, République → Bastille: we will only be at République at 8:07, too late for this run. Connection skipped. This test (can we be at the stop before it departs?) is the only test in the whole algorithm.",
  "8:04, Hôtel de Ville → Bastille: we have been there since 8:03, we board. Bastille is reached at 8:06.",
  "8:05, Bastille → Gare de Lyon: this run leaves one minute before we reach Bastille. Missed, too bad.",
  "8:07, Bastille → Nation: this is the train we have been sitting in since Châtelet, nothing to test. Nation is reached at 8:10.",
  "8:09, République → Bastille: we could board it, but it reaches Bastille at 8:12 and Bastille was already settled at 8:06. We only note that we are on board this train.",
  "8:13, Bastille → Gare de Lyon: the same train carries on, and this time nobody did better. Gare de Lyon is reached at 8:15.",
  "End of the scan: one read of the list and the best arrival time is known everywhere. On the real network that is 2.97 million connections swept in about 15 ms, every time the marker moves.",
]

export const t = (m: number) => `8:${String(m).padStart(2, '0')}`

export const bandColor = (m: number) =>
  m < 5 ? BAND_COLORS[0] : m < 10 ? BAND_COLORS[1] : m < 15 ? BAND_COLORS[2] : BAND_COLORS[3]
