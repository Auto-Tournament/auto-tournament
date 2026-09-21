# Translating MAT

The UI uses [i18next](https://www.i18next.com/). English is the source; the
other languages are community translations and some of them lag behind.

Languages in the app today: English, French, German, Spanish, Italian,
Portuguese (pt-PT), Polish, Dutch, Simplified Chinese and Norwegian bokmål.
Fixing gaps in one of those is as welcome as adding a new one.

The longer technical write-up is
[i18n and translation](https://docs.sivert.io/docs/mat/developer/i18n-and-translation)
in the docs.

## Adding a language

German (`de`) is used as the example below. Swap in your language code.

### 1. Copy the English files

```bash
cp -r client/src/locales/en client/src/locales/de
cp client/src/locales/brackets-viewer/en.json client/src/locales/brackets-viewer/de.json
```

`client/src/locales/<lang>/translation/` holds one JSON file per area of the app
(`core.json`, `tournament.json`, …) and an `index.ts` that merges them.
`brackets-viewer/<lang>.json` holds the strings for the bracket view.

### 2. Translate the values, not the keys

```json
{
  "dashboard": {
    "title": "Turnier-Dashboard"
  }
}
```

Keys stay in English. Keep `{{placeholders}}` as they are.

### 3. Register the language in `client/src/i18n.ts`

```typescript
import de from './locales/de/translation';
import bracketsViewerDe from './locales/brackets-viewer/de.json';

export const resources = {
  // ...
  de: {
    translation: de,
    bracketsViewer: bracketsViewerDe,
  },
} as const;

// and add the code to supportedLngs
supportedLngs: ['en', /* ... */ 'de'],
```

### 4. Add it to the language switcher

In `client/src/components/common/LanguageSwitcher.tsx`, add an entry to
`LANGUAGES`:

```tsx
{ code: 'de', flagCode: 'DE', label: 'Deutsch' },
```

### 5. Material UI's own strings

Material UI ships translations for its components (tables, date pickers and
so on). If it has one for your language
([list](https://mui.com/material-ui/guides/localization/)), add it to
`getMuiLocale` in `client/src/main.tsx`:

```typescript
import { deDE } from '@mui/material/locale';

if (lang.startsWith('de')) return deDE;
```

### 6. Try it

```bash
yarn dev
```

Open http://localhost:5173, pick your language from the switcher in the top
bar, and click through the main pages: dashboard, teams, players, servers,
matches, tournament creation, the bracket, veto, settings, and the public
player and team pages. Check error messages and form validation too.

Look out for long strings that break the layout (try a long tournament name
and many teams, on a narrow screen), and special characters that don't render.

## Wording

- Use the esports terms players in your language actually use. "Bracket",
  "veto", "Bo3" and "ELO" often stay in English; that's fine.
- Prefer clear over word-for-word.
- Be consistent: the same English term should get the same translation
  everywhere.

## Sending it in

```bash
git checkout -b translate-de
git add client/src/locales/de client/src/locales/brackets-viewer/de.json \
  client/src/i18n.ts client/src/components/common/LanguageSwitcher.tsx client/src/main.tsx
git commit -m "feat(i18n): add German translation"
git push origin translate-de
```

Then open a pull request. Translators are credited in the release notes.

## Help

- Unsure about a term? Open an issue with the **Translation Contribution**
  template and ask.
- Need other people to test? Use the **Community Request** template.
- Language won't load? Open a **Bug Report** or **Question**.
