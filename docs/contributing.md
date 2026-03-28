# Contributing

## Estrategia de branching — Git Flow

Usamos una variante simplificada de Git Flow con dos ramas permanentes:

| Rama | Propósito |
|------|-----------|
| `main` | Producción. Cada merge dispara un deploy automático en Amplify. |
| `develop` | Integración. Base para nuevas features. |

### Tipos de rama

```
feature/<descripcion>     nueva funcionalidad
fix/<descripcion>         corrección de bug
chore/<descripcion>       tareas de mantenimiento (deps, config, docs)
hotfix/<descripcion>      fix urgente directo sobre main
```

### Flujo habitual

1. Crear rama desde `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/mi-feature
   ```

2. Trabajar en la rama. Commits pequeños y descriptivos utilizando el estandar de [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/#summary).

3. Abrir PR hacia `develop`. Requiere al menos una revisión antes de mergear.

4. Cuando `develop` está estable, se mergea a `main` → deploy automático.

### Hotfixes

Los hotfixes se ramifican desde `main` y se mergean a `main` **y** `develop`:

```bash
git checkout main
git checkout -b hotfix/descripcion
# ... fix ...
git checkout main && git merge hotfix/descripcion
git checkout develop && git merge hotfix/descripcion
```

---

## Conventional Commits

Todos los commits deben seguir el estándar [Conventional Commits](https://www.conventionalcommits.org/).

### Formato

```
<tipo>[scope opcional]: <descripción>

[cuerpo opcional]

[footer opcional]
```

### Tipos

| Tipo | Cuándo usarlo |
|------|--------------|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de bug |
| `chore` | Mantenimiento: deps, config, scripts |
| `docs` | Cambios en documentación |
| `refactor` | Refactor sin cambio de comportamiento |
| `test` | Agregar o modificar tests |
| `style` | Formato, espacios, punto y coma (sin cambio lógico) |
| `perf` | Mejora de performance |
| `ci` | Cambios en pipelines de CI/CD |

### Ejemplos

```
feat: agregar endpoint de cancelación de envío
fix: validación de DNI en confirmación de borrador
chore: actualizar dependencias de Go
docs: agregar state-machine al directorio de docs
refactor(shipment): extraer lógica de tracking ID a helper
```


## Pull Requests

- Describir qué cambia y por qué, no cómo.
- No mergear sin revisión, salvo hotfixes urgentes.

---

