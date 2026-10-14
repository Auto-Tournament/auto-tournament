/**
 * Everything CS2 needs an admin to fix before its tournament can run, in the
 * one slot the shell renders on every admin page (3.0 phase E).
 *
 * The webhook URL the platform's links and callbacks use. The slot takes one
 * component, and keeping it here keeps the shell from learning what it is.
 */

import * as React from 'react';
import { WebhookWarning } from './WebhookWarning';
import type { AdminGlobalWarningProps } from '../../types';

export const Cs2AdminWarnings: React.FC<AdminGlobalWarningProps> = ({ onOpenSettings }) => (
  <>
    <WebhookWarning onOpenSettings={onOpenSettings} />
  </>
);
