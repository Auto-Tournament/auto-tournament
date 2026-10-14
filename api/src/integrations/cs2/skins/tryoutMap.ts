/**
 * The hub map of a Skin tryout server: surf_utopia_njv (Steam Workshop
 * 3073875025; the classic easy surf map). Ready Up loads it whenever nobody
 * is on the server (practice.set {home_map}) and applies the surf settings
 * while it is on it (practice.set {home_cvars}).
 */
export const TRYOUT_HOME_MAP = '3073875025';

/** What surf needs: air acceleration, no fall damage or stamina, auto bunny hop. */
export const TRYOUT_HOME_CVARS = [
  'sv_airaccelerate 150',
  'sv_falldamage_scale 0',
  'sv_staminajumpcost 0',
  'sv_staminalandcost 0',
  'sv_staminamax 0',
  'sv_accelerate_use_weapon_speed 0',
  'sv_enablebunnyhopping 1',
  'sv_autobunnyhopping 1',
];
