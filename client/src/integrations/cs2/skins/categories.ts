/**
 * Weapon groups for filtering skins (the inventory, the skin list): rifles,
 * pistols, SMGs, heavy, knives and gloves.
 */
export type SkinCategory = 'rifles' | 'pistols' | 'smgs' | 'heavy' | 'knives' | 'gloves';

export const SKIN_CATEGORIES: SkinCategory[] = [
  'rifles',
  'pistols',
  'smgs',
  'heavy',
  'knives',
  'gloves',
];

const PISTOLS = [
  'glock',
  'hkp2000',
  'usp_silencer',
  'p250',
  'fiveseven',
  'tec9',
  'cz75a',
  'deagle',
  'revolver',
  'elite',
];
const SMGS = ['mac10', 'mp9', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon'];
const HEAVY = ['nova', 'xm1014', 'sawedoff', 'mag7', 'm249', 'negev'];

/** A skin's group from its weapon (and slot: knife / gloves). */
export function skinCategory(skin: { weapon: string; slot?: string | null }): SkinCategory {
  const knife =
    skin.slot === 'knife' ||
    skin.weapon.startsWith('weapon_knife') ||
    skin.weapon === 'weapon_bayonet';
  if (knife) return 'knives';
  if (skin.slot === 'gloves' || skin.weapon.includes('gloves') || skin.weapon.includes('handwraps'))
    return 'gloves';
  const w = skin.weapon.replace('weapon_', '');
  if (PISTOLS.includes(w)) return 'pistols';
  if (SMGS.includes(w)) return 'smgs';
  if (HEAVY.includes(w)) return 'heavy';
  return 'rifles';
}
