/**
 * Everything CS2 needs an admin to fix before its tournament can run, in the
 * one slot the shell renders on every admin page (3.0 phase E).
 *
 * Two warnings, each already its own component: the webhook URL a CS2 server
 * reaches the platform on, and the MatchZy plugin's database. The slot takes
 * one component, and grouping them here is what keeps the shell from learning
 * what either of them is.
 */

import * as React from 'react';
import { WebhookWarning } from './WebhookWarning';
import { MatchzyDbWarning } from './MatchzyDbWarning';
import type { AdminGlobalWarningProps } from '../../types';

export const Cs2AdminWarnings: React.FC<AdminGlobalWarningProps> = ({ onOpenSettings }) => (
  <>
    <WebhookWarning onOpenSettings={onOpenSettings} />
    <MatchzyDbWarning />
  </>
);
