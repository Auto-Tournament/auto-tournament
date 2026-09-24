/**
 * The part of `react-router-dom` a game module gets: what works inside the
 * host's router.
 *
 * Sharing a package hands out its whole namespace, and a module that lives in
 * the main bundle (react-router-dom and @remix-run/router are one file each)
 * then keeps every export in the main bundle, used or not. For the router
 * that is the data-router half, ~80 KB minified the app never runs: the host
 * renders a `<BrowserRouter>`, so `createBrowserRouter`, loaders, actions,
 * `useFetcher`, `<Form>` and the rest throw inside it anyway, and a module
 * must never create a router of its own.
 *
 * The shim for `react-router-dom` exports exactly these names
 * (`vite-plugins/moduleShims.ts` reads this file), so a module that imports
 * anything else fails to link and is reported broken, rather than failing at
 * render.
 */

export {
  Link,
  NavLink,
  Navigate,
  NavigationType,
  Outlet,
  Route,
  Routes,
  createPath,
  createRoutesFromChildren,
  createRoutesFromElements,
  createSearchParams,
  generatePath,
  matchPath,
  matchRoutes,
  parsePath,
  renderMatches,
  resolvePath,
  useBeforeUnload,
  useHref,
  useInRouterContext,
  useLinkClickHandler,
  useLocation,
  useMatch,
  useNavigate,
  useNavigationType,
  useOutlet,
  useOutletContext,
  useParams,
  useResolvedPath,
  useRoutes,
  useSearchParams,
} from 'react-router-dom';
