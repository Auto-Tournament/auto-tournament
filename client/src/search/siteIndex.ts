/**
 * Everything the search box can open that is not content: the site's pages,
 * the admin pages, their tabs and sections, and the actions on them ("Redraw
 * overlays", "Update all" recorders). Searched in the browser with
 * search/fuzzy.ts, by the title in the viewer's language and in English and by
 * `keywords`: English search words, synonyms and internal names ("redress",
 * "csm", "benchmark"). Players, teams, tournaments, matches and what the games
 * add come from GET /api/search.
 *
 * `title` is an existing string key (`ns` for a module's), so the entry is
 * named exactly as on the page it opens. `parent` is the entry it sits in,
 * shown beside it ("Highlights › Overlays").
 */
import { leaderboardsPath, paths, manageTournamentPath } from '../paths';
import { fuzzyRank, type SearchField } from './fuzzy';

export type SearchAudience = 'all' | 'player' | 'admin';

export interface SiteSearchEntry {
  key: string;
  title: { key: string; ns?: string };
  to: string;
  keywords: string;
  audience: SearchAudience;
  /** A module's page: only when that module is installed. */
  module?: string;
  parent?: string;
}

const settings = (section: string) => `${paths.settings}?section=${section}`;
const highlightsTab = (sub: string) => `${paths.highlights}?tab=cs2&sub=${sub}`;
const page = (key: string) => ({ key: `search.pages.${key}` });
const cs2 = (key: string) => ({ key, ns: 'cs2' });

