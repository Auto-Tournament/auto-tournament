/**
 * A do-nothing add-on for test runs, on the fake game integration's switch
 * (isFakeIntegrationEnabled): proves an add-on turns on and off live and that its routes
 * answer only while it is on. Never registered in production.
 */
import { Router } from 'express';
import type { AddonModule } from './types';

let starts = 0;
let stops = 0;

const router = Router();
router.get('/state', (_req, res) => res.json({ success: true, starts, stops }));

export const testAddon: AddonModule = {
  id: 'test-addon',
  name: 'Test add-on',
  description: 'Only in test runs.',
  start() {
    starts++;
  },
  stop() {
    stops++;
  },
  router,
};
