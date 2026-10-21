# Corrección de vulnerabilidades OWASP Top 10 (API y web-empleados)

- **Tipo**: bug
- **Fecha**: 2026-10-21
- **Estado**: Pendiente

## 1. Contexto y objetivo

Una auditoría de solo lectura de `packages/api` y `packages/web-empleados` (más `web-shared`) ha detectado 0 vulnerabilidades críticas, varias altas y otras medias y bajas. Las más graves son de control de acceso (A01): cualquier usuario autenticado, incluido un cliente recién registrado, puede leer y modificar pedidos de cualquier restaurante, y los roles de staff pueden operar sobre otros restaurantes cambiando el `:restaurantId` de la URL.

Objetivo: corregirlas por orden de prioridad, imponiendo la seguridad en el **backend** (los guards del frontend solo son UX).

Hallazgos (IDs de los informes de auditoría):

| ID | Sev. | OWASP | Resumen |
| -- | ---- | ----- | ------- |
| SEC-01 | Alta | A01 | `GET /orders/:id` sin comprobar propietario ni restaurante |
| SEC-02 | Alta | A01 | `GET /orders/active` abierto a cualquier usuario autenticado y con `restaurantId` de la query |
| SEC-03 | Alta | A01 | `PATCH /orders/:orderId/items/:itemId/status` sin `authorize` ni pertenencia |
| SEC-04 | Alta | A01 | Rutas `/restaurants/:restaurantId/*` sin aislamiento por restaurante; `PUT`/`DELETE` de platos ignoran `restaurantId` |
| SEC-05 | Media | A04 | `createOrder` sin validar `quantity`/`items` (DoS) |
| SEC-06 | Media | A07 | Sin rate limiting en `/auth/*` |
| SEC-07 | Media | A07/A05 | Seed con contraseña igual al email |
| SEC-08 | Media | A02/A05 | `JWT_SECRET` por defecto público y duplicado |
| SEC-09 | Media | A05/A09 | `OrderController` devuelve `error.message` crudo |
| SEC-10 | Media | A01/A04 | `POST /employees` sin validar coherencia rol/restaurante |
| SEC-11 | Media | A07 | Sin política de contraseñas |
| SEC-12 | Baja | A01/A04 | DTO público de restaurantes expone email, teléfono y propietario |
| SEC-13 | Baja | A04 | Enumeración de usuarios, diferencia de tiempos, email sin normalizar |
| SEC-14 | Baja | A09 | Sin logging de eventos de seguridad ni de errores 500 |
| SEC-15 | Baja | A05 | CORS abierto, sin `helmet` |
| SEC-16 | Baja | A02/A07 | JWT de 8 h sin revocación |
| SEC-17 | Media | A06 | `npm audit` de la API (tar, qs, proxy-addr, sqlite3) |
| H-02 | Alta | A06 | `@angular/*` 21.2.x con advisories |
| H-03 | Media | A02/A07 | JWT y usuario en localStorage; `JSON.parse` sin `try/catch` |
| H-04 | Media | A01 | `roleGuard` basado en rol editable de localStorage |
| H-05 | Media | A07 | Sin comprobar `exp`; logout no para polling ni vacía stores; bandera `isRedirecting` frágil |
| H-07 | Baja | A05 | Sin CSP; `sourceMap` en tsconfig |
| H-08 | Baja | A07 | Contraseña mínima de 6 caracteres en cliente |
| H-09 | Baja | A09 | Errores técnicos mostrados al usuario |
| H-10 | Baja | A07 | `authInterceptor` añade el Bearer a cualquier URL |

## 2. Alcance

### Incluye

- Control de acceso y aislamiento por restaurante en la API (SEC-01 a SEC-04, SEC-10).
- Secreto JWT, seed, validación de entrada, rate limiting y política de contraseñas (SEC-05 a SEC-08, SEC-11).
- Cabeceras, CORS, logging y manejo de errores (SEC-09, SEC-14, SEC-15).
- DTO público, enumeración de usuarios y email normalizado (SEC-12, SEC-13).
- Actualización de dependencias vulnerables (SEC-17, H-02).
- Endurecimiento de `web-shared` y `web-empleados` (H-03, H-04, H-05, H-07 a H-10).
- Tests de la API para los cambios de autorización y validación.

### No incluye

