/**
 * Manual reporting's strings, namespace `manual-report` (see
 * `ClientGameIntegration.locales`).
 *
 * One file per language, checked against `en.json` by the i18n scripts in
 * `client/scripts` exactly like core's. Keys shared with core pages stay in
 * core's `translation` namespace; `scripts/move-module-strings.mjs` decides
 * which is which from the code.
 */

import type { ModuleLocales } from '../../types';
import de from './de.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import it from './it.json';
import nb from './nb.json';
import nl from './nl.json';
import pl from './pl.json';
import pt from './pt-PT.json';
import zhCN from './zh-CN.json';

export const manualReportLocales: ModuleLocales = {
  en,
  'zh-CN': zhCN,
  fr,
  de,
  es,
  it,
  'pt-PT': pt,
  pl,
  nl,
  nb,
};
