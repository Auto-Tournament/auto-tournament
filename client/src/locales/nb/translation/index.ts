import auth from './auth.json';
import core from './core.json';
import modals from './modals.json';
import pages from './pages.json';
import playersTeams from './playersTeams.json';
import tournament from './tournament.json';

const nbTranslation = {
  ...core,
  ...auth,
  ...playersTeams,
  ...modals,
  ...pages,
  ...tournament,
};

export default nbTranslation;
