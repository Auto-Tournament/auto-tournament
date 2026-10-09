/**
 * The admin pages and settings the search box finds (admins only), by their
 * name and the words people look for them with. Searched in the browser; the
 * players, teams, tournaments and matches come from GET /api/search.
 *
 * `title` is a key in the `search.pages` strings; `keywords` are English
 * search words beside the (translated) title.
 */
import { paths } from '../paths';

export interface AdminSearchEntry {
  key: string;
  to: string;
  keywords: string;
  /** A module's page: only when that module is installed. */
  module?: string;
}

const settings = (section: string) => `${paths.settings}?section=${section}`;

export const ADMIN_SEARCH_INDEX: AdminSearchEntry[] = [
  { key: 'manage', to: paths.manage, keywords: 'dashboard overview home admin' },
  { key: 'tournaments', to: paths.tournaments, keywords: 'events cups list create new' },
  {
    key: 'newTournament',
    to: paths.tournament,
    keywords: 'create tournament setup bracket format',
  },
  {
    key: 'playedMatches',
    to: paths.playedMatches,
    keywords: 'all matches results demos download history',
  },
  { key: 'importMatch', to: paths.importMatch, keywords: 'import demo dem upload match elsewhere' },
  { key: 'teams', to: paths.teams, keywords: 'teams rosters import' },
  { key: 'players', to: paths.players, keywords: 'players accounts ban delete steam discord' },
  { key: 'reports', to: paths.reports, keywords: 'reports reported cheating toxic moderation' },
  { key: 'templates', to: paths.templates, keywords: 'tournament templates presets' },
  { key: 'ratings', to: paths.eloTemplates, keywords: 'elo rating skill openskill templates' },
  { key: 'modules', to: paths.modules, keywords: 'modules games install packs code' },
  {
    key: 'servers',
    to: paths.servers,
    keywords: 'servers machines csm fleet ready up cs2 rcon',
    module: 'cs2',
  },
  { key: 'maps', to: paths.maps, keywords: 'maps map pools workshop veto', module: 'cs2' },
  { key: 'skins', to: '/skins', keywords: 'skins inventory knives gloves rewards', module: 'cs2' },
  {
    key: 'matchRules',
    to: '/match-rules',
    keywords: 'match rules cs2 overtime round limit forfeit knife',
    module: 'cs2',
  },
  {
    key: 'highlights',
    to: '/highlights',
    keywords: 'highlights clips reels recorder recorders benchmark video music',
    module: 'cs2',
  },
  { key: 'adminTools', to: paths.admin, keywords: 'tools logs recovery rcon console events' },
  { key: 'settings', to: paths.settings, keywords: 'settings configuration' },
  {
    key: 'settingsSite',
    to: settings('site'),
    keywords: 'site name url public address webhook base email smtp mail',
  },
  {
    key: 'settingsSignIn',
    to: settings('signin'),
    keywords:
      'sign in login steam discord google github twitch epic openid oidc keycloak sso api key',
  },
  {
    key: 'settingsPlayers',
    to: settings('players'),
    keywords: 'players access registration self signup ratings matches',
  },
  {
    key: 'settingsWebhooks',
    to: settings('webhooks'),
    keywords: 'webhooks discord integrations events signing secret',
  },
  { key: 'settingsLicense', to: settings('license'), keywords: 'license commercial key polyform' },
  {
    key: 'settingsMatchmaking',
    to: settings('matchmaking'),
    keywords: 'matchmaking queue lobbies',
  },
  {
    key: 'settingsAdvanced',
    to: settings('advanced'),
    keywords: 'advanced experimental developer',
  },
];

/** The entries whose title or words contain every word of `q`. */
export function searchAdminIndex(
  q: string,
  titleOf: (key: string) => string,
  modules: ReadonlySet<string>
): AdminSearchEntry[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return ADMIN_SEARCH_INDEX.filter((entry) => {
    if (entry.module && !modules.has(entry.module)) return false;
    const text = `${titleOf(entry.key)} ${entry.keywords}`.toLowerCase();
    return words.every((w) => text.includes(w));
  }).slice(0, 6);
}
