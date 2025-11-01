import { db } from '../config/database';
import { Match, MatchConfig, CreateMatchInput, MatchResponse } from '../types/match.types';
import { log } from '../utils/logger';

class MatchService {
  /**
   * Create a new match configuration
   */
  createMatch(input: CreateMatchInput, baseUrl: string): MatchResponse {
    // Check if slug already exists
    const existing = db.getOne<Match>('matches', 'slug = ?', [input.slug]);
    if (existing) {
      throw new Error(`Match with slug '${input.slug}' already exists`);
    }

    // Validate server exists
    const server = db.getOne('servers', 'id = ?', [input.serverId]);
    if (!server) {
      throw new Error(`Server '${input.serverId}' not found`);
    }

    // Insert match
    db.insert('matches', {
      slug: input.slug,
      server_id: input.serverId,
      config: JSON.stringify(input.config),
      status: 'pending',
    });

    const match = db.getOne<Match>('matches', 'slug = ?', [input.slug]);
    if (!match) {
      throw new Error('Failed to create match');
    }

    log.matchCreated(input.slug, input.serverId);
    return this.toResponse(match, baseUrl);
  }

  /**
   * Get match by slug
   */
  getMatchBySlug(slug: string, baseUrl: string): MatchResponse | null {
    const match = db.getOne<Match>('matches', 'slug = ?', [slug]);
    return match ? this.toResponse(match, baseUrl) : null;
  }

  /**
   * Get match by ID
   */
  getMatchById(id: number, baseUrl: string): MatchResponse | null {
    const match = db.getOne<Match>('matches', 'id = ?', [id]);
    return match ? this.toResponse(match, baseUrl) : null;
  }

  /**
   * Get all matches
   */
  getAllMatches(baseUrl: string, serverId?: string): MatchResponse[] {
    let matches: Match[];
    if (serverId) {
      matches = db.getAll<Match>('matches', 'server_id = ?', [serverId]);
    } else {
      matches = db.getAll<Match>('matches');
    }
    return matches.map((m) => this.toResponse(m, baseUrl));
  }

  /**
   * Update match status
   */
  updateMatchStatus(slug: string, status: 'pending' | 'loaded' | 'live' | 'completed'): void {
    const match = db.getOne<Match>('matches', 'slug = ?', [slug]);
    if (!match) {
      throw new Error(`Match '${slug}' not found`);
    }

    const updateData: Record<string, unknown> = { status };
    if (status === 'loaded') {
      updateData.loaded_at = Math.floor(Date.now() / 1000);
    }

    db.update('matches', updateData, 'slug = ?', [slug]);
    log.matchStatusUpdate(slug, status);
  }

  /**
   * Delete match
   */
  deleteMatch(slug: string): void {
    const match = db.getOne<Match>('matches', 'slug = ?', [slug]);
    if (!match) {
      throw new Error(`Match '${slug}' not found`);
    }
    db.delete('matches', 'slug = ?', [slug]);
    log.success(`Match deleted: ${slug}`);
  }

  /**
   * Get match config (raw JSON for MatchZy)
   */
  getMatchConfig(slug: string): MatchConfig | null {
    const match = db.getOne<Match>('matches', 'slug = ?', [slug]);
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
