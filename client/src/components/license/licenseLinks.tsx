import { ExternalLink } from '../common/ExternalLink';

/** Where a customer copies their license key: the licenses page in the website console. */
export const CONSOLE_LICENSES_URL = 'https://autotournament.gg/console/licenses';

/** `components` for a `<Trans>` string that wraps its link text in `<consoleLink>`. */
export const consoleLinkComponents = {
  consoleLink: <ExternalLink href={CONSOLE_LICENSES_URL}>{null}</ExternalLink>,
};
