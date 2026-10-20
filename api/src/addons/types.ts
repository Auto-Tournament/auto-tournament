/**
 * Add-on modules: features that are not a game (the Discord bot first).
 *
 * A game module (integrations/) owns how one game's matches run. An add-on
 * owns a feature beside the games: it is built in, listed on the Modules page,
 * and an admin turns it on and off while the platform runs. So an add-on must
 * be able to stop cleanly: `stop()` undoes everything `start()` set up (bus
 * listeners, timers), and its routes answer 404 while it is off.
 */
import type { Router } from 'express';

export interface AddonModule {
  /** Lowercase letters, digits and single hyphens (a URL segment). */
  id: string;
  name: string;
  /** One sentence for the Modules page. */
  description: string;
  /** On for an install that never chose (default off). */
  defaultOn?: boolean;
  /** Turned on, or at boot while on: set up listeners and timers. */
  start(): Promise<void> | void;
  /** Turned off, or shutting down: undo all of start(). */
  stop(): Promise<void> | void;
  /** Its API, under /api/addons/<id>/. It does its own auth. */
  router?: Router;
}
