# Trazabilidad de Anotaciones → Código

> Generado: 13/06/2026 — Branch: `develop`  
> Fuentes: NotebookLM (4 cuadernos) + exploración de código

---

## Leyenda

| Símbolo | Significado |
|---------|-------------|
| ✅ COMPLETO | Implementado y funcional en código |
| 🔄 PARCIAL | Implementado parcialmente o con limitaciones conocidas |
| ❌ PENDIENTE | No implementado — requiere trabajo |
| ⚠️ DESCARTADO | Decisión explícita de no implementar |
| 🔵 WIP | Work in progress, existe pero incompleto |

| Prioridad | Significado |
|-----------|-------------|
| 🔴 **CRÍTICO** | Bloqueante para demo/jurado — debe estar sí o sí |
| 🟡 **ALTO** | Muy importante — hacer si hay tiempo |
| 🟢 **MEDIO** | Valor visible pero no bloqueante |
| ⚪ **BAJO** | Se puede descartar sin impacto grave |
| ✅ | Ya completado |

---

## 1. Sprint 5 — Must Have

### 1.1 Tickets de reclamos inter-sucursal

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| 🔴 | Transferir ticket entre sucursales | ❌ PENDIENTE | El sistema actual deriva por **categoría/área** (operaciones, comercial, etc.), no por sucursal. No existe endpoint de transferencia inter-sucursal. |
| 🔴 | Dropdown de sucursal destino | ❌ PENDIENTE | `handler/claim_handler.go` — `UpdateClaimCategory` usa categorías, no sucursales |
| 🔴 | Comentario obligatorio al transferir | ❌ PENDIENTE | No hay campo de motivo de transferencia |
| 🔴 | Notificación a sucursal receptora | ❌ PENDIENTE | Depende de la funcionalidad de transferencia |
| 🔴 | Estado `derivado` | 🔄 PARCIAL | Existe estado `derived` pero es por categoría, no por sucursal. `model/claim.go` |
| 🔴 | Aceptar/rechazar transferencia | ❌ PENDIENTE | No hay endpoint de accept/reject para sucursal destino |
| 🔴 | Historial de transferencias en `claim_events` | 🔄 PARCIAL | `ClaimEvent` con `ClaimCategoryUpdatedPayload` existe. Falta payload para transferencia. `model/claim_event.go` |
| 🟡 | Bloquear transferencia en estado `resuelto` | ❌ PENDIENTE | Validación no existe |

**Archivos clave**: `model/claim.go`, `service/claim.go`, `handler/claim_handler.go`, `model/claim_event.go`, `repository/postgres_claim.go`

---

### 1.2 Prioridad de reclamos

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| 🔴 | Niveles: urgente, alta, media, baja | ❌ PENDIENTE | `Claim` struct **no tiene campo `priority`**. `model/claim.go` |
| 🔴 | Asignación automática por criterios | ❌ PENDIENTE | No existe lógica de asignación. |
| 🔴 | Urgente: envío extraviado/daño total, SLA vencido | ❌ PENDIENTE | — |
| 🔴 | Alta: score prioridad ≥ 0.65, 3er intento fallido, extraviado | ❌ PENDIENTE | — |
| 🔴 | Media: score 0.35–0.65, demorado, no entregado | ❌ PENDIENTE | — |
| 🔴 | Baja: consultas, info incorrecta, otros | ❌ PENDIENTE | — |
| 🔴 | Regla anti-inflación: máx 20% urgentes por sucursal | ❌ PENDIENTE | — |
| 🟡 | Tope configurable por admin | ❌ PENDIENTE | — |
| 🟡 | Nota automática "tope de urgentes" | ❌ PENDIENTE | — |

**Nota**: El sistema ya tiene `ml.PriorityResult` para shipments. Se puede reutilizar el motor ML para claims.

---