- Migrar el JWT a cookie `HttpOnly`: decisión tomada, se **mantiene el Bearer** en la cabecera `Authorization`.
- Cambiar `sqlite3` por `better-sqlite3` o migrar a `sqlite3@6` si rompe la API (se evalúa en T25).
- Servidor de producción y cabeceras HTTP del hosting de los frontends (solo se añade una CSP en `index.html`).
- `web-admin` y `web-clientes`, salvo los cambios inevitables en `web-shared`.

## 3. Análisis del código actual

Causas raíz verificadas en el código:

- `routes/order.routes.ts`: todas las rutas usan solo `authenticate`. `OrderController.getActiveOrders` toma `restaurantId` de la query y no mira `req.user`; `getById` y `updateItemStatus` tampoco.
- `contexts/shared/infrastructure/http/middlewares.ts`: `authorize(roles)` solo comprueba el rol. No existe ninguna comprobación de pertenencia al restaurante. `req.user` se tipa como `any`. `JWT_SECRET` tiene valor por defecto y se redefine en `contexts/employee/infrastructure/BcryptAuthService.ts` (que firma con `expiresIn: '8h'`).
- `routes/dish.routes.ts`, `ingredient.routes.ts`, `restaurant.routes.ts` y `restaurant-employee.routes.ts`: usan `authorize` por rol pero ninguna compara `:restaurantId` con el del JWT. `GET /restaurants` y `GET /restaurants/:id` solo exigen autenticación.
- `app.ts`: `app.use(cors())` abierto, sin `helmet`, sin rate limiting, sin logger.
- `contexts/employee/infrastructure/http/auth.routes.ts`: `/login` y `/register` sin límite de intentos.
- `scripts/seed.ts`: la contraseña de cada usuario es su email.

| Capa | Fichero | Cambio previsto |
| ---- | ------- | --------------- |
| shared | `packages/api/src/config/env.ts` (nuevo) | Config centralizada de `JWT_SECRET`, `CORS_ORIGINS`; falla si falta el secreto |
| shared | `packages/api/src/contexts/shared/infrastructure/http/middlewares.ts` | Usar config, `algorithms: ['HS256']`, tipar `req.user`, añadir `assertRestaurantAccess` |
| employee | `packages/api/src/contexts/employee/infrastructure/BcryptAuthService.ts` | Usar config centralizada; `issuer`/`audience`; expiración configurable |
| employee | `.../application/LoginUseCase.ts`, `RegisterClientUseCase.ts`, `CreateEmployeeUseCase.ts` | Email normalizado, política de contraseñas, `compare` ficticio, coherencia rol/restaurante |
| routes | `packages/api/src/routes/order.routes.ts` | `authorize` por ruta |
| controllers | `packages/api/src/controllers/order.controller.ts` | Usar `req.user`, `next(error)`, sin `error.message` crudo |
| services | `packages/api/src/services/order.service.ts` | Validar entrada; comprobar pertenencia en `getById` y `updateItemStatus` |
| routes | `dish.routes.ts`, `ingredient.routes.ts`, `restaurant.routes.ts`, `restaurant-employee.routes.ts` | Aplicar `assertRestaurantAccess` |
| services/repositories | `dish.service.ts`, `repositories/dish.repository.ts` | `PUT`/`DELETE` filtrando por `id` y `restaurant_id` |
| controllers | `restaurant.controller.ts` | DTO público reducido |
| app | `packages/api/src/app.ts` | `helmet`, CORS con lista blanca, rate limiting, logger, `x-powered-by` fuera |
| scripts | `packages/api/src/scripts/seed.ts` | Contraseñas desde env o aleatorias; bloqueo en producción |
| frontend | `packages/web-shared/src/lib/auth/auth.store.ts`, `auth.service.ts` | `try/catch` en parseo, comprobar `exp`, limpiar sesión |
| frontend | `packages/web-shared/src/lib/http/auth.interceptor.ts`, `error.interceptor.ts` | Limitar Bearer a `apiUrl`; simplificar gestión de 401 |
| frontend | `packages/web-shared/src/lib/components/register/register.component.ts` | Mínimo de contraseña alineado con la API |
| frontend | `packages/web-empleados/src/app/features/orders/store/order.store.ts` | Parar polling y vaciar estado al cerrar sesión |
| frontend | `packages/web-empleados/src/index.html`, `angular.json` | CSP; `sourceMap: false` en producción |
| deps | `package.json` raíz y de paquetes | Actualizar `@angular/*` a >=21.2.25 y dependencias del audit |

## 4. Diseño de la solución

### Autorización (SEC-01 a SEC-04, SEC-10)

Se añade en `middlewares.ts`:

