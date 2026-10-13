import { Box } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { tokens, radii, textSize } from '../../theme/tokens';

const { color } = tokens;

export interface PageTab {
  key: string;
  label: string;
  to: string;
}

/**
 * Two or three admin pages that are one place, as tabs under its head
 * (Templates | Ratings, Played | Import). Each tab is its own address.
 */
export function PageTabs({ tabs, label }: { tabs: PageTab[]; label: string }) {
  const { pathname } = useLocation();
  return (
    <Box
      component="nav"
      aria-label={label}
      sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 3 }}
    >
      {tabs.map((tab) => {
        const selected = pathname === tab.to;
        return (
          <Box
            key={tab.key}
            component={RouterLink}
            to={tab.to}
            data-testid={`page-tab-${tab.key}`}
            aria-current={selected ? 'page' : undefined}
            sx={{
              px: 1.5,
              py: 0.75,
              borderRadius: radii.pill,
              border: `1px solid ${selected ? color.ink2 : color.rule}`,
              bgcolor: selected ? color.paper2 : 'transparent',
              color: selected ? color.ink : color.ink2,
              textDecoration: 'none',
              fontSize: textSize.sm,
              whiteSpace: 'nowrap',
              '&:hover': { color: color.ink, bgcolor: color.paper2 },
              '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
            }}
          >
            {tab.label}
          </Box>
        );
      })}
    </Box>
  );
}