### 1.3 Chatbot guiado de reclamos (árbol de decisión)

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| 🔴 | Chatbot con pre-filtro sí/no | 🔄 PARCIAL | Chatbot existe (`ChatbotWidget.tsx`, 1022 líneas) con flujo US-4 (responder) y US-5 (crear reclamo). Pero **no tiene árbol de decisión** — va directo al formulario. |
| 🔴 | Árbol de delay (fecha estimada → estado actual → sucursal) | ❌ PENDIENTE | No existe |
| 🔴 | Árbol de not_delivered (entregado? → vecinos? → foto) | ❌ PENDIENTE | No existe |
| 🟡 | Árbol de damage (daño visible → interior → fotos) | ❌ PENDIENTE | No existe |
| 🟡 | Árbol de bad_treatment (chofer/sucursal) | ❌ PENDIENTE | No existe |
| 🟢 | Árbol de wrong_data (dirección/nombre/remitente) | ❌ PENDIENTE | No existe |
| 🟢 | Árbol de other (envío específico?) | ❌ PENDIENTE | No existe |
| 🔴 | Cierre sin ticket con mensaje informativo | ❌ PENDIENTE | Solo existe "cancelar" genérico |
| 🔴 | Pre-llenado de formulario | ❌ PENDIENTE | No existe |
| 🔴 | Validación automática de estado del envío | ❌ PENDIENTE | El chatbot consulta API pero no usa la respuesta para guiar |
| 🔴 | "Chatbot antes de accionable" (PO feedback) | ❌ PENDIENTE | El chatbot actual abre formulario directo |

**Archivos clave**: `handler/chatbot_handler.go` (896 líneas), `components/chatbot/ChatbotWidget.tsx` (1022 líneas)

---

### 1.4 Métricas de reclamos en dashboard

| Prioridad | Requisito | Estado | US | Código |
|-----------|-----------|--------|--------|
| 🔴 | Total de reclamos (período) | 🔄 PARCIAL | `Claims.tsx` calcula métricas **client-side**. No hay endpoint dedicado. |
| 🔴 | Reclamos vía chatbot (`is_automatic=true`) | ❌ PENDIENTE | No existe campo `is_automatic` en Claim |
| 🔴 | Reclamos vía formulario (`is_automatic=false`) | ❌ PENDIENTE | — |
| 🔴 | Reclamos abiertos | 🔄 PARCIAL | Cliente-side en `Claims.tsx` |
| 🔴 | Tiempo promedio de resolución | ❌ PENDIENTE | — |
| 🟡 | Tasa de resolución en 1ª derivación | ❌ PENDIENTE | — |
| 🔴 | Distribución por tipo | 🔄 PARCIAL | `ReclamosTab.tsx` tiene type breakdown pero usa incidents, no claims |
| 🔴 | Distribución por prioridad | ❌ PENDIENTE | Depende de #1.2 |
| 🟡 | Usuarios únicos en /track | ❌ PENDIENTE | No hay tracking de sesiones públicas |
| 🟡 | Árbol de decisión del chatbot utilizado | ❌ PENDIENTE | Depende de #1.3 |
| 🟡 | Consultas resueltas sin reclamo | ❌ PENDIENTE | Depende de #1.3 |

**Se necesita**: `GET /api/v1/claims/stats` endpoint en backend.

---

### 1.5 Panel de métricas configurable

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| 🔴 | Botón "Configurar panel" en dashboard | ❌ PENDIENTE | `DashboardHost.tsx` tiene 12 tabs **hardcodeados**, sin mecanismo de toggle |
| 🔴 | Drawer lateral con toggles por métrica | ❌ PENDIENTE | — |
| 🔴 | Métricas mandatorias: Choferes, Reclamos, Facturación, Fatiga | ❌ PENDIENTE | — |
| 🟡 | Default "todas visibles" para usuarios nuevos | ❌ PENDIENTE | — |
| 🟡 | Persistencia de configuración por usuario | ❌ PENDIENTE | — |

**Archivos clave**: `pages/DashboardHost.tsx`, `pages/reports/*.tsx`

---

### 1.6 Foto al entregar (Photo on Delivery)

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| 🔴 | Captura desde cámara (no galería) | ❌ PENDIENTE | No existe |
| 🔴 | Foto obligatoria antes de confirmar entrega | ❌ PENDIENTE | No existe `photo_url` en shipment events |
| 🔴 | Geo-referenciación de la foto | ❌ PENDIENTE | — |
| 🔴 | Almacenamiento en BD (`photo_url`) | ❌ PENDIENTE | No existe campo en `shipment_events` ni modelo |
| 🟡 | Guía "no rostros ni patentes" | ❌ PENDIENTE | — |
| 🟡 | No guardar en galería del chofer | ❌ PENDIENTE | — |
| 🔴 | Foto disponible en detalle del envío | ❌ PENDIENTE | — |