- `assertRestaurantAccess(paramName = 'restaurantId')`: deja pasar a `admin`; para el resto exige `req.params[paramName] === req.user.restaurantId`, o 403.
- Tipo `AuthUser { id, role, restaurantId }` para sustituir el `any`.

Pedidos:

- `GET /orders/active`: `authorize(['admin','manager','camarero','cocinero'])`. Para no admin se ignora la query y se usa `user.restaurantId`. El admin debe indicar `restaurantId`.
- `GET /orders/:id`: el servicio carga el pedido y lo devuelve solo si `order.clientId === user.id`, o si el rol es de staff y `order.restaurantId === user.restaurantId`, o si es admin. En otro caso responde **404** (no revela existencia).
- `PATCH .../status`: `authorize(['admin','manager','camarero','cocinero'])` y comprobación de que el pedido pertenece al restaurante del usuario.
- `POST /orders` y `GET /orders/mine` siguen abiertos a cualquier usuario autenticado.

Restaurantes anidados: `assertRestaurantAccess()` tras `authorize` en dishes, ingredients y employees. En `dish.service.ts` y su repositorio, `getById`, `update` y `delete` consultan `WHERE id = ? AND restaurant_id = ?`. `GET /restaurants/:id` queda restringido con `assertRestaurantAccess('id')`; `GET /restaurants` queda solo para admin (la lista pública ya existe en `/public/restaurants`).

Empleados: `CreateEmployeeUseCase` valida que staff (`manager`, `camarero`, `cocinero`) lleve `restaurantId` existente y que `admin` y `cliente` no lo lleven.

Alternativa descartada: filtrar por restaurante en cada controlador; se prefiere un único middleware y consultas con `restaurant_id` en la capa de datos.

### Secreto y tokens (SEC-08)

`config/env.ts` exporta `JWT_SECRET`. Si falta o mide menos de 32 caracteres, la API **no arranca** salvo `NODE_ENV=test` (valor fijo de prueba) o `NODE_ENV=development` con un secreto de desarrollo explícito en `.env.example`. `jwt.verify` fija `algorithms: ['HS256']` y comprueba `issuer`/`audience`. El access token pasa a ser de vida corta: `JWT_EXPIRES_IN` configurable, por defecto 15 min.

### Refresh token (SEC-16, H-03, H-05)

Decisión del usuario: el access token se sigue enviando como `Authorization: Bearer` (sin cookies) y se añade refresh token.

- **Refresh token opaco** (32 bytes aleatorios con `crypto.randomBytes`, no JWT). En BD solo se guarda su hash SHA-256 en la tabla nueva `refresh_tokens` (`id`, `employee_id`, `token_hash`, `family_id`, `expires_at`, `revoked_at`, `replaced_by`), con FK a empleados y borrado en cascada. Duración por defecto: 7 días (`REFRESH_TOKEN_TTL_DAYS`).
- `POST /api/v1/auth/login` devuelve `{ token, refreshToken, user }` (se mantiene `token` por compatibilidad con los tres frontends).
- `POST /api/v1/auth/refresh` con `{ refreshToken }`: valida hash, caducidad y que no esté revocado; **rota** el token (revoca el usado y emite uno nuevo de la misma familia); **vuelve a leer el empleado en BD** para reflejar cambios de rol y restaurante, y rechaza si fue eliminado. Si se presenta un token ya usado (reutilización), se revoca toda la familia y responde 401.
- `POST /api/v1/auth/logout` con `{ refreshToken }`: revoca la familia. Responde 204 aunque el token no exista.
- Ambos endpoints llevan rate limiting. Errores: 401 genérico, sin distinguir la causa.
- Frontend: `auth.store.ts` guarda el refresh token en localStorage junto al access token. Se asume el riesgo ante XSS y se mitiga con la CSP estricta y la rotación con detección de reutilización. El `error.interceptor.ts`, ante un 401, hace **un único** refresh compartido entre peticiones concurrentes, reintenta la petición original y, si falla, limpia la sesión y navega a `/login`. Las llamadas a `/auth/refresh` y `/auth/login` no se reintentan.
- Alternativa descartada: cookie `HttpOnly` para el refresh token (requeriría CSRF, CORS con credenciales y proxy; el usuario prefiere mantener Bearer).

### Validación y contraseñas (SEC-05, SEC-11)

