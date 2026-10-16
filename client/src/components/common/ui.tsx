import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box, { type BoxProps } from '@mui/material/Box';
import Chip, { type ChipProps } from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Switch, { type SwitchProps } from '@mui/material/Switch';
import type { Breakpoint, SxProps, Theme } from '@mui/material/styles';
import { tokens, fontDisplay, fontMono, mono, radii, textSize } from '../../theme/tokens';

/**
 * Small building blocks shared by the restyled views. They mirror the product
 * cards on autotournament.gg (website src/components/ui.tsx) and the page
 * patterns of the 3.0 drafts (website/drafts/platform/app.css and the pages'
 * own styles): `PageHead`, `SectionHead`, `Panel`, `RowList` / `Row` and
 * `FactGrid`. Game modules get them through the module SDK.
 */

const { color, radius, ease, duration } = tokens;

/** One entry of an `sx` array: a style object, a theme function or `false`. */
type SxItem = Extract<SxProps<Theme>, ReadonlyArray<unknown>>[number];

/** `sx` may be an object, a function or an array; spread it after our own. */
function sxList(sx: SxProps<Theme> | undefined): SxItem[] {
  if (sx === undefined) return [];
  return Array.isArray(sx) ? [...(sx as ReadonlyArray<SxItem>)] : [sx as SxItem];
}

// ---------------------------------------------------------------------------
// Page and section heads
// ---------------------------------------------------------------------------

export type PageHeadProps = {
  /** The page's one H1. */
  title: React.ReactNode;
  /** Small line above the title: a game mark and a link back, a tournament name. */
  eyebrow?: React.ReactNode;
  /** Muted line under the title. */
  subtitle?: React.ReactNode;
  /** Buttons on the right; they wrap under the title on a narrow screen. */
  actions?: React.ReactNode;
  /** `id` on the H1, for `aria-labelledby`. */
  titleId?: string;
  sx?: SxProps<Theme>;
  'data-testid'?: string;
};

/**
 * The top of a page (the drafts' `.head`): eyebrow, H1 at `--text-3xl` and
 * subtitle on the left, actions on the right, bottom-aligned.
 */
export function PageHead({
  title,
  eyebrow,
  subtitle,
  actions,
  titleId,
  sx,
  ...rest
}: PageHeadProps) {
  return (
    <Box
      data-testid={rest['data-testid']}
      sx={[
        {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 2,
          flexWrap: 'wrap',
          mb: 4,
        },
        ...sxList(sx),
      ]}
    >
      <Box sx={{ minWidth: 0 }}>
        {eyebrow && (
          <Box
            component="p"
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.45rem',
              m: 0,
              mb: 1,
              fontSize: textSize.xs,
              color: color.ink2,
            }}
          >
            {eyebrow}
          </Box>
        )}
        <Typography variant="h1" id={titleId}>
          {title}
        </Typography>
        {subtitle && (
          <Typography component="p" sx={{ mt: 1, fontSize: textSize.sm, color: color.muted }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{actions}</Box>}
    </Box>
  );
}

export type SectionHeadProps = {
  title: React.ReactNode;
  /** `id` on the heading, for the section's `aria-labelledby`. */
  id?: string;
  /** 2 (default): a page section, 22px. 3: a card's title, 18px. */
  level?: 2 | 3;
  /** A quiet link on the right ("All", "History", "Open"). */
  link?: { to: string; label: React.ReactNode; 'data-testid'?: string };
  /** Anything else on the right, instead of `link`. */
  action?: React.ReactNode;
  /** A muted line on the right ("12 teams", "Final"), when there is no link or action. */
  note?: React.ReactNode;
  sx?: SxProps<Theme>;
};

/**
 * A section's title row (the drafts' `.sec-head`): the heading on the left and
 * a quiet muted link on the right, on one baseline.
 */
