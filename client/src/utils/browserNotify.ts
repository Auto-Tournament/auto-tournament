/**
 * Browser notifications: a new notice shows as a system notification while
 * the site's tab is in the background. On or off per browser (the browser
 * asks the player once, and its permission is per browser too); which kinds
 * of notice come at all is the player's notification settings, shared with
 * the bell.
 */

const KEY = 'at.browserNotifications';

export type BrowserNotifyState = 'unsupported' | 'denied' | 'off' | 'on';

const supported = () => typeof window !== 'undefined' && 'Notification' in window;

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
  if (Notification.permission === 'denied') return 'denied';
  return stored() && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Turn them on (asks the browser the first time) or off. Returns the new state. */
export async function setBrowserNotify(on: boolean): Promise<BrowserNotifyState> {
  if (!supported()) return 'unsupported';
  if (on && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  store(on && Notification.permission === 'granted');
  return browserNotifyState();
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
    const n = new Notification(options.title, {
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
