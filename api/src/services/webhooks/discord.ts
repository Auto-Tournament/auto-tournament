/**
 * Discord webhook endpoints (`format: 'discord'`, Vikunja 1842): instead of the
 * signed JSON envelope, a Discord message with one embed, so an endpoint can
 * point straight at a Discord channel's webhook (#admins for `admin.called`).
 *
 * Discord channels are read by people, so the embed never carries a server
 * password or connect line: it names the server and links the match page,
 * where admins find how to join. No @mentions are parsed. Pure: no I/O.
 */
import type { WebhookEnvelope, WebhookMatch } from './events';

/** discord.com (and the canary / ptb / discordapp.com hosts) /api/webhooks/<id>/<token>. */
export function isDiscordWebhookUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      /^(?:(?:canary|ptb)\.)?discord(?:app)?\.com$/.test(url.hostname) &&
      /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/** Embed colours: the brand orange, gold for an admin call, green when it is answered. */
const COLOR = { default: 0xff6a3d, adminCall: 0xe8b04b, resolved: 0x3fc168, cancelled: 0x938a87 } as const;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function teams(match: WebhookMatch): string {
  return `${match.team1?.name ?? 'TBD'} vs ${match.team2?.name ?? 'TBD'}`;
}

function scoreLine(match: WebhookMatch): string | null {
  const map = match.score.map;
  if (!map) return null;
  const series = match.best_of > 1 ? ` (maps ${match.score.series.team1}–${match.score.series.team2})` : '';
  return `${map.name ?? `Map ${map.number}`}: ${map.team1}–${map.team2}${series}`;
}

interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

const TITLES: Partial<Record<WebhookEnvelope['type'], string>> = {
  'match.ready': 'Ready to join',
  'match.live': 'Live',
  'match.map_started': 'Map started',
  'match.score_updated': 'Score',
  'match.map_ended': 'Map finished',
  'match.finished': 'Finished',
  'match.cancelled': 'Cancelled',
  'match.reset': 'Reset',
};

/**
 * The Discord message for one event. `matchUrl` is the match's admin page
 * when the platform knows its own address (the envelope carries it for admin
 * calls; for other events the caller passes it).
 */
export function discordMessage(envelope: WebhookEnvelope, matchUrl: string | null): Record<string, unknown> {
  const { match } = envelope.data;
  const call = envelope.data.admin_call;
  const url = call?.match_url ?? matchUrl ?? undefined;
  const fields: DiscordEmbed['fields'] = [];
  const where = [match.tournament?.name, scoreLine(match)].filter(Boolean).join(' · ');
  let embed: DiscordEmbed;

  if (envelope.type === 'admin.called' && call) {
    const who = call.player.name ?? call.player.steam_id64 ?? 'A player';
    embed = {
      title: clip(`Admin called: ${teams(match)}`, 256),
      description: call.message ? clip(`> ${call.message}`, 2000) : '*No message*',
      url,
      color: COLOR.adminCall,
      timestamp: call.called_at,
    };
    fields.push({ name: 'Who', value: clip(`${who}${call.player.team_name ? ` (${call.player.team_name})` : ''}`, 1024), inline: true });
    if (call.server.name || call.server.id) fields.push({ name: 'Server', value: clip(call.server.name ?? call.server.id ?? '', 1024), inline: true });
    if (where) fields.push({ name: 'Match', value: clip(where, 1024), inline: false });
  } else if (envelope.type === 'admin.call_resolved' && call) {
    const by = envelope.data.resolved_by ?? 'an admin';
    embed = {
      title: clip(`Admin call answered: ${teams(match)}`, 256),
      description: clip(
        [`${call.player.name ?? 'The player'}'s call was answered by ${by}.`, envelope.data.resolution_note ? `> ${envelope.data.resolution_note}` : '']
          .filter(Boolean)
          .join('\n'),
        2000
      ),
      url,
      color: COLOR.resolved,
      timestamp: envelope.created_at,
    };
  } else {
    embed = {
      title: clip(`${TITLES[envelope.type] ?? envelope.type}: ${teams(match)}`, 256),
      description: where ? clip(where, 2000) : undefined,
      url,
      color: envelope.type === 'match.cancelled' ? COLOR.cancelled : COLOR.default,
      timestamp: envelope.created_at,
    };
    if (envelope.data.reason) fields.push({ name: 'Why', value: clip(envelope.data.reason, 1024) });
  }

  if (url) fields.push({ name: 'Open', value: `[Match page](${url})`, inline: false });
  if (fields.length) embed.fields = fields;
  if (envelope.test) embed.footer = { text: 'Test event from Auto Tournament' };

  return {
    username: 'Auto Tournament',
    embeds: [embed],
    // Never ping anyone from a message players can trigger.
    allowed_mentions: { parse: [] },
  };
}