**Nota**: Claims ya tiene sistema de evidencia por archivo (`EvidenceFilePath`). Se puede reutilizar el enfoque.

---

### 1.7 Empleado del mes

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| 🔴 | Job mensual (cron, día 1 del mes) | ❌ PENDIENTE | **Cero referencias** en todo el código |
| 🔴 | Tabla `employee_of_month` | ❌ PENDIENTE | — |
| 🔴 | 3 categorías: last_mile_driver, inter_branch_driver, operator | ❌ PENDIENTE | — |
| 🔴 | Score última milla: 40% 1er intento + 30% SLA + 30% reclamos | ❌ PENDIENTE | — |
| 🔴 | Score inter-sucursal: 50% puntualidad + 30% fatiga + 20% sin reasignación | ❌ PENDIENTE | — |
| 🔴 | Score operador: envíos creados + entregados + reclamos maltrato | ❌ PENDIENTE | — |
| 🟡 | Badge en perfil de usuario | ❌ PENDIENTE | — |
| 🔴 | Visible en dashboard gerencial | ❌ PENDIENTE | — |
| 🟡 | Desempate por cantidad de envíos | ❌ PENDIENTE | — |

**Módulo completamente nuevo** — model, service, handler, DB, frontend.

---

## 2. Sprint 5 — Should Have

### 2.1 Plantillas de color y vista previa

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| 🟡 | Vista previa en tiempo real de colores | 🔄 PARCIAL | `OrganizationConfig.tsx` tiene color pickers + swatches. Pero no hay preview de contraste sobre texto de ejemplo. |
| 🟡 | Contraste letra/fondo | ❌ PENDIENTE | "Contraste de la letra → A a / color de organización" (Sprint Review 4) |
| 🟢 | Tipografías personalizables | ❌ PENDIENTE | No existen selectores de fuente en `OrganizationConfig.tsx` |
| 🟡 | Previsualización antes de guardar | ❌ PENDIENTE | La preview actual es solo un strip de color, no un mockup funcional |

**Archivos clave**: `context/OrganizationThemeContext.tsx`, `pages/OrganizationConfig.tsx`

---

## 3. Sprint 5 — Could Have

### 3.1 Escalado automático de prioridad por tiempo

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| ⚪ | Detectar tickets estancados en `abierto`/`en_revision` | ❌ PENDIENTE | No existe |
| ⚪ | Escalar prioridad automáticamente | ❌ PENDIENTE | — |
| ⚪ | Reglas de timeout configurables | ❌ PENDIENTE | — |

---

## 4. Carry-over del Sprint 4

### 4.1 Gestión de Almacenes (5 US pendientes)

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| 🟢 | Modelo de zonas de almacén | 🔄 PARCIAL | `branch_zone.go`: solo 4 tipos fijos (entrada, salida, revisión, devolución). Sin shelf/rack/sector. |
| 🟢 | Movimiento entre zonas | 🔄 PARCIAL | `branch_zone_service.go`: movimiento individual con transiciones predefinidas. Sin bulk. |
| 🟢 | Despacho desde salida | ❌ PENDIENTE | `ZoneSalida` existe pero el despacho es implícito en ruteo. Sin gate-out scan. |
| ⚪ | Auto-ubicación (FIFO/FEFO) | ❌ PENDIENTE | **Cero referencias** en código |
| 🟡 | QR de pallet/vehículo | ❌ PENDIENTE | `qr_handler.go` solo genera QR por envío individual. Sin batch. |

**Archivos clave**: `model/branch_zone.go`, `service/branch_zone_service.go`, `handler/branch_zone_handler.go`, `handler/qr_handler.go`

### 4.2 Incidentes y Reclamos (2 US pendientes)

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| 🔴 | Validación automática de SLAs en reclamos | ❌ PENDIENTE | El SLA anomaly engine (`sla_anomaly.go`) funciona para shipments, no integrado con claims |
| 🔴 | Integración notificaciones-reclamos | 🔄 PARCIAL | Existe `NotifyClaimCustomerResponded`. Pero el servicio de mensajería tiene límites (1 email, rate limit). |

