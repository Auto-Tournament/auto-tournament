/**
 * Add-ons' client halves (server: `modules/loader.ts`, `"kind": "addon"`) and
 * the slots on core pages they may fill. Empty unless an add-on is loaded.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { ModuleSlotBoundary } from './ModuleSlotBoundary';
import { isBroken } from './moduleState';
import { useModuleState } from './useModuleState';
import type { ModuleLocales } from './moduleLocales';
import type { IntegrationNavItem, IntegrationRoute } from '../integrations/types';

/** What every match page slot gets. `viewerTeamId` is set when the viewer plays in the match. */
export interface MatchSlotProps {
  matchSlug: string;
  viewerTeamId: string | null;
}

/** The match page's layout: a stage showing something big sets `wide`; `theatre` and
 *  `side` (false hides the right column) are the viewer's, kept per browser. */
export interface StageLayout {
  wide: boolean;
  theatre: boolean;
  side: boolean;
}

/** What the `matchStage` slot gets on top of `MatchSlotProps`. */
export interface MatchStageProps extends MatchSlotProps {
  children: ReactNode;
  layout: StageLayout;
  setLayout: (patch: Partial<StageLayout>) => void;
}

const LAYOUT_KEY = 'at-match-stage-layout';
const DEFAULT_LAYOUT: StageLayout = { wide: false, theatre: false, side: true };

function savedLayout(): Pick<StageLayout, 'theatre' | 'side'> {
  try {
    const kept = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Partial<StageLayout>;
    return { theatre: kept.theatre === true, side: kept.side !== false };
  } catch {
    return { theatre: false, side: true };
  }
}

/** The match page's layout state; `theatre` and `side` survive a reload. */
export function useStageLayoutState(): [StageLayout, (patch: Partial<StageLayout>) => void] {
  const [layout, set] = useState<StageLayout>(() => ({ ...DEFAULT_LAYOUT, ...savedLayout() }));
  const setLayout = useCallback((patch: Partial<StageLayout>) => {
    set((was) => {
      const next = { ...was, ...patch };
      try {
        localStorage.setItem(
          LAYOUT_KEY,
          JSON.stringify({ theatre: next.theatre, side: next.side })
        );
      } catch {
        // Private mode or blocked storage: the choice lasts until the page closes.
      }
      return next;
    });
  }, []);
  return [layout, setLayout];
}

const StageLayoutContext = createContext<[StageLayout, (patch: Partial<StageLayout>) => void]>([
  DEFAULT_LAYOUT,
  () => undefined,
]);

export function StageLayoutProvider({
  value,
  children,
}: {
  value: [StageLayout, (patch: Partial<StageLayout>) => void];
  children: ReactNode;
}) {
  return <StageLayoutContext.Provider value={value}>{children}</StageLayoutContext.Provider>;
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
  matchStage?: ComponentType<MatchStageProps>;
  /** The match page's right column, under the match chat. */
  matchSide?: ComponentType<MatchSlotProps>;
  /** Pages and rail links, the same shapes a game module uses. */
  routes?: IntegrationRoute[];
  navItems?: IntegrationNavItem[];
}

const addons = new Map<string, ClientAddon>();

export function registerClientAddon(addon: ClientAddon): void {
  if (addons.has(addon.id)) throw new Error(`Add-on registered twice: ${addon.id}`);
  addons.set(addon.id, addon);
}

/** The loaded, unbroken add-ons. Not a hook: callers re-render through `useModuleState`. */
export function listAddons(): ClientAddon[] {
  return [...addons.values()].filter((addon) => !isBroken(addon.id));
}

/** The loaded, unbroken add-ons, re-rendering the caller when one arrives or breaks. */
export function useAddons(): ClientAddon[] {
  useModuleState();
  return listAddons();
}

/** Core's panel, or the first add-on's stage wrapped around it. */
export function MatchStageSlot({ children, ...props }: MatchSlotProps & { children: ReactNode }) {
  const addon = useAddons().find((a) => a.matchStage);
  const [layout, setLayout] = useContext(StageLayoutContext);
  const value = useMemo(() => ({ layout, setLayout }), [layout, setLayout]);
  if (!addon?.matchStage) return <>{children}</>;
  const Stage = addon.matchStage;
  return (
    <ModuleSlotBoundary moduleId={addon.id} slot="matchStage">
      <Stage {...props} {...value}>
        {children}
      </Stage>
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
