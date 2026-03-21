# Cómo levantar el frontend

## Requisitos

- Node.js 18+
- npm

## Primera vez (instalar dependencias)

```bash
cd logitrack_web
npm install
```

## Levantar el servidor de desarrollo

```bash
cd logitrack_web
npm run dev
```

La app queda disponible en **http://localhost:5173**.

## Otros comandos

```bash
# Type-check + build de producción
npm run build

# Lint
npm run lint

# Preview del build de producción
npm run preview
```

## Notas

- Requiere el backend corriendo en `http://localhost:8080` (ver `../logitrack_core/RUNNING.md`).
- Para apuntar a otra URL de API, crear un archivo `.env.local` con:
  ```
  VITE_API_URL=http://otra-url/api/v1
  ```
