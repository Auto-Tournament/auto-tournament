/**
 * Database schema definitions for PostgreSQL
 */

/**
 * Get PostgreSQL schema SQL
 */
export function getSchemaSQL(): string {
  return `
    -- Servers table
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      password TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    -- Application settings table
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    -- Teams table (must be created before matches due to foreign key)
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tag TEXT,
      discord_role_id TEXT,
      players TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);

    -- Tournament settings table
    CREATE TABLE IF NOT EXISTS tournament (
      id SERIAL PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'setup',
      maps TEXT NOT NULL,
      team_ids TEXT NOT NULL,
      settings TEXT,
      -- Shuffle tournament specific fields
      map_sequence TEXT, -- JSON array of maps in order (number of maps = number of rounds)
      team_size INTEGER DEFAULT 5, -- Number of players per team (default: 5 for 5v5)
      round_limit_type TEXT, -- 'first_to_13' or 'max_rounds'
      max_rounds INTEGER DEFAULT 24, -- Used when round_limit_type is 'max_rounds'
      overtime_mode TEXT DEFAULT 'enabled', -- 'enabled' or 'disabled'
      elo_template_id TEXT, -- Reference to elo_calculation_templates table (nullable)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      started_at INTEGER,
      completed_at INTEGER
    );

    -- Matches table
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      tournament_id INTEGER DEFAULT 1,
      round INTEGER NOT NULL,
      match_number INTEGER NOT NULL,
      team1_id TEXT,
      team2_id TEXT,
      winner_id TEXT,
      server_id TEXT,
      config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      next_match_id INTEGER,
      demo_file_path TEXT,
      veto_state TEXT,
      current_map TEXT,
      map_number INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      loaded_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE SET NULL,
      FOREIGN KEY (tournament_id) REFERENCES tournament(id) ON DELETE CASCADE,
      FOREIGN KEY (team1_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (team2_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (winner_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (next_match_id) REFERENCES matches(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_matches_slug ON matches(slug);
    CREATE INDEX IF NOT EXISTS idx_matches_server_id ON matches(server_id);
    CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
    CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round);
    CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

    -- Match events table
    CREATE TABLE IF NOT EXISTS match_events (
      id SERIAL PRIMARY KEY,
      match_slug TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT NOT NULL,
      received_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_match_events_slug ON match_events(match_slug);
    CREATE INDEX IF NOT EXISTS idx_match_events_type ON match_events(event_type);

    -- Match map results table
    CREATE TABLE IF NOT EXISTS match_map_results (
      id SERIAL PRIMARY KEY,
      match_slug TEXT NOT NULL,
      map_number INTEGER NOT NULL,
      map_name TEXT,
      team1_score INTEGER NOT NULL DEFAULT 0,
      team2_score INTEGER NOT NULL DEFAULT 0,
      winner_team TEXT,
      demo_file_path TEXT,
      completed_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      UNIQUE(match_slug, map_number),
      FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_match_map_results_slug ON match_map_results(match_slug);
    CREATE INDEX IF NOT EXISTS idx_match_map_results_map ON match_map_results(map_number);

    CREATE INDEX IF NOT EXISTS idx_servers_enabled ON servers(enabled);

    -- Maps table
    CREATE TABLE IF NOT EXISTS maps (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      image_url TEXT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_maps_id ON maps(id);

    -- Map pools table
    CREATE TABLE IF NOT EXISTS map_pools (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      map_ids TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_map_pools_name ON map_pools(name);
    CREATE INDEX IF NOT EXISTS idx_map_pools_default ON map_pools(is_default);
    CREATE INDEX IF NOT EXISTS idx_map_pools_enabled ON map_pools(enabled);

    -- Tournament templates table
    CREATE TABLE IF NOT EXISTS tournament_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      format TEXT NOT NULL,
      map_pool_id INTEGER,
      maps TEXT,
      team_ids TEXT,
      settings TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      FOREIGN KEY (map_pool_id) REFERENCES map_pools(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tournament_templates_name ON tournament_templates(name);
    CREATE INDEX IF NOT EXISTS idx_tournament_templates_type ON tournament_templates(type);

    -- Players table (for shuffle tournament type)
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, -- Steam ID
      name TEXT NOT NULL,
      avatar_url TEXT,
      -- Admin-facing "ELO" (for compatibility and display)
      current_elo INTEGER NOT NULL DEFAULT 3000, -- FaceIT-style default
      starting_elo INTEGER NOT NULL DEFAULT 3000, -- FaceIT-style default
      -- OpenSkill internal values
      openskill_mu REAL NOT NULL DEFAULT 25.0,
      openskill_sigma REAL NOT NULL DEFAULT 8.333,
      match_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);
    CREATE INDEX IF NOT EXISTS idx_players_elo ON players(current_elo);

    -- Player rating history table
    CREATE TABLE IF NOT EXISTS player_rating_history (
      id SERIAL PRIMARY KEY,
      player_id TEXT NOT NULL,
      match_slug TEXT NOT NULL,
      -- Display values (for admin/UI)
      elo_before INTEGER NOT NULL,
      elo_after INTEGER NOT NULL,
      elo_change INTEGER NOT NULL,
      -- OpenSkill values
      mu_before REAL NOT NULL,
      mu_after REAL NOT NULL,
      sigma_before REAL NOT NULL,
      sigma_after REAL NOT NULL,
      -- Stat-based adjustments (if template enabled)
      base_elo_after INTEGER, -- Base ELO from OpenSkill (before adjustments)
      stat_adjustment INTEGER, -- ELO adjustment from stats (can be negative)
      template_id TEXT, -- Reference to elo_calculation_templates table
      match_result TEXT NOT NULL, -- 'win' or 'loss'
      performance_data TEXT, -- JSON with ADR, damage, etc. (future)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_player_rating_history_player ON player_rating_history(player_id);
    CREATE INDEX IF NOT EXISTS idx_player_rating_history_match ON player_rating_history(match_slug);
    CREATE INDEX IF NOT EXISTS idx_player_rating_history_created ON player_rating_history(created_at);

    -- ELO calculation templates table
    CREATE TABLE IF NOT EXISTS elo_calculation_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      enabled BOOLEAN NOT NULL DEFAULT false,
      -- Stat weights (JSON object)
      weights TEXT NOT NULL DEFAULT '{}',
      -- Optional caps
      max_adjustment INTEGER,
      min_adjustment INTEGER,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_elo_templates_name ON elo_calculation_templates(name);
    CREATE INDEX IF NOT EXISTS idx_elo_templates_enabled ON elo_calculation_templates(enabled);

    -- Player match stats table (for tracking individual player performance)
    CREATE TABLE IF NOT EXISTS player_match_stats (
      id SERIAL PRIMARY KEY,
      player_id TEXT NOT NULL,
      match_slug TEXT NOT NULL,
      team TEXT NOT NULL, -- 'team1' or 'team2'
      won_match BOOLEAN NOT NULL,
      adr REAL, -- Average Damage per Round
      total_damage INTEGER,
      kills INTEGER,
      deaths INTEGER,
      assists INTEGER,
      headshots INTEGER,
      flash_assists INTEGER,
      utility_damage INTEGER,
      kast REAL, -- KAST percentage (0-100)
      mvps INTEGER,
      score INTEGER,
      rounds_played INTEGER,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_player_match_stats_player ON player_match_stats(player_id);
    CREATE INDEX IF NOT EXISTS idx_player_match_stats_match ON player_match_stats(match_slug);
    CREATE INDEX IF NOT EXISTS idx_player_match_stats_team ON player_match_stats(team);

    -- Shuffle tournament players registration table
    CREATE TABLE IF NOT EXISTS shuffle_tournament_players (
      tournament_id INTEGER NOT NULL DEFAULT 1,
      player_id TEXT NOT NULL,
      registered_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (tournament_id, player_id),
      FOREIGN KEY (tournament_id) REFERENCES tournament(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_shuffle_tournament_players_tournament ON shuffle_tournament_players(tournament_id);
    CREATE INDEX IF NOT EXISTS idx_shuffle_tournament_players_player ON shuffle_tournament_players(player_id);
  `;
}

