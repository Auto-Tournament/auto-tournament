import type { Router } from 'express';
import { execHandler, rootHandler } from './console';
import { kickHandler, playersHandler } from './players';
import { resetHandler } from './reset';

/** The per-server actions on `/api/fleet/servers/:id`: reset, kick, who is on it, console lines (root). */
export function mountServerActions(router: Router): void {
  router.post('/servers/:id/reset', resetHandler);
  router.post('/servers/:id/kick', kickHandler);
  router.get('/servers/:id/players', playersHandler);
  router.post('/servers/:id/exec', execHandler);
  router.get('/root', rootHandler);
}