---

## 5. Deuda técnica y bugs reportados

### 5.1 Bugs Sprint 4

| Prioridad | Bug | Estado | Notas |
|-----------|-----|--------|-------|
| 🟡 | Creación de reclamos sobre envíos no entregados | 🔄 PENDIENTE | Reportado en informe Sprint 4 |
| 🟡 | Reclamos con SLA vencido | 🔄 PENDIENTE | Reportado en informe Sprint 4 |
| 🟢 | Drill-down del dashboard | 🔄 PENDIENTE | Reportado en informe Sprint 4 |
| 🟡 | Chofer saltea bloqueo del supervisor | 🔄 PENDIENTE | Reportado en informe Sprint 4 |
| ✅ | Chatbot guarda cambios en historial incorrectamente | ✅ CORREGIDO | Mencionado como corregido en informe Sprint 4 |
| ✅ | URL de WhatsApp incorrecta en tracking | ✅ CORREGIDO | Mencionado como corregido |
| ✅ | Barras de progreso engañosas en tracking | ✅ CORREGIDO | Mencionado como corregido |
| ✅ | Superposiciones en mapa | ✅ CORREGIDO | Mencionado como corregido |
| ✅ | Errores de auditoría del admin | ✅ CORREGIDO | Mencionado como corregido |

### 5.2 Deuda técnica UI/Front → **US-5.F1**, **US-5.F2** (Thiago)

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| 🔴 | "Que se note menos que lo hicimos con Claude" | 🔄 PENDIENTE | Mejora continua de UX |
| 🟡 | Listado de incidencias ordenado por importancia | ❌ PENDIENTE | No existe ordenamiento por prioridad en incidencias |
| 🟡 | Listado de envíos ordenado por importancia | ❌ PENDIENTE | Backend ordena por tracking ID |
| ✅ | Modo oscuro global | ✅ COMPLETO | `OrganizationThemeContext.tsx` + `mode` class en `<html>` |
| 🟢 | Nav/footer en todas las páginas | 🔄 PENDIENTE | Verificar consistencia |
| 🟢 | Coherencia visual en tablas | 🔄 PENDIENTE | Mejora continua |

### 5.3 Deuda técnica Motor de Ruteo

| Prioridad | Requisito | Estado | Código |
|-----------|-----------|--------|--------|
| 🟢 | Tope de horas máximas de jornada laboral | ❌ PENDIENTE | Solo peso como tope. `service/routing.go` |
| ⚪ | Límite de km por vehículo por día | ❌ PENDIENTE | — |
| 🟢 | Cálculo de hora estimada de fin de recorrido | ❌ PENDIENTE | VRP scheduler calcula `SuggestedDepartureMin` pero no fin de jornada |
| 🟡 | Bug: mapa no actualiza ubicación del chofer al entregar | 🔄 PENDIENTE | Reportado en mejoras 28/05 |
| 🟡 | Ruteo en línea recta (última milla) | 🔄 PENDIENTE | Feedback de clase 02/06 |

---

## 6. Anotaciones de PO meetings — estado

### 6.1 Review Meeting 1 (Thiago)

| Prioridad | Anotación | Estado | Notas |
|-----------|-----------|--------|-------|
| ✅ | Verificar estado "cancelado" → "on-hold" | ✅ COMPLETO | `model/shipment.go` — `IsCancellable()` + estados terminales |
| ✅ | Trazabilidad de Jira en Plan de Pruebas | ✅ COMPLETO | Documentación |
| ✅ | Diagrama de estados validado con PO | ✅ COMPLETO | `model/shipment.go` — máquina de estados documentada |
| ✅ | Métricas como producto final | ✅ COMPLETO | Dashboard con 12 tabs |
| ✅ | Matriz de riesgos | ✅ COMPLETO | Gestión de proyecto |
| ✅ | Alta disponibilidad (AWS) | ✅ COMPLETO | Deploy en EC2 + RDS |
| ⚪ | Carga masiva / mega QR | ❌ PENDIENTE | No existe carga masiva |
| ✅ | End-to-end para sprints | ✅ COMPLETO | Flujo completo |

