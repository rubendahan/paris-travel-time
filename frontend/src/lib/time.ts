/** GTFS-style times can exceed 24h ("25:30" = 1:30 AM); display them mod 24. */
export function clockDisplay(at: string): string {
  const [h, m] = at.split(':').map(Number)
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
