/**
 * CS2's part of the Highlights page. Four tabs:
 *
 * - Recorders: every recorder that asked for work, with its GPU, status
 *   (online, recording, paused when its CS2 would not start), its
 *   benchmark, how many clips it kept, seconds per clip, and its recent runs
 *   with their logs (api:
 *   demos/recorders.ts). An offline one can be forgotten.
 * - Clips: recent matches' clips and reels, what each was made at, and a Redo
 *   for each, or for every one made at other settings (api: demos/clipsAdmin.ts).
 * - Overlays: clean copies of the clips, and redrawing their overlays.
 * Adding a recorder is on the Recorders tab: a recorder key and the one
 *   `docker run` that starts it (api: demos/recorderKeys.ts).
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, CircularProgress, Tab, Tabs } from '@mui/material';
import { api, useModuleTranslation, useSnackbar } from '../../../module-sdk';
import { HighlightOverlaySetting } from '../settings/HighlightOverlaySetting';

import type { TabKey } from './highlightsAdminShared';
import { RecordersTab } from './RecordersTab';
import { ClipsTab } from './ClipsTab';

/**
 * CS2's tab on core's Highlights page (`highlightsAdmin`): its recorders, the
 * overlays on its clips and the clips themselves. What every game's
 * recorders follow (size, frame rate, music) is core's Settings tab.
 */
export default function Cs2HighlightsAdmin() {
  const { t } = useModuleTranslation('cs2');
  // `?sub=` opens a tab (the site search links to Overlays, Clips, Recorders).
  const [search, setSearch] = useSearchParams();
  const sub = search.get('sub');
  const tab: TabKey = sub === 'clips' || sub === 'overlays' ? sub : 'recorders';
  const setTab = (value: TabKey) => {
    const next = new URLSearchParams(search);
    next.set('sub', value);
    setSearch(next, { replace: true });
  };

  return (
    <Box data-testid="cs2-highlights-admin">
      <Tabs value={tab} onChange={(_e, v: TabKey) => setTab(v)} sx={{ mb: 3 }} variant="scrollable">
        <Tab
          value="recorders"
          label={t('highlightsAdmin.tabs.recorders')}
          data-testid="highlights-tab-recorders"
        />
        <Tab
          value="clips"
          label={t('highlightsAdmin.tabs.clips')}
          data-testid="highlights-tab-clips"
        />
        <Tab
          value="overlays"
          label={t('highlightsAdmin.tabs.overlays')}
          data-testid="highlights-tab-overlays"
        />
      </Tabs>
      {tab === 'recorders' && <RecordersTab />}
      {tab === 'clips' && <ClipsTab />}
      {tab === 'overlays' && <OverlaysTab />}
    </Box>
  );
}

/** Clean copies of the clips and redrawing their overlays (CS2's clips and reels). */
function OverlaysTab() {
  const { t } = useModuleTranslation('cs2');
  const { showSuccess, showError } = useSnackbar();
  const [keepClean, setKeepClean] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .get<{ settings?: Record<string, unknown> }>('/api/settings')
      .then((res) => setKeepClean(res.settings?.highlightsKeepClean !== false))
      .catch((err: Error) => showError(err.message));
  }, [showError]);

  if (keepClean === null) return <CircularProgress />;
  return (
    <Box sx={{ maxWidth: 720 }} data-testid="cs2-highlights-overlays">
      <HighlightOverlaySetting
        keepClean={keepClean}
        onKeepClean={async (value) => {
          setKeepClean(value);
          try {
            await api.put('/api/settings', { highlightsKeepClean: value });
            showSuccess(t('settings.saved'));
          } catch (err) {
            showError(err instanceof Error ? err.message : t('settings.saveFailed'));
          }
        }}
      />
    </Box>
  );
}
