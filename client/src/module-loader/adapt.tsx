/**
 * Turns a validated code module into the integration the registry holds:
 * the same object, with every component slot, route and nav icon wrapped in
 * a `ModuleSlotBoundary`, and its callbacks (`ownsFailure`,
 * `summarizeAvailability`, `manageNeedsYou`, `adminHomeSetup` and the
 * `tournamentSetup` model's functions) guarded.
 *
 * Doing it here, once, puts a boundary around every slot core renders for a
 * code module without touching the 21 files that render slots, and without a
 * new render site ever forgetting one.
 *
 * This is also where the public `ModuleClientV1` shape will be adapted to the
 * internal type (item 8c). Until then a code module exports a
 * `ClientGameIntegration` as is.
 */

import type { ComponentType } from 'react';
import type { ClientGameIntegration } from '../integrations/types';
import { COMPONENT_SLOTS, getPath } from './manifest';
import { ModuleSlotBoundary } from './ModuleSlotBoundary';
import { recordRenderFailure } from './moduleState';

type AnyComponent = ComponentType<Record<string, unknown>>;

function withBoundary(moduleId: string, slot: string, Slot: AnyComponent): AnyComponent {
  function ModuleSlot(props: Record<string, unknown>) {
    return (
      <ModuleSlotBoundary moduleId={moduleId} slot={slot}>
        <Slot {...props} />
      </ModuleSlotBoundary>
    );
  }
  ModuleSlot.displayName = `ModuleSlot(${moduleId}:${slot})`;
  // MUI reads `muiName` off an icon to treat it as one.
  const muiName = (Slot as { muiName?: string }).muiName;
  if (muiName) (ModuleSlot as { muiName?: string }).muiName = muiName;
  return ModuleSlot;
}

/** A copy of `root` with the value at `path` replaced, copying each object on the way. */
function setPath<T>(root: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const source = root as Record<string, unknown>;
  return {
    ...source,
    [head]: rest.length === 0 ? value : setPath(source[head] ?? {}, rest.join('.'), value),
  } as T;
}

export function adaptCodeModule(integration: ClientGameIntegration): ClientGameIntegration {
  const id = integration.id;
  let adapted = integration;

  for (const slot of COMPONENT_SLOTS) {
    const Slot = getPath(adapted, slot);
    if (Slot) adapted = setPath(adapted, slot, withBoundary(id, slot, Slot as AnyComponent));
  }

  // Core calls this one directly, outside any render, when a start fails. A
  // throw here would lose the real error, so it counts as "not mine".
  const ownsFailure = adapted.tournamentStart?.ownsFailure;
  if (ownsFailure && adapted.tournamentStart) {
    adapted = {
      ...adapted,
      tournamentStart: {
        ...adapted.tournamentStart,
        ownsFailure: (error: string) => {
          try {
            return ownsFailure(error);
          } catch (thrown) {
            recordRenderFailure(id, 'tournamentStart.ownsFailure', thrown);
            return false;
          }
        },
      },
    };
  }

  // The setup model's functions run inside core renders and handlers. A throw
  // counts as "nothing to add": no settings, no error, no rows, no change.
  const setup = adapted.tournamentSetup;
  if (setup) {
    const guard = <A extends unknown[], R>(
      name: string,
      fn: ((...args: A) => R) | undefined,
      fallback: R
    ): ((...args: A) => R) | undefined =>
      fn &&
      ((...args: A) => {
        try {
          return fn(...args);
        } catch (thrown) {
          recordRenderFailure(id, `tournamentSetup.${name}`, thrown);
          return fallback;
        }
      });
    adapted = {
      ...adapted,
      tournamentSetup: {
        initialSettings: guard('initialSettings', setup.initialSettings, {}),
        onTypeChange: guard('onTypeChange', setup.onTypeChange, {}),
        stepError: guard('stepError', setup.stepError, null),
        summary: guard('summary', setup.summary, { rows: [], checklist: [], review: [] }),
        roundCount: guard('roundCount', setup.roundCount, null),
        changes: guard('changes', setup.changes, []),
      },
    };
  }

  // Core calls these on render (or, for the setup rows, on load). A throw
  // reads as "nothing to add" and marks the module broken, as a slot's does.
  const summarize = adapted.summarizeAvailability;
  if (summarize) {
    adapted = {
      ...adapted,
      summarizeAvailability: (availability) => {
        try {
          return summarize(availability);
        } catch (thrown) {
          recordRenderFailure(id, 'summarizeAvailability', thrown);
          return { waitingMatches: 0, resourceCount: 0 };
        }
      },
    };
  }
  const needsYou = adapted.manageNeedsYou;
  if (needsYou) {
    adapted = {
      ...adapted,
      manageNeedsYou: (input) => {
        try {
          return needsYou(input);
        } catch (thrown) {
          recordRenderFailure(id, 'manageNeedsYou', thrown);
          return [];
        }
      },
    };
  }
  const adminSetup = adapted.adminHomeSetup;
  if (adminSetup) {
    adapted = {
      ...adapted,
      adminHomeSetup: async () => {
        try {
          return await adminSetup();
        } catch (thrown) {
          recordRenderFailure(id, 'adminHomeSetup', thrown);
          return [];
        }
      },
    };
  }

  return {
    ...adapted,
    routes: adapted.routes.map((route) => ({
      ...route,
      element: (
        <ModuleSlotBoundary moduleId={id} slot={`route ${route.path}`}>
          {route.element}
        </ModuleSlotBoundary>
      ),
    })),
    navItems: adapted.navItems.map((item) =>
      item.icon
        ? { ...item, icon: withBoundary(id, `nav ${item.key}`, item.icon as unknown as AnyComponent) as never }
        : item
    ),
  };
}
