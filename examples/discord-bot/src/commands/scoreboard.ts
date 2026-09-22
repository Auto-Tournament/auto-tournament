import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';
import type { MatClient } from '../mat/client.js';
import {
  isFinished,
  matchLabel,
  scoreText,
  statusText,
  teamName,
  type Match,
} from '../mat/types.js';
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
 * anyone can read, so coalesce them: at most one refetch and edit per interval,
 * always of the latest state rather than a queued backlog.
 */
const EDIT_EVERY_MS = 5_000;

function render(match: Match, champion: string | null): EmbedBuilder {
  const team1 = teamName(match, 'team1');
  const team2 = teamName(match, 'team2');
  const label = matchLabel(match);

  const embed = new EmbedBuilder()
    .setTitle(`${team1} vs ${team2}`)
    // Series score, then the current map's rounds in brackets while it runs.
    .setDescription(`**${scoreText(match)}**`)
    .addFields({ name: 'Status', value: statusText(match.status), inline: true })
    .setFooter({ text: label ? `${label} · ${match.slug}` : match.slug })
    .setTimestamp(new Date());

  if (match.currentMap && !isFinished(match.status)) {
    embed.addFields({ name: 'Map', value: match.currentMap, inline: true });
  }
  if (match.status === 'needs_decision') {
    // Nothing more will happen on the server: every map is played and the
    // series is level. The match finishes when an admin picks the winner in
    // MAT, and this scoreboard picks that up like any other update.
    embed.addFields({
      name: 'Waiting on an admin',
      value: 'The series ended level. An admin has to pick the winner before the bracket moves on.',
    });
  }
  if (match.status === 'completed' && match.winner) {
    embed.addFields({ name: 'Winner', value: match.winner.name, inline: true });
  }
  if (champion) {
    embed.addFields({ name: 'Tournament champion', value: champion });
  }

  return embed;
}

/**
 * The champion's name if this match just finished the tournament. Only asked
 * for completed tournament matches, so a live scoreboard costs nothing extra.
 */
async function championFor(mat: MatClient, match: Match): Promise<string | null> {
  if (match.status !== 'completed' || !match.round) return null;
  const tournament = await mat.getTournament();
  return tournament?.status === 'completed' ? (tournament.winner?.name ?? null) : null;
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

    await interaction.editReply({ embeds: [render(match, await championFor(mat, match))] });

    // A finished match will never emit another update, so following it would
    // leak a listener for three hours to no purpose.
    if (isFinished(match.status)) return;

    let timer: NodeJS.Timeout | null = null;
    let stopped = false;

    const refresh = async () => {
      timer = null;
      if (stopped) return;
      try {
        // Refetch rather than render the push: pushes are partial and their
        // score fields do not mean what REST's do (see src/mat/live.ts).
        const latest = await mat.getMatch(slug);
        if (!latest) {
          // Deleted in MAT. Leave the last scoreboard standing.
          stop();
          return;
        }
        await interaction.editReply({
          embeds: [render(latest, await championFor(mat, latest))],
        });
        if (isFinished(latest.status)) stop();
      } catch (error) {
        // The message may have been deleted, or the interaction token expired
        // (Discord allows edits for 15 minutes after the reply). Either way,
        // there is nothing left to update.
        console.warn(`[scoreboard] stopped following ${slug}:`, error);
        stop();
      }
    };

    const unfollow = followMatch(socket, slug, () => {
      if (!timer && !stopped) timer = setTimeout(() => void refresh(), EDIT_EVERY_MS);
    });

    const expiry = setTimeout(() => stop(), FOLLOW_FOR_MS);

    function stop(): void {
      stopped = true;
      unfollow();
      clearTimeout(expiry);
      if (timer) clearTimeout(timer);
    }
  },
};
