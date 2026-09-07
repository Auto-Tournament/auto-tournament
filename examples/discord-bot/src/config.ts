/**
 * Configuration, read once at boot.
 *
 * Everything is checked up front and reported together. A bot that starts
 * happily and then fails on the first command with `undefined is not a valid
 * token` wastes far more time than one that refuses to start and says which
 * three variables are missing.
 */

export interface Config {
  discordToken: string;
  discordAppId: string;
  /** Register commands to one guild. Empty means global. */
  discordGuildId: string | null;
  matUrl: string;
  matApiToken: string;
}

function required(name: string, missing: string[]): string {
  const value = process.env[name]?.trim();
  if (!value) {
    missing.push(name);
    return '';
  }
  return value;
}

export function loadConfig(): Config {
  const missing: string[] = [];

  const config: Config = {
    discordToken: required('DISCORD_TOKEN', missing),
    discordAppId: required('DISCORD_APP_ID', missing),
    discordGuildId: process.env.DISCORD_GUILD_ID?.trim() || null,
    // Trailing slashes turn every URL into `//api/...`, which some proxies
    // answer and some do not.
    matUrl: required('MAT_URL', missing).replace(/\/+$/, ''),
    matApiToken: required('MAT_API_TOKEN', missing),
  };

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}.\n` +
        'Copy .env.example to .env and fill it in.'
    );
  }

  return config;
}
