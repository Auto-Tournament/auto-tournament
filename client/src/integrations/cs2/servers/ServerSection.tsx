/**
 * A section of the Servers page that folds: a header (title, a one-line
 * summary, the section's action) that opens and closes it, and inside, a short
 * "what is this" line and the section itself. Open or closed is remembered per
 * browser (localStorage), so an admin who works in one section keeps it open.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Box, ButtonBase, Collapse, Stack, Typography } from '@mui/material';
import { CaretDownIcon } from '@phosphor-icons/react';

export interface ServerSectionProps {
  /** Stable id: the anchor (`#id`) and the remembered open state. */
  id: string;
  title: ReactNode;
  /** One line shown in the header, open or closed (e.g. "1 machine · online"). */
  summary?: ReactNode;
  /** Shown inside, above the content: what the section is for, in a sentence. */
  about?: ReactNode;
  /** A button on the right of the header (e.g. "Add machine"). */
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  'data-testid'?: string;
}

const storageKey = (id: string) => `servers-section-${id}`;

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(storageKey(id));
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export function ServerSection({
  id,
  title,
  summary,
  about,
  action,
  defaultOpen = false,
  children,
  ...rest
}: ServerSectionProps) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const contentId = useId();

  // A link to #id (e.g. "see Automatic scaling") opens the section.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [id]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(storageKey(id), next ? '1' : '0');
    } catch {
      // Not remembered; fine.
    }
  };

  return (
    <Box
      component="section"
      id={id}
      mt={3}
      data-testid={rest['data-testid']}
      sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}
    >
      <Stack direction="row" alignItems="center" gap={2}>
        <ButtonBase
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          data-testid={`${id}-toggle`}
          sx={{
            flex: 1,
            minWidth: 0,
            justifyContent: 'flex-start',
            textAlign: 'left',
            borderRadius: 1,
            py: 0.5,
          }}
        >
          <CaretDownIcon
            size={18}
            aria-hidden
            style={{
              flex: 'none',
              transform: open ? 'none' : 'rotate(-90deg)',
              transition: 'transform 150ms',
            }}
          />
          <Box sx={{ ml: 1, minWidth: 0 }}>
            <Typography component="h2" variant="h6" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
              {title}
            </Typography>
            {summary && (
              <Typography variant="body2" color="text.secondary" noWrap>
                {summary}
              </Typography>
            )}
          </Box>
        </ButtonBase>
        {action && <Box sx={{ flex: 'none' }}>{action}</Box>}
      </Stack>
      <Collapse in={open} id={contentId} unmountOnExit={false}>
        <Box pt={2}>
          {about && (
            <Typography variant="body2" color="text.secondary" mb={2}>
              {about}
            </Typography>
          )}
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}
