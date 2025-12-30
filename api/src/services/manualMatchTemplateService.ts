import { db } from '../config/database';
import { log } from '../utils/logger';
import type {
  ManualMatchTemplate,
  ManualMatchTemplateRow,
  CreateManualMatchTemplateInput,
} from '../types/match.types';

class ManualMatchTemplateService {
  private rowToTemplate(row: ManualMatchTemplateRow): ManualMatchTemplate {
    const maps: string[] = row.maps ? JSON.parse(row.maps) : [];

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      bestOf: (row.best_of as 'bo1' | 'bo3' | 'bo5') || 'bo1',
      useVeto: row.use_veto === 1,
      startingSide: (row.starting_side as 'knife' | 'team1_ct' | 'team2_ct') || 'knife',
      knifeMode: (row.knife_mode as 'default' | 'enabled' | 'disabled') || 'default',
      playersPerTeam: row.players_per_team || 5,
      maxRounds: row.max_rounds || 24,
      overtimeEnabled: row.overtime_enabled === 1,
      overtimeMaxRounds: row.overtime_max_rounds ?? null,
      mapPoolId: row.map_pool_id ?? null,
      maps,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getAllTemplates(): Promise<ManualMatchTemplate[]> {
    const rows = await db.queryAsync<ManualMatchTemplateRow>(
      'SELECT * FROM manual_match_templates ORDER BY created_at DESC'
    );
    return rows.map((row) => this.rowToTemplate(row));
  }

  async createTemplate(input: CreateManualMatchTemplateInput): Promise<ManualMatchTemplate> {
    const now = Math.floor(Date.now() / 1000);

    const result = await db.insertAsync('manual_match_templates', {
      name: input.name,
      description: input.description ?? null,
      best_of: input.bestOf,
      use_veto: input.useVeto ? 1 : 0,
      starting_side: input.startingSide,
      knife_mode: input.knifeMode,
      players_per_team: input.playersPerTeam,
      max_rounds: input.maxRounds,
      overtime_enabled: input.overtimeEnabled ? 1 : 0,
      overtime_max_rounds:
        typeof input.overtimeMaxRounds === 'number' ? input.overtimeMaxRounds : null,
      map_pool_id: input.mapPoolId ?? null,
      maps: input.maps && input.maps.length > 0 ? JSON.stringify(input.maps) : null,
      created_at: now,
      updated_at: now,
    });

    const row = await db.queryOneAsync<ManualMatchTemplateRow>(
      'SELECT * FROM manual_match_templates WHERE id = ?',
      [result.lastInsertRowid]
    );
    if (!row) {
      throw new Error('Manual match template created but could not be retrieved');
    }

    const template = this.rowToTemplate(row);
    log.success(`Manual match template created: ${template.name}`);
    return template;
  }
}

export const manualMatchTemplateService = new ManualMatchTemplateService();


