/* global Navigator, ServiceWorkerRegistration */
/**
 * Browser and phone notifications. Two parts, both on or off per browser (the browser asks
 * the player once, and its permission is per browser too):
 *
 * - Push (public/sw.js): the platform sends the events a player turned on (their match is
 *   ready, their veto turn, a tournament starting) to this browser through its push service,
 *   so they arrive with the site closed. Desktop browsers and Android; an iPhone only once the
 *   site is on the Home Screen.
 * - In the tab: a new notice shows as a system notification while the site's tab is in the
 *   background.
 *
 * Which kinds of notice come at all is the player's notification settings, shared with the bell.
 */
import { api } from './api';

const KEY = 'at.browserNotifications';

export type BrowserNotifyState = 'unsupported' | 'denied' | 'off' | 'on';

const supported = () => typeof window !== 'undefined' && 'Notification' in window;

const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  window.isSecureContext;

/** An iPhone or iPad browsing the site (not opened from the Home Screen): no push there. */
export function needsHomeScreen(): boolean {
  if (typeof window === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

function stored(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

function store(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Private mode: on for this page only.
  }
}

export function browserNotifyState(): BrowserNotifyState {
  if (!supported()) return 'unsupported';
  if (window.Notification.permission === 'denied') return 'denied';
  return stored() && window.Notification.permission === 'granted' ? 'on' : 'off';
}

function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = window.atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

/** This browser's push subscription, made (and sent to the platform) when there is none. */
async function subscribePush(): Promise<boolean> {
  const reg = await registration();
  if (!reg) return false;
  try {
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await api.get<{ publicKey: string }>('/api/social/push/key');
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      });
    }
    await api.post('/api/social/push/subscription', sub.toJSON());
    return true;
  } catch {
    return false;
  }
}

async function unsubscribePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await api
      .fetch('/api/social/push/subscription', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      })
      .catch(() => {});
    await sub.unsubscribe();
  } catch {
    // Already gone.
  }
}

/** Turn them on (asks the browser the first time) or off. Returns the new state. */
export async function setBrowserNotify(on: boolean): Promise<BrowserNotifyState> {
  if (!supported()) return 'unsupported';
  if (on && window.Notification.permission === 'default') {
    await window.Notification.requestPermission();
  }
  const granted = window.Notification.permission === 'granted';
  store(on && granted);
  // The subscription is made in the background: the switch answers at once (registering the
  // service worker and asking the push service can take seconds).
  if (on && granted) void subscribePush();
  else if (!on) void unsubscribePush();
  return browserNotifyState();
}

/**
 * Once per page load for a signed-in player: when they are on in this browser, make sure the
 * platform has this browser's push subscription (turned on before push existed, a new key,
 * another account on the same browser).
 */
export async function syncBrowserPush(): Promise<void> {
  if (browserNotifyState() === 'on') await subscribePush();
}

/**
 * Show one, only while the tab is hidden or not focused (on the page, the
 * bell and its toast already say it). `tag` replaces an older one about the
 * same thing. Clicking it brings the tab forward and runs `onClick`.
 */
export function browserNotify(options: {
  title: string;
  body?: string;
  tag?: string;
  onClick?: () => void;
}): void {
  if (browserNotifyState() !== 'on') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const n = new window.Notification(options.title, {
      body: options.body || undefined,
      tag: options.tag,
      icon: '/icon-192.png',
    });
    n.onclick = () => {
      window.focus();
      options.onClick?.();
      n.close();
    };
  } catch {
    // Some browsers only allow them from a service worker: the bell still has it.
  }
}
