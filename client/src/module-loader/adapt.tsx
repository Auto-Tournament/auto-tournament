/**
 * Turns a validated code module into the integration the registry holds:
 * the same object, with every component slot, route and nav icon wrapped in
 * a `ModuleSlotBoundary`, and its `ownsFailure` callback guarded.
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
    navItems: adapted.navItems.map((item) => ({
      ...item,
      icon: withBoundary(id, `nav ${item.key}`, item.icon as unknown as AnyComponent) as never,
    })),
  };
}