- `createOrder`: `items` es un array de 1 a 50 elementos, `quantity` es un entero entre 1 y 50, `dishId` existe, pertenece al `restaurantId` del pedido y está disponible, y el restaurante existe. Los errores son `ValidationError` (400) de `@errors`.
- Contraseña: de 10 a 72 caracteres y distinta del email. La misma regla se aplica en registro y creación de empleados. Si falta `password` se devuelve 400, no 500.
- Se evalúa `zod` como dependencia solo si encaja con el estilo del proyecto; si no, validación manual en los servicios.

### Endurecimiento HTTP (SEC-06, SEC-09, SEC-14, SEC-15)

- `helmet()`, `app.disable('x-powered-by')`, `cors({ origin: CORS_ORIGINS })` (lista blanca de 4200, 4201 y 4202 en desarrollo).
- `express-rate-limit` en `/api/v1/auth/*` (p. ej. 10 intentos por 15 min y por IP) y `express.json({ limit: '100kb' })` explícito.
- `OrderController` pasa a `next(error)` y el `errorHandler` traduce los errores de dominio. `errorHandler` registra con `console.error` estructurado los 500, y se registran en el log los login fallidos, 401/403 y altas de admin. No se introduce una librería de logging salvo que se decida (sección 7).

### Autenticación (SEC-13, SEC-07)

Email con `trim().toLowerCase()` al registrar, crear y hacer login (más una migración que normaliza los emails existentes). `LoginUseCase` hace un `bcrypt.compare` ficticio si el email no existe. El registro mantiene el 400 por email duplicado (decisión de producto; ver sección 7). El seed toma la contraseña de `SEED_PASSWORD` o genera una aleatoria que imprime una vez, y aborta con `NODE_ENV=production`.

### Frontend

