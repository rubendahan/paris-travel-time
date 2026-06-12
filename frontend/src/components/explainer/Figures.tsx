import { CONNS, LINES, STOPS, WALK, t } from './toy'

/* Static figures of the explainer. Coordinates are hand-placed on the toy
   network, fixed viewBoxes. */

const MAREY_X0 = 50
const MAREY_PX_PER_MIN = 24
const mx = (min: number) => MAREY_X0 + min * MAREY_PX_PER_MIN
const my = (stop: number) => 18 + stop * 26

export function MareyFig() {
  return (
    <svg viewBox="0 0 460 185" className="w-full select-none">
      {STOPS.map((s, i) => (
        <g key={s.name}>
          <line x1={MAREY_X0} y1={my(i)} x2={mx(16)} y2={my(i)} stroke="#e5e7eb" strokeWidth={1} />
          <text x={MAREY_X0 - 5} y={my(i) + 3} textAnchor="end" fontSize={8.5} fill="#6b7280">
            {s.short}
          </text>
        </g>
      ))}
      {[0, 4, 8, 12, 16].map((m) => (
        <g key={m}>
          <line x1={mx(m)} y1={my(5) + 6} x2={mx(m)} y2={my(5) + 12} stroke="#9ca3af" strokeWidth={1} />
          <text x={mx(m)} y={my(5) + 24} textAnchor="middle" fontSize={8} fill="#6b7280">
            {t(m)}
          </text>
        </g>
      ))}
      <line
        x1={mx(3)} y1={my(WALK.a)} x2={mx(3 + WALK.min)} y2={my(WALK.b)}
        stroke="#2563eb" strokeWidth={1.5} strokeDasharray="3 4"
      />
      {CONNS.map((c, i) => (
        <g key={i}>
          <line
            x1={mx(c.dep)} y1={my(c.from)} x2={mx(c.arr)} y2={my(c.to)}
            stroke={LINES[c.line].color} strokeWidth={2.5} strokeLinecap="round"
          />
          <text x={mx(c.dep) - 3} y={my(c.from) - 5} textAnchor="end" fontSize={7.5} fill="#9ca3af">
            {i + 1}
          </text>
        </g>
      ))}
      <circle cx={mx(0)} cy={my(0)} r={3.5} fill="#2563eb" />
      <g fontSize={8.5}>
        <rect x={386} y={8} width={10} height={4} rx={2} fill={LINES[0].color} />
        <text x={400} y={13} fill="#6b7280">M1</text>
        <rect x={386} y={20} width={10} height={4} rx={2} fill={LINES[1].color} />
        <text x={400} y={25} fill="#6b7280">M5</text>
        <line x1={386} y1={34} x2={396} y2={34} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="3 3" />
        <text x={400} y={37} fill="#6b7280">on foot</text>
      </g>
    </svg>
  )
}

export function InvariantFig() {
  return (
    <svg viewBox="0 0 460 132" className="w-full select-none">
      <defs>
        <marker id="inv-arrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={6} markerHeight={6} orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#374151" />
        </marker>
        <marker id="inv-arrow-red" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={6} markerHeight={6} orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#dc2626" />
        </marker>
      </defs>
      <rect x={30} y={30} width={210} height={48} fill="#dcfce7" opacity={0.6} />
      <rect x={240} y={30} width={200} height={48} fill="#f3f4f6" opacity={0.8} />
      <text x={135} y={47} textAnchor="middle" fontSize={9} fontWeight={600} fill="#166534">already read</text>
      <text x={135} y={60} textAnchor="middle" fontSize={7.5} fill="#166534">
        every arrival before 8:05 is final
      </text>
      <text x={340} y={47} textAnchor="middle" fontSize={9} fontWeight={600} fill="#6b7280">not read yet</text>
      <text x={340} y={60} textAnchor="middle" fontSize={7.5} fill="#6b7280">
        departs after 8:05
      </text>
      <line x1={30} y1={78} x2={444} y2={78} stroke="#374151" strokeWidth={1.5} markerEnd="url(#inv-arrow)" />
      {[['8:00', 50], ['8:05', 240], ['8:10', 430]].map(([label, x]) => (
        <g key={label}>
          <line x1={x as number} y1={78} x2={x as number} y2={84} stroke="#374151" strokeWidth={1} />
          <text x={x as number} y={94} textAnchor="middle" fontSize={8} fill="#6b7280">{label}</text>
        </g>
      ))}
      <line x1={240} y1={22} x2={240} y2={84} stroke="#111827" strokeWidth={1.5} />
      <text x={240} y={16} textAnchor="middle" fontSize={8.5} fontWeight={600} fill="#111827">
        cursor
      </text>
      <path
        d="M 340 96 Q 255 118 170 96"
        fill="none" stroke="#dc2626" strokeWidth={1.3} strokeDasharray="4 3"
        markerEnd="url(#inv-arrow-red)"
      />
      <text x={255} y={128} textAnchor="middle" fontSize={8} fill="#dc2626">
        leave at 8:08 and drop someone before 8:05? time does not flow backwards
      </text>
    </svg>
  )
}

export function MemoryFig() {
  const heap: [number, number][] = [[268, 32], [388, 28], [318, 58], [418, 68], [276, 80], [358, 88]]
  return (
    <svg viewBox="0 0 460 124" className="w-full select-none">
      <defs>
        <marker id="mem-arrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={6} markerHeight={6} orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#16a34a" />
        </marker>
        <marker id="mem-arrow-red" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={6} markerHeight={6} orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#dc2626" />
        </marker>
      </defs>
      <text x={115} y={16} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="#374151">
        The scan: one array, one pass
      </text>
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={25 + i * 18} y={44} width={15} height={15} rx={2} fill="#fef9c3" stroke="#d1d5db" />
      ))}
      <line x1={25} y1={34} x2={205} y2={34} stroke="#16a34a" strokeWidth={1.5} markerEnd="url(#mem-arrow)" />
      <text x={115} y={84} textAnchor="middle" fontSize={8} fill="#6b7280">
        sequential reads: the prefetcher keeps up,
      </text>
      <text x={115} y={95} textAnchor="middle" fontSize={8} fill="#6b7280">
        branches predict well
      </text>
      <text x={345} y={16} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="#374151">
        Dijkstra: a heap and pointers
      </text>
      {heap.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={15} height={15} rx={2} fill="#f3f4f6" stroke="#d1d5db" />
      ))}
      {heap.slice(1).map(([x, y], i) => {
        const [px, py] = heap[i]
        return (
          <line
            key={i}
            x1={px + 8} y1={py + 8} x2={x + 8} y2={y + 8}
            stroke="#dc2626" strokeWidth={1.1} markerEnd="url(#mem-arrow-red)" opacity={0.7}
          />
        )
      })}
      <text x={345} y={114} textAnchor="middle" fontSize={8} fill="#6b7280">
        every hop is a potential cache miss
      </text>
    </svg>
  )
}
