import { db } from '../config/database';
import { log } from '../utils/logger';
import { DEFAULT_SETTINGS } from './tournamentService';
import type {
  TournamentTemplate,
  TournamentTemplateRow,
  CreateTemplateInput,
  UpdateTemplateInput,
  TournamentSettings,
} from '../types/tournament.types';

class TemplateService {
  /**
   * Convert database row to TournamentTemplate
   */
  private rowToTemplate(row: TournamentTemplateRow): TournamentTemplate {
    const settings: TournamentSettings = row.settings
      ? JSON.parse(row.settings)
      : DEFAULT_SETTINGS;

    const maps: string[] = row.maps ? JSON.parse(row.maps) : [];
    const teamIds: string[] = row.team_ids ? JSON.parse(row.team_ids) : [];

    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      type: row.type,
      format: row.format,
      mapPoolId: row.map_pool_id || undefined,
      maps,
      teamIds: teamIds.length > 0 ? teamIds : undefined,
      settings,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get all templates
   */
  async getAllTemplates(): Promise<TournamentTemplate[]> {
    const rows = await db.queryAsync<TournamentTemplateRow>(
      'SELECT * FROM tournament_templates ORDER BY created_at DESC'
    );

    return rows.map((row) => this.rowToTemplate(row));
  }

  /**
   * Get template by ID
   */
  async getTemplate(id: number): Promise<TournamentTemplate | null> {
    const row = await db.queryOneAsync<TournamentTemplateRow>(
      'SELECT * FROM tournament_templates WHERE id = ?',
      [id]
    );

    if (!row) return null;

    return this.rowToTemplate(row);
  }

  /**
   * Get template by name (case-insensitive)
   */
  async getTemplateByName(name: string): Promise<TournamentTemplate | null> {
    const row = await db.queryOneAsync<TournamentTemplateRow>(
      'SELECT * FROM tournament_templates WHERE LOWER(name) = LOWER(?)',
      [name]
    );

    if (!row) return null;

    return this.rowToTemplate(row);
  }

  /**
   * Create a new template
   */
  async createTemplate(input: CreateTemplateInput): Promise<TournamentTemplate> {
    const { name, description, type, format, mapPoolId, maps, teamIds, settings } = input;

    const templateSettings: TournamentSettings = {
      ...DEFAULT_SETTINGS,
      matchFormat: format,
      ...settings,
    };

    const now = Math.floor(Date.now() / 1000);

    const result = await db.insertAsync('tournament_templates', {
      name,
      description: description || null,
      type,
      format,
      map_pool_id: mapPoolId || null,
      maps: maps ? JSON.stringify(maps) : null,
      team_ids: teamIds && teamIds.length > 0 ? JSON.stringify(teamIds) : null,
      settings: JSON.stringify(templateSettings),
      created_at: now,
      updated_at: now,
    });

    const created = await this.getTemplate(result.lastInsertRowid as number);
    if (!created) {
      throw new Error('Template created but could not be retrieved. Please try again.');
    }

    log.success(`Template created: ${name}`);
    return created;
  }

  /**
   * Update an existing template
   */
  async updateTemplate(id: number, input: UpdateTemplateInput): Promise<TournamentTemplate> {
    const existing = await this.getTemplate(id);
    if (!existing) {
      throw new Error('Template not found');
    }

    const updates: Partial<TournamentTemplateRow> = {
      updated_at: Math.floor(Date.now() / 1000),
    };

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description || null;
    if (input.type !== undefined) updates.type = input.type;
    if (input.format !== undefined) updates.format = input.format;
    if (input.mapPoolId !== undefined) updates.map_pool_id = input.mapPoolId || null;
    if (input.maps !== undefined) updates.maps = input.maps ? JSON.stringify(input.maps) : null;
    if (input.teamIds !== undefined) {
      updates.team_ids = input.teamIds && input.teamIds.length > 0 ? JSON.stringify(input.teamIds) : null;
    }

    if (input.settings !== undefined || input.format !== undefined) {
      const templateSettings: TournamentSettings = {
        ...existing.settings,
        ...input.settings,
        matchFormat: input.format || existing.format,
      };
      updates.settings = JSON.stringify(templateSettings);
    }

    await db.updateAsync('tournament_templates', updates, 'id = ?', [id]);

    const updated = await this.getTemplate(id);
    if (!updated) {
      throw new Error(`Template updated but could not be retrieved (ID: ${id}). Please try again.`);
    }

    log.success(`Template updated: ${updated.name}`);
    return updated;
  }

  /**
   * Delete a template
   */
  async deleteTemplate(id: number): Promise<void> {
    const template = await this.getTemplate(id);
    if (!template) {
      throw new Error('Template not found');
    }

    await db.deleteAsync('tournament_templates', 'id = ?', [id]);
    log.success(`Template deleted: ${template.name}`);
  }
}

export const templateService = new TemplateService();

