import type { TFunction } from 'i18next';
import { getMapDisplayName } from '../../constants/maps';

/**
 * A platform line in a match's chat, in the viewer's language. The API stores
 * them as `i18n:{ key, params }` (api/src/services/matchChatLines.ts); map ids
 * become their display names here. Anything else is shown as it is.
 */
export function systemLineText(body: string, t: TFunction): string {
  if (!body.startsWith('i18n:')) return body;
  try {
    const { key, params = {} } = JSON.parse(body.slice(5)) as { key: string; params?: Record<string, unknown> };
    const values: Record<string, unknown> = { ...params };
    if (typeof params.map === 'string') values.map = params.map ? getMapDisplayName(params.map) : '';
    if (Array.isArray(params.maps)) values.maps = params.maps.map((m) => getMapDisplayName(String(m))).join(', ');
    const text = t(`chat.system.${key}`, values) as string;
    return params.timedOut ? `${text} · ${t('chat.system.timedOut')}` : text;
  } catch {
    return body;
  }
}
