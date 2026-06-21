export const ALLOWED_FONTS = ['Inter', 'IBM Plex Sans', 'Source Sans 3', 'Roboto', 'Open Sans', 'System UI'] as const

export type FontFamily = typeof ALLOWED_FONTS[number]

export function getGoogleFontsUrl(font: FontFamily): string | null {
  if (font === 'System UI') return null
  const family = font.replace(/ /g, '+')
  return `https://fonts.googleapis.com/css2?family=${family}:wght@400;600;700&display=swap`
}