export function SectionHead({ title, id, level = 2, link, action, note, sx }: SectionHeadProps) {
  return (
    <Box
      sx={[
        {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 1,
          columnGap: 2,
          mb: 2,
          minWidth: 0,
        },
        ...sxList(sx),
      ]}
    >
      <Typography
        component={level === 2 ? 'h2' : 'h3'}
        id={id}
        sx={{
          m: 0,
          fontFamily: fontDisplay,
          fontWeight: 700,
          fontSize: level === 2 ? '1.25rem' : '1.125rem',
          letterSpacing: '-0.015em',
          lineHeight: 1.25,
        }}
      >
        {title}
      </Typography>
      {link ? (
        <Link
          component={RouterLink}
          to={link.to}
          underline="none"
          data-testid={link['data-testid']}
          sx={{
            color: color.muted,
            fontSize: textSize.sm,
            whiteSpace: 'nowrap',
            '&:hover': { color: color.ink },
          }}
        >
          {link.label}
        </Link>
      ) : action ? (
        action
      ) : note ? (
        <Typography component="span" sx={{ fontSize: textSize.sm, color: color.muted }}>
          {note}
        </Typography>
      ) : null}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * The one surface every page uses (the 3.0 drafts' `.panel`): paper-2 and the
 * large radius, no border. `panelSx` has no padding (a list or a table fills
 * it); `panelPaddedSx` is the padded section: its children in a column, 16 px
 * apart (24 px from the edge, 16 on phones).
 */
export const panelSx = {
  bgcolor: color.paper2,
  borderRadius: radii.lg,
} as const;

export const panelPaddedSx = {
  ...panelSx,
  p: { xs: 2, sm: 3 },
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
} as const;

/** A hairline round a panel, for the few that sit on paper-2 themselves. */
export const panelBorderSx = { border: `1px solid ${color.rule}` } as const;

/** A dialog's paper: the panel surface, without MUI's elevation overlay. */
export const dialogPaperSx = { ...panelSx, backgroundImage: 'none' } as const;

export type PanelProps = BoxProps & {
  /** The padded section look (children in a column). Off: no padding, for a list or a table. */
  padded?: boolean;
  /** A hairline border (a panel on a paper-2 background). */
  bordered?: boolean;
};

/**
 * The one panel. `padded` for a section of content (title, text, controls);
 * without, it is a bare surface for a `RowList panel={false}`, a table or
 * anything that brings its own padding. Takes every `Box` prop, `component`
 * included.
 */
export function Panel({ padded = false, bordered = false, sx, ...props }: PanelProps) {
  return (
    <Box
      {...props}
      sx={[padded ? panelPaddedSx : panelSx, bordered ? panelBorderSx : {}, ...sxList(sx)]}
    />
  );
}

export type RowListProps = BoxProps & {
  /** Draw the list as a panel (default). `false` for a list inside a padded card. */
  panel?: boolean;
};

/**
 * Rows split by rules (the drafts' `.row-list`), by default in one panel
 * (`.row-list.panel`). A `ul`; put `Row`s in it.
 */
export function RowList({ panel = true, sx, ...props }: RowListProps) {
  return (
    <Box
      component="ul"
      {...props}
      sx={[
        {
          listStyle: 'none',
          m: 0,
          p: 0,
          '& > li + li': { borderTop: `1px solid ${color.rule}` },
        },
        panel ? panelSx : {},
        ...sxList(sx),
      ]}
    />
  );
}

export type RowProps = BoxProps & {
  /**
   * `grid-template-columns` for the row, per breakpoint if needed
   * (`{ xs: 'auto minmax(0, 1fr)', md: 'auto minmax(0, 1fr) auto' }`).
   * Without it the row is a wrapping flex row.
   */
  columns?: string | Partial<Record<Breakpoint, string>>;
};

/** One row of a `RowList`: an `li` padded 16px × 24px, items centred with a 16px gap. */
export function Row({ columns, sx, ...props }: RowProps) {
  return (
    <Box
      component="li"
      {...props}
      sx={[
        {
          display: columns ? 'grid' : 'flex',
          alignItems: 'center',
          gap: 2,
          px: 3,
          py: 2,
          minWidth: 0,
        },
        columns ? { gridTemplateColumns: columns } : { flexWrap: 'wrap' },
        ...sxList(sx),
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Joined stat / fact grid
// ---------------------------------------------------------------------------

export type Fact = {
  /** Mono caption (`dt`), e.g. "LIVE", "Format". */
  label: React.ReactNode;
  /** The value (`dd`): a number for `stat`, a short text for `fact`. */
  value: React.ReactNode;
  /** React key; defaults to the index. */
  key?: React.Key;
  'data-testid'?: string;
};

export type FactGridProps = {
  items: Fact[];
  /**
   * `stat` (default): big display-face numbers (Manage's status strip, the
   * profile's stats). `fact`: plain medium-weight text (the tournament's
   * "How it's played").
   */
  variant?: 'stat' | 'fact';
  /** Narrowest cell before the grid drops a column. Default 150px (`stat`) or 170px (`fact`). */
  minCellWidth?: number;
  sx?: SxProps<Theme>;
  'aria-label'?: string;
  'data-testid'?: string;
};

/**
 * Cells joined into one bordered grid with shared rules (the drafts'
 * `dl.status`, `dl.stats` and `dl.facts-grid`). A `dl`: each value is a `dd`
 * under its `dt` label, so numbers are not headings.
 */
export function FactGrid({ items, variant = 'stat', minCellWidth, sx, ...rest }: FactGridProps) {
  const min = minCellWidth ?? (variant === 'stat' ? 150 : 170);
  return (
    <Box
      component="dl"
      aria-label={rest['aria-label']}
      data-testid={rest['data-testid']}
      sx={[
        {
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}px), 1fr))`,
          border: `1px solid ${color.rule}`,
          borderRadius: radii.lg,
          overflow: 'hidden',
          m: 0,
        },
        ...sxList(sx),
      ]}
    >
      {items.map((item, index) => (
        <Box
          key={item.key ?? index}
          data-testid={item['data-testid']}
          sx={{
            px: 3,
            py: 2,
            borderRight: `1px solid ${color.rule}`,
            borderBottom: `1px solid ${color.rule}`,
            margin: '0 -1px -1px 0',
            minWidth: 0,
          }}
        >
          <Box
            component="dt"
            sx={{
              fontFamily: fontMono,
              fontSize: textSize.xs,
              fontWeight: variant === 'stat' ? 500 : 400,
              lineHeight: 1.4,
              color: color.muted,
            }}
          >
            {item.label}
          </Box>
          <Box
            component="dd"
            sx={[
              { m: 0, mt: 0.5 },
              variant === 'stat'
                ? {
                    fontFamily: fontDisplay,
                    fontSize: textSize.xl,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    fontVariantNumeric: 'tabular-nums',
                  }
                : { fontWeight: 500 },
            ]}
          >
            {item.value}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** Card title row: display-face title on the left, a chip or action on the right. */
export function CardHead({
  title,
  tag,
  sx,
}: {
  title: React.ReactNode;
  tag?: React.ReactNode;
  sx?: BoxProps['sx'];
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 1.5,
        mb: 2,
        minWidth: 0,
        ...(sx as object),
      }}
    >
      <Box sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: '1rem', minWidth: 0 }}>
        {title}
      </Box>
      {tag}
    </Box>
  );
}

/** Mono chip with a green dot, for anything that is live right now. */
export function LiveChip({
  label,
  sx,
  ...props
}: Omit<ChipProps, 'label'> & { label: React.ReactNode }) {
  return (
    <Chip
      size="small"
      label={label}
      {...props}
      sx={{
        color: color.live,
        backgroundColor: color.paper3,
        '&::before': {
          content: '""',
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: color.live,
          ml: 1,
          flex: 'none',
        },
        ...(sx as object),
      }}
    />
  );
}

export type StatusDotState = 'live' | 'loading' | 'free' | 'done' | 'error' | 'warning';

const dotColor: Record<StatusDotState, string> = {
  live: color.live,
  loading: color.accent,
  free: color.muted,
  done: color.ink2,
  error: color.ban,
  warning: color.warning,
};

/** 9px status dot: live green, loading orange, free muted. */
export function StatusDot({
  state,
  size = 9,
  sx,
}: {
  state: StatusDotState;
  size?: number;
  sx?: BoxProps['sx'];
}) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        display: 'inline-block',
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
        bgcolor: dotColor[state],
        boxShadow: state === 'live' ? `0 0 0 3px ${color.paper3}, 0 0 10px ${color.live}` : 'none',
        transition: `background-color ${duration.base}ms ${ease.out}`,
        ...(sx as object),
      }}
    />
  );
}

/** Stat tile: big mono value over a small muted label, on paper3. */
export function StatTile({
  value,
  label,
  accent,
  size = 'md',
  sx,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  accent?: string;
  /** `lg` for page-level stat rows, `md` inside cards. */
  size?: 'md' | 'lg';
  sx?: BoxProps['sx'];
}) {
  return (
    <Box
      sx={{
        bgcolor: color.paper3,
        borderRadius: `${radius.sm}px`,
        p: size === 'lg' ? 2 : 1.5,
        minWidth: 0,
        ...(sx as object),
      }}
    >
      <Box
        sx={{
          ...mono,
          fontWeight: 600,
          fontSize: size === 'lg' ? '1.625rem' : '1.125rem',
          lineHeight: 1.2,
          color: accent ?? color.ink,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Box>
      <Box
        sx={{
          color: color.muted,
          fontSize: size === 'lg' ? '0.8125rem' : '0.75rem',
          mt: size === 'lg' ? 0.5 : 0,
        }}
      >
        {label}
      </Box>
    </Box>
  );
}

/** Small mono label used above groups (round names, section captions). */
export const sectionLabelSx = {
  ...mono,
  fontSize: '0.75rem',
  color: color.muted,
} as const;

/** Inset row on paper3, as used for server rows and veto map rows. */
export const insetRowSx = {
  bgcolor: color.paper3,
  borderRadius: `${radius.md}px`,
} as const;

export type EmptyPanelProps = {
  title: React.ReactNode;
  description: React.ReactNode;
  /** Buttons or links under the text. */
  children?: React.ReactNode;
  /** Heading level of the title; 2 (default) directly under a page's H1. */
  level?: 2 | 3;
  'data-testid'?: string;
};

/**
 * Nothing to show yet: a quiet panel with a title, one line and maybe an
 * action. The 3.0 empty state, in place of the 2.x big-icon card.
 */
export function EmptyPanel({ title, description, children, level = 2, ...rest }: EmptyPanelProps) {
  return (
    <Panel
      role="status"
      data-testid={rest['data-testid']}
      sx={{ p: { xs: 3, md: 4 }, display: 'grid', gap: 1 }}
    >
      <Typography variant="h6" component={level === 2 ? 'h2' : 'h3'}>
        {title}
      </Typography>
      <Typography sx={{ color: color.muted, fontSize: textSize.sm, maxWidth: '60ch' }}>
        {description}
      </Typography>
      {children && <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>{children}</Box>}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// SwitchRow
// ---------------------------------------------------------------------------

export type SwitchRowProps = Omit<SwitchProps, 'sx'> & {
  /** The setting, as a sentence. */
  label: React.ReactNode;
  /** A line under it: what it does. */
  help?: React.ReactNode;
  /** The row's own style (the switch takes `switchSx`). */
  sx?: SxProps<Theme>;
  switchSx?: SxProps<Theme>;
  'data-testid'?: string;
};

/**
 * One setting with a switch (the drafts' `.tglrow`): the sentence on the left,
 * its help under it, the switch on the right. Every on/off setting uses this;
 * the label is the switch's label, so clicking it toggles. Takes every
 * `Switch` prop (`checked`, `onChange(event, checked)`, `disabled`, `inputProps`…).
 */
export function SwitchRow({
  label,
  help,
  sx,
  switchSx,
  id,
  'data-testid': testId,
  ...switchProps
}: SwitchRowProps) {
  const autoId = React.useId();
  const inputId = id ?? `switch-${autoId}`;
  const helpId = help ? `${inputId}-help` : undefined;
  return (
    <Box
      data-testid={testId}
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          minWidth: 0,
        },
        ...sxList(sx),
      ]}
    >
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Typography
          component="label"
          htmlFor={inputId}
          sx={{
            cursor: switchProps.disabled ? 'default' : 'pointer',
            color: switchProps.disabled ? color.muted : color.ink,
          }}
        >
          {label}
        </Typography>
        {help && (
          <Typography id={helpId} variant="body2" sx={{ color: color.ink2 }}>
            {help}
          </Typography>
        )}
      </Box>
      <Switch
        id={inputId}
        {...switchProps}
        slotProps={{
          ...switchProps.slotProps,
          input: {
            ...(helpId ? { 'aria-describedby': helpId } : {}),
            ...(switchProps.slotProps?.input as object | undefined),
          },
        }}
        sx={[{ flexShrink: 0 }, ...sxList(switchSx)]}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// FormField
// ---------------------------------------------------------------------------

export type FormFieldProps = {
  label: React.ReactNode;
  /** The control's id: the label is its <label>. Without, the label is a plain span (give `labelId` for aria-labelledby). */
  htmlFor?: string;
  labelId?: string;
  /** A line under the control. */
  help?: React.ReactNode;
  /**
   * `stack` (default): label, control, help, top to bottom (the wizard's fields).
   * `side`: the label on the left at `labelWidth`, the control on the right; stacks on phones.
   */
  layout?: 'stack' | 'side';
  labelWidth?: number;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
};

/** A labelled control. Every form uses this instead of its own Field / Row / Setting. */
export function FormField({
  label,
  htmlFor,
  labelId,
  help,
  layout = 'stack',
  labelWidth = 200,
  children,
  sx,
}: FormFieldProps) {
  const labelEl = (
    <Typography
      component={htmlFor ? 'label' : 'span'}
      id={labelId}
      htmlFor={htmlFor}
      variant="body2"
      sx={{ fontWeight: 600, color: color.ink }}
    >
      {label}
    </Typography>
  );
  const helpEl = help ? (
    <Typography variant="body2" sx={{ color: color.ink2 }}>
      {help}
    </Typography>
  ) : null;
  if (layout === 'side') {
    return (
      <Box
        sx={[
          {
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: `${labelWidth}px minmax(0, 1fr)` },
            columnGap: 1.5,
            rowGap: 0.75,
            alignItems: 'center',
            minWidth: 0,
          },
          ...sxList(sx),
        ]}
      >
        {labelEl}
        <Box sx={{ minWidth: 0 }}>{children}</Box>
        {helpEl && <Box sx={{ gridColumn: { sm: 2 } }}>{helpEl}</Box>}
      </Box>
    );
  }
  return (
    <Box sx={[{ display: 'grid', gap: 1.25, minWidth: 0 }, ...sxList(sx)]}>
      {labelEl}
      {children}
      {helpEl}
    </Box>
  );
}
