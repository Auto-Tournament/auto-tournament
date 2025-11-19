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
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_map_pools_name ON map_pools(name);
    CREATE INDEX IF NOT EXISTS idx_map_pools_default ON map_pools(is_default);
  `;
}

/**
 * Default maps to insert on schema initialization
 * Tries to fetch from wiki first, falls back to hardcoded maps if fetch fails
 */
export async function getDefaultMapsSQL(): Promise<string> {
  // Try fetching from wiki first
  const { fetchCS2MapsFromWiki } = await import('../utils/fetchCS2Maps');
  let maps = await fetchCS2MapsFromWiki();

  // Fallback to hardcoded maps if fetch failed or returned empty
  if (maps.length === 0) {
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
 * Fallback hardcoded maps (used if wiki fetch fails)
 */
function getFallbackMaps(): Array<{ id: string; display_name: string; image_url: string }> {
  return [
    {
      id: 'de_ancient',
      display_name: 'Ancient',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_ancient.png',
    },
    {
      id: 'de_anubis',
      display_name: 'Anubis',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_anubis.png',
    },
    {
      id: 'de_dust2',
      display_name: 'Dust II',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_dust2.png',
    },
    {
      id: 'de_inferno',
      display_name: 'Inferno',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_inferno.png',
    },
    {
      id: 'de_mirage',
      display_name: 'Mirage',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_mirage.png',
    },
    {
      id: 'de_nuke',
      display_name: 'Nuke',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_nuke.png',
    },
    {
      id: 'de_vertigo',
      display_name: 'Vertigo',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_vertigo.png',
    },
    {
      id: 'de_cache',
      display_name: 'Cache',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_cache.png',
    },
    {
      id: 'de_overpass',
      display_name: 'Overpass',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_overpass.png',
    },
    {
      id: 'de_train',
      display_name: 'Train',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_train.png',
    },
    {
      id: 'de_cbble',
      display_name: 'Cobblestone',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_cbble.png',
    },
    {
      id: 'de_office',
      display_name: 'Office',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_office.png',
    },
    {
      id: 'cs_office',
      display_name: 'CS Office',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/cs_office.png',
    },
    {
      id: 'de_agency',
      display_name: 'Agency',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_agency.png',
    },
    {
      id: 'de_italy',
      display_name: 'Italy',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_italy.png',
    },
    {
      id: 'de_canals',
      display_name: 'Canals',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_canals.png',
    },
    {
      id: 'cs_lake',
      display_name: 'Lake',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/cs_lake.png',
    },
    {
      id: 'de_shortdust',
      display_name: 'Shortdust',
      image_url:
        'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2/de_shortdust.png',
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
 */
export function getDefaultMapPoolsSQL(): string {
  const now = Math.floor(Date.now() / 1000);

  // Active Duty map pool (all 7 competitive maps)
  const activeDutyMapIds = JSON.stringify([
    'de_ancient',
    'de_anubis',
    'de_dust2',
    'de_inferno',
    'de_mirage',
    'de_nuke',
    'de_vertigo',
  ]);

  return `
    INSERT INTO map_pools (name, map_ids, is_default, created_at, updated_at)
    VALUES
      ('Active Duty', '${activeDutyMapIds}', 1, ${now}, ${now})
    ON CONFLICT (name) DO NOTHING;
  `;
}
