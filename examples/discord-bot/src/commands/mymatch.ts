import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';
import type { MatClient } from '../mat/client.js';
import { teamName, type Player } from '../mat/types.js';
import { detail, scoreline } from './matches.js';

/**
 * `/mymatch` — the match of whoever runs it.
 *
 * This is the pattern for anything personal: map the Discord user to a MAT
 * player first. MAT stores a Discord ID on each player (set by an admin, an
 * import, or the player on their own profile page), and the bot looks the
 * invoking user up by it. There is no Discord sign-in involved; if the ID was
 * never set, the bot simply cannot know who you are.
 *
 * Every reply is ephemeral. Whether someone is registered, and under which
 * name, is their business — a public channel should not learn it because they
 * ran a command there.
 */

/**
 * A Discord ID on more players than this is not a family, it is a mistake;
 * cap it so one bad import cannot blow past Discord's 25-field embed limit.
 */
const MAX_PLAYERS = 10;

/** One player's current match, as a couple of lines of embed text. */
async function describeMatch(mat: MatClient, player: Player): Promise<string> {
  const current = await mat.getPlayerCurrentMatch(player.id);

  // The player was deleted between the two requests. Rare, but not an error.
  if (!current) return 'Not found in MAT any more.';

  // An ordinary answer between matches, or before a bracket reaches them.
  if (!current.hasMatch) return 'No live or upcoming match.';

  const summary = current.match;
  const side = summary.isTeam1 ? 'team1' : 'team2';

  // The current-match endpoint has no series score, so fetch the match itself:
  // that gives the same scoreline `/matches` shows, and `teamName()` handles
  // manual matches whose names live only in the config.
  const match = await mat.getMatch(summary.slug);

  if (!match) {
    // Deleted in between — fall back to what the first response already had.
    const team1 = summary.team1?.name ?? 'TBD';
    const team2 = summary.team2?.name ?? 'TBD';
    return `\`${summary.slug}\` — ${team1} vs ${team2}\n${summary.status}`;
  }

  return (
    `\`${match.slug}\` — ${scoreline(match)}\n` +
    `${detail(match)}\n` +
    `Playing for **${teamName(match, side)}**`
  );
}

export const mymatchCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('mymatch')
    .setDescription('Show your current or next match'),

  async execute(interaction, { mat }) {
    // Ephemeral from the start: a deferred reply's visibility cannot be
    // changed by the edit that follows it.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // The invoking user's snowflake. Always a valid Discord ID, so MAT's 400
    // for a malformed one cannot happen here.
    const players = await mat.findPlayersByDiscordId(interaction.user.id);

    if (players.length === 0) {
      await interaction.editReply(
        "Your Discord account isn't linked to any player in MAT. Ask an organizer " +
          'to add your Discord ID to your player, or sign in to MAT and set it on ' +
          'your player profile page.'
      );
      return;
    }

    const [only] = players;
    if (players.length === 1 && only) {
      const embed = new EmbedBuilder()
        .setTitle(only.name)
        .setDescription(await describeMatch(mat, only));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Several players share this Discord ID. That is legitimate: a parent
    // signing up their children gives their own Discord account for each, so
    // one Discord user genuinely stands behind several MAT players. Show them
    // all rather than guessing which one was meant.
    const shown = players.slice(0, MAX_PLAYERS);
    const descriptions = await Promise.all(shown.map((p) => describeMatch(mat, p)));

    const embed = new EmbedBuilder()
      .setTitle('Your players')
      .addFields(
        shown.map((player, i) => ({ name: player.name, value: descriptions[i] ?? '—' }))
      );

    if (players.length > MAX_PLAYERS) {
      embed.setFooter({ text: `and ${players.length - MAX_PLAYERS} more` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
