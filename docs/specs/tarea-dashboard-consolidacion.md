# Revisar y consolidar tabs del Dashboard

**Tipo**: Tarea | **Prioridad**: Alta | **Sprint**: 5  
**Asignado**: Thiago | **Bloquea**: Panel configurable, Métricas de reclamos

---

## Descripción

El dashboard tiene 12 tabs. Varios son redundantes o muestran datos con muy poco valor operativo. Para la demo hay que dejar un dashboard conciso y profesional. Esta tarea es analizar qué tabs se quedan, cuáles se eliminan y definir las 4 métricas mandatorias para el panel configurable.

## Situación actual

| Tab | Problema |
|-----|----------|
| Resumen | ✅ Tab principal. De todo: KPIs, sparklines, status grid, tendencias, avg times. |
| SLA | ✅ El más sofisticado: compliance, fleet diagnosis ML, bottlenecks. |
| Choferes | ✅ Único tab con vista por driver. |
| Fatiga | ✅ Único tab con datos de seguridad/salud. |
| Reclamos | ⚠️ Muestra incidents, no claims. Hay que reemplazar (US-5.4). |
| Retorno | ✅ Tasa de retorno útil. |
| Ranking | ❌ Redundante: success rate ya está en Resumen y Éxito. |
| Éxito | ❌ Redundante: success rate ya está en Resumen y Ranking. |
| Facturación | ❌ Dato admin, no operativo. Sin gráficos. |
| Tipo de Envío | ❌ Solo 2 categorías (express/normal). Mismo layout que MetodoEntrega y Volumen. |
| Método de Entrega | ❌ Solo 2 categorías (última milla/retiro). Mismo layout. |
| Vol. por Ventana | ❌ Una sola dimensión (morning/afternoon/flexible). Mismo layout. |

## Propuesta: 12 → 6 tabs

1. **Resumen** — KPIs, status grid, tendencias, distribución por sucursal, últimos envíos
2. **SLA** — Compliance, fleet diagnosis (ML + heurístico), bottlenecks, recomendaciones
3. **Choferes** — Performance por driver: asignados, entregados, fallidos, success rate
4. **Reclamos** — Métricas de reclamos reales (reemplazar incidents actuales con US-5.4)
5. **Retorno** — Tasa de retorno, tendencia diaria, breakdown por sucursal
6. **Fatiga** — Distribución de riesgo de flota, avg sleep hours, ranking drivers

## Tabs eliminados (6)

Ranking, Éxito, Tipo de Envío, Método de Entrega, Vol. por Ventana, Facturación.

## Preguntas para resolver con el equipo

- ¿Confirman los 6 tabs o ajustamos?
- ¿Facturación se mueve a panel de admin?
- ¿Los 3 tabs de "volumen por X" se borran sin reemplazo o se mete un minigráfico en Resumen?
- ¿Métricas mandatorias para el panel configurable: Resumen, Reclamos, SLA, Fatiga?

## Subtareas

- [ ] Validar propuesta con el equipo
- [ ] Definir lista final de tabs
- [ ] Definir 4 métricas mandatorias
- [ ] Actualizar US-5.4 y US-5.5 con las definiciones finales
