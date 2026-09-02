import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  highContrast: boolean;
  largeText: boolean;
  toggleTheme: () => void;
  toggleHighContrast: () => void;
  toggleLargeText: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('gtext:theme') as Theme) || 'dark');
  const [highContrast, setHighContrast] = useState(() => localStorage.getItem('gtext:contrast') === '1');
  const [largeText, setLargeText] = useState(() => localStorage.getItem('gtext:largeText') === '1');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.contrast = highContrast ? 'high' : 'normal';
    document.documentElement.dataset.text = largeText ? 'large' : 'normal';
    localStorage.setItem('gtext:theme', theme);
    localStorage.setItem('gtext:contrast', highContrast ? '1' : '0');
    localStorage.setItem('gtext:largeText', largeText ? '1' : '0');
  }, [theme, highContrast, largeText]);

  const value = useMemo(
    () => ({
      theme,
      highContrast,
      largeText,
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      toggleHighContrast: () => setHighContrast((v) => !v),
      toggleLargeText: () => setLargeText((v) => !v),
    }),
    [theme, highContrast, largeText]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
