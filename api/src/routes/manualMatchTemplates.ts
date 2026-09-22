import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { manualMatchTemplateService } from '../services/manualMatchTemplateService';
import type { CreateManualMatchTemplateInput } from '../types/match.types';

const router = Router();

// Protect all routes
router.use(requireAuth);

/**
 * GET /api/manual-match-templates
 * List all manual match templates.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const templates = await manualMatchTemplateService.getAllTemplates();
    return res.json({
      success: true,
      templates,
    });
  } catch (error) {
    log.error('Error fetching manual match templates', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch manual match templates',
    });
  }
});

/**
 * POST /api/manual-match-templates
 * Create a new manual match template.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input = req.body as CreateManualMatchTemplateInput;

    if (!input.name || !input.bestOf) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, bestOf',
      });
    }

    if (!input.maps || input.maps.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Manual match template must include at least one map',
      });
    }

    const template = await manualMatchTemplateService.createTemplate(input);
    return res.json({
      success: true,
      template,
    });
  } catch (error) {
    log.error('Error creating manual match template', error as Error);
    const err = error as Error;
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to create manual match template',
    });
  }
});

export default router;


