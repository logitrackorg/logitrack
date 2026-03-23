# logitrack_web

Frontend SPA del sistema LogiTrack, construido con React, Vite y TypeScript.

## Requisitos

- Node.js 18 o superior
- npm 9 o superior
- El backend (`logitrack_core`) corriendo en `http://localhost:8080`

## Levantar el servidor de desarrollo

```bash
# Desde la raíz del repo
cd logitrack_web

# Instalar dependencias
npm install

# Iniciar el servidor de desarrollo (puerto 5173)
npm run dev
```

La app queda disponible en `http://localhost:5173`.

## Otros comandos

```bash
# Type-check + build de producción (genera /dist)
npm run build

# Preview del build de producción
npm run preview

# Lint
npm run lint
```

`npm run build` corre `tsc -b` antes de Vite — usarlo para validar TypeScript antes de deployar.


## Notas

- Si el backend se reinicia, los tokens de sesión quedan inválidos. El interceptor de la API detecta el 401, limpia el localStorage y redirige automáticamente al login.
- El seguimiento público (`/track`) no requiere login.
- Los conductores ven una vista diferente al acceder al detalle de un envío (`DriverShipmentDetail`), optimizada para actualizar el estado desde la ruta.
- Los supervisores y admins pueden corregir campos de un envío confirmado (botón "Edit data") y cancelar envíos en estado intermedio.
