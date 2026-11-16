import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const KEY = 'at:return-after-login';
const FOR_MS = 15 * 60 * 1000;

/** A path on this site only: `/match/x`, not `//evil.example` or `https://…`. */
export function safeReturnPath(path: string | null | undefined): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\'))
    return null;
  if (path === '/login' || path.startsWith('/login/') || path.startsWith('/login?')) return null;
  return path;
}

/** Remember where to go back to once this tab is signed in (the login page calls it). */
export function rememberReturnPath(path: string | null | undefined): void {
  const safe = safeReturnPath(path);
  if (!safe) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path: safe, at: Date.now() }));
  } catch {
    // storage blocked: the viewer lands where login sends them
  }
}

function takeReturnPath(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const saved = raw ? (JSON.parse(raw) as { path?: string; at?: number }) : null;
    return saved && Date.now() - (saved.at ?? 0) < FOR_MS ? safeReturnPath(saved.path) : null;
  } catch {
    return null;
  }
}

/** Once signed in, go back to the page the viewer was on before login. */
export function ReturnAfterLogin(): null {
  const { isLoading, isAuthenticated, playerUid } = useAuth();
  const navigate = useNavigate();
  const signedIn = !isLoading && (isAuthenticated || Boolean(playerUid));
  useEffect(() => {
    if (!signedIn) return;
    const path = takeReturnPath();
    if (path) navigate(path, { replace: true });
  }, [signedIn, navigate]);
  return null;
}