export const SITE_SEARCH_INDEX: SiteSearchEntry[] = [
  // --- everyone ---------------------------------------------------------
  {
    key: 'home',
    title: { key: 'nav.home' },
    to: paths.root,
    keywords: 'start front page',
    audience: 'all',
  },
  {
    key: 'play',
    title: { key: 'nav.play' },
    to: paths.play,
    keywords:
      'matchmaking queue find match search party lobby competitive 5v5 wingman 2v2 1v1 aim duel bots',
    audience: 'all',
  },
  {
    key: 'browse',
    title: { key: 'nav.browse' },
    to: paths.tournamentList,
    keywords: 'tournaments events cups upcoming running',
    audience: 'all',
  },
  {
    key: 'library',
    title: cs2('library.nav'),
    to: '/highlights',
    keywords: 'clips reels videos watch frags aces plays',
    audience: 'all',
    module: 'cs2',
  },
  {
    key: 'teamDirectory',
    title: { key: 'nav.teams' },
    to: paths.communityTeams,
    keywords: 'team directory rosters clans',
    audience: 'all',
  },
  {
    key: 'playerDirectory',
    title: { key: 'nav.players' },
    to: paths.communityPlayers,
    keywords: 'player directory people find player',
    audience: 'all',
  },
  {
    key: 'leaderboards',
    title: { key: 'nav.leaderboards' },
    to: paths.leaderboards,
    keywords: 'rankings top players elo rating stats',
    audience: 'all',
  },
  {
    key: 'mmLeaderboard',
    title: { key: 'matchmaking.leaderboard.title' },
    to: leaderboardsPath('matchmaking'),
    keywords: 'matchmaking ranked leaderboard elo top',
    audience: 'all',
  },
  {
    key: 'dropRates',
    title: cs2('skins.drops.link'),
    to: '/inventory/drops',
    keywords: 'drop rates chances odds rarity skins cases probability',
    audience: 'all',
    module: 'cs2',
  },

  // --- signed-in players --------------------------------------------------
  {
    key: 'matchNow',
    title: { key: 'matchNow.title' },
    to: paths.matchNow,
    keywords: 'my match current match connect server ip join now',
    audience: 'player',
  },
  {
    key: 'myProfile',
    title: { key: 'nav.myProfile' },
    to: paths.me,
    keywords: 'me my profile stats history',
    audience: 'player',
  },
  {
    key: 'connections',
    title: { key: 'nav.accountConnections' },
    to: paths.meConnections,
    keywords: 'account connections link steam discord faceit email password two step 2fa',
    audience: 'player',
  },
  {
    key: 'friends',
    title: { key: 'social.friends.title' },
    to: paths.friends,
    keywords: 'friends requests add friend invite',
    audience: 'player',
  },
  {
    key: 'notifications',
    title: { key: 'social.bell.title' },
    to: paths.notifications,
    keywords: 'notifications bell alerts invites',
    audience: 'player',
  },
  {
    key: 'inventory',
    title: cs2('skins.inventory'),
    to: '/inventory',
    keywords: 'inventory skins loadout equip knives gloves agents ct t',
    audience: 'player',
    module: 'cs2',
  },

  // --- admins -------------------------------------------------------------
  {
    key: 'manage',
    title: page('manage'),
    to: paths.manage,
    keywords: 'dashboard overview admin',
    audience: 'admin',
  },
  {
    key: 'tournaments',
    title: page('tournaments'),
    to: paths.tournaments,
    keywords: 'events cups list create new',
    audience: 'admin',
  },
  {
    key: 'newTournament',
    title: page('newTournament'),
    to: manageTournamentPath('new', 'setup'),
    keywords: 'create tournament setup bracket format swiss round robin elimination',
    audience: 'admin',
  },
  {
    key: 'liveMatches',
    title: page('liveMatches'),
    to: paths.liveMatches,
    keywords: 'live running now servers pause admin call players connected',
    audience: 'admin',
  },
  {
    key: 'playedMatches',
    title: page('playedMatches'),
    to: paths.playedMatches,
    keywords: 'all matches results demos download history',
    audience: 'admin',
  },
  {
    key: 'importMatch',
    title: page('importMatch'),
    to: paths.importMatch,
    keywords: 'import demo dem upload match elsewhere',
    audience: 'admin',
  },
  {
    key: 'disputes',
    title: { key: 'managePage.rail.disputes' },
    to: paths.disputes,
    keywords: 'disputes contested results manual report score',
    audience: 'admin',
  },
  {
    key: 'teams',
    title: page('teams'),
    to: paths.teams,
    keywords: 'teams rosters import',
    audience: 'admin',
  },
  {
    key: 'players',
    title: page('players'),
    to: paths.players,
    keywords: 'players accounts ban delete steam discord impersonate',
    audience: 'admin',
  },
  {
    key: 'reports',
    title: page('reports'),
    to: paths.reports,
    keywords: 'reports reported cheating toxic moderation',
    audience: 'admin',
  },
  {
    key: 'templates',
    title: page('templates'),
    to: paths.templates,
    keywords: 'tournament templates presets',
    audience: 'admin',
  },
  {
    key: 'ratings',
    title: page('ratings'),
    to: paths.eloTemplates,
    keywords: 'elo rating skill openskill templates',
    audience: 'admin',
  },
  {
    key: 'modules',
    title: page('modules'),
    to: paths.modules,
    keywords: 'modules games install packs code plugins update',
    audience: 'admin',
  },
  {
    key: 'servers',
    title: page('servers'),
    to: paths.servers,
    keywords: 'servers machines csm cs server manager fleet ready up cs2 rcon hosts autoscale',
    audience: 'admin',
    module: 'cs2',
  },
  {
    key: 'addMachine',
    title: cs2('machinesPanel.add'),
    to: paths.servers,
    keywords: 'add machine host csm install enroll new server linux',
    audience: 'admin',
    module: 'cs2',
    parent: 'servers',
  },
  {
    key: 'maps',
    title: page('maps'),
    to: paths.maps,
    keywords: 'maps map pools workshop veto',
    audience: 'admin',
    module: 'cs2',
  },
  {
    key: 'skins',
    title: page('skins'),
    to: '/manage/skins',
    keywords: 'skins inventory knives gloves rewards drops prices',
    audience: 'admin',
    module: 'cs2',
  },
  {
    key: 'matchRules',
    title: page('matchRules'),
    to: '/manage/match-rules',
    keywords: 'match rules cs2 overtime round limit forfeit knife',
    audience: 'admin',
    module: 'cs2',
  },
  {
    key: 'highlights',
    title: page('highlights'),
    to: paths.highlights,
    keywords: 'highlights clips reels recorder recorders video',
    audience: 'admin',
  },
  {
    key: 'highlightsSettings',
    title: { key: 'highlightsPage.tabs.settings' },
    to: `${paths.highlights}?tab=settings`,
    keywords: 'resolution fps frame rate quality clips per player watermark logo reels length',
    audience: 'admin',
    parent: 'highlights',
  },
  {
    key: 'highlightsMusic',
    title: { key: 'highlightsPage.music.label' },
    to: `${paths.highlights}?tab=settings`,
    keywords: 'music tracks songs audio volume pixabay content id',
    audience: 'admin',
    parent: 'highlights',
  },
  {
    key: 'recorders',
    title: cs2('highlightsAdmin.tabs.recorders'),
    to: highlightsTab('recorders'),
    keywords: 'recorders recorder gpu worker obs capture',
    audience: 'admin',
    module: 'cs2',
    parent: 'highlights',
  },
  {
    key: 'recordersUpdateAll',
    title: cs2('highlightsAdmin.fleet.updateAll'),
    to: highlightsTab('recorders'),
    keywords: 'update recorders upgrade image version latest',
    audience: 'admin',
    module: 'cs2',
    parent: 'recorders',
  },
  {
    key: 'recordersBenchmark',
    title: cs2('highlightsAdmin.stat.benchmark'),
    to: highlightsTab('recorders'),
    keywords: 'benchmark fps refresh rate gamescope hz speed',
    audience: 'admin',
    module: 'cs2',
    parent: 'recorders',
  },
  {
    key: 'recordersAdd',
    title: cs2('highlightsAdmin.add.button'),
    to: highlightsTab('recorders'),
    keywords: 'add recorder new install docker setup key',
    audience: 'admin',
    module: 'cs2',
    parent: 'recorders',
  },
  {
    key: 'highlightClips',
    title: cs2('highlightsAdmin.tabs.clips'),
    to: highlightsTab('clips'),
    keywords: 'clips failed retry redo record again queue',
    audience: 'admin',
    module: 'cs2',
    parent: 'highlights',
  },
  {
    key: 'overlays',
    title: cs2('highlightsAdmin.tabs.overlays'),
    to: highlightsTab('overlays'),
    keywords: 'overlay caption card kill feed killfeed names logo',
    audience: 'admin',
    module: 'cs2',
    parent: 'highlights',
  },
  {
    key: 'redrawOverlays',
    title: cs2('settings.highlights.overlay.redraw'),
    to: highlightsTab('overlays'),
    keywords: 'redraw redress repaint rerender refresh overlays card kill feed clean copies',
    audience: 'admin',
    module: 'cs2',
    parent: 'overlays',
  },
  {
    key: 'adminTools',
    title: page('adminTools'),
    to: paths.admin,
    keywords: 'system tools logs recovery stuck matches restart',
    audience: 'admin',
  },
  {
    key: 'settings',
    title: page('settings'),
    to: paths.settings,
    keywords: 'settings configuration',
    audience: 'admin',
  },
  {
    key: 'settingsSite',
    title: page('settingsSite'),
    to: settings('site'),
    keywords: 'site name url public address webhook base email smtp mail',
    audience: 'admin',
    parent: 'settings',
  },
  {
    key: 'settingsSignIn',
    title: page('settingsSignIn'),
    to: settings('signin'),
    keywords:
      'sign in login steam discord google github twitch epic openid oidc keycloak sso api key',
    audience: 'admin',
    parent: 'settings',
  },
  {
    key: 'settingsPlayers',
    title: page('settingsPlayers'),
    to: settings('players'),
    keywords: 'players access registration self signup ratings matches',
    audience: 'admin',
    parent: 'settings',
  },
  {
    key: 'settingsWebhooks',
    title: page('settingsWebhooks'),
    to: settings('webhooks'),
    keywords: 'webhooks discord integrations events signing secret',
    audience: 'admin',
    parent: 'settings',
  },
  {
    key: 'settingsLicense',
    title: page('settingsLicense'),
    to: paths.license,
    keywords: 'license commercial non-profit free key polyform licensed badge subscription',
    audience: 'admin',
  },
  {
    key: 'settingsMatchmaking',
    title: page('settingsMatchmaking'),
    to: settings('matchmaking'),
    keywords: 'matchmaking queue lobbies modes search window reserved servers',
    audience: 'admin',
    parent: 'settings',
  },
  {
    key: 'settingsAdvanced',
    title: page('settingsAdvanced'),
    to: settings('advanced'),
    keywords: 'advanced experimental developer',
    audience: 'admin',
    parent: 'settings',
  },
];

