/**
 * The tournament page redesign's shared pieces (the 2026-10 drafts): team
 * logos, player avatars, the status hero every format opens with, info tiles,
 * state pills and map tiles. Colours come from the theme tokens only. The
 * pieces live in teamUi, pillsUi and blocksUi; import them from here.
 */
import { PlayerAvatar, playerInitials } from '../../player/PlayerAvatar';

/** The one player picture lives in components/player/PlayerAvatar. */
export { PlayerAvatar, playerInitials };
export * from './teamUi';
export * from './pillsUi';
export * from './blocksUi';
