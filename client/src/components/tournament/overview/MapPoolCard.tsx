import { useState, type SyntheticEvent } from 'react';
import { Box, ButtonBase, Dialog, IconButton, Typography } from '@mui/material';
import { ArrowRightIcon, XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { getMapData, getMapDisplayName, getMapIconUrl } from '../../../constants/maps';
import { tokens, fontDisplay, radii } from '../../../theme/tokens';

const { color } = tokens;

/** A map's icon on a dark tile; the name is its tooltip and alt text. */
function MapIconTile({ map, size }: { map: string; size: number }) {
  const name = getMapDisplayName(map);
  return (
    <Box
      component="span"
      title={name}
      sx={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '10px',
        bgcolor: color.paper3,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <Box
        component="img"
        src={getMapIconUrl(map)}
        alt={name}
        loading="lazy"
        sx={{ width: size * 0.66, height: size * 0.66, display: 'block' }}
        onError={(event: SyntheticEvent<HTMLImageElement>) => {
          event.currentTarget.style.visibility = 'hidden';
        }}
      />
    </Box>
  );
}

/**
 * The map pool as one row of map icons; it opens a dialog with each map's
 * picture and name. The row is all the overview needs to say: which maps.
 */
export function MapPoolCard({ maps }: { maps: string[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (maps.length === 0) return null;

  return (
    <>
      <ButtonBase
        onClick={() => setOpen(true)}
        data-testid="overview-map-pool"
        aria-haspopup="dialog"
        sx={{
          width: '100%',
          minHeight: 68,
          px: 2.5,
          py: 1.75,
          borderRadius: radii.lg,
          bgcolor: color.paper2,
          border: `1px solid ${color.rule}`,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          textAlign: 'left',
          '&:hover': { borderColor: color.muted },
          '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
        }}
      >
        <Typography sx={{ fontFamily: fontDisplay, fontSize: '1.125rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {t('overviewPage.mapPool')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, minWidth: 0, overflow: 'hidden' }}>
          {maps.map((map) => (
            <MapIconTile key={map} map={map} size={36} />
          ))}
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', color: color.ink2 }} aria-hidden>
          <ArrowRightIcon size={18} />
        </Box>
      </ButtonBase>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="md"
        fullWidth
        aria-labelledby="map-pool-title"
        PaperProps={{ sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' } }}
      >
        <Box sx={{ p: { xs: 2.5, md: 3.5 }, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
            <Typography
              id="map-pool-title"
              component="h2"
              sx={{ fontFamily: fontDisplay, fontSize: '1.5rem', fontWeight: 600 }}
            >
              {t('overviewPage.mapPoolCount', { count: maps.length })}
            </Typography>
            <IconButton aria-label={t('common.close')} onClick={() => setOpen(false)}>
              <XIcon size={20} />
            </IconButton>
          </Box>
          <Box
            data-testid="map-pool-dialog-maps"
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
              gap: 1.5,
            }}
          >
            {maps.map((map) => {
              const data = getMapData(map);
              return (
                <Box
                  key={map}
                  sx={{ borderRadius: '16px', overflow: 'hidden', bgcolor: color.paper3, display: 'flex', flexDirection: 'column' }}
                >
                  {data?.thumbnail ? (
                    <Box
                      component="img"
                      src={data.thumbnail}
                      alt=""
                      loading="lazy"
                      sx={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <Box sx={{ width: '100%', aspectRatio: '16 / 9', bgcolor: color.rule }} />
                  )}
                  <Box sx={{ px: 1.5, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    <Box
                      component="img"
                      src={getMapIconUrl(map)}
                      alt=""
                      sx={{ width: 22, height: 22, display: 'block' }}
                      onError={(event: SyntheticEvent<HTMLImageElement>) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                    <Typography sx={{ fontWeight: 600 }}>{getMapDisplayName(map)}</Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
          <Typography sx={{ fontSize: '0.875rem', color: color.muted }}>
            {t('overviewPage.mapPoolNote')}
          </Typography>
        </Box>
      </Dialog>
    </>
  );
}
