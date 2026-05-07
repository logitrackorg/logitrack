# Manual de usuario — Fecha estimada de entrega

**Roles**: Operador, Supervisor, Manager  
**Módulo**: Detalle de envío

---

## ¿Qué es la fecha estimada de entrega?

Es la fecha proyectada en la que el envío debería llegar al destinatario. El sistema la calcula automáticamente al momento de confirmar el envío (o al confirmar un borrador) y la muestra en el detalle del envío.

No es una fecha garantizada: puede verse afectada por demoras operativas, condiciones climáticas u otros factores fuera del sistema.

---

## Cuándo se calcula

La fecha estimada se genera en dos momentos:

| Situación | Cuándo se calcula |
|---|---|
| Envío creado directamente (no borrador) | Al momento de la creación |
| Borrador confirmado | Al hacer clic en "Confirmar envío" |

> **Importante:** los borradores **no tienen** fecha estimada mientras estén en estado borrador. La fecha aparece recién después de confirmar.

---

## Cómo se calcula

El sistema tiene en cuenta:

1. **Distancia entre sucursales**: calcula la distancia entre la sucursal de origen y la sucursal de destino más cercana al domicilio del destinatario.
2. **Tipo de envío**:
   - **Express** → menos días de tránsito
   - **Normal** → plazo estándar

No se calcula en función de calendarios de feriados ni horarios de atención.

---

## Dónde verlo

La fecha estimada aparece en la sección de datos del **detalle del envío**, con el rótulo **"Entrega est."**.

Si el envío no tiene fecha estimada (por ejemplo, fue creado antes de esta funcionalidad), se muestra un guión (`—`).

---

## Preguntas frecuentes

**¿Se actualiza si el envío cambia de ruta?**  
No. La fecha estimada se fija al confirmar el envío y no se recalcula ante cambios de estado o correcciones.

**¿Por qué un envío muestra "—" en vez de una fecha?**  
Ese envío fue creado antes de que la funcionalidad estuviera disponible, o es un borrador aún no confirmado.

**¿El cliente puede ver la fecha estimada?**  
Sí. La página pública de seguimiento también muestra la fecha estimada cuando está disponible.

**¿Puedo corregir la fecha estimada si es incorrecta?**  
No. La fecha estimada no es un campo editable. Si hay un error de configuración que la afecte, debe reportarse al administrador del sistema.
