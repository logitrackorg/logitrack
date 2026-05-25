# LOGITRACK-357: Definir zona peligrosa

**CA-01:** En el menú principal veo el link "Zonas" (admin) que me lleva a una pantalla con un sidebar de zonas existentes y un mapa central. Otros roles no ven el link.

| TC | CA | Given | When | Then | Datos de Entrada |
|---|---|---|---|---|---|
| TC-131 | CA-01 | El usuario tiene rol admin y está logueado en el sistema | Navega por el menú | Ve el link "Zonas" en el menú | y al hacer click accede a /admin/zones con sidebar de zonas y mapa central | {user_role: "admin"} |
| TC-132 | CA-01b | El usuario tiene rol operador y está logueado en el sistema | Navega por el menú | No ve el link "Zonas" en el menú | y no tiene acceso a /admin/zones | {user_role: "operator"} |

**CA-02:** Al apretar "Dibujar nueva zona", el cursor sobre el mapa se transforma en cruz y cada click suma un vértice marcado con un círculo. La línea entre vértices y el polígono que se va formando se muestran en tiempo real.

| TC | CA | Given | When | Then | Datos de Entrada |
|---|---|---|---|---|---|
| TC-133 | CA-02 | El admin está en la pantalla /admin/zones con el mapa cargado | Hace click en el botón "Dibujar nueva zona" | El cursor cambia a cruz | y cada click agrega un vértice marcado con un círculo | {action: "start_drawing"} |
| TC-134 | CA-02b | El admin está en modo dibujo y ya hizo click en 2 puntos | Hace click en el tercer punto | Se visualiza el polígono parcial con líneas entre los 3 vértices | el área se completa y se muestra en tiempo real | {drawn_points: [{lat:-34.65, lng:-58.48}, {lat:-34.67, lng:-58.46}], click: {lat:-34.66, lng:-58.44}} |

**CA-03:** Al cerrar el polígono se abre un modal pidiendo nombre (obligatorio) y descripción (opcional), y aclarando que las zonas peligrosas aplican recargo en envíos de última milla.

| TC | CA | Given | When | Then | Datos de Entrada |
|---|---|---|---|---|---|
| TC-135 | CA-03 | El admin dibujó un polígono con al menos 3 puntos y cerró el polígono | Hace click en el primer punto para cerrar | Se abre un modal con campos nombre (obligatorio) | y descripción (opcional), y texto "⚠️ Las zonas peligrosas aplican recargo en envíos de última milla" | {polygon_closed: true, points: [{lat:-34.65, lng:-58.48}, {lat:-34.67, lng:-58.46}, {lat:-34.66, lng:-58.44}]} |
| TC-136 | CA-03b | El admin tiene abierto el modal de creación de zona | Deja el campo nombre vacío y hace click en "Guardar" | Muestra mensaje de error "El nombre es obligatorio" | y no permite guardar | {name: ""} |
| TC-137 | CA-03c | El admin tiene abierto el modal de creación de zona | Completa el nombre "Villa Soldati - noche", deja descripción vacía, y hace click en "Guardar" | El sistema crea la zona, la persiste en la base | y la muestra en el sidebar y en el mapa | {name: "Villa Soldati - noche", description: ""} |

---

# LOGITRACK-365: Visualización recargo en precio del envío

**CA-01:** En la cotización en vivo del formulario de nuevo envío, cuando aplica el recargo, aparece la línea "⚠️  Recargo zona peligrosa" con el monto formateado en pesos argentinos.

| TC | CA | Given | When | Then | Datos de Entrada |
|---|---|---|---|---|---|
| TC-138 | CA-01 | El operador llena el formulario de nuevo envío y el destino cae dentro de una zona peligrosa activa | Se procesa la cotización (GET /pricing/quote) | El breakdown incluye la línea "⚠️ Recargo zona peligrosa" | con el monto en ARS formateado | {recipient: {address: {latitude: -34.65, longitude: -58.48}}, delivery_method: "ultima_milla"} |
| TC-139 | CA-01b | El operador llena el formulario de nuevo envío y el destino NO cae en ninguna zona peligrosa | Se procesa la cotización (GET /pricing/quote) | El breakdown NO incluye la línea "Recargo zona peligrosa" | | {recipient: {address: {latitude: -34.70, longitude: -58.50}}, delivery_method: "ultima_milla"} |

**CA-02:** En el detalle del envío confirmado, el desglose de precio incluye la misma línea con el mismo monto que se cobró al confirmar.

| TC | CA | Given | When | Then | Datos de Entrada |
|---|---|---|---|---|---|
| TC-140 | CA-02 | Existe un envío confirmado con destino en zona peligrosa y su price_breakdown incluye risky_zone_surcharge | El supervisor abre /shipments/:tracking_id | En la card de precio, al expandir "Ver desglose" | se ve la línea "⚠️ Recargo zona peligrosa" con el monto cobrado | {tracking_id: "LT-XXXXXXXX", price_breakdown: {risky_zone_surcharge: 5000}} |

**CA-03:** La línea solo aparece cuando el monto es mayor a cero.

| TC | CA | Given | When | Then | Datos de Entrada |
|---|---|---|---|---|---|
| TC-141 | CA-03 | El operador llena el formulario y el destino no está en zona peligrosa | Se procesa la cotización (GET /pricing/quote) | El breakdown.risky_zone_surcharge es 0 | la línea "Recargo zona peligrosa" no se renderiza en la UI | {risky_zone_surcharge: 0} |

**CA-04:** Esta línea no se muestra en la página pública de seguimiento (/track) ni en la pantalla del chofer: el cliente final y el repartidor no necesitan ver el desglose de costos.

| TC | CA | Given | When | Then | Datos de Entrada |
|---|---|---|---|---|---|
| TC-142 | CA-04 | Existe un envío confirmado con destino en zona peligrosa | Un cliente consulta el envío en /track?id=LT-XXXXXXXX | La página muestra la información del envío y estado | No se muestra desglose de precio ni "Recargo zona peligrosa" | {tracking_id: "LT-XXXXXXXX", page: "/track"} |
| TC-143 | CA-04b | Un chofer está en su pantalla de ruta /driver/route | Ve los envíos asignados | Ve la información del envío (tracking, dirección, estado) | no ve el desglose de precio ni "Recargo zona peligrosa" | {user_role: "driver", page: "/driver/route"} |