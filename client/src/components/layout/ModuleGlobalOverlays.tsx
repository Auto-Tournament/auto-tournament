import { Fragment } from 'react';
import { useInstalledIntegrations } from '../../integrations/registry';

/**
 * Each installed module's `globalOverlay`, above every page (CS2: the "new
 * skin" reveal). Code modules' slots come wrapped in an error boundary, so a
 * broken one shows nothing instead of taking the page down.
 */
export function ModuleGlobalOverlays() {
  const overlays = useInstalledIntegrations().flatMap((integration) =>
    integration.globalOverlay ? [{ id: integration.id, Overlay: integration.globalOverlay }] : []
  );
  return (
    <>
      {overlays.map(({ id, Overlay }) => (
        <Fragment key={id}>
          <Overlay />
        </Fragment>
      ))}
    </>
  );
}
