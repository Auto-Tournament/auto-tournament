/**
 * ELO Calculation Template Service
 * Handles creation and application of ELO calculation templates
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import type { StatsSchema } from '../integrations/types';
import {
  BALANCED_STATS_V1_WEIGHTS,
  PURE_WIN_LOSS_WEIGHTS,
  unknownWeightKeys,
  weightedStatSum,
  type EloTemplateWeights,
} from '../utils/eloWeights';

export type { EloTemplateWeights };

/** Templates already warned about (id + unknown keys), so each is logged once. */
const warnedUnknownWeights = new Set<string>();

export interface EloCalculationTemplate {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  weights: EloTemplateWeights;
  maxAdjustment?: number;
  minAdjustment?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTemplateInput {
  id?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  weights?: EloTemplateWeights;
  maxAdjustment?: number;
  minAdjustment?: number;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  weights?: EloTemplateWeights;
  maxAdjustment?: number;
  minAdjustment?: number;
}

interface EloTemplateRecord {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  weights: string; // JSON string
  max_adjustment?: number | null;
  min_adjustment?: number | null;
  created_at: number;
  updated_at: number;
}

class EloTemplateService {
  /**
   * Convert database record to response format
   */
  private toResponse(record: EloTemplateRecord): EloCalculationTemplate {
    return {
      id: record.id,
      name: record.name,
      description: record.description || undefined,
      enabled: record.enabled,
      weights: JSON.parse(record.weights || '{}') as EloTemplateWeights,
      maxAdjustment: record.max_adjustment || undefined,
      minAdjustment: record.min_adjustment || undefined,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    };
  }

  /**
   * Get all templates
   * Ensures default template exists and has correct weights
   */
  async getAllTemplates(): Promise<EloCalculationTemplate[]> {
    // Ensure built-in templates exist
    await this.getDefaultTemplate();
    await this.ensureBalancedStatsTemplate();
    const records = await db.getAllAsync<EloTemplateRecord>('elo_calculation_templates');
    return records.map((r) => this.toResponse(r));
  }

  /**
   * Get template by ID
   */
  async getTemplate(id: string): Promise<EloCalculationTemplate | null> {
    const record = await db.getOneAsync<EloTemplateRecord>('elo_calculation_templates', 'id = ?', [id]);
    if (!record) {
      return null;
    }
    return this.toResponse(record);
  }

  /**
   * Get default "Pure Win/Loss" template (or create it if it doesn't exist)
   * Ensures template is enabled
   */
  async getDefaultTemplate(): Promise<EloCalculationTemplate> {
    const defaultId = 'pure-win-loss';
    let template = await this.getTemplate(defaultId);
    
    if (!template) {
      // Create default template with all weights explicitly set to 0
      template = await this.createTemplate({
        id: defaultId,
        name: 'Pure Win/Loss',
        description: 'Only team result affects ELO. No stat adjustments. This is the default template.',
        enabled: true,
        weights: PURE_WIN_LOSS_WEIGHTS,
      });
      log.info('Created default "Pure Win/Loss" template');
    } else if (!template.enabled) {
      // Ensure existing default template is enabled
      await db.updateAsync(
        'elo_calculation_templates',
        { enabled: true, updated_at: Math.floor(Date.now() / 1000) },
        'id = ?',
        [defaultId]
      );
      template.enabled = true;
      log.info('Enabled default "Pure Win/Loss" template');
    }
    
    return template;
  }

  /**
   * Ensure the "Balanced Stats v1" template exists.
   * This is a built-in stat-based template that adds a modest adjustment
   * on top of the OpenSkill win/loss update.
   *
   * Unlike the pure-win-loss template, we do NOT force-enable or lock
   * this one; admins are free to edit or disable it after creation.
   */
  private async ensureBalancedStatsTemplate(): Promise<void> {
    const id = 'balanced-stats-v1';
    const existing = await this.getTemplate(id);
    if (existing) {
      return;
    }

    await this.createTemplate({
      id,
      name: 'Balanced Stats v1',
      description:
        'Adds a modest stat-based adjustment on top of OpenSkill win/loss, using ADR, KAST, K/D, utility, and MVPs. Tuned so that match result still dominates.',
      enabled: true,
      weights: BALANCED_STATS_V1_WEIGHTS,
      maxAdjustment: 40,
      minAdjustment: -40,
    });
    log.info('Created built-in "Balanced Stats v1" ELO template');
  }

