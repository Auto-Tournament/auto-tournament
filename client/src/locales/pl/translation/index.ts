import auth from './auth.json';
import core from './core.json';
import dashboardSettings from './dashboardSettings.json';
import devTools from './devTools.json';
import mapsTemplatesElo from './mapsTemplatesElo.json';
import matchesAndModals from './matchesAndModals.json';
import misc from './misc.json';
import playersTeams from './playersTeams.json';
import serversAdmin from './serversAdmin.json';
import tournament from './tournament.json';

const plTranslation = {
  ...core,
  ...auth,
  ...playersTeams,
  ...dashboardSettings,
  ...serversAdmin,
  ...mapsTemplatesElo,
  ...matchesAndModals,
  ...devTools,
  ...misc,
  ...tournament,
} as const;

export default plTranslation;
