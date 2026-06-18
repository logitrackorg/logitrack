# Sprint 5 — User Stories: Thiago

> Área: Personalización visual + Dashboard + Pulido UX  
> Formato: Justificación + Comportamiento esperado (estilo del equipo)

---

## Tema: Personalización visual (white-label)

---

### US-5.8.1 — Vista previa de colores con indicador de contraste

**Prioridad**: 🟡 Should Have | **SP**: 3  
**Tipo**: Frontend | **Dependencias**: Ninguna

#### Justificación

El panel de `OrganizationConfig` permite cambiar colores pero no hay forma de ver el resultado sin aplicarlo a toda la plataforma. Si el admin elige combinaciones ilegibles, lo descubre tarde. Sprint Review 4: "contraste de la letra → A a / color de organización. Visualización de demo de colores sobre texto."

#### Comportamiento esperado

- Al modificar `primary_color`, `accent_color` o `sidebar_color`, un **mockup estático de UI** se actualiza en tiempo real mostrando: barra lateral, botón primario, badge de estado, tarjeta con texto.
- El mockup **no modifica el tema global** hasta que el admin guarda.
- Debajo de cada color en la preview se muestra el **ratio de contraste** contra texto blanco y negro (fórmula WCAG 2.1) con badge ✓ AA, ★ AAA, o ✗ No cumple.
- Layout desktop: formulario izquierda, preview derecha (~40%). Mobile: apilado.

#### Notas técnicas

- **Modificar**: `pages/OrganizationConfig.tsx`
- **Nuevo**: `components/ThemePreview.tsx`, `utils/contrast.ts`
- `OrganizationThemeContext.tsx` ya inyecta CSS custom properties — solo falta el preview visual aislado
- No requiere backend

---

### US-5.8.2 — Paletas de colores predefinidas

**Prioridad**: 🟢 Medio | **SP**: 1  
**Tipo**: Frontend | **Dependencias**: US-5.8.1 (comparte el mockup)

#### Justificación

No todos los admins saben elegir combinaciones de colores. Ofrecer paletas curadas acelera el onboarding de nuevas empresas y evita resultados desprolijos.

#### Comportamiento esperado

- Debajo de los inputs de color, una fila de **paletas sugeridas** (LogiTrack, Profesional, Cálido, Naturaleza, Moderno, Clásico) mostradas como 3 círculos de color con el nombre.
- Al hacer clic en una paleta, los 3 inputs de color se actualizan simultáneamente y la preview (US-5.8.1) refleja el cambio.
- La paleta activa tiene un borde destacado.

#### Notas técnicas

- **Modificar**: `pages/OrganizationConfig.tsx` — agregar sección debajo de los inputs
- Las paletas son constantes hardcodeadas, no requieren API

---

### US-5.8.3 — Selector de tipografía

**Prioridad**: 🟡 Should Have | **SP**: 3  
**Tipo**: Frontend + mini backend | **Dependencias**: Columna `font_family` en `organization_config`

#### Justificación

Sprint Review 4: "Personalización de tipografías". Hoy la plataforma usa una fuente fija. Distintas empresas tienen distintas identidades visuales — poder elegir la tipografía cierra el círculo de white-label.

#### Comportamiento esperado

- Selector de **familia tipográfica** con opciones: Inter (default), Roboto, System UI, Montserrat, Lato, Open Sans.
- La preview (US-5.8.1) muestra el texto de ejemplo con la fuente seleccionada.
- Al guardar, se persiste en `organization_config.font_family` y se inyecta como `--font-family` en `:root` aplicándose a toda la plataforma (dashboard, tablas, formularios, /track, driver app).
- Las fuentes se cargan desde Google Fonts con `<link>` dinámico al guardar.

#### Notas técnicas

- **Modificar**: `pages/OrganizationConfig.tsx` — agregar selector
- **Modificar**: `context/OrganizationThemeContext.tsx` — inyectar `--font-family`
- **Migration**: `ALTER TABLE organization_config ADD COLUMN font_family TEXT DEFAULT 'Inter'` (la puede hacer Mauri)
- **API**: `PATCH /organization` debe aceptar `font_family` (Mauri)

---

## Tema: Dashboard

---

### US-5.5 — Panel de métricas configurable

**Prioridad**: 🔴 Must Have | **SP**: 5  
**Tipo**: Frontend | **Dependencias**: Ninguna

#### Justificación

Con 12 tabs el dashboard es visualmente denso. Cada supervisor/gerente tiene focos distintos. Sprint Review 4: "Mostrar tabs por usuario, configurables". Propuesta de Amín.

#### Comportamiento esperado

- Botón ⚙ **"Configurar panel"** en el dashboard (visible solo para supervisor/manager). Abre drawer lateral con toggle por métrica.
- 4 métricas **mandatorias** con toggle bloqueado ON + badge "Obligatorio": Choferes, Reclamos, Facturación, Fatiga.
- Al desactivar una métrica, su tab no se renderiza. La configuración persiste en localStorage por usuario.
- Default: todas visibles. URL a tab oculta redirige a la primera visible.

