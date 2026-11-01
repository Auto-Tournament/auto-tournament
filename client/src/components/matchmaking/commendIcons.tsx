import {
  BombIcon,
  ClockCountdownIcon,
  CrownSimpleIcon,
  DotsThreeIcon,
  GraduationCapIcon,
  HandPalmIcon,
  HandWavingIcon,
  HandshakeIcon,
  MicrophoneIcon,
  SkullIcon,
  SmileyMehIcon,
  UsersThreeIcon,
  type Icon,
} from '@phosphor-icons/react';

/** Each commend type's icon, positive and negative. */
export const COMMEND_ICONS: Record<string, Icon> = {
  friendly: HandWavingIcon,
  team_player: UsersThreeIcon,
  leader: CrownSimpleIcon,
  good_comms: MicrophoneIcon,
  teacher: GraduationCapIcon,
  good_sport: HandshakeIcon,
  toxic: SkullIcon,
  griefing: BombIcon,
  unhelpful: SmileyMehIcon,
  bad_sport: HandPalmIcon,
  afk: ClockCountdownIcon,
  other: DotsThreeIcon,
};