const byKey = new Map(SITE_SEARCH_INDEX.map((e) => [e.key, e]));

/** The entries an entry sits in, outermost first ("Highlights", "Overlays"). */
export function parentsOf(entry: SiteSearchEntry): SiteSearchEntry[] {
  const out: SiteSearchEntry[] = [];
  for (
    let p = entry.parent ? byKey.get(entry.parent) : undefined;
    p;
    p = p.parent ? byKey.get(p.parent) : undefined
  ) {
    out.unshift(p);
  }
  return out;
}

export interface SiteSearchViewer {
  signedIn: boolean;
  admin: boolean;
  modules: ReadonlySet<string>;
}

/**
 * The entries `q` finds for this viewer, best first: by the title in the
 * viewer's language (`title`) and in English (`englishTitle`), the parents'
 * titles, and the keywords.
 */
export function searchSiteIndex(
  q: string,
  viewer: SiteSearchViewer,
  title: (entry: SiteSearchEntry) => string,
  englishTitle: (entry: SiteSearchEntry) => string,
  limit = 8
): SiteSearchEntry[] {
  const visible = SITE_SEARCH_INDEX.filter(
    (e) =>
      (!e.module || viewer.modules.has(e.module)) &&
      (e.audience === 'all' ||
        (e.audience === 'player' && (viewer.signedIn || viewer.admin)) ||
        (e.audience === 'admin' && viewer.admin))
  );
  const fields = (e: SiteSearchEntry): SearchField[] => [
    { text: title(e) },
    { text: englishTitle(e) },
    ...parentsOf(e).map((p) => ({ text: `${title(p)} ${englishTitle(p)}`, weight: 0.5 })),
    { text: e.keywords, weight: 0.8 },
  ];
  return fuzzyRank(q, visible, fields, limit).map((r) => r.item);
}
