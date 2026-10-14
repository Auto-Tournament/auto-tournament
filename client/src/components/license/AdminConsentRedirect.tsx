import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLicenseConsent } from '../../hooks/useLicenseConsent';
import { paths } from '../../paths';

/** Where an admin may be before the license is chosen: the consent page and signing in or out. */
const OPEN_PATHS = [paths.licenseConsent, '/login', '/setup', '/logout', '/auth'];

/**
 * An admin who has not chosen a license yet (or the terms changed since) is
 * sent to the consent page from every page, public ones included, and back
 * afterwards. `LicenseConsentGate` does the same around the admin routes;
 * this covers the rest. Players and signed-out visitors never see it, and an
 * unreadable status opens the page: an outage must not lock admins out.
 */
export function AdminConsentRedirect() {
  const { isAuthenticated: isAdmin } = useAuth();
  const { status, loaded } = useLicenseConsent(isAdmin);
  const location = useLocation();

  if (!isAdmin || !loaded || !status || status.accepted) return null;
  if (OPEN_PATHS.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))) {
    return null;
  }
  const next = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to={`${paths.licenseConsent}?next=${encodeURIComponent(next)}`} replace />;
}
