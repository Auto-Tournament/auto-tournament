/**
 * A minimal MAT Discord bot.
 *
 * Two commands, so there is something to run and something to copy:
 *   /matches              one request, one reply
 *   /scoreboard <match>   a message that edits itself as MAT pushes updates
 *
 * Read src/commands/matches.ts first; it is the simpler of the two.
 */

import { Client, Events, GatewayIntentBits, MessageFlags, REST, Routes } from 'discord.js';
import { loadConfig } from './config.js';
import { MatClient } from './mat/client.js';
import { connectLiveUpdates } from './mat/live.js';
import { commands, commandsByName } from './commands/index.js';

async function registerCommands(config: ReturnType<typeof loadConfig>): Promise<void> {
  const rest = new REST().setToken(config.discordToken);
  const body = commands.map((c) => c.data.toJSON());

  // Guild commands appear immediately; global ones can take an hour to
  // propagate, which makes developing against them miserable.
  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordAppId, config.discordGuildId)
    : Routes.applicationCommands(config.discordAppId);

  await rest.put(route, { body });
  console.log(
    `[discord] registered ${body.length} command(s) ` +
      (config.discordGuildId ? `to guild ${config.discordGuildId}` : 'globally')
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  const mat = new MatClient(config);

  // Fail here rather than on someone's first command.
  const token = await mat.verifyToken();
  console.log(`[mat] token "${token.label}" accepted (${token.scope})`);

  const socket = connectLiveUpdates(config);

  // Guilds is all this bot needs: slash commands arrive as interactions, so
  // there is no reason to ask for message content.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (ready) => {
    console.log(`[discord] logged in as ${ready.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commandsByName.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, { mat, socket });
    } catch (error) {
      console.error(`[discord] /${interaction.commandName} failed:`, error);

      // The interaction has already been acknowledged if the command deferred,
      // and replying twice throws — which would bury the real error.
      const message = 'Something went wrong talking to MAT. Check the bot logs.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => undefined);
      } else {
        await interaction
          .reply({ content: message, flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
      }
    }
  });

  await registerCommands(config);
  await client.login(config.discordToken);

  const shutdown = (signal: string) => {
    console.log(`[bot] ${signal}, shutting down`);
    socket.close();
    void client.destroy().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
