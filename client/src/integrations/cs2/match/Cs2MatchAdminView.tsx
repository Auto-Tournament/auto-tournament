import { Stack } from '@mui/material';
import type { MatchAdminPanelProps } from '../../types';
import { FailoverPanel } from './FailoverPanel';
import { RoundBackupsPanel } from './RoundBackupsPanel';

/**
 * The CS2 part of the match admin section (`matchPanels.adminMatchView`):
 * failover (a Ready Up server that went down, moving the match; nothing when
 * the match is not on one), then the round backups and "restore to round N".
 */
export function Cs2MatchAdminView(props: MatchAdminPanelProps) {
  return (
    <Stack spacing={3}>
      <FailoverPanel {...props} />
      <RoundBackupsPanel {...props} />
    </Stack>
  );
}
