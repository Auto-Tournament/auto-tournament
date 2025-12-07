import { db } from '../config/database';
import { Match, MatchConfig, CreateMatchInput, MatchResponse } from '../types/match.types';
import { log } from '../utils/logger';

class MatchService {
  /**
   * Create a new match configuration
   */
  async createMatch(input: CreateMatchInput, baseUrl: string): Promise<MatchResponse> {
    // Check if slug already exists
    const existing = await db.getOneAsync<Match>('matches', 'slug = ?', [input.slug]);
    if (existing) {
      throw new Error(`Match with slug '${input.slug}' already exists`);
    }

    // Validate server exists
    const server = await db.getOneAsync('servers', 'id = ?', [input.serverId]);
    if (!server) {
      throw new Error(`Server '${input.serverId}' not found`);
    }

    // Insert match
    await db.insertAsync('matches', {
      slug: input.slug,
      server_id: input.serverId,
      config: JSON.stringify(input.config),
      status: 'pending',
    });

    const match = await db.getOneAsync<Match>('matches', 'slug = ?', [input.slug]);
    if (!match) {
      throw new Error('Failed to create match');
    }

    log.matchCreated(input.slug, input.serverId);
    return this.toResponse(match, baseUrl);
  }

  /**
   * Get match by slug
   */
  async getMatchBySlug(slug: string, baseUrl: string): Promise<MatchResponse | null> {
    const match = await db.getOneAsync<Match>('matches', 'slug = ?', [slug]);
    return match ? this.toResponse(match, baseUrl) : null;
  }

  /**
   * Get match by ID
   */
  async getMatchById(id: number, baseUrl: string): Promise<MatchResponse | null> {
    const match = await db.getOneAsync<Match>('matches', 'id = ?', [id]);
    return match ? this.toResponse(match, baseUrl) : null;
  }

  /**
   * Get all matches
   */
  async getAllMatches(baseUrl: string, serverId?: string): Promise<MatchResponse[]> {
    let matches: Match[];
    if (serverId) {
      matches = await db.getAllAsync<Match>('matches', 'server_id = ?', [serverId]);
    } else {
      matches = await db.getAllAsync<Match>('matches');
    }
    return matches.map((m) => this.toResponse(m, baseUrl));
  }

  /**
   * Update match status
   */
  async updateMatchStatus(slug: string, status: 'pending' | 'loaded' | 'live' | 'completed'): Promise<void> {
    const match = await db.getOneAsync<Match>('matches', 'slug = ?', [slug]);
    if (!match) {
      throw new Error(`Match '${slug}' not found`);
    }

    const updateData: Record<string, unknown> = { status };
    if (status === 'loaded') {
      updateData.loaded_at = Math.floor(Date.now() / 1000);
    }

    await db.updateAsync('matches', updateData, 'slug = ?', [slug]);
    log.matchStatusUpdate(slug, status);
  }

  /**
   * Delete match
   */
  async deleteMatch(slug: string): Promise<void> {
    const match = await db.getOneAsync<Match>('matches', 'slug = ?', [slug]);
    if (!match) {
      throw new Error(`Match '${slug}' not found`);
    }
    await db.deleteAsync('matches', 'slug = ?', [slug]);
    log.success(`Match deleted: ${slug}`);
  }

  /**
   * Get match config (raw JSON for MatchZy)
   */
  async getMatchConfig(slug: string): Promise<MatchConfig | null> {
    const match = await db.getOneAsync<Match>('matches', 'slug = ?', [slug]);
    if (!match) {
      return null;
    }
    return JSON.parse(match.config) as MatchConfig;
  }

  /**
   * Convert database match to response format
   */
  private toResponse(match: Match, baseUrl: string): MatchResponse {
    const config = JSON.parse(match.config) as MatchConfig;
    return {
      id: match.id,
      slug: match.slug,
      serverId: match.server_id,
      config,
      createdAt: match.created_at,
      loadedAt: match.loaded_at,
      status: match.status,
      configUrl: `${baseUrl}/api/matches/${match.slug}.json`,
    };
  }
}

export const matchService = new MatchService();
