/**
 * The error boundary around every slot a code module fills
 * (DESIGN-module-client-api.md §4.4).
 *
 * A slot that throws while rendering marks its module broken for the session
 * and renders nothing for players, or one line saying so for admins. The rest
 * of the page, and every other module, carries on. The registry then leaves
 * the module out, so the next render of any page that asked for it gets the
 * "module not installed" placeholder instead.
 *
 * Built-in modules are compiled in and are not wrapped: nothing about them
 * changes.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { recordRenderFailure } from './moduleState';

interface BoundaryProps {
  moduleId: string;
  slot: string;
  children?: ReactNode;
}

function SlotFailed({ moduleId }: { moduleId: string }) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  // Players get the page without the module's part; only an admin can do
  // anything about it, on the Modules page.
  if (!isAuthenticated) return null;
  return (
    <Alert severity="error" variant="outlined" data-testid={`module-slot-failed-${moduleId}`}>
      {t('modulesPage.code.slotFailed', { id: moduleId })}
    </Alert>
  );
}

export class ModuleSlotBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    recordRenderFailure(this.props.moduleId, this.props.slot, error);
  }

  render() {
    return this.state.failed ? <SlotFailed moduleId={this.props.moduleId} /> : this.props.children;
  }
}
