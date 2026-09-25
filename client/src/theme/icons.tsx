/**
 * The platform's icon set: Phosphor (`@phosphor-icons/react`).
 *
 * Import each icon by name, with the `Icon` suffix (`import { GearIcon } from
 * '@phosphor-icons/react'`): named imports are what lets the build drop the
 * other 1,500. The unsuffixed names (`Gear`) are deprecated upstream.
 *
 * One weight, `regular`; `fill` only to mark something as selected (the admin
 * rail's current page). Colour is `currentColor`, so an icon takes its text's
 * colour. Sizes come from {@link ICON_SIZE}. An icon that sits beside text
 * saying the same thing is decorative: give it `aria-hidden`.
 */

import React from 'react';
import { IconContext, type IconProps } from '@phosphor-icons/react';

/** The icon sizes, in px: small (inline with body text), medium (menus, the rail), large (the default). */
export const ICON_SIZE = { sm: 16, md: 20, lg: 24 } as const;

/**
 * What an icon draws with when it names nothing itself. 24px is the size an
 * MUI icon had by default, so a page that swapped one for the other keeps
 * its layout.
 *
 * A code module loaded at runtime bundles its own copy of Phosphor (it is not
 * a shared package, see `module-loader/sharedSpecifiers.ts`), whose defaults
 * are Phosphor's own (`1em`), not these: a module passes `size` itself.
 */
export const ICON_DEFAULTS: IconProps = {
  size: ICON_SIZE.lg,
  weight: 'regular',
  color: 'currentColor',
  mirrored: false,
};

/** Sets {@link ICON_DEFAULTS} for everything below it: the app root. */
export const IconDefaults: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <IconContext.Provider value={ICON_DEFAULTS}>{children}</IconContext.Provider>
);
