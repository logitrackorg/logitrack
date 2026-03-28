# US-018 — Registro de acceso (login / logout)

**Como** usuario
**Quiero** iniciar y cerrar sesión
**Para** acceder de forma segura al sistema

---

## Criterios de aceptación

1. Credenciales válidas autentican al usuario y redirigen a la vista principal según su rol.
2. Credenciales inválidas muestran un mensaje de error y no permiten el acceso.
3. Al cerrar sesión el usuario es redirigido al login y no puede acceder a rutas protegidas.

---

## Modelo de datos

### Solicitud de login

| Campo      | Tipo   | Notas      |
|------------|--------|------------|
| `username` | string | Requerido  |
| `password` | string | Requerido  |

### Respuesta de login

| Campo         | Tipo   | Notas                                      |
|---------------|--------|--------------------------------------------|
| `token`       | string | UUID generado en el servidor               |
| `user.id`     | string |                                            |
| `user.username` | string |                                          |
| `user.role`   | string | `operator`, `supervisor`, `manager`, `admin`, `driver` |

---

## Reglas de negocio

1. El servidor genera un token UUID por sesión y lo almacena en memoria. El token es válido hasta que se haga logout o el servidor se reinicie.
2. El frontend almacena `token` y `user` en `localStorage`. Al recargar la página, la sesión se recupera automáticamente.
3. Si el servidor se reinicia, el token almacenado en el cliente queda inválido. La primera petición autenticada devuelve `401` → el interceptor borra el `localStorage` y redirige a `/login`.
4. El logout invalida el token en el servidor (`DELETE` desde la memoria) y borra `localStorage` en el cliente.
5. Las rutas protegidas redirigen a `/login` cuando no hay sesión activa.

---

## Redirect por rol tras login

| Rol         | Vista inicial        |
|-------------|----------------------|
| operator    | `/` (ShipmentList)   |
| supervisor  | `/` (ShipmentList)   |
| manager     | `/` (ShipmentList)   |
| admin       | `/` (ShipmentList)   |
| driver      | `/driver/route`      |

> El driver es redirigido a `/driver/route` porque App.tsx mapea cualquier ruta desconocida a `/driver/route` cuando el rol es `driver`. Para los demás roles, la vista de entrada es la lista de envíos.

---

## Endpoints

| Método | Path                    | Auth requerida | Descripción                             |
|--------|-------------------------|----------------|-----------------------------------------|
| POST   | `/api/v1/auth/login`    | No             | Autentica y devuelve token + user       |
| POST   | `/api/v1/auth/logout`   | Sí (Bearer)    | Invalida el token en el servidor        |
| GET    | `/api/v1/auth/me`       | Sí (Bearer)    | Devuelve el usuario autenticado actual  |

---

## Comportamiento del frontend

1. La pantalla `/login` es accesible sin autenticación.
2. Si un usuario ya autenticado navega a `/login`, es redirigido a `/`.
3. El formulario muestra un mensaje de error inline si las credenciales son inválidas.
4. El botón "Sign In" muestra el estado `Signing in...` durante la petición.
5. El botón "Sign out" en la barra de navegación llama a `POST /auth/logout`, limpia `localStorage` y vacía el estado de AuthContext — el usuario queda en `/login`.
6. Cualquier ruta protegida visitada sin sesión redirige a `/login`.
7. El interceptor de respuesta `401` en `api/shipments.ts` actúa como logout automático: borra `localStorage` y redirige a `/login` sin interacción del usuario.

---

## Escenarios

### CA1 — Login con credenciales válidas

- **Dado** que el usuario ingresa `operator / operator123`
- **Cuando** hace submit del formulario
- **Entonces** el servidor responde `200 OK` con `{ token, user: { role: "operator" } }`
- **Y** el frontend almacena token y user en `localStorage`
- **Y** el frontend redirige a `/`

### CA2 — Login con credenciales inválidas

- **Dado** que el usuario ingresa una contraseña incorrecta
- **Cuando** hace submit del formulario
- **Entonces** el servidor responde `401 Unauthorized` con `"invalid username or password"`
- **Y** el frontend muestra el mensaje de error bajo el formulario
- **Y** no se almacena ningún token ni se redirige

### CA3 — Login con campos vacíos

- **Dado** que el usuario envía el formulario con username o password vacíos
- **Cuando** el servidor recibe la petición
- **Entonces** responde `400 Bad Request`
- **Y** el frontend muestra un error (los campos tienen `required` en HTML)

### CA4 — Login del driver redirige a su ruta

- **Dado** que el usuario ingresa `chofer / chofer123`
- **Cuando** hace submit del formulario
- **Entonces** el servidor responde `200 OK` con `role: driver`
- **Y** el frontend redirige a `/driver/route`

### CA5 — Logout exitoso

- **Dado** que el usuario está autenticado
- **Cuando** hace clic en "Sign out"
- **Entonces** el frontend llama a `POST /api/v1/auth/logout` con el Bearer token
- **Y** el servidor elimina el token de su memoria
- **Y** el frontend borra `localStorage` y limpia el estado de AuthContext
- **Y** el usuario es redirigido a `/login`

### CA6 — Acceso a ruta protegida sin sesión

- **Dado** que el usuario no está autenticado
- **Cuando** intenta navegar directamente a `/shipments/LT-XXXXXXXX`
- **Entonces** el frontend redirige a `/login`
- **Y** tras autenticarse, el usuario llega a la vista principal de su rol (no necesariamente a la URL original)

### CA7 — Persistencia de sesión al recargar

- **Dado** que el usuario está autenticado y recarga la página
- **Cuando** `AuthProvider` se monta
- **Entonces** recupera token y user de `localStorage`
- **Y** el usuario permanece autenticado sin necesidad de volver a hacer login

### CA8 — Expiración de sesión por reinicio del servidor

- **Dado** que el usuario tiene un token válido en `localStorage`
- **Y** el servidor fue reiniciado (borrando todos los tokens en memoria)
- **Cuando** el frontend hace cualquier petición autenticada
- **Entonces** el servidor responde `401 Unauthorized`
- **Y** el interceptor borra `localStorage` y redirige a `/login` automáticamente

### CA9 — Usuario ya autenticado accede a /login

- **Dado** que el usuario está autenticado
- **Cuando** navega a `/login`
- **Entonces** el frontend redirige a `/`
