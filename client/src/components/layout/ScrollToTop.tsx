import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * A new page starts at the top, as a full page load would, on every page of
 * the app. Going back keeps where you were, and a link to a #section scrolls
 * there itself.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    if (type !== 'POP' && !hash) window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new page scrolls, not a new hash
  }, [pathname]);
  return null;
}
