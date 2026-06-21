import { getWCAGLevel } from '../utils/contrast';

interface ThemePreviewProps {
  primaryColor?: string;
  accentColor?: string;
  sidebarColor?: string;
}

function ContrastBadge({ bg, fg }: { bg: string; fg: string }) {
  let level: 'AAA' | 'AA' | 'FAIL';
  try {
    level = getWCAGLevel(fg, bg);
  } catch {
    level = 'FAIL';
  }

  if (level === 'AAA') {
    return <span className="text-xs mt-1 text-amber-500">★ AAA</span>;
  }
  if (level === 'AA') {
    return <span className="text-xs mt-1 text-green-600">✓ AA</span>;
  }
  return <span className="text-xs mt-1 text-red-500">✗</span>;
}

export function ThemePreview({
  primaryColor = '#2563eb',
  accentColor = '#f97316',
  sidebarColor = '#1e3a5f',
}: ThemePreviewProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
      {/* Section 1 — Sidebar */}
      <div className="flex flex-col gap-2">
        <div
          data-testid="preview-sidebar"
          className="rounded p-3"
          style={{ backgroundColor: sidebarColor, color: '#ffffff' }}
        >
          <div className="text-sm font-semibold mb-2">Navegación</div>
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 w-3/4 rounded bg-white/20" />
            <div className="h-1.5 w-2/3 rounded bg-white/20" />
            <div className="h-1.5 w-1/2 rounded bg-white/20" />
          </div>
        </div>
        <ContrastBadge bg={sidebarColor} fg="#ffffff" />
      </div>

      {/* Section 2 — Button */}
      <div className="flex flex-col gap-2">
        <button
          data-testid="preview-button"
          className="rounded px-4 py-2 text-white font-medium w-fit"
          style={{ backgroundColor: primaryColor, color: '#ffffff' }}
        >
          Acción principal
        </button>
        <ContrastBadge bg={primaryColor} fg="#ffffff" />
      </div>

      {/* Section 3 — Badge */}
      <div className="flex flex-col gap-2">
        <span
          data-testid="preview-badge"
          className="rounded-full px-3 py-1 text-white text-sm font-medium w-fit inline-block"
          style={{ backgroundColor: accentColor, color: '#ffffff' }}
        >
          Activo
        </span>
        <ContrastBadge bg={accentColor} fg="#ffffff" />
      </div>

      {/* Section 4 — Card */}
      <div className="flex flex-col gap-2">
        <div
          data-testid="preview-card"
          className="rounded p-3 border bg-white"
        >
          <div className="font-semibold text-base mb-1" style={{ color: '#1e3a8f' }}>
            Título de sección
          </div>
          <div className="text-sm" style={{ color: '#6b7280' }}>
            Texto descriptivo
          </div>
        </div>
        <ContrastBadge bg="#ffffff" fg="#1e3a8f" />
      </div>
    </div>
  );
}
