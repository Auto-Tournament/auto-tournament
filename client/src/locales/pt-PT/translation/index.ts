import auth from './auth.json';
import core from './core.json';
import dashboardSettings from './dashboardSettings.json';
import playersTeams from './playersTeams.json';
import serversAdmin from './serversAdmin.json';

export default {
  ...core,
  ...auth,
  ...playersTeams,
  ...dashboardSettings,
  ...serversAdmin,
};
