import type { ChatInputCommandInteraction, SlashCommandOptionsOnlyBuilder } from 'discord.js';
import type { SlashCommandBuilder } from 'discord.js';
import type { MatClient } from '../mat/client.js';
import type { Socket } from 'socket.io-client';

export interface CommandContext {
  mat: MatClient;
  socket: Socket;
}

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
}
