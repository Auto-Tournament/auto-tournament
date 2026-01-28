# 🌍 Translation Guide

**Help translate MatchZy Auto Tournament into your language!**

We use **i18next** for internationalization and welcome translations from the community.

## 🚀 Quick Start (5 Steps)

### 1. Copy the English translation file

```bash
# Example for German
cp client/src/locales/en/translation.json client/src/locales/de/translation.json

# Example for Brazilian Portuguese  
cp client/src/locales/en/translation.json client/src/locales/pt-BR/translation.json

# Example for Spanish
cp client/src/locales/en/translation.json client/src/locales/es/translation.json
```

### 2. Translate the values (NOT the keys!)

Open your new file and translate **only the values**, keeping the structure identical:

```json
{
  "dashboard": {
    "title": "Tournament Dashboard"  ← Translate this value
  }
}
```

**Important:** Keep all keys in English! Only change the text values.

### 3. Register your language in `client/src/i18n.ts`

```typescript
// Add import at the top
import de from './locales/de/translation.json';

// Add to resources
export const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
  de: { translation: de },  // ← Add your language
} as const;

// Update supportedLngs
supportedLngs: ['en', 'zh-CN', 'de'],  // ← Add your language code
```

### 4. Add to the language switcher

Edit `client/src/components/common/LanguageSwitcher.tsx`:

```tsx
<MenuItem value="de">Deutsch</MenuItem>
```

### 5. Test it!

```bash
cd client
yarn dev
```

Then:
1. Open http://localhost:3069
2. Find the language switcher in the top navigation
3. Select your language
4. Walk through the major pages to verify everything looks good

## 📋 Translation Coverage Checklist

Make sure to translate all these areas:

- [ ] Navigation & Layout
- [ ] Dashboard page
- [ ] Teams page
- [ ] Players page  
- [ ] Servers page
- [ ] Matches page
- [ ] Tournament creation flow (5 steps)
- [ ] Tournament live view
- [ ] Bracket viewer
- [ ] Settings page
- [ ] Templates (Tournament, ELO, Manual Match)
- [ ] Veto process
- [ ] Player profile (public page)
- [ ] Team page (public page)
- [ ] Error messages
- [ ] Form validations
- [ ] Buttons and actions

## 🎯 Translation Guidelines

### Keep CS/Esports Terms Consistent
- "Bracket" → Use common esports term in your language
- "Best of 3 (BO3)" → Translate or keep abbreviation based on local practice
- "ELO" / "Skill Rating" → These are often kept in English
- "Veto" → Common CS term, may stay in English or have local equivalent

### Be Clear & Professional
- Use friendly but professional tone
- Prefer clarity over strict word-for-word translation
- Stay consistent with gaming terminology

### Test on Real Content
- Don't just look at the JSON file
- Actually run the app and test with:
  - Long tournament names
  - Many teams
  - Different screen sizes

### Check Special Characters
- Ensure your language's special characters display correctly
- Test with real data (team names, player names, etc.)

## 📚 Advanced: MUI Locale Support

Material UI has built-in translations for common components (date pickers, tables, etc.).

If MUI supports your language, add it to `client/src/main.tsx`:

```typescript
import { deDE } from '@mui/material/locale';

const getMuiLocale = (lang: string) => {
  if (lang.startsWith('zh')) return zhCN;
  if (lang.startsWith('de')) return deDE;  // ← Add your MUI locale
  return enUS;
};
```

**Check available MUI locales:** https://mui.com/material-ui/guides/localization/

## ❓ Need Help?

### Terminology Questions
Open an issue using the "Translation Contribution" template and ask! We want terminology to be consistent and make sense to your language's gaming community.

### Testing Help
Need multiple people to test something? Use the "Community Request" issue template.

### Technical Issues
Can't get your language to load? Open a "Question" or "Bug Report" issue.

## 📖 Full Documentation

For detailed technical information, see:
**[Development → i18n and Translation](https://docs.sivert.io/docs/mat/developer/i18n-and-translation)**

## 🎉 Contributing Your Translation

Once you're happy with your translation:

1. **Create a branch:**
   ```bash
   git checkout -b feature/translate-de
   ```

2. **Commit your changes:**
   ```bash
   git add client/src/locales/de/
   git add client/src/i18n.ts
   git add client/src/components/common/LanguageSwitcher.tsx
   git commit -m "Add: German (de) translation"
   ```

3. **Push and create a PR:**
   ```bash
   git push origin feature/translate-de
   ```
   
4. **Open a Pull Request** and use the "Translation Contribution" issue template to provide details.

## 🏆 Recognition

All translation contributors will be:
- Credited in the project
- Listed in release notes
- Appreciated by the community! 🌍

---

## 🌐 Currently Supported Languages

- 🇬🇧 English (en) - Complete
- 🇨🇳 Simplified Chinese (zh-CN) - Complete

**Want to see your language here? Start translating!** 🚀
