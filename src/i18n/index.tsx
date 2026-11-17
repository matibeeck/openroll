import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { en, type Messages } from './en';
import { es } from './es';

export type Lang = 'en' | 'es';
const dictionaries: Record<Lang, Messages> = { en, es };

export function detectLang(): Lang {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
  if (q === 'en' || q === 'es') return q;
  try {
    const saved = localStorage.getItem('openroll.lang');
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export type TFn = (key: keyof Messages, vars?: Record<string, string | number>) => string;

interface I18n {
  lang: Lang;
  setLang(l: Lang): void;
  t: TFn;
}

const Ctx = createContext<I18n | null>(null);

export function makeT(lang: Lang): TFn {
  return (key, vars) => {
    let s: string = dictionaries[lang][key] ?? en[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial ?? detectLang());
  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang(l) {
        setLangState(l);
        try {
          localStorage.setItem('openroll.lang', l);
        } catch {
          /* storage unavailable */
        }
        document.documentElement.lang = l;
      },
      t: makeT(lang),
    }),
    [lang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
