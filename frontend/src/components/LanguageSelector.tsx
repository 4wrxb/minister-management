import { useTranslation } from 'react-i18next';

type LanguageCode = 'en' | 'ko' | 'zh' | 'tr' | 'ar' | 'rr';

interface LanguageOption {
  code: LanguageCode;
  isoCode: string;
  emoji?: string;
}

const languageOptions: LanguageOption[] = [
  { code: 'en', isoCode: 'en', emoji: '🇬🇧' },
  { code: 'ko', isoCode: 'ko', emoji: '🇰🇷' },
  { code: 'zh', isoCode: 'zh', emoji: '🇨🇳' },
  { code: 'tr', isoCode: 'tr', emoji: '🇹🇷' },
  { code: 'ar', isoCode: 'ar', emoji: '🇸🇦' },
  { code: 'rr', isoCode: 'rr', emoji: '🦖' },
];

const fallbackNativeNames: Record<LanguageCode, string> = {
  en: 'English',
  ko: '한국어',
  zh: '中文',
  tr: 'Türkçe',
  ar: 'العربية',
  rr: 'Rawr',
};

function getStandardLanguageLabel(option: LanguageOption): string {
  const fallbackNativeName = fallbackNativeNames[option.code];
  if (option.code === 'rr') {
    return `${option.emoji} ${option.isoCode} - ${fallbackNativeName}`;
  }

  try {
    const nativeName = new Intl.DisplayNames([option.code], { type: 'language' }).of(option.code) ?? fallbackNativeName;
    const emojiPrefix = option.emoji ? `${option.emoji} ` : '';
    return `${emojiPrefix}${option.isoCode} - ${nativeName}`;
  } catch {
    const emojiPrefix = option.emoji ? `${option.emoji} ` : '';
    return `${emojiPrefix}${option.isoCode} - ${fallbackNativeName}`;
  }
}

function normalizeLanguageCode(input: string): LanguageCode {
  const base = input.toLowerCase().split('-')[0];
  if (base === 'en' || base === 'ko' || base === 'zh' || base === 'tr' || base === 'ar' || base === 'rr') {
    return base;
  }
  return 'en';
}

export default function LanguageSelector() {
  const { i18n } = useTranslation();
  const selectedLanguage = normalizeLanguageCode(i18n.resolvedLanguage || i18n.language);

  const handleLanguageChange = (langCode: LanguageCode) => {
    void i18n.changeLanguage(langCode);
    document.documentElement.dir = langCode === 'ar' ? 'rtl' : 'ltr';
  };

  return (
    <div className="flex items-center justify-end">
      <label htmlFor="language-select" className="sr-only">Language</label>
      <select
        id="language-select"
        value={selectedLanguage}
        onChange={(event) => handleLanguageChange(event.target.value as LanguageCode)}
        className="min-w-[290px] max-w-full rounded-lg border border-theme-border bg-dark-card px-3 py-2 text-sm text-theme-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
        aria-label="Language selector"
      >
        {languageOptions.map((option) => (
          <option key={option.code} value={option.code}>
            {getStandardLanguageLabel(option)}
          </option>
        ))}
      </select>
    </div>
  );
}
