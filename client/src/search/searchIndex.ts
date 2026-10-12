/**
 * The pages and settings the search box finds, by their name (in the
 * viewer's language and in English) and the words people look for them with.
 * Searched in the browser, fuzzily (search/fuzzy.ts); the players, teams,
 * tournaments and matches come from GET /api/search.
 *
 * `key` is a key in the `search.pages` strings; `keywords` are English
 * search words, including what a thing used to be called ("redress").
 */
import { paths } from '../paths';
import { scoreFields } from './fuzzy';

export interface SearchEntry {
  key: string;
  to: string;
  keywords: string;
  /** Who finds it: admins only, signed-in players, or everyone (unset). */
  who?: 'admin' | 'player';
  /** A module's page: only when that module is installed. */
  module?: string;
}

const settings = (section: string) => `${paths.settings}?section=${section}`;
const highlightsTab = (section: string) => `${paths.highlights}?tab=cs2&section=${section}`;

/** Everyone's pages. */
const PUBLIC: SearchEntry[] = [
  {
    key: 'highlightsLibrary',
    to: '/highlights',
    keywords: 'highlights clips reels videos watch library frags aces clutches likes comments',
    module: 'cs2',
  },
  {
    key: 'leaderboards',
    to: paths.leaderboards,
    keywords: 'leaderboards rankings top best stats kills rating adr headshots entry clutch',
  },
  {
    key: 'browsePlayers',
    to: paths.browsePlayers,
    keywords: 'players directory find player profiles steam people',
  },
  { key: 'browseTeams', to: paths.browseTeams, keywords: 'teams directory clans rosters' },
  { key: 'browse', to: paths.browse, keywords: 'browse tournaments events cups matches results' },
  { key: 'play', to: paths.play, keywords: 'play matchmaking queue lobby pug pickup' },
  {
    key: 'ladder',
    to: paths.playLeaderboard,
    keywords: 'ladder matchmaking leaderboard elo rating rank',
  },
  {
    key: 'compatibility',
    to: paths.compatibility,
    keywords: 'compatibility games supported requirements',
  },
];

/** A signed-in player's own pages. */
const PLAYER: SearchEntry[] = [
  { key: 'me', to: paths.me, keywords: 'my profile account me stats', who: 'player' },
  {
    key: 'connections',
    to: paths.meConnections,
    keywords: 'connections linked accounts steam discord faceit email',
    who: 'player',
  },
  { key: 'friends', to: paths.friends, keywords: 'friends invites party', who: 'player' },
  {
    key: 'notifications',
    to: paths.notifications,
    keywords: 'notifications notices inbox alerts',
    who: 'player',
  },
];

/** Admin pages and settings. */
const ADMIN: SearchEntry[] = [
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
  {
    key: 'skins',
    to: '/manage/skins',
    keywords: 'skins inventory knives gloves rewards',
    module: 'cs2',
  },
  {
    key: 'matchRules',
    to: '/manage/match-rules',
    keywords: 'match rules cs2 overtime round limit forfeit knife',
    module: 'cs2',
  },
  {
    key: 'highlights',
    to: paths.highlights,
    keywords: 'highlights reels settings music crowd resolution length frame rate fps',
  },
  {
    key: 'highlightsRecorders',
    to: highlightsTab('recorders'),
    keywords: 'recorders recording machines benchmark update agent progress add recorder keys',
    module: 'cs2',
  },
  {
    key: 'highlightsClips',
    to: highlightsTab('clips'),
    keywords: 'clips queue failed redo retry moments recorded',
    module: 'cs2',
  },
  {
    key: 'highlightsOverlays',
    to: highlightsTab('overlays'),
    keywords: 'overlays redraw redress restyle cards kill feed captions',
    module: 'cs2',
  },
  { key: 'adminTools', to: paths.admin, keywords: 'system tools logs recovery stuck matches' },
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
  {
    key: 'settingsLicense',
    to: paths.license,
    keywords: 'license commercial non-profit free key polyform licensed badge',
  },
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

export const SEARCH_INDEX: SearchEntry[] = [
  ...PUBLIC,
  ...PLAYER,
  ...ADMIN.map((e) => ({ ...e, who: 'admin' as const })),
];

export interface SearchViewer {
  isAdmin: boolean;
  isPlayer: boolean;
  modules: ReadonlySet<string>;
}

/**
 * The pages that match `q`, best first: by the title (the viewer's language
 * and English) before the keywords, typos forgiven (search/fuzzy.ts).
 */
export function searchPages(
  q: string,
  titleOf: (key: string) => string,
  englishTitleOf: (key: string) => string,
  viewer: SearchViewer,
  limit = 6
): SearchEntry[] {
  return SEARCH_INDEX.filter((entry) => {
    if (entry.module && !viewer.modules.has(entry.module)) return false;
    if (entry.who === 'admin') return viewer.isAdmin;
    if (entry.who === 'player') return viewer.isPlayer || viewer.isAdmin;
    return true;
  })
    .map((entry) => ({
      entry,
      score: scoreFields(q, [
        { text: titleOf(entry.key), weight: 1 },
        { text: englishTitleOf(entry.key), weight: 1 },
        { text: entry.keywords, weight: 0.85 },
      ]),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.entry);
}