#### Notas técnicas

- **Modificar**: `pages/DashboardHost.tsx`
- **Nuevo**: `components/DashboardConfigDrawer.tsx`, `hooks/useDashboardConfig.ts`

---

### US-5.4 — Métricas de reclamos en dashboard

**Prioridad**: 🔴 Must Have | **SP**: 5  
**Tipo**: Frontend | **Dependencias**: `GET /api/v1/claims/stats` (Mauri)

#### Justificación

El PO pidió que el dashboard contabilice métricas de reclamos con foco en origen (chatbot vs formulario) y calidad de resolución. Hoy `ReclamosTab.tsx` muestra incidents, no claims.

#### Comportamiento esperado

- Tab "Reclamos" con KPIs: Total, Abiertos, Tiempo promedio resolución, Tasa 1ª derivación.
- Gráfico de barras: distribución por tipo (7 tipos).
- Gráfico de torta: origen (chatbot vs formulario).
- Gráfico de barras: distribución por prioridad (se oculta si el backend no devuelve el dato).
- Filtrado por fecha/sucursal del dashboard. Estado vacío sin errores.

#### Notas técnicas

- **Modificar**: `pages/reports/ReclamosTab.tsx`
- **Nuevo**: `api/claimStats.ts`

---

## Tema: Pulido UX por página

---

### US-5.UX1 — Consistencia visual: tablas, dark mode, nav/footer

**Prioridad**: 🔴 Must Have | **SP**: 5  
**Tipo**: Frontend | **Dependencias**: Ninguna

#### Justificación

"Que se note menos que lo hicimos con Claude" — la app funciona pero las tablas tienen distinto espaciado según la página, el modo oscuro está roto en algunas secciones, y hay páginas sin footer. La demo son 2 minutos: cada pantalla debe verse profesional.

#### Comportamiento esperado

- **Tablas unificadas** en Envíos, Reclamos, Flota, Usuarios y Sucursales: mismo espaciado, tamaño de fuente, estilos de badge, chip y fila.
- **Modo oscuro verificado** en cada página: sin fondos blancos duros, textos ilegibles ni bordes invisibles.
- **Nav y footer** presentes en absolutamente todas las páginas.
- **Estados vacíos** unificados: mismo componente "Sin datos" con ícono y mensaje en todas las listas.
- **Loadings** unificados: mismo spinner/skeleton.
- **Toasts de error** unificados: mismo color, posición, duración.
- **Responsive**: todas las páginas funcionales en ≥360px. Tablas con scroll horizontal.

#### Notas técnicas

- Revisar ~15 páginas: Login, Dashboard, ShipmentList/Detail/New, Claims, Routing, VehicleList, BranchList, AdminUsers, OrganizationConfig, DriverRoute, PublicTracking, NotificationsPage, Perfil
- Checklist en el PR

---

### US-5.UX2 — /track: rediseño visual

**Prioridad**: 🔴 Must Have | **SP**: 3  
**Tipo**: Frontend | **Dependencias**: US-5.8.3 (tipografía) para heredar `--font-family`

#### Justificación

Clase 02/06: "Actualizar visual de /track". Es la carta de presentación al cliente final y debe reflejar el white-label de la organización.

#### Comportamiento esperado

- Header con logo de la organización (si cargado) o "LogiTrack" default.
- Timeline de eventos con ícono por estado. Badges con colores del tema.
- Tarjeta limpia con datos del envío: tracking ID, origen, destino, fecha estimada.
- Responsive mobile-first. Modo oscuro funcional.
- Sin regresiones: chatbot y auth dentro de /track siguen funcionando.

#### Notas técnicas

- **Modificar**: `pages/PublicTracking.tsx`
- Usar `GET /api/v1/public/branding` para colores y logo

---

## Resumen para Jira

| US | Título | Prio | SP |
|----|--------|------|-----|
| US-5.8.1 | Vista previa de colores con contraste WCAG | 🟡 Should | 3 |
| US-5.8.2 | Paletas de colores predefinidas | 🟢 Medio | 1 |
| US-5.8.3 | Selector de tipografía | 🟡 Should | 3 |
| US-5.5 | Panel de métricas configurable | 🔴 Must | 5 |
| US-5.4 | Métricas de reclamos en dashboard | 🔴 Must | 5 |
| US-5.UX1 | Consistencia visual: tablas, dark mode, nav/footer, empty/loading/error states | 🔴 Must | 5 |
| US-5.UX2 | /track: rediseño visual | 🔴 Must | 3 |

**Total**: 25 SP — 7 US.

### Orden

1. US-5.UX1 (5 SP) — arrancar con la auditoría de consistencia
2. US-5.8.1 + US-5.8.2 (4 SP) — personalización visual en paralelo
3. US-5.UX2 (3 SP) — /track
4. US-5.8.3 (3 SP) — tipografía (necesita migration de Mauri)
5. US-5.5 (5 SP) — panel configurable
6. US-5.4 (5 SP) — métricas reclamos (espera endpoint de Mauri)
