# Contributing to LogiTrack

## Branch strategy

This project follows [Gitflow](https://nvie.com/posts/a-successful-git-branching-model/). `main` is production and auto-deploys to Amplify. All development is based on `develop`.

```
feature/<description>   new functionality — branch from develop, merge back to develop
fix/<description>       bug fix — branch from develop, merge back to develop
chore/<description>     maintenance (deps, config, docs) — branch from develop, merge back to develop
release/<version>       release preparation — branch from develop, merge to main AND develop
hotfix/<description>    urgent fix — branch from main, merge back to main AND develop
```

## Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat:      new feature
fix:       bug fix
chore:     maintenance, deps, config
docs:      documentation only
refactor:  code restructure without behavior change
test:      adding or fixing tests
style:     formatting, no logic change
perf:      performance improvement
ci:        CI/CD changes
```

Example: `feat: add delivery_failed → at_branch transition`

## Pull requests

- Open PRs against `develop` (not `main`).
- Require at least one review before merging. Hotfixes are the exception.
- Keep PRs focused — one concern per PR.

## Backend (`logitrack_core/`)

Validate before pushing:

```bash
go build ./...
go mod tidy
```

Architecture: `handler → service → repository`. New endpoints follow this sequence:

1. Add model to `internal/model/` if needed.
2. Add method to the repository interface and implementation.
3. Add method to the service.
4. Add handler and register route in `main.go` with the appropriate role middleware.

## Frontend (`logitrack_web/`)

Validate before pushing:

```bash
npm run build   # runs tsc + vite
npm run lint
```

- All UI text must be in **English** — no Spanish strings in the frontend.
- Use `fmtDate` / `fmtDateTime` from `src/utils/date.ts` for all date display.
- Branches are always fetched from the API — never hardcoded.

## Specs

New features should have a spec written first under `docs/specs/` in Given/When/Then format. See `docs/specs/00-indice.md` for structure.
