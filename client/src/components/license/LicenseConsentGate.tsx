import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useLicenseConsent } from '../../hooks/useLicenseConsent';
import { paths } from '../../paths';

/**
 * Admin pages wait for the license terms to be accepted: until then (or when
 * the terms changed since), this sends the admin to the consent page and
 * back afterwards.
 *
 * Only admin pages are wrapped in it. Public pages, player pages and the API
 * are never gated, so running tournaments carry on. If the status cannot be
 * read, the page opens: an outage must not lock admins out.
 */
export function LicenseConsentGate({ children }: { children: React.ReactNode }) {
  const { status, loaded } = useLicenseConsent();
  const location = useLocation();

  if (!loaded) return null;
  if (status && !status.accepted) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`${paths.licenseConsent}?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}
