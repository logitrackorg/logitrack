export interface Palette {
  name: string;
  primary_color: string;
  accent_color: string;
  sidebar_color: string;
}

export const PALETTES: Palette[] = [
  { name: 'LogiTrack', primary_color: '#2563eb', accent_color: '#f97316', sidebar_color: '#1e3a5f' },
  { name: 'Profesional', primary_color: '#1e40af', accent_color: '#0ea5e9', sidebar_color: '#0f172a' },
  { name: 'Cálido', primary_color: '#c2410c', accent_color: '#d97706', sidebar_color: '#451a03' },
  { name: 'Naturaleza', primary_color: '#0d9488', accent_color: '#14b8a6', sidebar_color: '#134e4a' },
  { name: 'Moderno', primary_color: '#7c3aed', accent_color: '#ec4899', sidebar_color: '#1e1b4b' },
  { name: 'Clásico', primary_color: '#475569', accent_color: '#64748b', sidebar_color: '#1e293b' },
];
