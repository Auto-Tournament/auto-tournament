/**
 * "First round at 12:00, then one every 60 minutes": the times of `count`
 * rounds as "HH:MM". Rounds that would fall past midnight are left out (the
 * schedule is for one day); an unreadable start or a step under one minute
 * gives none.
 */
export function stepTimes(start: string, everyMinutes: number, count: number): string[] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(start);
  if (!match || !Number.isFinite(everyMinutes) || everyMinutes < 1) return [];
  const first = Number(match[1]) * 60 + Number(match[2]);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = first + i * Math.round(everyMinutes);
    if (at >= 24 * 60) break;
    out.push(`${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`);
  }
  return out;
}
