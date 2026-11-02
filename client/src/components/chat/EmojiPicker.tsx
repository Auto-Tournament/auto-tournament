import { EmojiPicker as AtEmojiPicker } from '@auto-tournament/ui';
import { useTranslation } from 'react-i18next';

/** The design system's emoji picker, in our translations. */
export function useEmojiLabels() {
  const { t } = useTranslation();
  return {
    open: t('chat.emoji.open'),
    title: t('chat.emoji.title'),
    search: t('chat.emoji.search'),
    none: t('chat.emoji.none'),
    category: (id: string) => t(`chat.emoji.categories.${id}`),
  };
}

export function EmojiPicker(props: Omit<Parameters<typeof AtEmojiPicker>[0], 'labels'>) {
  const labels = useEmojiLabels();
  return <AtEmojiPicker labels={labels} {...props} />;
}
