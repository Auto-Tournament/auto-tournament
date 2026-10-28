import { licenseService } from '../../../services/license/licenseService';
import { settingsService } from '../../../services/settingsService';

/**
 * The logo on highlight videos. Free and unlicensed use always shows it; only
 * a paid (commercial) license can turn it off with highlights_watermark "0".
 */
export async function highlightsWatermark(): Promise<boolean> {
  if ((await settingsService.getSetting('highlights_watermark'))?.trim() !== '0') return true;
  return (await licenseService.getPublicBadge()).use !== 'commercial';
}