/**
 * Default maps to insert on schema initialization
 * Fetches from GitHub repository: https://github.com/sivert-io/cs2-server-manager/tree/master/map_thumbnails
 * Falls back to hardcoded maps if GitHub fetch fails (e.g., rate limiting)
 */
export async function getDefaultMapsSQL(): Promise<string> {
  // Fetch from GitHub repository - this is the source of truth
  const { fetchCS2MapsFromWiki } = await import('../utils/fetchCS2Maps');
  let maps = await fetchCS2MapsFromWiki();

  // Fallback to hardcoded maps if fetch failed (e.g., rate limiting)
  if (maps.length === 0) {
    const { log } = await import('../utils/logger');
    log.warn(
      'Failed to fetch maps from GitHub repository. Using fallback maps that match the repository.'
    );
    const fallbackMaps = getFallbackMaps();
    return generateMapsSQL(fallbackMaps);
  }

  // Convert fetched maps to the format expected by generateMapsSQL
  const formattedMaps = maps.map((map) => ({
    id: map.id,
    display_name: map.displayName,
    image_url: map.imageUrl,
  }));

  return generateMapsSQL(formattedMaps);
}

/**
 * Fallback hardcoded maps (used if GitHub fetch fails, e.g., rate limiting)
 * This list matches the actual maps in the repository:
 * https://github.com/sivert-io/cs2-server-manager/tree/master/map_thumbnails
 */
