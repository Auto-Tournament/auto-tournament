# MAT Discord bot — boilerplate

A small, working Discord bot for a [MatchZy Auto Tournament](../../README.md)
instance. Three commands, chosen to show the shapes most bot commands take:

| Command | Shows |
| --- | --- |
| `/matches` | One request, one reply. Start here. |
| `/scoreboard <match>` | A message that edits itself as MAT pushes updates over Socket.IO. |
| `/mymatch` | The caller's own match, found through the Discord ID on their MAT player. Replies only to them. |

It is meant to be copied and extended, not installed as-is. About a thousand
lines, most of them comments; no framework, no database.

Written against MAT 2.4.10. Older instances work, minus whatever they do not
send yet (bracket labels, the champion).

## What it shows

- **Scores as "maps (rounds)"**: `1 – 0 (7 – 3)` while a series is on, `2 – 1`
  once it is over. The series score comes from `team1SeriesScore`, the current
  map's rounds from `team1MapScore`. Don't read `team1Score`: it means maps won
  on a finished match and rounds on a live one.
- **Bracket-aware labels**, as MAT's own UI shows them: `UB R2 M1`, `LB R1 M3`,
  `Grand Final` in double elimination, `R3 M2` elsewhere.
- **Matches waiting on an admin.** A series that runs out of maps level (maps,
  rounds and damage all tied) gets status `needs_decision`. The maps are over
  but the bracket waits until an admin picks the winner in MAT. `/matches` lists
  these first and `/scoreboard` says what it is waiting for. The bot does not
  set the winner itself; it only reads.
- **The champion** once the tournament is completed, from `winner` on
  `GET /api/tournament`: in `/matches`, and on the scoreboard of the match that
  decided it. A completed round robin or Swiss with a shared top spot, or a
  shuffle tournament, has no champion, and the bot shows none.

## Running it

```bash
cd examples/discord-bot
yarn install
cp .env.example .env   # then fill it in
yarn dev
```

You need four things in `.env`:

- **`DISCORD_TOKEN`** and **`DISCORD_APP_ID`** — from
  [the Discord developer portal](https://discord.com/developers/applications).
  Invite the bot with the `applications.commands` and `bot` scopes.
- **`DISCORD_GUILD_ID`** — optional but do set it while developing. Guild
  commands register instantly; global ones take up to an hour to appear.
- **`MAT_URL`** and **`MAT_API_TOKEN`** — your instance, and a token from its
  `API_TOKENS_READONLY`. This bot only reads.

On your MAT instance:

```bash
# .env
API_TOKENS_READONLY=discord-bot:<openssl rand -hex 32>
```

Restart MAT and it will say so at boot:

```
[Startup] 1 API token(s) active: discord-bot (readonly, 9d8e7f60)
```

The bot checks the token before it logs into Discord, so a wrong one fails
immediately with a clear message rather than on someone's first command.

### Who is running `/mymatch`?

MAT has no Discord sign-in. Instead each player can carry a Discord user ID,
and `/mymatch` looks the caller up by theirs. That ID has to be set on the
player first, in any of three places: an admin in the player editor, a team or
player import, or the player on their own MAT profile page. Until it is, the
bot tells the user so rather than guessing.

One Discord ID can be on several players — a parent signing up their children
often gives their own — so the lookup returns a list and `/mymatch` shows each.

## Layout

```
src/
  index.ts            boot, command registration, interaction routing
  config.ts           environment, validated up front
  mat/
    client.ts         thin fetch wrapper — add methods as you need them
    types.ts          the response shapes this example reads
    live.ts           Socket.IO subscription
  commands/
    matches.ts        the simple pattern
    scoreboard.ts     the live-updating pattern
    mymatch.ts        the personal pattern: Discord user -> MAT player
```

## Adding a command

Write it, then add it to the array in `src/commands/index.ts`. Registration and
routing are automatic.

```ts
import { SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.js';

export const pingCommand: Command = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check MAT is up'),
  async execute(interaction, { mat }) {
    await interaction.deferReply();
    const { matches } = await mat.listMatches();
    await interaction.editReply(`MAT is up — ${matches.length} matches.`);
  },
};
```

## Talking to more of the API

`src/mat/client.ts` covers six endpoints. MAT has 194, all listed in
[docs/API-REFERENCE.md](../../docs/API-REFERENCE.md) with what each one
requires.

To act for the person running a command, start from
`GET /api/players/by-discord-id/:discordId` (`findPlayersByDiscordId`): it
turns `interaction.user.id` into MAT players, whose `id` (a Steam ID) every
other player endpoint takes. A read-only token is enough, and nobody matching is
an empty list, not an error.

Rather than hand-writing types as you go, generate them from MAT's OpenAPI
spec — which is itself generated by walking MAT's routers, so it is never out
of date with the code:

```bash
yarn gen:types      # ../../docs/openapi.json -> src/mat/openapi.d.ts
```

```ts
import type { paths } from './mat/openapi.js';

type Leaderboard =
  paths['/api/tournament/{id}/leaderboard']['get']['responses'][200];
```

One caveat: the spec's paths, methods and auth requirements are complete and
correct for every endpoint, but response *bodies* are only described where
somebody wrote them by hand — about a third. The rest say so and point at the
handler. See [docs/API.md](../../docs/API.md).

## Writing, not just reading

This bot uses a read-only token deliberately. If you want commands that start
matches, pause servers or settle a `needs_decision` series
(`POST /api/matches/:slug/winner` with `{ "winner": "team1" }`), give it a
token from `API_TOKENS` instead — but know
what that means: a full-admin token can reach every RCON command and
`POST /api/tournament/wipe-database`. Think about who can run your commands
before you widen the token.

Discord permissions are the right place for that. `setDefaultMemberPermissions`
on a command restricts it server-side, which is far stronger than checking a
role ID inside the handler:

```ts
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Pause the live match')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
```

Teams in MAT carry a `discordRoleId` field, which is stored and returned but
otherwise unused — it is there for mapping a MAT team to a Discord role.

## Live updates

`/scoreboard` listens on `match:update:<slug>`, but treats each push as "this
match changed" and refetches `GET /api/matches/:slug`. It does not render the
push itself. Pushes are partial (often a slug, a status and live stats), and
some carry `team1Score` as maps won where the REST endpoint gives the current
map's rounds. Refetching costs one small request per edit, and edits are
already throttled to one every five seconds.

## Things this example does not do

Deliberately, so the code stays readable:

- No persistence. A scoreboard stops updating when the bot restarts.
- No sharding. Fine well past the point where you would rewrite this anyway.
- No pagination. `/matches` shows the first 20.
- Interaction tokens expire after 15 minutes, so a `/scoreboard` stops being
  editable then. Post to a channel and keep the message ID if you want one that
  lasts a whole match.
