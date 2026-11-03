import type { TFunction } from 'i18next';
import type { Untrusted } from '../utils/untrusted';

/** A template a game module ships (setup's "Start from a template", New tournament). */
export interface BuiltInTemplate {
  key: string;
  name: string;
  description: string;
  type:
    'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss' | 'shuffle' | 'groups';
  format: 'bo1' | 'bo3' | 'bo5';
  /** Settings as a template stores them: the module's object under its key. */
  settings: Record<string, Untrusted>;
}

/** A setup model's built-in templates, listed before the site's saved ones. */
export interface ShipsBuiltInTemplates {
  builtInTemplates?(t: TFunction): BuiltInTemplate[];
}
