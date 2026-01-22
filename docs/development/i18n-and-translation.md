## Internationalization & Translation Guide


!!! tip "🌍 Want to contribute a translation?"
    **Quick Start:** Check out [TRANSLATING.md](https://github.com/sivert-io/matchzy-auto-tournament/blob/main/TRANSLATING.md) for a simple 5-step guide.
    
    This page is for developers who want to understand the technical details of the i18n system.

MatchZy Auto Tournament ships with full frontend internationalization (i18n) using **i18next** and **react‑i18next**, plus Material UI’s locale support.

This guide explains:

- **How the i18n system is wired**
- **Where translation files live**
- **How to add a new language**
- **How to update existing translations**

The goal is to make it easy for contributors to translate the UI without touching core logic.

---

### 1. Overview of the i18n Setup

- **Library**: `i18next` + `react-i18next`
- **Browser language detection**: `i18next-browser-languagedetector`
- **Frontend entry**: `client/src/i18n.ts`
- **Provider**: `I18nextProvider` is configured in `client/src/main.tsx`
- **MUI localization**: MUI locale switches along with the active i18n language via `ThemeProvider`
- **Locales directory**: `client/src/locales/`
  - English (default): `client/src/locales/en/translation.json`
  - Simplified Chinese: `client/src/locales/zh-CN/translation.json`

At runtime:

1. `i18n.ts` loads the JSON resources for each language and configures i18next.
2. `main.tsx` wraps the React app in an `I18nextProvider` and a `ThemeProvider` that picks the correct MUI locale (`enUS` / `zhCN`).
3. Components call `const { t } = useTranslation()` and use `t('some.key')` for **all user‑visible text**.
4. A `LanguageSwitcher` component in the main layout lets users switch languages; the choice is persisted (e.g. via `localStorage`).

---

### 2. File Layout & Naming Conventions

All frontend translations live in a single JSON per language:

- `client/src/locales/en/translation.json`
- `client/src/locales/zh-CN/translation.json`

Keys are grouped by **feature / page / component**, for example:

- `layout.*` – global layout and navigation
- `dashboard.*` – dashboard page
- `teamsPage.*`, `playersPage.*`, `serversPage.*` – list pages
- `teamModal.*`, `playerModal.*`, `serverModal.*`, `mapModal.*` – core CRUD modals
- `tournament.*` – tournament creation / live tournament flows
- `eloTemplatesPage.*` – ELO template UI
- `publicLinks.*` – public link descriptions

**Guidelines:**

- Prefer nested namespaces (objects) rather than flat keys.
- Keep the **same key structure** across all languages.
- Use **descriptive keys** (`dashboard.stats.playerDistributionTitle`) instead of embedding English in the key.

---

### 3. How to Add a New Language

#### 3.1. Create a locale file

1. Copy the existing English translation file:

   ```bash
   cp client/src/locales/en/translation.json client/src/locales/<your-locale-code>/translation.json
   ```

   Examples:

   - German: `client/src/locales/de/translation.json`
   - Brazilian Portuguese: `client/src/locales/pt-BR/translation.json`

2. Open your new file and translate **values only**.  
   Do **not** change keys or the overall structure.

#### 3.2. Register the language in `i18n.ts`

1. Open `client/src/i18n.ts`.
2. Add an import for your new JSON resource, similar to:

   ```ts
   import de from './locales/de/translation.json';
   ```

3. Add it to the `resources` object:

   ```ts
   const resources = {
     en: { translation: en },
     'zh-CN': { translation: zhCN },
     de: { translation: de },
   } as const;
   ```

4. If needed, update `supportedLngs` / `fallbackLng` in the i18n config to include your new language code.

#### 3.3. Wire it into the language switcher (optional but recommended)

1. Open `client/src/components/common/LanguageSwitcher.tsx`.
2. Add another `MenuItem` for your locale:

   ```tsx
   <MenuItem value="de">Deutsch</MenuItem>
   ```

3. Ensure the `LanguageSwitcher` uses the same language code you registered in `i18n.ts` (`de`, `pt-BR`, etc.).

Once this is done, rebuilding the frontend will make your language selectable and persisted.

---

### 4. How to Update Existing Translations

#### 4.1. Find the key in code

In a React component, user‑visible strings should **already** be wrapped in `t()`:

```tsx
const { t } = useTranslation();

<Typography variant="h6">
  {t('dashboard.title')}
</Typography>
```

If you see a **hardcoded English string** instead:

1. Replace it with a translation key:

   ```tsx
   <Typography variant="h6">
     {t('dashboard.title')}
   </Typography>
   ```

2. Add `dashboard.title` to each locale JSON (see below).

#### 4.2. Edit the locale JSON

1. Open `client/src/locales/en/translation.json` and locate the relevant section (e.g. `"dashboard"`).
2. Add or update the key:

   ```json
   "dashboard": {
     "title": "Tournament Dashboard",
     ...
   }
   ```

3. Open `client/src/locales/zh-CN/translation.json` (and any other locales) and add the **same key** with the translated value:

   ```json
   "dashboard": {
     "title": "锦标赛控制面板",
     ...
   }
   ```

4. Run the frontend and verify in each language.

---

### 5. Pluralization & Interpolation

We use **i18next’s standard pluralization and interpolation**.

#### 5.1. Interpolation

Example in code:

```tsx
t('serversPage.allocation.nextPass', { count: nextPassInSeconds });
```

English JSON:

```json
"serversPage": {
  "allocation": {
    "nextPass": "Next allocator pass in ~{{count}}s"
  }
}
```

The `{{count}}` placeholder is replaced with the provided `count` value.

#### 5.2. Pluralization

For count‑dependent labels, define `one` / `other`:

```json
"teamsPage": {
  "playersCount": {
    "one": "{{count}} player",
    "other": "{{count}} players"
  }
}
```

Usage in code:

```tsx
t('teamsPage.playersCount', { count: team.players?.length ?? 0 });
```

**Important:** Keep the plural keys (`one`, `other`, etc.) in **every** locale file for the same base key.

---

### 6. MUI Localization (Dates, Tables, Built‑in Text)

Material UI’s own texts (pagination labels, date pickers, etc.) are localized via MUI locale objects:

- `@mui/material/locale` – e.g. `enUS`, `zhCN`
- In `client/src/main.tsx`, the theme is created with:

  ```ts
  const getMuiLocale = (lang: string) => {
    if (lang.startsWith('zh')) return zhCN;
    return enUS;
  };
  ```

To support your language **fully**, you may:

1. Import another MUI locale (if available), e.g. `deDE` for German.
2. Extend `getMuiLocale` to map your i18n language code to the correct MUI locale object.

If a MUI locale does not exist for your language, the UI will still work; only some built‑in component texts will remain in English.

---

### 7. Translation Workflow for Contributors

1. **Pick a language** you want to add or improve.
2. **Sync main** and create a branch:

   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/translate-<locale>
   ```

3. **Add or update** the locale JSON under `client/src/locales/`.
4. Register your language in `client/src/i18n.ts` and (optionally) `LanguageSwitcher`.
5. **Run the frontend**:

   ```bash
   cd client
   yarn dev
   ```

6. Manually verify:
   - Switch to your language via the in‑app language switcher.
   - Walk through all major pages: Dashboard, Teams, Players, Servers, Tournament creation, Matches, Templates, ELO Templates, Settings, Dev Tools, Public Links.
7. **Commit** your changes with a clear message (e.g. `Add: de locale`).
8. **Open a PR**, briefly describing:
   - Which language you added or updated
   - Which areas of the UI you validated

---

### 8. Translation Quality Guidelines

- Aim for **clear, professional UI wording** rather than literal translations.
- Prefer terminology familiar to CS / esports admins (e.g. “Bracket”, “Best of 3”, “ELO”, “Skill Rating”).
- Keep tone consistent across pages (we use a friendly but professional voice).
- When in doubt, **favor clarity** over strict brevity.

If you’re unsure about a term (e.g. how to translate “Skill Rating” vs “ELO”), feel free to open a Draft PR or Discussion so we can align terminology across languages.


