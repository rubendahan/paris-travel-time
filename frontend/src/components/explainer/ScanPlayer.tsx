import { useEffect, useState } from 'react'
import { CONNS, LINES, STOPS, STEPS, TEXTS, WALK, bandColor, t } from './toy'
import type { ConnStatus, Step } from './toy'

const PLAY_TICK_MS = 2600

const STATUS_LABEL: Record<ConnStatus, [string, string]> = {
  pending: ['', ''],
  taken: ['taken', 'text-green-700'],
  skipped: ['skipped', 'text-red-500'],
  boarded: ['on board', 'text-gray-500'],
}

function ToyMap({ step }: { step: Step }) {
  const cur = step.connIdx !== null ? CONNS[step.connIdx] : null
  return (
    <svg viewBox="0 0 460 268" className="w-full select-none">
      {LINES.map((l) =>
        l.path.slice(1).map((b, i) => {
          const a = STOPS[l.path[i]]
          const s2 = STOPS[b]
          return (
            <line
              key={`${l.id}-${i}`}
              x1={a.x} y1={a.y} x2={s2.x} y2={s2.y}
              stroke={l.color} strokeWidth={4} strokeLinecap="round"
            />
          )
        })
      )}
      <line
        x1={STOPS[WALK.a].x} y1={STOPS[WALK.a].y}
        x2={STOPS[WALK.b].x} y2={STOPS[WALK.b].y}
        stroke={step.walked ? '#2563eb' : '#9ca3af'}
        strokeWidth={step.walked ? 3 : 2}
        strokeDasharray="4 5"
      />
      {cur && (
        <line
          x1={STOPS[cur.from].x} y1={STOPS[cur.from].y}
          x2={STOPS[cur.to].x} y2={STOPS[cur.to].y}
          stroke="#111827" strokeWidth={10} strokeLinecap="round" opacity={0.25}
        />
      )}
      {STOPS.map((s, i) => {
        const a = step.arrival[i]
        const [nx, ny, na] = s.nameAt ?? [s.x, s.y - 14, 'middle']
        const [tx, ty, ta] = s.timeAt ?? [s.x, s.y + 25, 'middle']
        return (
          <g key={s.name}>
            <circle
              cx={s.x} cy={s.y} r={8}
              fill={a === null ? '#ffffff' : i === 0 ? '#2563eb' : bandColor(a)}
              stroke="#374151" strokeWidth={1.5}
            />
            <text x={nx} y={ny} textAnchor={na} fontSize={11} fontWeight={600} fill="#374151">
              {s.name}
            </text>
            {a !== null && (
              <text x={tx} y={ty} textAnchor={ta} fontSize={10.5} fontWeight={700} fill="#111827">
                {t(a)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export default function ScanPlayer() {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const last = STEPS.length - 1

  // one tick per step; autoplay stops itself at the end of the list
  useEffect(() => {
    if (!playing) return
    const id = window.setTimeout(() => {
      if (step >= last) setPlaying(false)
      else setStep(step + 1)
    }, PLAY_TICK_MS)
    return () => window.clearTimeout(id)
  }, [playing, step, last])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setStep((s) => Math.min(last, s + 1))
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [last])

  const st = STEPS[step]

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <ol className="shrink-0 self-start rounded-md border border-gray-200 bg-gray-50 p-1.5 text-[11px] sm:w-60">
          {CONNS.map((c, i) => {
            const status = st.statuses[i]
            const [label, cls] = STATUS_LABEL[status]
            const line = LINES[c.line]
            const isCur = st.connIdx === i
            return (
              <li key={i}>
                <button
                  onClick={() => setStep(i + 1)}
                  className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left tabular-nums ${
                    isCur ? 'bg-amber-100 font-semibold' : 'hover:bg-gray-100'
                  } ${status === 'pending' && !isCur ? 'text-gray-400' : 'text-gray-800'}`}
                >
                  <span
                    className="w-6 shrink-0 rounded text-center text-[9px] font-bold"
                    style={{ background: line.color, color: line.dark ? '#1f2937' : '#fff' }}
                  >
                    {line.id}
                  </span>
                  <span className="shrink-0">{t(c.dep)}</span>
                  <span className="truncate">
                    {STOPS[c.from].short} → {STOPS[c.to].short}
                  </span>
                  <span className={`ml-auto shrink-0 text-[10px] ${cls}`}>{label}</span>
                </button>
              </li>
            )
          })}
        </ol>
        <div className="min-w-0 flex-1">
          <ToyMap step={st} />
        </div>
      </div>

      <p className="mt-2 min-h-16 rounded-md bg-gray-50 p-2 text-xs leading-snug text-gray-700">
        {TEXTS[step]}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded border border-gray-300 px-2 py-0.5 text-sm hover:bg-gray-100 disabled:opacity-40"
        >
          ◀
        </button>
        <button
          onClick={() => setStep((s) => Math.min(last, s + 1))}
          disabled={step === last}
          className="rounded border border-gray-300 px-2 py-0.5 text-sm hover:bg-gray-100 disabled:opacity-40"
        >
          ▶
        </button>
        <button
          onClick={() => (step === last && !playing ? (setStep(0), setPlaying(true)) : setPlaying((p) => !p))}
          className={`rounded px-2 py-0.5 text-xs ${playing ? 'bg-gray-800 text-white' : 'border border-gray-300 hover:bg-gray-100'}`}
        >
          {playing ? '⏸ pause' : '▶ autoplay'}
        </button>
        <span className="ml-auto text-xs tabular-nums text-gray-500">
          step {step + 1}/{STEPS.length}
        </span>
      </div>
    </div>
  )
}
