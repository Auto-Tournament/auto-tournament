import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { generateTeamName } from '../generation/teamName';

const router = Router();

// All generation routes require authentication (admin UI only)
router.use(requireAuth);

router.get('/team-name', (_req, res) => {
  const name = generateTeamName();
  return res.json({ success: true, name });
});

export default router;


