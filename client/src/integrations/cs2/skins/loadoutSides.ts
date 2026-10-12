/**
 * Per-side loadouts (CT / T) on the client: what each side has equipped, and
 * the same equip rules the server keeps (api skins/skinService.ts equip), so
 * the inventory shows a change before the server answers. No client imports:
 * tests load this file directly.
 */

/** 0 both sides, 2 T, 3 CT (CS2's team numbers). */
export type LoadoutTeam = 0 | 2 | 3;

export interface SidedSkin {
  id: number;
  slot: string;
  /** The one side that buys this weapon, or null when both do. */
  side: 2 | 3 | null;
  equippedSides: LoadoutTeam[];
  equipped: boolean;
}

/** The side a skin goes on: a one-side weapon always "both" (its side is its only one). */
export function teamFor(skin: Pick<SidedSkin, 'side'>, wanted: LoadoutTeam): LoadoutTeam {
  return skin.side !== null ? 0 : wanted;
}

/** What one side (2 T, 3 CT) has on, per slot: its own pick first, then a "both" one it can use. */
export function equippedFor<T extends SidedSkin>(inventory: T[], team: 2 | 3): Map<string, T> {
  const out = new Map<string, T>();
  for (const skin of inventory) {
    if (skin.equippedSides.includes(team)) out.set(skin.slot, skin);
  }
  for (const skin of inventory) {
    if (out.has(skin.slot)) continue;
    if (skin.equippedSides.includes(0) && (skin.side === null || skin.side === team)) {
      out.set(skin.slot, skin);
    }
  }
  return out;
}

function withSides<T extends SidedSkin>(skin: T, sides: LoadoutTeam[]): T {
  const unique = [...new Set(sides)].sort() as LoadoutTeam[];
  return { ...skin, equippedSides: unique, equipped: unique.length > 0 };
}

/** Equip `skin` for `wanted`: that side's pick in the slot is replaced; "both" clears the slot's one-side picks. */
export function applyEquip<T extends SidedSkin>(inventory: T[], skin: T, wanted: LoadoutTeam): T[] {
  const team = teamFor(skin, wanted);
  return inventory.map((s) => {
    if (s.slot !== skin.slot) return s;
    // "both" replaces everything in the slot; a side replaces only that side.
    const rest = team === 0 ? [] : s.equippedSides.filter((side) => side !== team);
    const next = s.id === skin.id ? [...(team === 0 ? [] : rest), team] : team === 0 ? [] : rest;
    return withSides(s, next);
  });
}

/** Take a skin off one side (or every side with no team). */
export function applyUnequip<T extends SidedSkin>(
  inventory: T[],
  skin: T,
  team?: LoadoutTeam
): T[] {
  return inventory.map((s) =>
    s.id !== skin.id
      ? s
      : withSides(s, team === undefined ? [] : s.equippedSides.filter((side) => side !== team))
  );
}

export type EquipStep =
  | { kind: 'equip'; team: LoadoutTeam }
  | { kind: 'unequip'; team: LoadoutTeam }
  /** On for both, clicked with one side selected: off that side, kept on the other. */
  | { kind: 'split'; keep: 2 | 3 };

/** What a click on a skin does with `wanted` selected (0 both, 2 T, 3 CT). */
export function equipStep(skin: SidedSkin, wanted: LoadoutTeam): EquipStep {
  const team = teamFor(skin, wanted);
  if (skin.equippedSides.includes(team)) return { kind: 'unequip', team };
  if (team !== 0 && skin.equippedSides.includes(0))
    return { kind: 'split', keep: team === 2 ? 3 : 2 };
  return { kind: 'equip', team };
}

/** The inventory after a step (the same rules the server keeps). */
export function applyStep<T extends SidedSkin>(inventory: T[], skin: T, step: EquipStep): T[] {
  if (step.kind === 'equip') return applyEquip(inventory, skin, step.team);
  if (step.kind === 'unequip') return applyUnequip(inventory, skin, step.team);
  const off = applyUnequip(inventory, skin, 0);
  return applyEquip(off, off.find((s) => s.id === skin.id) ?? skin, step.keep);
}
