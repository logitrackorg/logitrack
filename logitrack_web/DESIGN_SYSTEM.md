# LogiTrack — Design System

Referencia de estilos para mantener consistencia visual en todas las vistas.
Basado en el rediseño del Login (`src/pages/Login.tsx`).

---

## Colores

| Token            | Valor       | Uso                                      |
|------------------|-------------|------------------------------------------|
| Primary          | `#1e3a5f`   | Nav, headers, botones primarios          |
| Primary hover    | `#2563eb`   | Links, focus, botón submit               |
| Primary dark     | `#1d4ed8`   | Hover de botón primario                  |
| Accent           | `#f97316`   | Logo, highlights, acciones destructivas  |
| Background       | `#eff6ff`   | Fondo general de páginas                 |
| Surface          | `#ffffff`   | Cards, modales, paneles                  |
| Border           | `slate-200` | Bordes de inputs, cards, separadores     |
| Text primary     | `gray-900`  | Títulos, texto principal                 |
| Text secondary   | `gray-500`  | Labels, subtítulos, placeholders         |
| Text muted       | `slate-400` | Metadata, timestamps, texto deshabilitado|

---

## Tipografía

- **Fuente**: sistema (heredada, Arial/sans-serif como fallback)
- **Títulos de página**: `text-2xl font-bold text-gray-900 tracking-tight`
- **Subtítulos de sección**: `text-sm font-semibold text-gray-700`
- **Labels de formulario**: `text-sm font-semibold text-gray-700`
- **Texto de tabla**: `text-sm text-gray-700`
- **Metadata / timestamps**: `text-xs text-slate-400`
- **Badges / tags**: `text-[10px] font-semibold`

---

## Componentes

### Inputs
```
w-full h-10 px-4 rounded-xl border border-slate-200 bg-slate-50 text-sm
text-gray-900 placeholder:text-gray-400
focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] focus:bg-white
transition-all
```

### Botón primario
```
h-10 px-4 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] active:bg-[#1e40af]
disabled:opacity-50 disabled:cursor-not-allowed
text-white text-sm font-semibold transition-colors shadow-sm shadow-blue-500/20
```

### Botón secundario (outline)
```
h-10 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50
text-sm font-semibold text-gray-700 transition-colors
```

### Botón ghost / destructivo
```
h-10 px-4 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100
text-sm font-semibold text-red-700 transition-colors
```

### Card / Panel
```
bg-white rounded-2xl border border-slate-200 shadow-sm p-5
```

### Card destacada (info)
```
bg-blue-50 rounded-2xl border border-blue-200 p-4
```

### Tabla
- Wrapper: `overflow-x-auto rounded-2xl border border-slate-200`
- `<table>`: `w-full text-sm border-collapse`
- `<thead>`: `bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider`
- `<th>`: `px-4 py-3 text-left`
- `<td>`: `px-4 py-3 text-gray-700 border-t border-slate-100`
- Row hover: `hover:bg-slate-50 transition-colors cursor-pointer`

### Badge de rol (referencia Login)
```js
const ROLE_STYLES = {
  operator:   "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  supervisor: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  manager:    "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  admin:      "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  driver:     "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
}
// Aplicar: text-[10px] font-semibold px-2 py-0.5 rounded-md
```

### Select
```
h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm text-gray-700
focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb]
transition-all
```

### Modal overlay
```
fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4
```

### Modal container
```
bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4
```

### Alert / Error inline
```
flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3
text-sm text-red-700
```

### Alert / Warning inline
```
flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3
text-sm text-amber-700
```

### Alert / Success inline
```
flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3
text-sm text-emerald-700
```

---

## Layout de páginas internas

```
<div className="p-6 space-y-6">
  {/* Header */}
  <div className="flex items-center justify-between">
    <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Título</h1>
    {/* Acción principal */}
  </div>

  {/* Filtros / toolbar */}
  <div className="flex flex-wrap gap-3">...</div>

  {/* Contenido principal */}
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">...</div>
</div>
```

---

## Iconos

Usar **lucide-react** (ya instalado). Tamaño estándar: `w-4 h-4`.

---

## Espaciado

| Uso                        | Clase Tailwind     |
|----------------------------|--------------------|
| Padding de página          | `p-6`              |
| Gap entre secciones        | `space-y-6`        |
| Gap entre elementos inline | `gap-3`            |
| Padding interno de card    | `p-5`              |
| Border radius card         | `rounded-2xl`      |
| Border radius input/botón  | `rounded-xl`       |
| Border radius badge        | `rounded-md`       |