### 6.2 Consultas TP — 30/04/2026

| Prioridad | Anotación | Estado | Código |
|-----------|-----------|--------|--------|
| ✅ | Nº de reintentos configurable por cliente | ✅ COMPLETO | `system_config.max_delivery_attempts` (1–10) |
| ✅ | Color de página / logo | ✅ COMPLETO | `OrganizationConfig.tsx` + `OrganizationThemeContext.tsx` |
| ⚪ | Días de borradores configurables | ❌ PENDIENTE | No implementado |
| ✅ | Cambio de contraseña con código 5 min | ✅ COMPLETO | `password_reset.go` — OTP 5 min TTL |
| ✅ | CERRAR TODOS LOS FLUJOS por rol | ✅ COMPLETO | RBAC implementado |
| ✅ | Ojo del Patrón | ✅ COMPLETO | `handler/driver.go` — KSS, voice, PVT, touch events |
| ✅ | Umbral personalizado por empresa | ✅ COMPLETO | `system_config` |
| ✅ | Geolocalización | ✅ COMPLETO | Leaflet/OpenStreetMap + geocodificación |
| ✅ | Plan de proyecto actualizado | ✅ COMPLETO | Documentación |
| ✅ | Informe de avance | ✅ COMPLETO | Documentación |

### 6.3 Consultas TP — 05/05/2026

| Prioridad | Anotación | Estado | Código |
|-----------|-----------|--------|--------|
| ⚪ | Capacidad de sucursales configurable (m²/m³/bultos) | 🔄 PARCIAL | `branch.go` tiene `MaxCapacity` pero sin opciones |
| ✅ | Algoritmo de asignación de vehículos automático | ✅ COMPLETO | `service/routing.go` |
| ✅ | Ruteo automático inteligente | ✅ COMPLETO | `service/routing.go` — `generatePlan()` |
| ✅ | Zona insegura (última milla) | ✅ COMPLETO | `model/zone.go` + `service/routing_zones.go` + `ors/client.go` |
| ✅ | Calcular costo de envío | ✅ COMPLETO | `service/pricing.go` — pricing engine |
| ✅ | Ventana de borradores | ✅ COMPLETO | `POST /shipments/draft` |
| ✅ | DNI como primer dato | ✅ COMPLETO | `NewShipment.tsx` |
| ✅ | Vehículo asignado automáticamente | ✅ COMPLETO | `service/routing.go` — vehicle selection |
| ✅ | 40% capacidad mínima para despacho | ✅ COMPLETO | `routing_config.min_fill_rate` (default 0.40) |
| ✅ | Chofer como entidad con más peso | ✅ COMPLETO | `handler/driver.go` — ruta, fatiga, disponibilidad implícita |
| 🟡 | QR de pallet para finalizar viaje | ❌ PENDIENTE | Solo QR por envío individual |
| ✅ | "Enviar a sucursal" y "Última milla" | ✅ COMPLETO | Labels en `StatusBadge.tsx` |
| ✅ | Envío rápido = express | ✅ COMPLETO | `shipment_type: express` |

### 6.4 Consultas TP — 07/05/2026

| Prioridad | Anotación | Estado | Código |
|-----------|-----------|--------|--------|
| ✅ | Repetir test Ojo del Patrón por paradas | ✅ COMPLETO | `handler/driver.go` — check-in por parada |
| ✅ | AGM para sucursales / rutas predefinidas | ✅ COMPLETO | `BranchGraphService` + `BranchEdge` |
| 🟢 | Anticipación envíos que no llegaron | ❌ PENDIENTE | — |
| ✅ | Notificación de envíos que NO llegaron | ✅ COMPLETO | `messaging/service.go` |
| ✅ | Config de notificaciones en perfil | ✅ COMPLETO | `SystemConfig.tsx` — toggles email/WhatsApp |
| 🟢 | Ubicación de envíos en sucursales (lockers) | 🔄 PARCIAL | `branch_zone.go` — solo 4 zonas, sin lockers |
| ✅ | Vehículo en ambos modos (última milla + inter-sucursal) | ✅ COMPLETO | `model/vehicle.go` — `mode` field |
| ⚪ | Guardar excepciones de ruteo manual | ❌ PENDIENTE | No existe |
| ✅ | Dibujar otro tipo de zonas | ✅ COMPLETO | `model/zone.go` — polígonos |
| ✅ | Calendario de envíos entrantes/salientes | ✅ COMPLETO | `GET /inter-branch-trips/calendar` |

