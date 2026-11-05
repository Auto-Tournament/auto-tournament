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
  /** Short facts for its card in step 1 (CS2: "Veto picks sides", "Valve rules"). */
  facts: string[];
  /** Rules for players and a rulebook link it fills in on Name and day. */
  eventPage?: { rules: string[]; rulebookUrl: string };
  /** Settings as a template stores them: the module's object under its key. */
  settings: Record<string, Untrusted>;
}

/** A setup model's built-in templates, listed before the site's saved ones. */
export interface ShipsBuiltInTemplates {
  builtInTemplates?(t: TFunction): BuiltInTemplate[];
}
