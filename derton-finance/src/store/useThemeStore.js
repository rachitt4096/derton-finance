import { create } from 'zustand'

const THEME_KEY = 'derton-theme-v3'
const DEFAULT_THEME = 'dark'
const ALLOWED_THEMES = new Set(['dark', 'light', 'warm'])

const getInitialTheme = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME
  }

  const stored = localStorage.getItem(THEME_KEY)
  return stored && ALLOWED_THEMES.has(stored) ? stored : DEFAULT_THEME
}

const useThemeStore = create((set) => ({
  theme: getInitialTheme(),
  setTheme: (theme) => {
    const nextTheme = ALLOWED_THEMES.has(theme) ? theme : DEFAULT_THEME
    if (typeof window !== 'undefined') {
      localStorage.setItem(THEME_KEY, nextTheme)
    }
    set({ theme: nextTheme })
  },
}))

export default useThemeStore