### 6.5 Clase de Consulta — 02/06/2026

| Prioridad | Anotación | Estado | Código |
|-----------|-----------|--------|--------|
| 🟡 | Actualizar visual de /track | 🔄 PENDIENTE | `pages/PublicTracking.tsx` |
| ✅ | Modo oscuro en todas las páginas | ✅ COMPLETO | `OrganizationThemeContext.tsx` |
| 🟢 | Nav/footer en todas las páginas | 🔄 PENDIENTE | Verificar |
| 🟡 | Ruteo en línea recta (bug) | 🔄 PENDIENTE | Bug conocido |
| ✅ | Rechazado no activa Ojo del Patrón | ✅ COMPLETO | Lógica en `handler/driver.go` |
| ✅ | Errores de touch en Ojo del Patrón | ✅ COMPLETO | Misfire tracking |
| ✅ | Cerrar sesión del chofer con alerta fatiga | ✅ COMPLETO | `handler/driver.go` — bloqueo |
| ⚪ | Configurar visualización del mail por organización | ❌ PENDIENTE | — |
| ✅ | 2FA con Google Authenticator | ✅ COMPLETO | `service/two_fa.go` — TOTP |
| ✅ | Integrar cambio de contraseña en perfil con login | ✅ COMPLETO | `Login.tsx` — flujo integrado |
| ✅ | Mail de cambio de contraseña confirmado | ✅ COMPLETO | `email/templates.go` |
| 🟡 | Parada NO en sucursal para Ojo del Patrón | 🔄 PENDIENTE | — |
| ✅ | Bloquear envíos cuando se activa Ojo del Patrón | ✅ COMPLETO | `handler/driver.go` |
| 🟡 | Bug: Ojo del Patrón en otro dispositivo con usuario bloqueado | 🔄 PENDIENTE | — |
| 🟡 | 2FA no permitir si usuario bloqueado por fatiga | 🔄 PENDIENTE | — |
| ✅ | Motor de Anomalías SLA integrado con dashboard | ✅ COMPLETO | `SlaTab.tsx` en DashboardHost |
| ✅ | No repriorizar envíos SLA, solo etiquetar | ✅ COMPLETO | `sla_anomaly.go` — escalado de prioridad |

### 6.6 Sprint Review 4 — 09/06/2026

| Prioridad | Anotación | US | Estado |
|-----------|-----------|-----|--------|
| 🟡 | Gráficos Calidad y Burndown redundantes | — | 🔄 PENDIENTE |
| 🟡 | Números exactos en barras (TCs/Sprint) | **US-5.F2** ✅ | 🔄 PENDIENTE |
| ✅ | Clasificación de bugs en Jira | — | ✅ COMPLETO (gestión) |
| 🔴 | Contraste letra/fondo en personalización | **US-5.8** ✅ | ❌ PENDIENTE |
| 🔴 | Vista previa de colores sobre texto | **US-5.8** ✅ | ❌ PENDIENTE |
| 🔴 | Tabs configurables por admin | **US-5.5** ✅ | ❌ PENDIENTE |
| 🟢 | Choferes: licencia y horario laboral | — | ❌ PENDIENTE |
| ✅ | SLA panel por sucursal | — | ✅ COMPLETO |
| ✅ | Notificaciones que se marquen como leídas | — | ✅ COMPLETO |
| 🔴 | Chatbot no permita escribir en medio de opciones | **US-5.F1** ✅ | ❌ PENDIENTE |
| 🔴 | Mostrar evidencia en reclamo (foto, fecha) | US-5.1 | ❌ PENDIENTE |
| 🔴 | Tiempo de respuesta de un reclamo | US-5.1 | ❌ PENDIENTE |
| 🔴 | Reclamo resuelto satisfactoriamente o no | US-5.1 | ❌ PENDIENTE |
| 🔴 | Chatbot antes de accionable | US-5.3 | ❌ PENDIENTE |

