/**
 * Add-ons' client halves (server: `modules/loader.ts`, `"kind": "addon"`) and
 * the slots on core pages they may fill. Empty unless an add-on is loaded.
 */

import type { ComponentType, ReactNode } from 'react';
import { ModuleSlotBoundary } from './ModuleSlotBoundary';
import { isBroken } from './moduleState';
import { useModuleState } from './useModuleState';
import type { ModuleLocales } from './moduleLocales';

/** What every match page slot gets. `viewerTeamId` is set when the viewer plays in the match. */
export interface MatchSlotProps {
  matchSlug: string;
  viewerTeamId: string | null;
}

/** An add-on's client half: its default export. Every slot is optional. */
export interface ClientAddon {
  id: string;
  /** Strings, by language, under the add-on's id as the i18n namespace. */
  locales?: ModuleLocales;
  /**
   * The match page's state panel, for people who don't play in the match.
   * `children` is core's panel: render it to keep it.
   */
  matchStage?: ComponentType<MatchSlotProps & { children: ReactNode }>;
  /** The match page's right column, under the match chat. */
  matchSide?: ComponentType<MatchSlotProps>;
}

const addons = new Map<string, ClientAddon>();

export function registerClientAddon(addon: ClientAddon): void {
  if (addons.has(addon.id)) throw new Error(`Add-on registered twice: ${addon.id}`);
  addons.set(addon.id, addon);
}

/** The loaded, unbroken add-ons, re-rendering the caller when one arrives or breaks. */
function useAddons(): ClientAddon[] {
  useModuleState();
  return [...addons.values()].filter((addon) => !isBroken(addon.id));
}

/** Core's panel, or the first add-on's stage wrapped around it. */
export function MatchStageSlot({ children, ...props }: MatchSlotProps & { children: ReactNode }) {
  const addon = useAddons().find((a) => a.matchStage);
  if (!addon?.matchStage) return <>{children}</>;
  const Stage = addon.matchStage;
  return (
    <ModuleSlotBoundary moduleId={addon.id} slot="matchStage">
      <Stage {...props}>{children}</Stage>
    </ModuleSlotBoundary>
  );
}

/** Every add-on's part of the right column. Nothing when none fills it. */
export function MatchSideSlots(props: MatchSlotProps) {
  return (
    <>
      {useAddons().map(({ id, matchSide: Side }) =>
        Side ? (
          <ModuleSlotBoundary key={id} moduleId={id} slot="matchSide">
            <Side {...props} />
          </ModuleSlotBoundary>
        ) : null
      )}
    </>
  );
}
