import { Router, Request, Response } from 'express';
import { templateService } from '../services/templateService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import type { CreateTemplateInput, UpdateTemplateInput, TournamentTemplate } from '../types/tournament.types';

const router = Router();

// Protect all routes
router.use(requireAuth);

/**
 * @openapi
 * /api/templates:
 *   get:
 *     tags:
 *       - Templates
 *     summary: Get all tournament templates
 *     description: Returns all saved tournament templates
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Templates retrieved successfully
 *       500:
 *         description: Server error
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const templates = await templateService.getAllTemplates();
    return res.json({
      success: true,
      templates,
    });
  } catch (error) {
    log.error('Error fetching templates', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch templates',
    });
  }
});

/**
 * @openapi
 * /api/templates:
 *   post:
 *     tags:
 *       - Templates
 *     summary: Create a new tournament template
 *     description: Creates a new tournament template from the provided configuration
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *               - format
 *             properties:
 *               name:
 *                 type: string
 *                 example: "8-team Single Elim BO3"
 *               description:
 *                 type: string
 *                 example: "Weekly 8-team single elimination tournament"
 *               type:
 *                 type: string
 *                 enum: [single_elimination, double_elimination, round_robin, swiss]
 *               format:
 *                 type: string
 *                 enum: [bo1, bo3, bo5]
 *               mapPoolId:
 *                 type: number
 *                 nullable: true
 *               maps:
 *                 type: array
 *                 items:
 *                   type: string
 *               settings:
 *                 type: object
 *     responses:
 *       200:
 *         description: Template created successfully
 *       400:
 *         description: Invalid input
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreateTemplateInput = req.body;

    if (!input.name || !input.type || !input.format) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, type, format',
      });
    }

    // Check if template with same name (case-insensitive) already exists
    const existing = await templateService.getTemplateByName(input.name);
    let template: TournamentTemplate;

    if (existing) {
      // Update existing template
      template = await templateService.updateTemplate(existing.id, {
        description: input.description,
        type: input.type,
        format: input.format,
        mapPoolId: input.mapPoolId,
        maps: input.maps,
        teamIds: input.teamIds,
        settings: input.settings,
      });
      return res.json({
        success: true,
        template,
        message: 'Template updated successfully',
      });
    } else {
      // Create new template
      template = await templateService.createTemplate(input);
      return res.json({
        success: true,
        template,
        message: 'Template created successfully',
      });
    }
  } catch (error) {
    log.error('Error creating/updating template', error as Error);
    const err = error as Error;
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to create/update template',
    });
  }
});

/**
 * @openapi
 * /api/templates/:id:
 *   get:
 *     tags:
 *       - Templates
 *     summary: Get template by ID
 *     description: Returns a specific tournament template
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Template retrieved successfully
 *       404:
 *         description: Template not found
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid template ID',
      });
    }

    const template = await templateService.getTemplate(id);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found',
      });
    }

    return res.json({
      success: true,
      template,
    });
  } catch (error) {
    log.error('Error fetching template', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch template',
    });
  }
});

/**
 * @openapi
 * /api/templates/:id:
 *   put:
 *     tags:
 *       - Templates
 *     summary: Update tournament template
 *     description: Updates an existing tournament template
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Template updated successfully
 *       404:
 *         description: Template not found
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid template ID',
      });
    }

    const input: UpdateTemplateInput = req.body;
    const template = await templateService.updateTemplate(id, input);

    return res.json({
      success: true,
      template,
      message: 'Template updated successfully',
    });
  } catch (error) {
    log.error('Error updating template', error as Error);
    const err = error as Error;
    if (err.message === 'Template not found') {
      return res.status(404).json({
        success: false,
        error: err.message,
      });
    }
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to update template',
    });
  }
});

/**
 * @openapi
 * /api/templates/:id:
 *   delete:
 *     tags:
 *       - Templates
 *     summary: Delete tournament template
 *     description: Deletes a tournament template
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Template deleted successfully
 *       404:
 *         description: Template not found
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid template ID',
      });
    }

    await templateService.deleteTemplate(id);

    return res.json({
      success: true,
      message: 'Template deleted successfully',
    });
  } catch (error) {
    log.error('Error deleting template', error as Error);
    const err = error as Error;
    if (err.message === 'Template not found') {
      return res.status(404).json({
        success: false,
        error: err.message,
      });
    }
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to delete template',
    });
  }
});

export default router;

