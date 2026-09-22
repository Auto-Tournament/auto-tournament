import type { Command } from './types.js';
import { matchesCommand } from './matches.js';
import { scoreboardCommand } from './scoreboard.js';
import { mymatchCommand } from './mymatch.js';

/** Add your command here and it is registered and routed automatically. */
export const commands: Command[] = [matchesCommand, scoreboardCommand, mymatchCommand];

export const commandsByName = new Map(commands.map((c) => [c.data.name, c]));
