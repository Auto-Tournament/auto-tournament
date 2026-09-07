import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';
import { teamName, type Match } from '../mat/types.js';
import { followMatch } from '../mat/live.js';

/**
 * `/scoreboard <match>` — a message that keeps itself current.
 *
 * This is the pattern worth copying: reply once, then edit that same message
 * as MAT pushes updates, instead of posting a new one per round. It is also
 * where the interesting failure modes live, so the details below are
 * deliberate rather than incidental.
 */

/** Stop following after this long, so a forgotten scoreboard is not forever. */
const FOLLOW_FOR_MS = 3 * 60 * 60 * 1000;

/**
 * Discord rate-limits message edits. A busy match emits far more updates than
 * anyone can read, so coalesce them: apply at most one edit per interval, and
 * always apply the latest state rather than a queued backlog.
 */
const EDIT_EVERY_MS = 5_000;

function render(match: Match): EmbedBuilder {
  const team1 = teamName(match, 'team1');
  const team2 = teamName(match, 'team2');

  const embed = new EmbedBuilder()
    .setTitle(`${team1} vs ${team2}`)
    .setDescription(`**${match.team1Score ?? 0} – ${match.team2Score ?? 0}**`)
    .addFields({ name: 'Status', value: match.status, inline: true })
    .setFooter({ text: match.slug })
    .setTimestamp(new Date());

  if (match.currentMap) {
    embed.addFields({ name: 'Map', value: match.currentMap, inline: true });
  }
  if (match.status === 'completed' && match.winner) {
    embed.addFields({ name: 'Winner', value: match.winner.name, inline: true });
  }

  return embed;
}

export const scoreboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('scoreboard')
    .setDescription('Post a live-updating scoreboard for a match')
    .addStringOption((option) =>
      option
        .setName('match')
        .setDescription('Match slug, as shown by /matches')
        .setRequired(true)
    ),

  async execute(interaction, { mat, socket }) {
    await interaction.deferReply();

    const slug = interaction.options.getString('match', true);
    const match = await mat.getMatch(slug);

    if (!match) {
      await interaction.editReply(`No match called \`${slug}\`. Try \`/matches\`.`);
      return;
    }

    await interaction.editReply({ embeds: [render(match)] });

    // A finished match will never emit another update, so following it would
    // leak a listener for three hours to no purpose.
    if (match.status === 'completed') return;

    let latest = match;
    let pending = false;
    let timer: NodeJS.Timeout | null = null;

    const flush = async () => {
      timer = null;
      if (!pending) return;
      pending = false;
      try {
        await interaction.editReply({ embeds: [render(latest)] });
      } catch (error) {
        // The message may have been deleted, or the interaction token expired
        // (Discord allows edits for 15 minutes after the reply). Either way,
        // there is nothing left to update.
        console.warn(`[scoreboard] stopped following ${slug}:`, error);
        stop();
      }
    };

    const unfollow = followMatch(socket, slug, (update) => {
      latest = update;
      pending = true;
      if (!timer) timer = setTimeout(() => void flush(), EDIT_EVERY_MS);
      if (update.status === 'completed') {
        // Let the final score through, then stop.
        setTimeout(stop, EDIT_EVERY_MS + 1_000);
      }
    });

    const expiry = setTimeout(() => stop(), FOLLOW_FOR_MS);

    function stop(): void {
      unfollow();
      clearTimeout(expiry);
      if (timer) clearTimeout(timer);
    }
  },
};
