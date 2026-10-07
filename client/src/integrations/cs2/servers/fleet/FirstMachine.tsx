import type { ReactNode } from 'react';
import { useState } from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { ExternalLink, fontDisplay, radii, StatusDot, tokens, useModuleTranslation } from '../../../../module-sdk';
import { platformIsPlainHttp } from '../insecureLink';
import { CommandBox, type LinkInfo } from './FleetDialogs';

const { color } = tokens;

function Step({ n, active, title, children }: { n: number; active: boolean; title: string; children: ReactNode }) {
  return (
    <Box sx={{ p: 2.75, borderRadius: radii.lg, bgcolor: color.paper2, border: `1px solid ${active ? color.accent : color.rule}`, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: radii.pill,
          display: 'grid',
          placeItems: 'center',
          fontFamily: fontDisplay,
          fontWeight: 700,
          ...(active ? { bgcolor: color.accent, color: color.accentInk } : { border: `1px solid ${color.rule}`, color: color.ink2 }),
        }}
      >
        {n}
      </Box>
      <Typography fontWeight={600}>{title}</Typography>
      {children}
    </Box>
  );
}

/**
 * The page before there is a machine: name it, run one command on it, and it
 * shows up. The command stays here until csm connects (creating the code adds
 * the machine, not yet linked, which must not swap this for the list).
 */
export function FirstMachine({
  link,
  busy,
  onCreate,
}: {
  link: LinkInfo | null;
  busy: boolean;
  onCreate: (name: string) => void;
}) {
  const { t, i18n } = useModuleTranslation('cs2');
  const [name, setName] = useState('');
  return (
    <Box data-testid="machines-empty" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
        <Step n={1} active={!link} title={t('machinesPanel.step.name', { defaultValue: 'Name the machine' })}>
          <Stack gap={1.25}>
            <TextField
              size="small"
              label={t('machinesPanel.name', { defaultValue: 'Name (optional)' })}
              value={name}
              onChange={(e) => setName(e.target.value)}
              inputProps={{ maxLength: 100 }}
            />
            <Button variant="contained" disabled={busy || !!link} onClick={() => onCreate(name.trim())} data-testid="machines-create-code">
              {t('machinesPanel.getCommand', { defaultValue: 'Get the command' })}
            </Button>
          </Stack>
        </Step>
        <Step n={2} active={!!link} title={t('machinesPanel.step.run', { defaultValue: 'Run this on it' })}>
          {link ? (
            <>
              <CommandBox command={link.command} testId="machines-link-command" />
              <Typography variant="caption" color="text.secondary">
                {t('machinesPanel.linkHelp', {
                  defaultValue: 'Run it on the machine as the user that runs csm (not root). The code works once and until {{time}}.',
                  time: new Date(link.expiresAt * 1000).toLocaleString(i18n.language),
                })}
              </Typography>
              {platformIsPlainHttp() && (
                <Typography variant="caption" color="warning.main" data-testid="machines-insecure-note">
                  {t('machinesPanel.insecureNote', {
                    defaultValue: 'This site is on plain http://, so the command has --insecure and the token travels unencrypted. Serve the platform over https:// if you can.',
                  })}
                </Typography>
              )}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('machinesPanel.step.runHelp', { defaultValue: 'One command, shown here once you have named the machine.' })}
            </Typography>
          )}
        </Step>
        <Step n={3} active={false} title={t('machinesPanel.step.appears', { defaultValue: 'It shows up here' })}>
          <Stack direction="row" gap={1.25} alignItems="center">
            <StatusDot state={link ? 'loading' : 'free'} />
            <Typography variant="body2" color="text.secondary">
              {link
                ? t('machinesPanel.linkWaiting', { defaultValue: 'Waiting for the machine to connect…' })
                : t('machinesPanel.step.appearsHelp', { defaultValue: 'Then add servers to it with one click.' })}
            </Typography>
          </Stack>
        </Step>
      </Box>
      <Box sx={{ p: 2.75, borderRadius: radii.lg, border: `1px dashed ${color.rule}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography fontWeight={600}>{t('machinesPanel.noCsm', { defaultValue: 'No csm on the machine yet?' })}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('machinesPanel.noCsmHelp', { defaultValue: 'Install CS2 Server Manager first, then come back for step 2.' })}
          </Typography>
        </Box>
        <ExternalLink href="https://docs.autotournament.gg/cs2/server-manager/install">
          {t('machinesPanel.installGuide', { defaultValue: 'Install guide' })}
        </ExternalLink>
      </Box>
    </Box>
  );
}
