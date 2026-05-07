# Manual de usuario — Tipo de envío

**Roles**: Operador, Supervisor  
**Módulo**: Nuevo envío / Borrador

---

## ¿Qué es el tipo de envío?

El tipo de envío indica la urgencia con la que debe tratarse el paquete dentro del flujo logístico. Se selecciona al crear el envío y afecta directamente al precio y a la fecha estimada de entrega.

Hay dos opciones:

| Tipo | Descripción |
|---|---|
| **Normal** | Envío estándar. Plazo habitual de entrega, sin recargo por urgencia. |
| **Express** | Envío prioritario. Menor tiempo de tránsito estimado y precio más alto. |

---

## Dónde se selecciona

El campo **"Tipo de envío"** se encuentra en la sección **Paquete** del formulario de nuevo envío, junto a la ventana horaria.

El valor por defecto es **Normal**.

---

## Impacto en el precio

El tipo de envío afecta el costo final mediante un multiplicador:

- **Normal**: no aplica recargo adicional (multiplicador 1.0×).
- **Express**: aplica un multiplicador sobre el subtotal. El valor exacto es configurable por el administrador (por defecto 1.5×, es decir, 50% más caro que el envío normal equivalente).

El desglose del precio que se muestra al cotizar incluye la línea **"Tipo de envío ×"** con el multiplicador aplicado.

> Para ver el precio antes de confirmar, completá los datos del envío y el sistema calcula la cotización automáticamente en la sección de precio.

---

## Impacto en la fecha estimada de entrega

El tipo de envío también influye en los días de tránsito estimados:

- **Express** → menos días que **Normal** para la misma distancia.

La fecha estimada se calcula al confirmar el envío y tiene en cuenta tanto el tipo como la distancia entre sucursales.

---

## Impacto en la prioridad

El sistema de prioridad automática (ML) considera el tipo de envío como uno de los factores con mayor peso en el cálculo. Los envíos **Express** tienden a recibir prioridad **Alta**.

---

## Restricciones

- El tipo de envío **no se puede modificar** después de confirmar el envío. Es parte del contrato de servicio y está ligado al precio calculado.
- En borradores, podés cambiarlo libremente antes de confirmar.

---

## Preguntas frecuentes

**¿Puedo cambiar de Normal a Express después de confirmar?**  
No. El tipo de envío queda fijo al confirmar porque el precio ya fue calculado y comprometido. Si necesitás cambiar el tipo, debés cancelar el envío y crear uno nuevo.

**¿El cliente puede elegir el tipo de envío?**  
El cliente no tiene acceso al sistema. El operador elige el tipo según lo acordado con el cliente al tomar el pedido.

**¿El tipo de envío afecta qué vehículos se asignan?**  
No directamente. La asignación de vehículos depende de la sucursal y la capacidad. El tipo de envío solo impacta en precio, fecha estimada y prioridad.
