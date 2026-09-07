import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';
import { teamName, type Match } from '../mat/types.js';

/**
 * `/matches` — what is happening right now.
 *
 * The simplest useful shape: one request, one reply. Start here when adding a
 * command of your own.
 */

function scoreline(match: Match): string {
  const team1 = teamName(match, 'team1');
  const team2 = teamName(match, 'team2');

  // Before a match starts there is no score; showing "0 – 0" reads as a draw
  // that was actually played.
  if (match.status === 'pending' || match.status === 'ready') {
    return `${team1} vs ${team2}`;
  }

  return `${team1} **${match.team1Score ?? 0} – ${match.team2Score ?? 0}** ${team2}`;
}

function detail(match: Match): string {
  const bits: string[] = [match.status];
  if (match.currentMap) bits.push(match.currentMap);
  if (match.serverName) bits.push(match.serverName);
  return bits.join(' · ');
}

export const matchesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('matches')
    .setDescription('Show live and upcoming matches'),

  async execute(interaction, { mat }) {
    await interaction.deferReply();

    const all = await mat.listMatches();
    const interesting = all.filter((m) => m.status !== 'completed');

    if (interesting.length === 0) {
      await interaction.editReply('No live or upcoming matches.');
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

    await interaction.editReply({ embeds: [embed] });
  },
};
