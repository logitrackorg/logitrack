# Manual de usuario — Flujo de borradores

**Roles**: Operador, Supervisor  
**Módulo**: Nuevo envío / Lista de envíos

---

## ¿Qué es un borrador?

Un borrador es un envío incompleto que se guarda para terminar de completar más tarde. No genera número de seguimiento definitivo ni ingresa al flujo operativo hasta que sea confirmado.

Los borradores son útiles cuando tenés parte de la información del envío pero necesitás conseguir el resto antes de comprometerte con la operación.

---

## Identificación de un borrador

Cada borrador recibe un identificador propio con el formato:

```
BORRADOR-NNNNN
```

donde `NNNNN` es un número de 5 dígitos asignado automáticamente (ej: `BORRADOR-47382`).

Este ID es **transitorio**: desaparece cuando confirmás el envío y se reemplaza por el número de seguimiento definitivo (`LT-XXXXXXXX`). Todos los eventos y cambios del borrador quedan asociados al nuevo número para mantener la trazabilidad completa.

> El ID del borrador es de solo lectura y no puede editarse.

---

## Crear un borrador

1. Ingresá a **Nuevo envío** desde el menú principal.
2. Completá los datos que tengas disponibles (al menos el nombre del remitente o destinatario).
3. Hacé clic en **"Guardar borrador"**.

El sistema guarda el borrador y te redirige al detalle del mismo, donde podés seguir completando la información.

---

## Editar un borrador

1. Encontrá el borrador en la **Lista de envíos** (filtrando por estado "Pendiente").
2. Abrí el detalle haciendo clic en el ID.
3. Modificá los campos que necesitás desde el formulario de edición.
4. Hacé clic en **"Guardar cambios"** para actualizar sin confirmar.

Podés guardar y volver a editar tantas veces como necesites.

---

## Confirmar un borrador

Confirmar convierte el borrador en un envío real que ingresa al flujo operativo.

### Requisitos para confirmar

Antes de poder confirmar, el sistema valida que estén completos:

| Campo | Remitente | Destinatario |
|---|---|---|
| Nombre completo | ✅ | ✅ |
| Teléfono | ✅ | ✅ |
| DNI (mínimo 7 dígitos) | ✅ | ✅ |
| Calle | ✅ | ✅ |
| Ciudad | ✅ | ✅ |
| Provincia | ✅ | ✅ |
| Código postal | ✅ | ✅ |

Si algún campo falta, el sistema indica cuáles completar antes de continuar.

### Pasos para confirmar

1. Desde el detalle del borrador, completá todos los campos requeridos.
2. Hacé clic en **"Confirmar envío"**.
3. El sistema valida, calcula el precio y la fecha estimada de entrega, y genera el número de seguimiento definitivo (`LT-XXXXXXXX`).
4. La pantalla se redirige automáticamente al detalle del nuevo envío confirmado.

### ¿Qué pasa internamente al confirmar?

- El `BORRADOR-NNNNN` se reemplaza por un `LT-XXXXXXXX`.
- Se registra un evento de trazabilidad (`draft_confirmed`) con el ID anterior, el nuevo ID, el precio calculado y la fecha estimada.
- Se calcula la prioridad del envío mediante el modelo de ML.
- El envío pasa al estado **En sucursal de origen** y queda disponible para la operación.
- Todo el historial de cambios del borrador queda asociado al nuevo número `LT-`.

---

## Sucursal receptora en borradores

La sucursal receptora que asignaste al crear el borrador **se conserva al editar**. No se pierde si volvés al formulario de edición.

Si necesitás cambiar la sucursal receptora, podés hacerlo desde el formulario de edición antes de confirmar. Una vez confirmado, la sucursal de destino es inmutable.

---

## Preguntas frecuentes

**¿Los borradores tienen fecha de vencimiento?**  
No. Un borrador permanece disponible hasta que lo confirmás o lo eliminás manualmente.

**¿Un borrador ocupa lugar en el flujo operativo?**  
No. Hasta ser confirmado, el borrador no genera movimiento ni aparece en la vista de operaciones activas.

**¿Puedo ver el historial de cambios de un borrador?**  
Sí. Todos los cambios quedan registrados y son visibles en la pestaña de eventos del detalle, tanto durante el borrador como después de confirmar (asociados al nuevo `LT-`).

**¿Qué pasa si confirmo y el número de seguimiento ya existe?**  
No puede pasar: el sistema genera el número de seguimiento con un UUID único. No hay riesgo de colisión.

**¿Puedo cancelar un borrador?**  
Los borradores no tienen opción de cancelación directa. Podés dejarlos sin confirmar o contactar al supervisor para eliminarlos desde administración.