  /**
   * Create a new template
   */
  async createTemplate(input: CreateTemplateInput): Promise<EloCalculationTemplate> {
    const id = input.id || this.generateId(input.name);
    const now = Math.floor(Date.now() / 1000);

    // Check if template with this ID already exists
    const existing = await this.getTemplate(id);
    if (existing) {
      throw new Error(`Template with ID '${id}' already exists`);
    }

    const templateData = {
      id,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      enabled: input.enabled ?? false,
      weights: JSON.stringify(input.weights || {}),
      max_adjustment: input.maxAdjustment || null,
      min_adjustment: input.minAdjustment || null,
      created_at: now,
      updated_at: now,
    };

    await db.insertAsync('elo_calculation_templates', templateData);

    log.success(`Created ELO template: ${input.name} (${id})`);
    return this.getTemplate(id) as Promise<EloCalculationTemplate>;
  }

  /**
   * Update an existing template
   */
  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<EloCalculationTemplate> {
    // Prevent updates to default template
    if (id === 'pure-win-loss') {
      throw new Error('Cannot update the default "Pure Win/Loss" template');
    }

    const existing = await this.getTemplate(id);
    if (!existing) {
      throw new Error(`Template with ID '${id}' not found`);
    }

    const updates: Partial<EloTemplateRecord> = {
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (input.name !== undefined) {
      updates.name = input.name.trim();
    }
    if (input.description !== undefined) {
      updates.description = input.description?.trim() || null;
    }
    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }
    if (input.weights !== undefined) {
      updates.weights = JSON.stringify(input.weights);
    }
    if (input.maxAdjustment !== undefined) {
      updates.max_adjustment = input.maxAdjustment || null;
    }
    if (input.minAdjustment !== undefined) {
      updates.min_adjustment = input.minAdjustment || null;
    }

    await db.updateAsync('elo_calculation_templates', updates, 'id = ?', [id]);

    log.success(`Updated ELO template: ${id}`);
    return this.getTemplate(id) as Promise<EloCalculationTemplate>;
  }

  /**
   * Delete a template
   */
  async deleteTemplate(id: string): Promise<boolean> {
    // Prevent deletion of default template
    if (id === 'pure-win-loss') {
      throw new Error('Cannot delete the default "Pure Win/Loss" template');
    }

    const result = await db.deleteAsync('elo_calculation_templates', 'id = ?', [id]);
    if (result.changes > 0) {
      log.success(`Deleted ELO template: ${id}`);
      return true;
    }
    return false;
  }

  /**
   * Apply template to calculate stat-based ELO adjustment from a player's
   * metrics, weighted by the template over `schema` (the match's
   * integration's `statsSchema`).
   * Returns 0 if template is disabled or doesn't exist
   */
  async applyTemplate(
    templateId: string | null | undefined,
    _baseELO: number, // Reserved for future use (e.g., percentage-based adjustments)
    metrics: Record<string, number>,
    schema: StatsSchema
  ): Promise<{ adjustment: number; templateId: string | null }> {
    // If no template ID, return no adjustment
    if (!templateId) {
      return { adjustment: 0, templateId: null };
    }

    // Get template
    const template = await this.getTemplate(templateId);
    if (!template || !template.enabled) {
      return { adjustment: 0, templateId: null };
    }

    const unknown = unknownWeightKeys(template.weights, schema);
    const warnKey = `${template.id}:${unknown.join(',')}`;
    if (unknown.length > 0 && !warnedUnknownWeights.has(warnKey)) {
      warnedUnknownWeights.add(warnKey);
      log.warn('ELO template weights stats the game does not record; they are ignored', {
        templateId: template.id,
        unknown,
      });
    }

    // Calculate stat-based adjustment
    const adjustment = weightedStatSum(template.weights, metrics, schema);

    // Apply caps if defined
    let cappedAdjustment = adjustment;
    if (template.minAdjustment !== undefined) {
      cappedAdjustment = Math.max(template.minAdjustment, cappedAdjustment);
    }
    if (template.maxAdjustment !== undefined) {
      cappedAdjustment = Math.min(template.maxAdjustment, cappedAdjustment);
    }

    return {
      adjustment: Math.round(cappedAdjustment),
      templateId: template.id,
    };
  }

  /**
   * Generate ID from name (slugify)
   */
  private generateId(name: string): string {
    const base = name
      .toLowerCase()
      .trim()
      // Keep all letters and numbers from any language plus spaces/hyphens.
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

    // Fallback for names that don't yield a usable slug (e.g. only punctuation)
    return base || `template_${Date.now().toString(36)}`;
  }
}

export const eloTemplateService = new EloTemplateService();

