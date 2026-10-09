/**
 * Sending email: the SMTP server an admin sets on Settings -> Email, and the
 * one layout every email uses (the site's name on top, the message, a button,
 * a footer). Used for verifying a player's address, password recovery and
 * tournament news (services/playerEmailService.ts).
 *
 * The settings live in one `email_settings` row, the password encrypted with
 * utils/secretBox. A change applies to the next email: the transport is
 * built from the row each time it changes.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { decryptSecret, encryptSecret } from '../utils/secretBox';
import { settingsService } from './settingsService';

export type SmtpSecurity = 'tls' | 'starttls' | 'none';

interface EmailSettingsRow {
  enabled: number;
  host: string | null;
  port: number | null;
  security: string;
  username: string | null;
  password_enc: string | null;
  from_address: string | null;
  from_name: string | null;
  site_url: string | null;
  updated_at: number;
  updated_by: string | null;
}

/** What Settings -> Email shows. The password itself never leaves the server. */
export interface EmailSettingsView {
  enabled: boolean;
  host: string;
  port: number | null;
  security: SmtpSecurity;
  username: string;
  passwordSet: boolean;
  fromAddress: string;
  fromName: string;
  siteUrl: string;
  /** The address links start from when siteUrl is empty (FRONTEND_BASE_URL). */
  defaultSiteUrl: string;
  /** Enabled, with a server and a sender: emails can go out. */
  ready: boolean;
  updatedAt: number | null;
}

export interface EmailSettingsUpdate {
  enabled?: boolean;
  host?: string;
  port?: number | null;
  security?: SmtpSecurity;
  username?: string;
  /** A new password; "" clears it; absent keeps the saved one. */
  password?: string;
  fromAddress?: string;
  fromName?: string;
  siteUrl?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  /** Short paragraphs, plain text; each becomes a <p>. */
  paragraphs: string[];
  /** The one button (and its link, also written out for text-only readers). */
  action?: { label: string; url: string };
  /** A line under the footer, e.g. the unsubscribe link. */
  footer?: { text: string; url?: string; linkLabel?: string };
}

export class EmailSettingsError extends Error {}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** A plausible email address, trimmed; null when it is not one. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  return value.length <= 254 && EMAIL_RE.test(value) ? value : null;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function trimUrl(url: string | null | undefined): string {
  return (url ?? '').trim().replace(/\/+$/, '');
}

class EmailService {
  private transport: { key: string; transporter: Transporter } | null = null;

  private async row(): Promise<EmailSettingsRow | null> {
    const rows = await db.queryAsync<EmailSettingsRow>(
      'SELECT * FROM email_settings WHERE id = 1',
      []
    );
    return rows[0] ?? null;
  }

  async getSettings(): Promise<EmailSettingsView> {
    const r = await this.row();
    const security = (['tls', 'starttls', 'none'] as const).includes(r?.security as SmtpSecurity)
      ? (r?.security as SmtpSecurity)
      : 'starttls';
    const view: EmailSettingsView = {
      enabled: r?.enabled === 1,
      host: r?.host ?? '',
      port: r?.port ?? null,
      security,
      username: r?.username ?? '',
      passwordSet: !!decryptSecret(r?.password_enc),
      fromAddress: r?.from_address ?? '',
      fromName: r?.from_name ?? '',
      siteUrl: r?.site_url ?? '',
      defaultSiteUrl: trimUrl(process.env.FRONTEND_BASE_URL),
      ready: false,
      updatedAt: r?.updated_at ?? null,
    };
    view.ready = view.enabled && !!view.host && !!view.fromAddress;
    return view;
  }