function getFallbackMaps(): Array<{ id: string; display_name: string; image_url: string }> {
  const GITHUB_RAW_BASE =
    'https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails';

  return [
    {
      id: 'ar_baggage',
      display_name: 'Baggage',
      image_url: `${GITHUB_RAW_BASE}/ar_baggage.png`,
    },
    {
      id: 'ar_pool_day',
      display_name: 'Pool Day',
      image_url: `${GITHUB_RAW_BASE}/ar_pool_day.png`,
    },
    {
      id: 'ar_shoots',
      display_name: 'Shoots',
      image_url: `${GITHUB_RAW_BASE}/ar_shoots.png`,
    },
    {
      id: 'ar_shoots_night',
      display_name: 'Shoots (Night)',
      image_url: `${GITHUB_RAW_BASE}/ar_shoots_night.png`,
    },
    {
      id: 'cs_agency',
      display_name: 'Agency',
      image_url: `${GITHUB_RAW_BASE}/cs_agency.png`,
    },
    {
      id: 'cs_italy',
      display_name: 'Italy',
      image_url: `${GITHUB_RAW_BASE}/cs_italy.png`,
    },
    {
      id: 'cs_office',
      display_name: 'CS Office',
      image_url: `${GITHUB_RAW_BASE}/cs_office.png`,
    },
    {
      id: 'de_ancient',
      display_name: 'Ancient',
      image_url: `${GITHUB_RAW_BASE}/de_ancient.png`,
    },
    {
      id: 'de_ancient_night',
      display_name: 'Ancient (Night)',
      image_url: `${GITHUB_RAW_BASE}/de_ancient_night.png`,
    },
    {
      id: 'de_anubis',
      display_name: 'Anubis',
      image_url: `${GITHUB_RAW_BASE}/de_anubis.png`,
    },
    {
      id: 'de_dust2',
      display_name: 'Dust II',
      image_url: `${GITHUB_RAW_BASE}/de_dust2.png`,
    },
    {
      id: 'de_golden',
      display_name: 'Golden',
      image_url: `${GITHUB_RAW_BASE}/de_golden.png`,
    },
    {
      id: 'de_inferno',
      display_name: 'Inferno',
      image_url: `${GITHUB_RAW_BASE}/de_inferno.png`,
    },
    {
      id: 'de_mirage',
      display_name: 'Mirage',
      image_url: `${GITHUB_RAW_BASE}/de_mirage.png`,
    },
    {
      id: 'de_nuke',
      display_name: 'Nuke',
      image_url: `${GITHUB_RAW_BASE}/de_nuke.png`,
    },
    {
      id: 'de_overpass',
      display_name: 'Overpass',
      image_url: `${GITHUB_RAW_BASE}/de_overpass.png`,
    },
    {
      id: 'de_palacio',
      display_name: 'Palacio',
      image_url: `${GITHUB_RAW_BASE}/de_palacio.png`,
    },
    {
      id: 'de_rooftop',
      display_name: 'Rooftop',
      image_url: `${GITHUB_RAW_BASE}/de_rooftop.png`,
    },
    {
      id: 'de_train',
      display_name: 'Train',
      image_url: `${GITHUB_RAW_BASE}/de_train.png`,
    },
    {
      id: 'de_vertigo',
      display_name: 'Vertigo',
      image_url: `${GITHUB_RAW_BASE}/de_vertigo.png`,
    },
  ];
}

