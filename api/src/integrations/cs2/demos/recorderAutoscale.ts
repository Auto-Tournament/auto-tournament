/**
 * What each host's autoscaler last reported, for the Recorders page. It reports
 * every minute, so this lives in memory: after a restart the page fills in again.
 */
import type { Request, Response } from 'express';
import type { Untrusted } from '../../../utils/untrusted';

const FRESH_MS = 3 * 60 * 1000;
const MAX_HOSTS = 100;
const MAX_ITEMS = 64;
const BLOCKED = ['', 'limit', 'full', 'memory'];

export interface AutoscaleReport {
  host: string;
  jobsWaiting: number;
  cards: { bus: string; recorders: string[]; blocked: string }[];
  standby: string[];
}

const reports = new Map<string, { at: number; report: AutoscaleReport }>();

const isName = (v: Untrusted): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 128;
const names = (v: Untrusted): string[] | null =>
  Array.isArray(v) && v.length <= MAX_ITEMS && v.every(isName) ? v : null;

function parseCard(v: Untrusted): AutoscaleReport['cards'][number] | null {
  const { bus, recorders, blocked } = (v ?? {}) as Record<string, Untrusted>;
  const list = names(recorders);
  if (!isName(bus) || !list || typeof blocked !== 'string' || !BLOCKED.includes(blocked))
    return null;
  return { bus, recorders: list, blocked };
}

/** False when the body isn't a report. */
export function saveAutoscaleReport(body: Untrusted, now = Date.now()): boolean {
  const { host, jobsWaiting, cards, standby } = (body ?? {}) as Record<string, Untrusted>;
  const list = names(standby);
  if (!isName(host) || !list || !Number.isSafeInteger(jobsWaiting) || (jobsWaiting as number) < 0)
    return false;
  if (!Array.isArray(cards) || cards.length > MAX_ITEMS) return false;
  const parsed = cards.map(parseCard);
  if (parsed.some((c) => !c)) return false;
  for (const [key, r] of reports) if (now - r.at > FRESH_MS) reports.delete(key);
  if (!reports.has(host) && reports.size >= MAX_HOSTS) return false;
  reports.set(host, {
    at: now,
    report: {
      host,
      jobsWaiting: jobsWaiting as number,
      cards: parsed as AutoscaleReport['cards'],
      standby: list,
    },
  });
  return true;
}

export function autoscaleReportRoute(req: Request, res: Response) {
  if (!saveAutoscaleReport(req.body))
    return res.status(400).json({ success: false, error: 'Not an autoscale report' });
  return res.json({ success: true });
}

export function autoscaleReports(now = Date.now()): AutoscaleReport[] {
  return [...reports.values()].filter((r) => now - r.at <= FRESH_MS).map((r) => r.report);
}