---

## 7. Anotaciones ya cubiertas (✅ para descartar)

Estas anotaciones están implementadas y funcionales. Se marcan como **descartadas** del backlog activo:

| Anotación | Implementación |
|-----------|---------------|
| Backhauling — sugerencia de retorno vacío | `service/routing.go::matchBackhaulPairs()` |
| Despacho proyectado con vehículos en tránsito | `service/routing.go::tryProjectedDispatch()` |
| Mercado Pago configurable por admin | `handler/` + `SystemConfig.tsx` |
| Doble factor de autenticación (2FA) | `service/two_fa.go` + frontend completo |
| Palabra clave para validar entrega | `handler/shipment.go` — delivery keyword |
| Reset de contraseña con email | `service/password_reset.go` |
| Bloqueo por fatiga en app chofer | `handler/driver.go` |
| Rediseño mobile-first del subsistema chofer | `pages/DriverRoute.tsx` |
| Modo claro/oscuro global | `OrganizationThemeContext.tsx` |
| White-label: colores y logo | `OrganizationConfig.tsx` |
| Notificaciones multicanal (in-app, email, WhatsApp) | `messaging/service.go` + `NotificationBell.tsx` |
| Canalización configurable de notificaciones | `SystemConfig.tsx` |
| Centro de notificaciones in-app con SSE | `handler/notification.go` + `NotificationBell.tsx` |
| SLA anomaly engine | `service/sla_anomaly.go` |
| Métricas SLA por sucursal | `handler/sla_metrics.go` + `SlaTab.tsx` |
| Ruteo inteligente (plan global) | `service/routing.go::GenerateGlobalPlan()` |
| Piggybacking (aprovechar viajes) | `service/routing.go` |
| Consolidación inteligente con min_fill_rate | `service/routing.go` |
| Bin-packing por peso para última milla | `service/routing.go` |
| Zonas peligrosas (polígonos) | `model/zone.go` + `service/routing_zones.go` |
| Cotización en vivo | `service/pricing.go` |
| Precio inmutable post-confirmación | `service/shipment.go` — campos bloqueados |
| Ojo del Patrón (KSS, voz, PVT, touch) | `handler/driver.go` |
| QR de envío individual | `handler/qr_handler.go` |
| Geocodificación de direcciones | `NewShipment.tsx` — autocompletado |
| Draft workflow | `POST /shipments/draft` → `PATCH /:id/draft` → `POST /:id/confirm` |

---

## 8. Resumen ejecutivo ordenado por prioridad

### 🔴 CRÍTICO — Bloqueante para demo/jurado

| # | Funcionalidad | US | Esfuerzo |
|---|---------------|-----|----------|
| 1 | **Tickets inter-sucursal** — transferencia entre branches con trazabilidad | US-5.1 | Alto — nuevo flujo completo |
| 2 | **Prioridad de reclamos** — 4 niveles con asignación automática + anti-inflación | US-5.2 | Medio — extender modelo + ML |
| 3 | **Chatbot guiado** — árboles de decisión delay + not_delivered, pre-filtro antes de formulario | US-5.3 | Alto — 2 árboles prioritarios + integración |
| 4 | **Foto al entregar** — cámara, upload, georreferenciación, privacidad | US-5.6 | Alto — nuevo subsystem |
| 5 | **Métricas de reclamos** — endpoint `GET /claims/stats` + dashboard | US-5.4 ✅ | Medio — Thiago frontend + Mauri backend |
| 6 | **Panel configurable** — toggles por widget, 4 métricas mandatorias | US-5.5 ✅ | Medio — Thiago |
| 7 | **Empleado del mes** — job mensual, 3 categorías, dashboard | US-5.7 | Alto — módulo completo nuevo |
| — | **Validación SLA en reclamos** (carry-over) | — | Medio — integrar anomaly engine |
| — | **Integración notificaciones-reclamos** (carry-over) | — | Medio — cerrar ciclo |
| — | **Contraste + vista previa colores** (Sprint Review 4) | US-5.8 ✅ | Bajo — Thiago |
| — | **Chatbot: no escribir en opciones** (Sprint Review 4) | US-5.F1 ✅ | Bajo — Thiago |
| — | **Evidencia en reclamo** (foto, fecha, tiempo respuesta, satisfacción) | US-5.1 | Medio — integrado en tickets |
| — | **"Menos Claude"** — pulido visual general | — | Medio — frontend |

