import React from 'react';
import { Box, Container } from '@mui/material';
import { SharedNavBar } from './SharedNavBar';
import { tokens, radii } from '../../theme/tokens';
import { NAV_GAP_PX, NAV_HEIGHT_PX, NAV_STICKY_TOP } from '../../constants/navBar';

type TopNavBarProps = {
  /**
   * Set by the admin shell on the pages its rail lists, so "Manage" reads as
   * where the admin is.
   */
  adminArea?: boolean;
};

/**
 * The top bar of every page: the 3.0 drafts' floating pill (`.nav`). It sticks
 * 12px from the top, in the same 1200px wrap as the page under it (MUI's `lg`
 * `Container`), on paper-2 glass with a pill radius.
 */
export const TopNavBar: React.FC<TopNavBarProps> = ({ adminArea = false }) => {
  return (
    <Container
      maxWidth="lg"
      sx={(theme) => ({
        position: 'sticky',
        top: NAV_STICKY_TOP,
        zIndex: theme.zIndex.appBar,
        mt: `${NAV_GAP_PX}px`,
        displayPrint: 'none',
        // The wrap's side padding is see-through: let clicks reach the page.
        pointerEvents: 'none',
      })}
    >
      <Box
        component="header"
        data-testid="top-nav"
        sx={{
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1.5, sm: 3 },
          minHeight: NAV_HEIGHT_PX,
          boxSizing: 'border-box',
          py: 1,
          pl: { xs: 1.5, sm: 2 },
          pr: 1,
          bgcolor: tokens.color.navGlass,
          backdropFilter: 'blur(14px)',
          border: `1px solid ${tokens.color.rule}`,
          borderRadius: radii.pill,
          color: 'text.primary',
        }}
      >
        <SharedNavBar adminArea={adminArea} />
      </Box>
    </Container>
  );
};
