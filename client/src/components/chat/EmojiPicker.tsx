/**
 * The chat composer's emoji button: a small panel with a search, the ones
 * used lately and every category. Arrow keys move through the grid, Enter
 * picks, Escape closes; the composer gets its focus back either way.
 */
import React, {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import { Box, IconButton, InputBase, Popover, Typography } from '@mui/material';
import { SmileyIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { radii, textSize, tokens } from '../../theme/tokens';
import { EMOJI_CATEGORIES, pushRecent, searchEmoji, type Emoji } from './emojiData';
import { panelSx } from '../../components/common/ui';

const { color } = tokens;
const RECENT_KEY = 'chat.recentEmoji';
const COLUMNS = 8;

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecent(recent: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // No storage (private window): recent stays for this visit only.
  }
}

export function EmojiPicker({
  onPick,
  onClose,
  disabled,
}: {
  onPick: (char: string) => void;
  /** After the panel closes (the composer takes its focus back). */
  onClose?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(readRecent);
  const gridRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => {
    if (query.trim()) return [{ id: 'results', emoji: searchEmoji(query) }];
    const recentEmoji: Emoji[] = recent.map((char) => ({ char, words: '' }));
    return [
      ...(recentEmoji.length > 0 ? [{ id: 'recent', emoji: recentEmoji }] : []),
      ...EMOJI_CATEGORIES,
    ];
  }, [query, recent]);

  const close = () => {
    setAnchor(null);
    setQuery('');
    onClose?.();
  };

  const pick = (char: string) => {
    const next = pushRecent(recent, char);
    setRecent(next);
    saveRecent(next);
    onPick(char);
    close();
  };
  // The grids are memoised: they get a stable function that calls the latest `pick`.
  const latestPick = useRef(pick);
  useLayoutEffect(() => {
    latestPick.current = pick;
  });
  const pickRef = useCallback((char: string) => latestPick.current(char), []);

  // Arrow keys move between the emoji buttons, a row at a time up and down.
  const onGridKey = (event: React.KeyboardEvent) => {
    const buttons = Array.from(
      gridRef.current?.querySelectorAll<ComponentRef<'button'>>('button[data-emoji]') ?? []
    );
    const at = buttons.indexOf(document.activeElement as ComponentRef<'button'>);
    if (at < 0) return;
    const step =
      event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowDown'
            ? COLUMNS
            : event.key === 'ArrowUp'
              ? -COLUMNS
              : 0;
    if (!step) return;
    event.preventDefault();
    const next = Math.min(buttons.length - 1, Math.max(0, at + step));
    buttons[next]?.focus();
  };

  const firstButton = () =>
    gridRef.current?.querySelector<ComponentRef<'button'>>('button[data-emoji]')?.focus();

  return (
    <>
      <IconButton
        aria-label={t('chat.emoji.open')}
        aria-haspopup="dialog"
        aria-expanded={anchor ? true : undefined}
        data-testid="chat-emoji"
        disabled={disabled}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ width: 40, height: 40, borderRadius: radii.md, color: color.ink2 }}
      >
        <SmileyIcon size={22} />
      </IconButton>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': t('chat.emoji.title'),
            sx: {
              ...panelSx,
              width: 336,
              maxWidth: 'calc(100vw - 24px)',
            },
          } as object,
        }}
      >
        <Box sx={{ p: 1.25, borderBottom: `1px solid ${color.rule}` }}>
          <InputBase
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                firstButton();
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                const first = sections[0]?.emoji[0];
                if (first) pick(first.char);
              }
            }}
            placeholder={t('chat.emoji.search')}
            inputProps={{
              'aria-label': t('chat.emoji.search'),
              'data-testid': 'chat-emoji-search',
            }}
            sx={{
              width: '100%',
              px: 1.25,
              py: 0.5,
              borderRadius: radii.md,
              border: `1px solid ${color.rule}`,
              bgcolor: color.paper,
              fontSize: textSize.sm,
            }}
          />
        </Box>
        <Box
          ref={gridRef}
          onKeyDown={onGridKey}
          sx={{
            maxHeight: 300,
            overflowY: 'auto',
            p: 1,
            // One rule for every emoji button: ~450 MUI buttons with their own styles and
            // ripples made the panel slow to open and to type into.
            '& .emoji-grid': {
              display: 'grid',
              gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
            },
            '& .emoji': {
              aspectRatio: '1 / 1',
              fontSize: '1.375rem',
              lineHeight: 1,
              border: 0,
              padding: 0,
              background: 'none',
              color: 'inherit',
              cursor: 'pointer',
              borderRadius: radii.sm,
            },
            '& .emoji:hover, & .emoji:focus-visible': { bgcolor: color.paper3 },
            '& .emoji:focus-visible': { outline: `2px solid ${color.accent}` },
          }}
        >
          {sections.map((section) => (
            <Box key={section.id} sx={{ mb: 1 }}>
              <Typography
                sx={{
                  px: 0.5,
                  pb: 0.5,
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: color.muted,
                }}
              >
                {t(`chat.emoji.categories.${section.id}`)}
              </Typography>
              {section.emoji.length === 0 ? (
                <Typography sx={{ px: 0.5, fontSize: textSize.sm, color: color.muted }}>
                  {t('chat.emoji.none')}
                </Typography>
              ) : (
                <EmojiGrid sectionId={section.id} emoji={section.emoji} onPick={pickRef} />
              )}
            </Box>
          ))}
        </Box>
      </Popover>
    </>
  );
}

/** One section's emoji as plain buttons (styled by the grid's one rule), rendered once. */
const EmojiGrid = memo(function EmojiGrid({
  sectionId,
  emoji,
  onPick,
}: {
  sectionId: string;
  emoji: Emoji[];
  onPick: (char: string) => void;
}) {
  return (
    <div className="emoji-grid">
      {emoji.map((e) => {
        const name = e.words.split(' ')[0];
        return (
          <button
            type="button"
            className="emoji"
            key={`${sectionId}-${e.char}`}
            data-emoji={e.char}
            title={name || undefined}
            aria-label={name || e.char}
            onClick={() => onPick(e.char)}
          >
            {e.char}
          </button>
        );
      })}
    </div>
  );
});
