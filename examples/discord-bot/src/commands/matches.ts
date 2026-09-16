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

/**
 * `/matches` — what is happening right now.
 *
 * The simplest useful shape: one request, one reply. Start here when adding a
 * command of your own.
 */

export function scoreline(match: Match): string {
  const team1 = teamName(match, 'team1');
  const team2 = teamName(match, 'team2');

  // Before a match starts there is no score; showing "0 – 0" reads as a draw
  // that was actually played.
  if (match.status === 'pending' || match.status === 'ready') {
    return `${team1} vs ${team2}`;
  }

  return `${team1} **${scoreText(match)}** ${team2}`;
}

export function detail(match: Match): string {
  const bits: string[] = [];
  const label = matchLabel(match);
  if (label) bits.push(label);
  bits.push(statusText(match.status));
  if (match.currentMap) bits.push(match.currentMap);
  if (match.serverName) bits.push(match.serverName);
  return bits.join(' · ');
}

/**
 * "Champion: <team>" once the tournament is over, or null.
 *
 * `GET /api/matches` already says whether the tournament is completed, so the
 * second request is only made when there is a champion to show.
 */
export async function championLine(mat: MatClient, tournamentStatus: string): Promise<string | null> {
  if (tournamentStatus !== 'completed') return null;
  const tournament = await mat.getTournament();
  // No winner on a completed tournament is legitimate: a shared top spot in a
  // round robin, or a shuffle tournament, which ranks players instead.
  return tournament?.winner ? `**${tournament.winner.name}** won ${tournament.name}.` : null;
}

export const matchesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('matches')
    .setDescription('Show live and upcoming matches'),

  async execute(interaction, { mat }) {
    await interaction.deferReply();

    const { matches, tournamentStatus } = await mat.listMatches();
    const champion = await championLine(mat, tournamentStatus);

    // Matches waiting on an admin go first: they hold the bracket up, and a
    // score that is not moving is easy to scroll past.
    const interesting = matches
      .filter((m) => !isFinished(m.status))
      .sort((a, b) => Number(b.status === 'needs_decision') - Number(a.status === 'needs_decision'));

    if (interesting.length === 0) {
      await interaction.editReply(champion ?? 'No live or upcoming matches.');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Matches')
      .setDescription(
        interesting
          // Discord embeds cap at 4096 characters; a large tournament will
          // exceed that long before anyone wants to read it all.
          .slice(0, 20)
          .map((m) => `\`${m.slug}\` — ${scoreline(m)}\n${detail(m)}`)
          .join('\n\n')
      );

    if (interesting.length > 20) {
      embed.setFooter({ text: `and ${interesting.length - 20} more` });
    }

    await interaction.editReply({ content: champion ?? undefined, embeds: [embed] });
  },
};
