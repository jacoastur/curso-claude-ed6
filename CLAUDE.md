# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

La documentación del proyecto (`README.md`, `docs/`) está en español; mantén ese idioma al escribir documentación.

## Visión general

Resttek: plataforma de gestión de restaurantes. Monorepo con **npm workspaces** (`packages/*`): una API (`api`, Express 5 + TypeScript + SQLite) y tres apps Angular 21 (`web-admin`, `web-empleados`, `web-clientes`) más una librería compartida (`web-shared`: auth, interceptors, componentes comunes, tokens). Requiere Node 22+ y npm 10+.

## Comandos (desde la raíz)

```bash
npm install            # instala todos los paquetes
npm run seed           # puebla SQLite (packages/api/resttek.db) con datos de prueba; la contraseña de cada usuario es su email (p. ej. admin@resttek.com)
npm run dev:api        # API en :3000 (tsx watch); comprobar con GET /health
npm run dev:admin      # :4200
npm run dev:empleados  # :4201
npm run dev:clientes   # :4202
npm test               # tests de la API (vitest run)
```

- Un solo test: `npm run test -w @resttek/api -- src/services/order.service.test.ts` (o `-t "nombre del test"`). Modo watch: `npm run test:watch -w @resttek/api`.
- Build de un frontend: `npm run build -w @resttek/web-admin` (análogo para los demás). Los frontends no tienen tests ni lint configurados en los scripts; solo la API tiene tests.
- Los frontends hacen proxy de `/api` a `http://localhost:3000` (`proxy.conf.json`), así que hay que levantar la API primero.
- `scripts/seed-issues.sh` crea issues de GitHub desde `scripts/issues.json` (requiere `gh` y `jq`; ver `scripts/README.md`).

## Arquitectura de la API (`packages/api`)

Conviven **dos estilos** y hay que saber cuál aplica antes de tocar código (detalle en `docs/arquitectura/arquitectura-api.md`):

- **Hexagonal + DDD solo para `employee`** (`src/contexts/employee/{domain,application,infrastructure}`): entidad `Employee` (constructor privado + `create()`), casos de uso (`LoginUseCase`, `CreateEmployeeUseCase`, `RegisterClientUseCase`), repositorio detrás de interfaz (`IEmployeeRepository`) y composición de dependencias en `infrastructure/http/dependencies.ts`. `contexts/shared` contiene el value object `Email`, middlewares (`authenticate`/`authorize`, JWT + roles) y `errorHandler`.
- **Por capas para `restaurant`, `dish`, `ingredient`, `order`**: carpetas transversales `models/` (interfaces planas + normalización), `repositories/` (interfaz + SQLite, mocks en `repositories/mocks`), `services/` (lógica y validación), `controllers/`, `routes/`. No hay entidades con comportamiento.
- `src/app.ts` monta todas las rutas bajo `/api/v1` (incluye rutas públicas `/public/restaurants/...` para clientes y rutas anidadas `/restaurants/:restaurantId/{ingredients,dishes,employees}`). Errores: `src/errors/AppError.ts` y `DomainErrors.ts`, tratados por `errorHandler`.
- Alias de paths (`tsconfig.json`): `@config`, `@errors`, `@shared` (→ `contexts/shared`), `@employee` (→ `contexts/employee`), `@routes`, `@controllers`, `@services`, `@repositories`, `@models`, `@scripts`. Los imports usan extensión `.js` (ESM, `module: nodenext`). Vitest los resuelve con `vite-tsconfig-paths`.
- TS estricto: `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes` activos.
- BD: las tablas se crean al arrancar (migraciones en código, `src/config/database.ts`). Con `NODE_ENV=test` se usa SQLite en memoria. Las FKs/cascadas dependen de que SQLite tenga las foreign keys activadas (hubo una incidencia documentada en `docs/revisiones/inconsistencias-backend.md`).
- Auth: JWT en `Authorization: Bearer`; login en `POST /api/v1/auth/login`.

## Arquitectura de los frontends

Angular 21: componentes standalone, signals, **zoneless** (sin `zone.js`), guards/interceptors funcionales, iconos con `lucide-angular`. Las tres apps **no comparten estructura** (ver `docs/arquitectura/arquitectura-frontend.md`):

- `web-admin` y `web-empleados`: `core/layout` + `features/<feature>/{models,pages,services,store}`; rutas con lazy loading; estado en stores con signals y HTTP envuelto en `firstValueFrom`.
- `web-clientes`: más pequeña; modelos y servicios centralizados en `core/`, features como componentes sueltos; los componentes consumen `Observable` con `.subscribe()`. El componente raíz se llama `App` (en `app.ts`), no `AppComponent`.
- Las apps solo dependen de `@resttek/web-shared`, nunca entre sí.

## Documentación

`docs/arquitectura/` (general, api, frontend), `docs/dominio/` (glosario, modelo de datos) y `docs/revisiones/` (revisiones de inconsistencias doc-vs-código). Actualiza la documentación relevante si cambias la arquitectura o el modelo de datos.