  async saveSettings(
    update: EmailSettingsUpdate,
    actor: string | null
  ): Promise<EmailSettingsView> {
    const current = await this.row();
    const next = {
      enabled: update.enabled ?? current?.enabled === 1,
      host: update.host !== undefined ? update.host.trim() : (current?.host ?? ''),
      port: update.port !== undefined ? update.port : (current?.port ?? null),
      security: update.security ?? ((current?.security as SmtpSecurity) || 'starttls'),
      username: update.username !== undefined ? update.username.trim() : (current?.username ?? ''),
      fromAddress:
        update.fromAddress !== undefined
          ? update.fromAddress.trim()
          : (current?.from_address ?? ''),
      fromName: update.fromName !== undefined ? update.fromName.trim() : (current?.from_name ?? ''),
      siteUrl: update.siteUrl !== undefined ? trimUrl(update.siteUrl) : (current?.site_url ?? ''),
    };
    if (
      next.port !== null &&
      (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535)
    ) {
      throw new EmailSettingsError('The port is a number from 1 to 65535');
    }
    if (!['tls', 'starttls', 'none'].includes(next.security)) {
      throw new EmailSettingsError('Security is tls, starttls or none');
    }
    if (next.fromAddress && !normalizeEmail(next.fromAddress)) {
      throw new EmailSettingsError('The sender address is not an email address');
    }
    if (next.siteUrl && !/^https?:\/\/[^\s/]+/i.test(next.siteUrl)) {
      throw new EmailSettingsError('The site address starts with https:// (or http://)');
    }
    if (next.enabled && (!next.host || !next.fromAddress)) {
      throw new EmailSettingsError('Sending needs a server and a sender address');
    }
    let passwordEnc = current?.password_enc ?? null;
    if (update.password !== undefined)
      passwordEnc = update.password ? encryptSecret(update.password) : null;

    await db.queryAsync(
      `INSERT INTO email_settings (id, enabled, host, port, security, username, password_enc,
         from_address, from_name, site_url, updated_at, updated_by)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, host = EXCLUDED.host,
         port = EXCLUDED.port, security = EXCLUDED.security, username = EXCLUDED.username,
         password_enc = EXCLUDED.password_enc, from_address = EXCLUDED.from_address,
         from_name = EXCLUDED.from_name, site_url = EXCLUDED.site_url,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [
        next.enabled ? 1 : 0,
        next.host || null,
        next.port,
        next.security,
        next.username || null,
        passwordEnc,
        next.fromAddress || null,
        next.fromName || null,
        next.siteUrl || null,
        Math.floor(Date.now() / 1000),
        actor,
      ]
    );
    this.transport = null;
    log.info('[EMAIL] Email settings saved', { enabled: next.enabled, host: next.host, by: actor });
    return this.getSettings();
  }

  /** Whether emails can go out now. */
  async isReady(): Promise<boolean> {
    return (await this.getSettings()).ready;
  }

  /**
   * Where links in emails start: the saved site address, else
   * FRONTEND_BASE_URL, else `fallback` (the request's own origin).
   */
  async siteUrl(fallback?: string): Promise<string> {
    const r = await this.row();
    return trimUrl(r?.site_url) || trimUrl(process.env.FRONTEND_BASE_URL) || trimUrl(fallback);
  }

  private async transporter(): Promise<{ transporter: Transporter; from: string } | null> {
    const r = await this.row();
    if (!r || r.enabled !== 1 || !r.host || !r.from_address) return null;
    const password = decryptSecret(r.password_enc);
    const key = JSON.stringify([
      r.host,
      r.port,
      r.security,
      r.username,
      r.password_enc,
      r.updated_at,
    ]);
    if (!this.transport || this.transport.key !== key) {
      const security = r.security as SmtpSecurity;
      this.transport = {
        key,
        transporter: nodemailer.createTransport({
          host: r.host,
          port: r.port ?? (security === 'tls' ? 465 : 587),
          secure: security === 'tls',
          requireTLS: security === 'starttls',
          ignoreTLS: security === 'none',
          auth: r.username ? { user: r.username, pass: password ?? '' } : undefined,
          connectionTimeout: 15_000,
          greetingTimeout: 15_000,
          socketTimeout: 30_000,
        }),
      };
    }
    const from = r.from_name
      ? `"${r.from_name.replace(/"/g, "'")}" <${r.from_address}>`
      : r.from_address;
    return { transporter: this.transport.transporter, from };
  }

  /** The message in the shared layout, as HTML and as plain text. */
  async render(message: EmailMessage): Promise<{ html: string; text: string }> {
    const site = await settingsService.getSiteName().catch(() => 'Auto Tournament');
    const paragraphs = message.paragraphs
      .map((p) => `<p style="margin:0 0 16px;line-height:1.55">${escapeHtml(p)}</p>`)
      .join('');
    const button = message.action
      ? `<p style="margin:24px 0"><a href="${escapeHtml(message.action.url)}" style="display:inline-block;background:#ff6a3d;color:#1a0f0b;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px">${escapeHtml(message.action.label)}</a></p>
         <p style="margin:0 0 16px;font-size:13px;color:#7a6f6a;line-height:1.5">${escapeHtml(message.action.url)}</p>`
      : '';
    const footer = message.footer
      ? `<p style="margin:24px 0 0;font-size:12px;color:#7a6f6a;line-height:1.5">${escapeHtml(message.footer.text)}${
          message.footer.url
            ? ` <a href="${escapeHtml(message.footer.url)}" style="color:#7a6f6a">${escapeHtml(message.footer.linkLabel ?? message.footer.url)}</a>`
            : ''
        }</p>`
      : '';
    const html = `<!doctype html><html><body style="margin:0;background:#f4f1ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1513">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<div style="font-weight:700;font-size:18px;margin-bottom:20px">${escapeHtml(site)}</div>
<div style="background:#ffffff;border-radius:12px;padding:28px 24px;font-size:15px">${paragraphs}${button}</div>
${footer}
</div></body></html>`;
    const text = [
      site,
      '',
      ...message.paragraphs.flatMap((p) => [p, '']),
      ...(message.action ? [`${message.action.label}: ${message.action.url}`, ''] : []),
      ...(message.footer
        ? [`${message.footer.text}${message.footer.url ? ` ${message.footer.url}` : ''}`]
        : []),
    ].join('\n');
    return { html, text };
  }

  /**
   * Send one email. Throws when sending is not set up or the server refuses
   * it; the caller decides whether that matters.
   */
  async send(message: EmailMessage): Promise<void> {
    const t = await this.transporter();
    if (!t) throw new EmailSettingsError('Email is not set up');
    const { html, text } = await this.render(message);
    await t.transporter.sendMail({
      from: t.from,
      to: message.to,
      subject: message.subject,
      html,
      text,
    });
  }

  /** Settings -> Email's "Send a test email": the server's own error on failure. */
  async sendTest(to: string): Promise<void> {
    const site = await settingsService.getSiteName().catch(() => 'Auto Tournament');
    await this.send({
      to,
      subject: `Test email from ${site}`,
      paragraphs: [`This is a test email from ${site}. Sending works.`],
    });
  }
}

export const emailService = new EmailService();