- `auth.store.ts`: `try/catch` en el parseo, tipado de `user`, decodificar `exp` del JWT y que `isAuthenticated` sea falso si caducó; `clearSession` programa el cierre en `exp`.
- `OrderStore`: método `reset()` que para el polling y vacía señales, invocado al cerrar sesión.
- `error.interceptor.ts`: gestionar el 401 sin `setTimeout`; limpiar sesión y navegar una sola vez.
- `auth.interceptor.ts`: solo añade el Bearer si `req.url.startsWith(environment.apiUrl)`.
- Mensajes de error genéricos en la UI; el detalle va a `console.error` solo en desarrollo.
- `roleGuard` se mantiene como UX; se documenta que el backend impone los roles.
- CSP en `index.html` (decisión confirmada), estricta por ser la principal defensa del token en localStorage: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`. `unsafe-inline` solo en estilos, porque Angular los inyecta. `frame-ancestors` no funciona en `<meta>`, así que se deja para la cabecera del servidor. Además, `sourceMap: false` en la configuración de producción de `angular.json`.

## 5. Lista de tareas

Cada tarea debe poder hacerse en 5-10 minutos y tener un resultado verificable. Las tareas siguen la prioridad pedida: bloque A (T1-T14) autorización; B (T15-T18) secreto y seed; C (T19-T25) validación, rate limiting y contraseñas; D (T26-T30) dependencias y cabeceras; E (T31-T41) resto y frontend; F (T42-T44) documentación; G (T45-T55) refresh token.

**A. Control de acceso (SEC-01 a SEC-04, SEC-10)**

- [x] **T1** – Definir el tipo `AuthUser` y tipar `AuthRequest.user` en lugar de `any` · `packages/api/src/contexts/shared/infrastructure/http/middlewares.ts` · ⏱ 5 min
- [x] **T2** – Añadir el middleware `assertRestaurantAccess(paramName)` (admin pasa; resto exige coincidencia con `user.restaurantId`, si no 403) · `middlewares.ts` · ⏱ 8 min
- [x] **T3** – Tests unitarios de `authorize` y `assertRestaurantAccess` (admin, mismo restaurante, otro restaurante, sin restaurante) · `packages/api/src/contexts/shared/infrastructure/http/middlewares.test.ts` (nuevo) · ⏱ 10 min
- [ ] **T4** – `OrderService.getById(id, user)`: devolver el pedido solo al cliente propietario, al staff del mismo restaurante o al admin; si no, `OrderNotFoundError` · `packages/api/src/services/order.service.ts` · ⏱ 10 min
- [ ] **T5** – `OrderService.updateItemStatus` y `listActive` reciben el usuario; comprobar que el pedido es de su restaurante (admin exento) · `order.service.ts` · ⏱ 10 min
- [ ] **T6** – Tests de `order.service` para IDOR: cliente ajeno, staff de otro restaurante, propietario y admin · `packages/api/src/services/order.service.test.ts` · ⏱ 10 min
- [ ] **T7** – `OrderController`: pasar `req.user` al servicio, usar `restaurantId` del JWT para no admin en `getActiveOrders` · `packages/api/src/controllers/order.controller.ts` · ⏱ 8 min
- [ ] **T8** – Añadir `authorize` por ruta en pedidos (`active` y `PATCH` solo staff y admin) · `packages/api/src/routes/order.routes.ts` · ⏱ 5 min
- [ ] **T9** – Aplicar `assertRestaurantAccess()` en las rutas de platos · `packages/api/src/routes/dish.routes.ts` · ⏱ 5 min
- [ ] **T10** – Hacer que `getById`, `update` y `delete` de platos filtren por `id` y `restaurant_id` (repositorio, servicio y controlador) · `packages/api/src/repositories/dish.repository.ts`, `services/dish.service.ts`, `controllers/dish.controller.ts` · ⏱ 10 min
- [ ] **T11** – Tests de `dish.service` (plato de otro restaurante devuelve no encontrado en get, update y delete) · `packages/api/src/services/dish.service.test.ts` (nuevo) · ⏱ 10 min
- [ ] **T12** – Aplicar `assertRestaurantAccess()` en ingredientes y en empleados anidados, y comprobar en ingredientes que el id pertenece al restaurante de la ruta · `routes/ingredient.routes.ts`, `contexts/employee/infrastructure/http/restaurant-employee.routes.ts` · ⏱ 8 min
- [ ] **T13** – Restringir `GET /restaurants` a admin y `GET /restaurants/:id` con `assertRestaurantAccess('id')` · `packages/api/src/routes/restaurant.routes.ts` · ⏱ 5 min
- [ ] **T14** – `CreateEmployeeUseCase`: validar coherencia rol/`restaurantId` (existencia incluida) y test · `contexts/employee/application/CreateEmployeeUseCase.ts` y su test · ⏱ 10 min

**B. Secreto JWT y seed (SEC-08, SEC-07)**

- [ ] **T15** – Crear la config centralizada (`JWT_SECRET` obligatorio de 32 o más caracteres salvo en test, `JWT_EXPIRES_IN`, `CORS_ORIGINS`) y un `.env.example` · `packages/api/src/config/env.ts` (nuevo), `packages/api/.env.example` · ⏱ 10 min
- [ ] **T16** – Usar la config en `authenticate` (`algorithms: ['HS256']`, `issuer`, `audience`) · `middlewares.ts` · ⏱ 7 min
- [ ] **T17** – Usar la config en la firma del token (`issuer`, `audience`, expiración configurable, por defecto 15 min) y eliminar el secreto duplicado · `contexts/employee/infrastructure/BcryptAuthService.ts` · ⏱ 7 min
- [ ] **T18** – Seed: contraseña desde `SEED_PASSWORD` o aleatoria, abortar si `NODE_ENV=production` · `packages/api/src/scripts/seed.ts` · ⏱ 8 min

**C. Validación, rate limiting y contraseñas (SEC-05, SEC-06, SEC-09, SEC-11, SEC-13)**

- [ ] **T19** – Validar `items` y `quantity` en `OrderService.create`, y la existencia de restaurante y platos disponibles del mismo restaurante · `order.service.ts` · ⏱ 10 min
- [ ] **T20** – Tests de validación de pedidos (quantity 0, negativa, decimal, 1e9, items vacío, no array, plato ajeno) · `order.service.test.ts` · ⏱ 10 min
- [ ] **T21** – `OrderController.createOrder` y `updateItemStatus` pasan a `next(error)` y se elimina `error.message` crudo; mapear los errores de dominio en `errorHandler` si falta · `order.controller.ts`, `errorHandler.ts` · ⏱ 10 min
- [ ] **T22** – Crear la validación de contraseña (10-72 caracteres, distinta del email, presente) y usarla en registro y alta de empleados, con tests · `contexts/shared/domain/Password.ts` (nuevo) y casos de uso · ⏱ 10 min
- [ ] **T23** – Normalizar el email (`trim` y `toLowerCase`) en el value object `Email`, `compare` ficticio en `LoginUseCase`, y migración de emails existentes · `contexts/shared/domain/Email.ts`, `LoginUseCase.ts`, `config/database.ts` · ⏱ 10 min
- [ ] **T24** – Añadir `express-rate-limit` a `/auth/login` y `/auth/register` · `package.json` de la API, `contexts/employee/infrastructure/http/auth.routes.ts` · ⏱ 8 min
- [ ] **T25** – Revisar y fijar `express.json({ limit })` y el tope de `limit`/`offset` en `findAll` · `app.ts`, repositorio de empleados · ⏱ 5 min

**D. Dependencias y cabeceras (SEC-15, SEC-17, H-02)**

- [ ] **T26** – `npm audit fix` sin `--force` en la raíz; ejecutar `npm test` y anotar lo que queda pendiente · `package-lock.json` · ⏱ 8 min
- [ ] **T27** – Evaluar `sqlite3@6` (cambio mayor) en una rama: arrancar, `npm run seed` y `npm test`; adoptar solo si todo pasa · `packages/api/package.json` · ⏱ 10 min
- [ ] **T28** – Actualizar `@angular/*` a >=21.2.25 en los frontends y comprobar `npm run build` de los tres · `packages/*/package.json` · ⏱ 10 min
- [ ] **T29** – Añadir `helmet`, `app.disable('x-powered-by')` y CORS con lista blanca desde `CORS_ORIGINS` · `packages/api/src/app.ts` · ⏱ 8 min
- [ ] **T30** – Registrar en el log los 500, los 401 y 403 y los login fallidos (`console.error` estructurado) · `errorHandler.ts`, `middlewares.ts`, `LoginUseCase.ts` · ⏱ 10 min

**E. Resto de hallazgos y frontend**

- [ ] **T31** – DTO público de restaurante sin email, teléfono ni propietario en `/public/restaurants` · `controllers/restaurant.controller.ts` · ⏱ 8 min
- [ ] **T32** – Validar `logoUrl` como `http(s)` en el servicio de restaurantes · `services/restaurant.service.ts` · ⏱ 5 min
- [ ] **T33** – `auth.store.ts`: `try/catch` en el parseo de `auth_user`, tipar `user`, decodificar `exp` y hacer que `isAuthenticated` sea falso al caducar · `packages/web-shared/src/lib/auth/auth.store.ts` · ⏱ 10 min
- [ ] **T34** – Limitar `authInterceptor` a las URLs que empiezan por `apiUrl` · `packages/web-shared/src/lib/http/auth.interceptor.ts` · ⏱ 5 min
- [ ] **T35** – Mensajes de error genéricos para el usuario en `error.interceptor.ts` (la gestión del 401 con refresh se hace en T55) · `packages/web-shared/src/lib/http/error.interceptor.ts` · ⏱ 5 min
- [ ] **T36** – `OrderStore.reset()` (parar polling y vaciar señales) y llamarlo al cerrar sesión o caducar · `packages/web-empleados/src/app/features/orders/store/order.store.ts`, `auth.service.ts` de `web-shared` · ⏱ 10 min
- [ ] **T37** – Mostrar mensajes genéricos en `alert-error` en lugar de `err.message` · `packages/web-empleados/src/app/features/**` (salón, cocina, barra) · ⏱ 8 min
- [ ] **T38** – Alinear el mínimo de contraseña del formulario de registro con la API (10 caracteres) · `packages/web-shared/src/lib/components/register/register.component.ts` · ⏱ 5 min
- [ ] **T39** – Añadir la CSP estricta de la sección 4 en `index.html` y `sourceMap: false` y `namedChunks: false` en producción · `packages/web-empleados/src/index.html`, `angular.json` · ⏱ 8 min
- [ ] **T40** – Codificar con `encodeURIComponent` los IDs de ruta en las llamadas HTTP de pedidos · `packages/web-empleados/src/app/features/orders/services/order.service.ts` · ⏱ 5 min
- [ ] **T41** – Comentar en `role.guard.ts` que es solo UX y que el backend impone los roles · `packages/web-empleados/src/app/core/guards/role.guard.ts` · ⏱ 5 min

**G. Refresh token (SEC-16, H-03, H-05)** — se ejecuta después de B y C; T49 a T52 dependen de T45 a T48.

- [ ] **T45** – Crear la tabla `refresh_tokens` (con FK en cascada a empleados e índice por `token_hash`) en las migraciones de arranque · `packages/api/src/config/database.ts` · ⏱ 8 min
- [ ] **T46** – Definir `IRefreshTokenRepository` y su implementación SQLite (`save`, `findByHash`, `revoke`, `revokeFamily`) · `packages/api/src/contexts/employee/domain/IRefreshTokenRepository.ts`, `.../infrastructure/SqliteRefreshTokenRepository.ts` (nuevos) · ⏱ 10 min
- [ ] **T47** – Servicio que genera el refresh token opaco (`crypto.randomBytes(32)`) y calcula su hash SHA-256; añadir `REFRESH_TOKEN_TTL_DAYS` a la config · `.../infrastructure/RefreshTokenService.ts` (nuevo), `config/env.ts` · ⏱ 8 min
- [ ] **T48** – `LoginUseCase` emite también el refresh token y la respuesta pasa a `{ token, refreshToken, user }` · `.../application/LoginUseCase.ts`, `.../infrastructure/http/AuthController.ts` · ⏱ 8 min
- [ ] **T49** – `RefreshTokenUseCase`: validar, rotar, releer el empleado en BD, rechazar si no existe y detectar reutilización (revocar la familia) · `.../application/RefreshTokenUseCase.ts` (nuevo) · ⏱ 10 min
- [ ] **T50** – `LogoutUseCase`: revocar la familia del refresh token (idempotente) · `.../application/LogoutUseCase.ts` (nuevo) · ⏱ 5 min
- [ ] **T51** – Controlador, composición de dependencias y rutas `POST /auth/refresh` y `POST /auth/logout` con rate limiting · `.../infrastructure/http/AuthController.ts`, `dependencies.ts`, `auth.routes.ts` · ⏱ 8 min
- [ ] **T52** – Tests de `RefreshTokenUseCase` y `LogoutUseCase`: rotación correcta, token caducado, token inexistente, reutilización revoca la familia, empleado eliminado, rol cambiado reflejado · `.../application/RefreshTokenUseCase.test.ts` (nuevo) · ⏱ 10 min
- [ ] **T53** – `auth.store.ts`: guardar y limpiar el refresh token y exponer `setSession(token, refreshToken, user)` · `packages/web-shared/src/lib/auth/auth.store.ts` · ⏱ 7 min
- [ ] **T54** – `auth.service.ts`: método `refresh()` y `logout()` que llama a `/auth/logout` antes de limpiar la sesión; el login guarda el `refreshToken` · `packages/web-shared/src/lib/auth/auth.service.ts` · ⏱ 8 min
- [ ] **T55** – `error.interceptor.ts`: ante un 401 hacer un único refresh compartido entre peticiones concurrentes, reintentar la original y, si falla, limpiar la sesión y redirigir; excluir `/auth/login` y `/auth/refresh` · `packages/web-shared/src/lib/http/error.interceptor.ts` · ⏱ 10 min

**F. Documentación**

- [ ] **T42** – Documentar el modelo de autorización (roles, `assertRestaurantAccess`, 404 en pedidos ajenos) · `docs/arquitectura/arquitectura-api.md` · ⏱ 8 min
- [ ] **T43** – Documentar variables de entorno (`JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_TTL_DAYS`, `CORS_ORIGINS`, `SEED_PASSWORD`) y el flujo de refresh y actualizar la nota de contraseñas del seed · `README.md`, `CLAUDE.md` · ⏱ 8 min
- [ ] **T44** – Añadir una revisión con el resultado de la auditoría y el estado de cada hallazgo · `docs/revisiones/auditoria-seguridad-owasp.md` (nuevo) · ⏱ 10 min

Total: 55 tareas, unos 460 min (≈ 7,5 h). Las del bloque G son T45 a T55 y se numeran al final para no alterar la numeración de los demás bloques.

## 6. Plan de pruebas

La API tiene tests (`npm test`); los frontends no, así que se verifican con build y pruebas manuales.

- [ ] `npm test` pasa entero, con los tests nuevos de T3, T6, T11, T14, T20 y T22.
- [ ] Cliente registrado: `curl -H "Authorization: Bearer $T" ":3000/api/v1/orders/active?restaurantId=<id>"` devuelve **403**.
- [ ] Cliente con el `id` de un pedido ajeno: `GET /orders/<id>` devuelve **404**; el propio pedido devuelve 200.
- [ ] Camarero de `rest-1` en `GET /restaurants/<rest-2>/dishes` devuelve **403**; en `PUT`/`DELETE` de un plato de `rest-2` por la ruta de `rest-1`, **404**.
- [ ] Admin conserva el acceso a todos los restaurantes (regresión).
- [ ] Arrancar la API sin `JWT_SECRET` (y sin `NODE_ENV=test`) falla con un mensaje claro; con un secreto válido arranca.
- [ ] Token firmado con el secreto antiguo, o con `alg: none`, devuelve 401.
- [ ] `POST /orders` con `quantity: 1e9`, `-1`, `1.5` o `items: []` devuelve 400 sin consumo anómalo.
- [ ] 11 intentos de login seguidos desde la misma IP devuelven 429.
- [ ] Registro con contraseña de 1 carácter, sin contraseña o igual al email devuelve 400.
- [ ] `A@x.com` y `a@x.com` inician sesión en la misma cuenta; el tiempo de respuesta con email inexistente es comparable.
- [ ] `/public/restaurants` ya no contiene email, teléfono ni propietario; las cabeceras incluyen las de `helmet` y no `X-Powered-By`.
- [ ] CORS: una petición con `Origin` no permitido no recibe `Access-Control-Allow-Origin`.
- [ ] `npm audit --omit=dev` no muestra críticas ni altas pendientes (o quedan justificadas en la revisión).
- [ ] Refresh: `POST /auth/refresh` con un refresh válido devuelve un access y un refresh nuevos; el refresh anterior, reutilizado, devuelve 401 y deja inutilizada toda la familia.
- [ ] Refresh con token caducado, inexistente o de un empleado eliminado devuelve 401; si cambió el rol del empleado, el nuevo access lleva el rol nuevo.
- [ ] `POST /auth/logout` revoca la sesión: el refresh deja de funcionar y el endpoint es idempotente (204).
- [ ] Frontend: con el access caducado, varias peticiones concurrentes provocan un solo `/auth/refresh` y todas se reintentan con éxito; si el refresh falla se vuelve a `/login`.
- [ ] CSP: en `ng serve` y en el build de producción no aparecen violaciones en la consola.
- [ ] Los tres frontends compilan (`npm run build -w @resttek/web-admin`, `-web-empleados`, `-web-clientes`); el flujo login, cocina, barra y salón funciona.
- [ ] Editar `auth_user` en localStorage con un JSON inválido no bloquea la app; con un JWT caducado la app cierra la sesión y vuelve al login.
- [ ] Al cerrar sesión se detiene el polling y no quedan pedidos en memoria al iniciar con otro usuario.
- [ ] Un usuario con rol editado a `manager` en localStorage ve la UI pero la API responde 403 en cada llamada.

## 7. Riesgos y dudas abiertas

- **Compatibilidad de los frontends**: `web-admin` y `web-clientes` pueden depender de `GET /restaurants` abierto a cualquier autenticado o de `GET /orders/:id` sin restricción. Hay que revisar sus llamadas antes de T8, T13 y T4.
- **Contraseñas existentes**: la política de T22 solo se aplica al crear o registrar; las cuentas actuales (seed) siguen con contraseña débil hasta que se cambien.
- **Migración de emails (T23)**: si existen emails que difieren solo en mayúsculas, la migración chocará con la restricción de unicidad; hay que detectar duplicados antes.
- **`sqlite3@6` (T27)** es un cambio mayor y puede requerir recompilación nativa; si falla, se deja pendiente y se documenta.
- **Decisiones de diseño para el usuario**:
  - Resuelto: se mantiene el Bearer, con refresh token y CSP.
  - ¿Mantener el 400 de "email duplicado" en el registro (enumeración, SEC-13) o responder siempre igual con confirmación por email?
  - ¿Introducir `pino` o `morgan` para el logging, o basta `console` estructurado?
  - ¿Adoptar `zod` para validar la entrada?
- **Cambio de contrato**: el login añade `refreshToken` a la respuesta y el access token pasa a 15 min. `web-admin` y `web-clientes` comparten `web-shared`, así que reciben el refresh automáticamente, pero hay que probar su login.
- **Refresh token en localStorage**: sigue siendo robable ante XSS. Se mitiga con la CSP, la rotación con detección de reutilización y el logout que revoca en servidor, pero no se elimina el riesgo.
- **Tests del login**: los existentes de `LoginUseCase` y de `web-shared` pueden necesitar actualizarse por el cambio de respuesta (T48).
- La CSP puede bloquear recursos en desarrollo; probar con `ng serve` antes de cerrar T39.

## 8. Documentación a actualizar

- `docs/arquitectura/arquitectura-api.md`: modelo de autorización y middleware `assertRestaurantAccess`.
- `README.md` y `CLAUDE.md`: variables de entorno nuevas y la nota de que la contraseña del seed deja de ser el email.
- `docs/revisiones/auditoria-seguridad-owasp.md` (nuevo): resultados de la auditoría y estado de cada hallazgo.
