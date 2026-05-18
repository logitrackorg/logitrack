# Propuesta de Mejoras de Producto — LogiTrack

> Documento de roadmap con las 5 funcionalidades que mayor impacto tendrían como **mejora de producto** sobre la base operativa actual. Excluye temas legales/de infraestructura (CPE AFIP, payments, etc.) para enfocarse exclusivamente en features visibles que mejoren la experiencia del operador, del chofer y del cliente final.

**Fecha**: 2026-05-11
**Estado**: Borrador para discusión

---

## Contexto

El proyecto tiene una base operativa muy completa: event sourcing de envíos, ML para priorización, VRP de ruteo diario, motor de pricing configurable, RBAC multi-sucursal, dashboard con KPIs, tracking público y bulk upload. Lo que falta para **destacarse como producto** son features visibles, con impacto directo en la experiencia diaria de los tres actores principales:

- **Operadores y supervisores**: hoy operan con tablas y listas.
- **Choferes**: hoy usan una web sin soporte offline, sin captura de evidencia.
- **Destinatarios**: hoy son actores pasivos que solo consultan `/track`.

---

## Las 5 mejoras esenciales

### 1. Torre de Control en tiempo real (mapa interactivo)

**El gap**

Hoy todo se visualiza en **tablas y listas** — el `Routing`, el `Dashboard`, el `VehicleList`, el `ShipmentList`. Para una empresa logística esto es contraintuitivo: el negocio es geográfico por naturaleza.

**Qué construir**

Pantalla nueva `/control` con mapa de Argentina (Leaflet + OpenStreetMap, gratis) que muestre **en vivo**:

- Vehículos en `en_transito` con su posición GPS actual (capturada por la app del chofer cada 60s).
- Envíos `out_for_delivery` con pin en la dirección de destino, coloreado por prioridad ML.
- Sucursales con su `BranchCapacity` actual (verde / amarillo / rojo según `% ocupación`).
- Rutas del día sobre el mapa (polyline OSRM ya está integrado).

Click en un pin → drawer lateral con detalle y acciones rápidas. Filtros: solo mi sucursal, solo envíos en riesgo de SLA, solo última milla, etc.

**Por qué destaca**

Es el feature más vendible visualmente y el único que un manager/gerente puede dejar puesto en una pantalla todo el día. Andreani y OCA tienen versiones internas de esto; ningún competidor SMB lo tiene bien resuelto.

---

### 2. Proof of Delivery digital con app offline-first

**El gap**

La entrega solo valida `recipient_dni` textual. No hay foto, firma, ni GPS del momento de la entrega. Encima `DriverRoute` es una página web sin soporte offline — y los choferes pierden señal en cualquier ruta argentina fuera del AMBA.

**Qué construir**

- Convertir `DriverRoute` + `DriverShipmentDetail` en **PWA con Service Worker** (cache de rutas del día, queue de mutations offline).
- Al marcar `delivered`, capturar de forma obligatoria:
  - **Foto del paquete entregado** (cámara nativa vía `<input capture>`).
  - **Firma digital del receptor** (canvas táctil con biblioteca `signature_pad`).
  - **Lat/lng GPS** del momento (`navigator.geolocation`) — validar que esté a < 200m de la dirección del envío y alertar si no.
- Persistir los assets en el `ShipmentEvent` con notas tipadas, mostrarlos en `ShipmentDetail` y en `/track` público (la firma redactada, la foto visible).

**Por qué destaca**

Corta de raíz las disputas de "nunca lo recibí" y eleva el producto a estándar de mercado (Pedidos Ya, Rappi, Andreani). Es lo primero que pide cualquier sender B2B serio.

---

### 3. Portal self-service para destinatarios

**El gap**

Hoy `/track` es **read-only**. El destinatario es un actor pasivo. Pero el 60-70% del costo del last mile en Argentina viene de **entregas fallidas** porque nadie estaba en domicilio.

**Qué construir**

Sobre la página pública (con auth liviana por DNI + tracking ID):

- **Reprogramar entrega**: cambiar `time_window` o pedir reintento en una fecha específica (genera evento `delivery_rescheduled`, recalcula plan VRP del día objetivo).
- **Cambiar a retiro en sucursal**: convierte un `delivery_method=ultima_milla` a `retiro_sucursal` antes de que entre a `out_for_delivery`. Recalcula el plan, devuelve diferencia de precio si aplica.
- **Cambiar dirección dentro de la misma localidad**: pasa por aprobación del operador (notificación interna tipo campanita) si está fuera de la zona de cobertura.
- **Instrucciones especiales** ("tocar timbre 4B", "dejar con encargado", "fragilísimo"): se inyectan al `DriverShipmentDetail` del día de la entrega.