/**
 * Generate SQL from maps array
 */
function generateMapsSQL(
  maps: Array<{ id: string; display_name: string; image_url: string }>
): string {
  const now = Math.floor(Date.now() / 1000);
  const values = maps
    .map(
      (map) =>
        `('${map.id}', '${map.display_name.replace(/'/g, "''")}', '${
          map.image_url
        }', ${now}, ${now})`
    )
    .join(',\n    ');

  return `
    INSERT INTO maps (id, display_name, image_url, created_at, updated_at)
    VALUES
      ${values}
    ON CONFLICT (id) DO NOTHING;
  `;
}

/**
 * Default map pools to insert on schema initialization
 * Creates pools based on map types (de_, cs_, ar_) and Active Duty pool
 */
export async function getDefaultMapPoolsSQL(client: {
  query: (sql: string) => Promise<{ rows: Array<{ id: string }> }>;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Query all maps from the database
  const mapsResult = await client.query('SELECT id FROM maps ORDER BY id');
  const allMapIds = mapsResult.rows.map((row) => row.id);

  // Group maps by prefix
  const defusalMaps: string[] = [];
  const hostageMaps: string[] = [];
  const armsRaceMaps: string[] = [];

  for (const mapId of allMapIds) {
    if (mapId.startsWith('de_')) {
      defusalMaps.push(mapId);
    } else if (mapId.startsWith('cs_')) {
      hostageMaps.push(mapId);
    } else if (mapId.startsWith('ar_')) {
      armsRaceMaps.push(mapId);
    }
  }

  // Active Duty map pool (all 7 competitive maps, filtered to only include maps that exist)
  const activeDutyMapIds = [
    'de_ancient',
    'de_anubis',
    'de_dust2',
    'de_inferno',
    'de_mirage',
    'de_nuke',
    'de_vertigo',
  ];
  const activeDutyMaps = activeDutyMapIds.filter((id) => allMapIds.includes(id));

  const pools: Array<{ name: string; mapIds: string[]; isDefault: number; enabled: number }> = [];

  // Add Active Duty pool if we have any of those maps
  if (activeDutyMaps.length > 0) {
    pools.push({
      name: 'Active Duty',
      mapIds: activeDutyMaps,
      isDefault: 1,
      enabled: 1, // Active Duty is enabled by default
    });
  }

  // Add Defusal pool if we have de_ maps
  if (defusalMaps.length > 0) {
    pools.push({
      name: 'Defusal only',
      mapIds: defusalMaps,
      isDefault: 0,
      enabled: 0, // Disabled by default - for future "no veto" mode
    });
  }

  // Add Hostage pool if we have cs_ maps
  if (hostageMaps.length > 0) {
    pools.push({
      name: 'Hostage only',
      mapIds: hostageMaps,
      isDefault: 0,
      enabled: 0, // Disabled by default - for future "no veto" mode
    });
  }

  // Add Arms Race pool if we have ar_ maps
  if (armsRaceMaps.length > 0) {
    pools.push({
      name: 'Arms Race only',
      mapIds: armsRaceMaps,
      isDefault: 0,
      enabled: 0, // Disabled by default - for future "no veto" mode
    });
  }

  // Generate SQL for all pools
  const values = pools
    .map((pool) => {
      const mapIdsJson = JSON.stringify(pool.mapIds).replace(/'/g, "''");
      const escapedName = pool.name.replace(/'/g, "''");
      return `('${escapedName}', '${mapIdsJson}', ${pool.isDefault}, ${pool.enabled}, ${now}, ${now})`;
    })
    .join(',\n      ');

  return `
    INSERT INTO map_pools (name, map_ids, is_default, enabled, created_at, updated_at)
    VALUES
      ${values}
    ON CONFLICT (name) DO UPDATE SET
      map_ids = EXCLUDED.map_ids,
      enabled = EXCLUDED.enabled,
      updated_at = EXCLUDED.updated_at;
  `;
}
