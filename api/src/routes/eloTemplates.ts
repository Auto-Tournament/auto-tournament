/**
 * ELO Calculation Templates API Routes
 */

import { Router } from 'express';
import { eloTemplateService } from '../services/eloTemplateService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';

const router = Router();

// Protect all routes
router.use(requireAuth);

/**
 * GET /api/elo-templates
 * List all ELO calculation templates
 */
router.get('/', async (_req, res) => {
  try {
    const templates = await eloTemplateService.getAllTemplates();
    return res.json({ success: true, templates });
  } catch (error) {
    log.error('Error fetching ELO templates', { error });
    return res.status(500).json({ success: false, error: 'Failed to fetch templates' });
  }
});

/**
 * GET /api/elo-templates/:id
 * Get template by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const template = await eloTemplateService.getTemplate(id);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    return res.json({ success: true, template });
  } catch (error) {
    log.error('Error fetching ELO template', { error, id: req.params.id });
    return res.status(500).json({ success: false, error: 'Failed to fetch template' });
  }
});

/**
 * POST /api/elo-templates
 * Create new template
 */
router.post('/', async (req, res) => {
  try {
    const input = req.body;
    
    // Validate required fields
    if (!input.name || typeof input.name !== 'string' || input.name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Template name is required' });
    }

    const template = await eloTemplateService.createTemplate(input);
    return res.status(201).json({ success: true, template });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to create template';
    log.error('Error creating ELO template', { error, input: req.body });
    return res.status(400).json({ success: false, error: errorMessage });
  }
});

/**
 * PUT /api/elo-templates/:id
 * Update template
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const input = req.body;

    const template = await eloTemplateService.updateTemplate(id, input);
    return res.json({ success: true, template });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to update template';
    log.error('Error updating ELO template', { error, id: req.params.id });
    return res.status(400).json({ success: false, error: errorMessage });
  }
});

/**
 * DELETE /api/elo-templates/:id
 * Delete template
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await eloTemplateService.deleteTemplate(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    return res.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete template';
    log.error('Error deleting ELO template', { error, id: req.params.id });
    return res.status(400).json({ success: false, error: errorMessage });
  }
});

export default router;

