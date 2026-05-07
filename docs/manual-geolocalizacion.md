# Manual de usuario — Geolocalización de direcciones

**Roles**: Operador, Supervisor  
**Módulo**: Nuevo envío / Borrador

---

## ¿Qué es la geolocalización de direcciones?

Al completar la dirección del remitente o destinatario en el formulario de nuevo envío, el sistema busca automáticamente la ubicación en el mapa y completa los campos restantes por vos. Esto reduce errores de tipeo y garantiza que el sistema tenga las coordenadas necesarias para calcular distancias, precio y fecha estimada de entrega.

---

## Cómo funciona paso a paso

### 1. Empezá a escribir en el campo "Calle"

Ingresá al menos **5 caracteres** en el campo "Calle" (por ejemplo: `Av. Corrientes 12`).

Después de 400 milisegundos de inactividad, el sistema consulta automáticamente el servicio de mapas. Mientras busca, aparece el texto **"buscando..."** junto al campo.

### 2. Seleccioná una sugerencia del listado

Si se encuentran resultados, aparece una lista desplegable con hasta 5 direcciones. Cada opción muestra la dirección completa con ciudad y provincia.

> **Hacé clic sobre la opción correcta.**

El sistema completa automáticamente los siguientes campos:
- Calle y número
- Ciudad
- Provincia
- Código postal
- Coordenadas geográficas (usadas internamente para calcular distancia y precio)

### 3. Si no aparecen sugerencias

El sistema muestra el mensaje: **"No se encontró la dirección. Podés completar los campos manualmente."**

En ese caso, completá los campos a mano. El envío se puede crear igualmente, pero el cálculo de distancia usará datos por provincia en lugar de coordenadas exactas, lo que puede afectar la precisión del precio y la fecha estimada.

---

## Preguntas frecuentes

**¿Necesito dar permiso de ubicación al navegador?**  
No. El sistema busca la dirección que vos escribís, no tu ubicación actual. No se solicitan permisos al navegador.

**¿Solo funciona con direcciones de Argentina?**  
Sí. La búsqueda está restringida al territorio argentino.

**¿Qué pasa si selecciono una sugerencia incorrecta?**  
Podés corregir cualquier campo manualmente después de seleccionar. Los campos son editables. Si las coordenadas quedaron mal, borrá el campo "Calle" y buscá de nuevo.

**¿Puedo ignorar las sugerencias y completar todo a mano?**  
Sí. Las sugerencias son opcionales. Si preferís completar la dirección manualmente, simplemente no seleccionés ninguna opción del listado.

**¿Afecta al precio si no se capturan las coordenadas?**  
El precio y la fecha estimada se calculan igual, pero con menor precisión. Sin coordenadas, el sistema usa la distancia aproximada entre provincias como referencia.

---

## Buenas prácticas

- Incluí el número de calle desde el inicio (ej: `Rivadavia 1500` en lugar de solo `Rivadavia`).
- Si la dirección tiene piso o departamento, completalo manualmente en el campo correspondiente después de seleccionar la sugerencia.
- En localidades pequeñas o barrios privados, las sugerencias pueden no aparecer. En ese caso, completá manualmente y usá la provincia correcta para que el cálculo de distancia sea razonable.