**Por qué destaca**

Reduce drásticamente el `delivery_attempts > 1` (que es el KPI más caro del negocio) y le da al destinatario sensación de control. Casi nadie en el mercado local lo tiene bien hecho.

---

### 4. WhatsApp como canal principal de notificaciones interactivas

**El gap**

Las notificaciones de la épica actual son por **email**. En Argentina, la tasa de apertura de email en B2C es del 15-20%; la de WhatsApp es del 95%+. Email es el canal equivocado.

**Qué construir**

- Integración con **WhatsApp Business Cloud API** (Meta) — gratuita hasta 1000 conversaciones de servicio por mes; ideal para arrancar.
- Plantillas pre-aprobadas para cada US de la épica de Notificaciones (link de seguimiento, próximo a entregar, listo para retirar, etc.).
- **Botones interactivos** (`quick replies`) en los mensajes:
  - "Próximo a entregar" → botones [Confirmar disponibilidad] / [Reprogramar] / [Cambiar a sucursal].
  - "Listo para retirar" → botones [Ver sucursal en Google Maps] / [Ver horario] / [Avisar que ya pasé].
  - Las respuestas entran al sistema vía webhook → disparan acciones del portal self-service (#3).
- Fallback automático: si no hay teléfono o falla WhatsApp, cae a email; si no hay email, registra en log.

**Por qué destaca**

Convierte la notificación pasiva en un canal **bidireccional accionable**, y aprovecha que `Customer.Phone` ya está en el modelo. Es el feature de mayor ROI por costo de implementación.

---

### 5. Escaneo de código de barras + etiquetas integradas

**El gap**

Hoy en `VehicleList → Cargar Envíos` y en cualquier movimiento entre sucursales, el operador **tipea el tracking ID** (`LT-XXXXXXXX`). En un hub recibiendo 200 paquetes por la mañana, esto es inoperable. Además, no existe una etiqueta física estándar para imprimir.

**Qué construir**

- **Etiqueta imprimible desde el envío**: formato A6 con datos del destinatario, sucursal de destino, tracking ID en texto + **QR + código de barras Code 128**. Endpoint `/shipments/:id/label` que devuelva PDF. Generable masivamente desde la lista (selección múltiple).
- **Pantalla "Recepción en sucursal"** (`/scan/recepcion`): el operador apunta la cámara del celular/tablet con la PWA, escanea con `@zxing/library`, el sistema dispara `bulk-status → at_hub` con `current_location = mi_sucursal_id`. Acumula en una tabla viva en pantalla con feedback sonoro de "ok / error / duplicado".
- **Pantalla "Carga al vehículo"**: mismo patrón, pero llamando a `vehicles/by-plate/:plate/assign` por cada escaneo. Valida capacidad en vivo.
- **Verificación en entrega**: el chofer escanea el paquete antes de marcarlo `delivered` (previene entregar el paquete equivocado en domicilios con varios envíos).

**Por qué destaca**

Convierte operaciones que hoy toman minutos (tipear ID por ID) en **segundos por paquete**. Es invisible en la demo, pero los operadores reales lo van a amar y multiplica la productividad del sistema sin contratar gente.

---

## Priorización sugerida

| Prioridad | Feature | Impacto | Esfuerzo | Por qué arrancar acá |
|---|---|---|---|---|
| 🥇 | **WhatsApp interactivo** (#4) | Altísimo | Bajo-medio | El canal correcto para Argentina, ROI inmediato |
| 🥈 | **Self-service destinatarios** (#3) | Altísimo | Medio | Ataca el delivery fallido, el costo más alto del negocio |
| 🥉 | **Escaneo + etiquetas** (#5) | Alto operativo | Medio | Productividad operativa sin contratar más gente |
| 4 | **POD + PWA offline** (#2) | Alto comercial | Alto | Estándar de mercado, condición para senders B2B |
| 5 | **Torre de Control / mapa** (#1) | Alto en demo | Alto | El feature más vendible visualmente |

**Recomendación de arranque**: **WhatsApp + Self-service** se potencian entre sí (los botones de WhatsApp linkean al portal). Juntos atacan el problema más caro del negocio: **el delivery fallido**.

---

## Próximos pasos

1. Validar la priorización con el equipo comercial y operaciones.
2. Para cada feature elegida, redactar especificación detallada en `docs/specs/` con US y criterios de aceptación en formato Dado/Cuando/Entonces.
3. Estimar esfuerzo en sprints y armar plan de releases.
