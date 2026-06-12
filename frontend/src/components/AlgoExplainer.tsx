import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import ScanPlayer from './explainer/ScanPlayer'
import { InvariantFig, MareyFig, MemoryFig } from './explainer/Figures'

function H({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 mb-1.5 text-[13px] font-bold text-gray-800">{children}</h3>
}

function P({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[12.5px] leading-relaxed text-gray-700">{children}</p>
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-gray-100 px-1 py-px font-mono text-[11px]">{children}</code>
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="mt-1 mb-2 text-center text-[10.5px] italic text-gray-500">{children}</p>
}

export default function AlgoExplainer() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="How does it work?"
        className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[11px] font-bold text-gray-500 hover:bg-gray-100"
      >
        ?
      </button>

      {/* portal: the panel's backdrop-blur would make it the containing
          block of a position:fixed child, the modal must live under body */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white px-6 pb-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 -mx-6 mb-1 flex items-start justify-between border-b border-gray-100 bg-white px-6 pt-4 pb-2">
              <h2 className="text-sm font-bold text-gray-800">Under the hood: the Connection Scan</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded px-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <P>
              No precomputed routes, no approximate zones: every click makes the server
              recompute the best arrival time at all 36,071 stops of the region, against the
              real timetables of the day. The algorithm that makes this affordable is called
              the Connection Scan, and it is simple enough to explain here in full.
            </P>

            <H>1. The problem</H>
            <P>
              Coloring the map means answering 36,071 questions at once: leaving the marker at
              the chosen time, how early can you be at every stop in the region?
            </P>
            <P>
              The classic reflex would be a shortest path, Dijkstra style: nodes, edges,
              weights. But a timetable network does not play along. The "cost" of the
              Châtelet → Bastille hop depends on when you show up on the platform: it includes
              the wait for the next departure, which changes all day long and becomes infinite
              after the last métro. You can escape by unrolling time (one node per stop per
              event, then Dijkstra on that), but the graph balloons and you drag a priority
              queue around.
            </P>
            <P>
              The Connection Scan starts from a simpler observation: a timetable already is a
              list of dated events. Properly arranged, the list is enough. No graph at all.
            </P>

            <H>2. The atom: the connection</H>
            <P>
              The basic unit is neither the line nor the station, it is the connection: one
              specific vehicle leaving one stop at one specific time and reaching the next stop
              at one specific time. The M1 train that leaves Châtelet at 8:01 and touches Hôtel
              de Ville at 8:03, that is a connection. A vehicle's full run is just a sequence
              of connections sharing a trip id.
            </P>
            <P>
              One day of Île-de-France transit compiles down to 2.97 million connections (75
              operators, from the RER A to the night buses), laid out in flat arrays and sorted
              once and for all by departure time. That sort is the only expensive work in the
              whole story, and it is paid once a day at preprocessing time, not on every click.
            </P>
            <MareyFig />
            <Caption>
              The demo's toy network as a space-time diagram: every stroke is a connection,
              numbered in the order the scan will read them.
            </Caption>

            <H>3. The scan, live</H>
            <P>
              Here is the entire algorithm, on six stops, two lines and one walking shortcut.
              We keep a single array, the best known arrival time at every stop, and we read
              the connections in sorted order. For each one, a single question: are we at its
              departure stop before it leaves? If yes and it improves something, write the new
              arrival down. Otherwise, next. (Arrow keys, or click a row.)
            </P>
            <ScanPlayer />

            <H>4. Why it is correct</H>
            <P>
              The scan never backtracks and never compares two journeys. That it still finds
              the optimum rests on one invariant: when the cursor processes a connection
              departing at time t, the array already holds, for every stop, the best arrival
              achievable using connections that depart before t. In other words, everything
              that could have brought us anywhere before t has already been read.
            </P>
            <P>
              The invariant proves itself step by step. True at the start: before the first
              connection, the array holds nothing but the marker and the initial walk.
              Preserved after that: a connection can only create arrivals later than its own
              departure (walking too, it only ever adds minutes), so it cannot rewrite the
              past, and everything departing earlier has already spoken. A vehicle that leaves
              later cannot drop you off earlier: time moves forward, and that is the whole
              proof.
            </P>
            <InvariantFig />
            <P>
              The practical consequence: the boarding test always runs against a final value,
              never a provisional one. This is exactly the service the priority queue renders
              in Dijkstra (process events in time order), except here the order is known before
              the question is even asked, and the same sort serves every query of the day.
            </P>

            <H>5. The details that bite</H>
            <P>
              <strong>Staying on board.</strong> Once you are in a train you stay in it: the
              kernel keeps one flag per trip (<Code>trip_reached</Code>) and takes its later
              connections without re-running the test. Necessary, because the boarding test
              charges a transfer buffer that makes no sense for the vehicle you are already
              sitting in: a train that leaves 30 seconds after it arrives would miss itself. In
              the demo, this is what happens at 8:07 between Bastille and Nation.
            </P>
            <P>
              <strong>Transfers cost time.</strong> Changing vehicles takes real minutes: the
              kernel demands 60 seconds between an arrival and the next boarding. Hence its two
              arrays, <Code>arrival</Code> (being somewhere) and <Code>board</Code> (being able
              to climb into something else there).
            </P>
            <P>
              <strong>Walking.</strong> Every improvement propagates to the stops reachable on
              foot (platforms of the same station, neighboring streets, 200 m at most). And the
              whole computation starts with walking: from the marker to every stop within a
              kilometer, honoring the walkability mask. The Seine is crossed on bridges, not by
              swimming.
            </P>

            <H>6. Why it is fast</H>
            <P>
              The complexity is linear in the number of connections, and the scan only reads a
              slice: a binary search jumps straight to the departure time, and the loop stops
              as soon as departures pass the 100 minute horizon, since nothing beyond can help
              anymore.
            </P>
            <P>
              But the decisive argument is hardware. The scan walks contiguous arrays, in
              order, with no indirection: the CPU prefetcher sees the reads coming and the
              branches predict well. An equivalent Dijkstra hops from pointer to pointer
              between a heap and adjacency lists, and every hop is a potential cache miss.
              Similar complexity, constants worlds apart.
            </P>
            <MemoryFig />
            <P>
              The python kernel is compiled to native code by numba (the pure python version,
              identical line for line, serves as the test reference). Net result: 2.97 million
              connections swept in 13 to 35 ms, fast enough to recompute the whole map on every
              marker drag.
            </P>

            <H>7. The free extras</H>
            <P>
              <strong>The itinerary.</strong> During the scan, every improvement records where
              it came from: the connection taken, or the stop the walk started from. Following
              that predecessor chain backwards from any stop rebuilds the full journey, lines,
              transfers and walking minutes included. That is what right-click does, at zero
              extra cost.
            </P>
            <P>
              <strong>The mode filters.</strong> Every connection carries a mode group (métro,
              rail, tram, bus); unticking "Bus" amounts to testing one bit of a mask at the
              top of the loop. The scan itself does not change.
            </P>
            <P>
              <strong>The "arrive by" mode.</strong> Same algorithm played in a mirror:
              reverse time, sort by decreasing arrival, and the scan computes the latest
              departure from every stop that still makes it on time. Nothing else changes.
            </P>

            <H>8. From stops to the map</H>
            <P>
              The scan delivers 36,071 arrival times, not an image yet. The client finishes the
              job: from every reached stop, the remaining time spreads on foot over a grid of
              the visible viewport (bridges and rivers still honored), then the colored bands
              are pulled out with marching squares. The sliders and the day animation only redo
              this local part: as long as the marker stays put, no request leaves the browser.
            </P>

            <p className="mt-3 text-[10px] text-gray-400">
              The serious version:{' '}
              <a
                href="https://arxiv.org/abs/1703.05997"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-gray-600"
              >
                Connection Scan Algorithm
              </a>
              , Dibbelt et al.
            </p>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
