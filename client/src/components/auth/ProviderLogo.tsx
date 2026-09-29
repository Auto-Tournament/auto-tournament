import type { ComponentType } from 'react';
import {
  DiscordLogoIcon,
  GithubLogoIcon,
  GoogleLogoIcon,
  SteamLogoIcon,
  TwitchLogoIcon,
  type IconProps,
} from '@phosphor-icons/react';

/**
 * Sign-in providers' marks, from Phosphor. A provider Phosphor has no logo for
 * (Epic Games, Keycloak) has none: its button is text only.
 */
const PROVIDER_LOGOS: Record<string, ComponentType<IconProps>> = {
  steam: SteamLogoIcon,
  discord: DiscordLogoIcon,
  github: GithubLogoIcon,
  google: GoogleLogoIcon,
  twitch: TwitchLogoIcon,
};

export function hasProviderLogo(id: string): boolean {
  return id in PROVIDER_LOGOS;
}

/** The provider's logo, or nothing when Phosphor has none. Decorative: the label names the provider. */
export function ProviderLogo({ id, size = 20 }: { id: string; size?: number | string }) {
  const Logo = PROVIDER_LOGOS[id];
  return Logo ? <Logo size={size} weight="fill" aria-hidden /> : null;
}