### 🟡 ALTO — Muy importante si hay tiempo

| # | Funcionalidad | US | Esfuerzo |
|---|---------------|-----|----------|
| 8 | Árboles damage + bad_treatment del chatbot | US-5.3 | Medio |
| 9 | Tasa de resolución 1ª derivación | US-5.4 ✅ | Bajo |
| 10 | Usuarios únicos en /track | — | Bajo |
| 11 | Plantillas de color con vista previa (Should Have) | US-5.8 ✅ | Medio |
| 12 | QR de pallet/vehículo (carry-over) | — | Medio |
| 13 | Bugs: reclamos no entregados, SLA vencido, bypass supervisor | — | Medio |
| 14 | Listados ordenados por importancia | — | Medio |
| 15 | Bug mapa + ruteo línea recta | — | Bajo |
| 16 | Bug Ojo del Patrón otro dispositivo + 2FA con fatiga | — | Bajo |
| 17 | Visual de /track | — | Bajo |
| 18 | Valores numéricos en barras de gráficos | US-5.F2 ✅ | Bajo |

### 🟢 MEDIO — Valor visible, no bloqueante

| # | Funcionalidad | Esfuerzo |
|---|---------------|----------|
| 18 | Árboles wrong_data + other del chatbot | Bajo |
| 19 | Gestión de Almacenes: zonas, movimiento, despacho (carry-over) | Alto |
| 20 | Gráficos Burndown/Calidad, números en barras | Bajo |
| 21 | Nav/footer consistente, coherencia tablas | Bajo |
| 22 | Tope jornada laboral en ruteo | Medio |
| 23 | Lockers / ubicación física en sucursales | Alto |
| 24 | Notificación sucursal llena | Bajo |
| 25 | Ingreso rápido con PIN | Medio |
| 26 | Push Android + sonido | Medio |

### ⚪ BAJO — Descartable sin impacto

| # | Funcionalidad |
|---|---------------|
| 27 | Escalado automático prioridad (Could Have) |
| 28 | Auto-ubicación FIFO/FEFO |
| 29 | Tipografías personalizables |
| 30 | Días de borradores configurables |
| 31 | Capacidad sucursales m²/m³/bultos |
| 32 | Guardar excepciones ruteo manual |
| 33 | Visualización mail por organización |
| 34 | Carga masiva / mega QR |
| 35 | Límite km por vehículo por día |
| 36 | Choferes: licencia y horario laboral |

---

## 9. Mejoras post-presentaciones (28/05) — pendientes

| Prioridad | Anotación | Estado | Notas |
|-----------|-----------|--------|-------|
| 🟢 | Ingreso rápido con PIN | ❌ PENDIENTE | No existe |
| 🟡 | Cambio de prioridad manual (override IA) | ❌ PENDIENTE | No existe |
| 🟢 | Push en Android + sonido en notificaciones | ❌ PENDIENTE | Notificaciones in-app sí, push nativo no |
| 🟢 | Notificación cuando sucursal se llena | ❌ PENDIENTE | `dispatch_volume.go` monitorea pero no notifica capacidad |
| 🔴 | Comprobante de entrega | ❌ PENDIENTE | Relacionado con foto al entregar (#1.6) |
| 🟡 | Recepción intersucursal con doble escaneo QR | ❌ PENDIENTE | Solo QR por envío individual |
| ⚪ | Testing exploratorio | 🔄 PENDIENTE | Proceso, no código |
| ⚪ | Datos de prueba más realistas | 🔄 PENDIENTE | `seed/seed.go` |
| ⚪ | Riesgo gremial en matriz | 🔄 PENDIENTE | Gestión de proyecto |
| ⚪ | Riesgo complejidad técnica | 🔄 PENDIENTE | Gestión de proyecto |
| ⚪ | Riesgo cobertura testing | 🔄 PENDIENTE | Gestión de proyecto |

---

*Documento generado por Sisyphus. Actualizar al completar cada ítem.*
