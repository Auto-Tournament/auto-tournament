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
import cs from './cs.json';
import de from './de.json';
import en from './en.json';
import es from './es.json';
import es419 from './es-419.json';
import fr from './fr.json';
import it from './it.json';
import ja from './ja.json';
import ko from './ko.json';
import nb from './nb.json';
import nl from './nl.json';
import pl from './pl.json';
import pt from './pt-PT.json';
import ptBR from './pt-BR.json';
import ru from './ru.json';
import tr from './tr.json';
import uk from './uk.json';
import zhCN from './zh-CN.json';
import zhTW from './zh-TW.json';

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
  ru,
  uk,
  'es-419': es419,
  'zh-TW': zhTW,
  'pt-BR': ptBR,
  tr,
  ja,
  ko,
  cs,
};
