# Arquitectura del frontend

Los frontends de Resttek usan **Angular 21** con las funcionalidades más modernas: standalone components, signals, zoneless change detection y functional guards/interceptors.

---

## Stack Frontend

| Tecnología | Uso |
| --- | --- |
| Angular 21 | Framework principal |
| Standalone Components | Sin NgModules |
| Signals | Estado reactivo (reemplaza a RxJS en estado) |
| Zoneless | Sin `zone.js` en ningún paquete |
| Lucide Angular | Iconos |
| RxJS | Solo para HTTP. En `web-admin` y `web-empleados`, casi siempre envuelto en `firstValueFrom` dentro de un store; en `web-clientes`, los componentes consumen los `Observable` directamente con `.subscribe()` (ver "Gestión de Estado") |

---

## Estructura de un Frontend

Las tres aplicaciones son feature-based, pero **no comparten la misma estructura**.

### `web-admin` y `web-empleados`

Cada feature es autocontenida y se subdivide por tipo de fichero:

```
src/app/
├── app.component.ts       → Componente raíz (<router-outlet>)
├── app.config.ts          → Providers (DI, router, HTTP, interceptors)
├── app.routes.ts          → Rutas principales con lazy loading
├── core/
│   └── layout/            → Shell y not-found
└── features/
    └── <feature>/
        ├── <feature>.routes.ts
        ├── models/        → Interfaces y DTOs
        ├── pages/         → Componentes de página
        ├── services/      → Llamadas HTTP
        └── store/         → Estado con signals
```

### `web-clientes`

Es más pequeña y centraliza modelos y servicios en `core/` en vez de repartirlos por feature. Sus features son componentes sueltos, sin subcarpetas:

```
src/app/
├── app.ts                 → Componente raíz, se llama App (no AppComponent)
├── app.config.ts
├── app.routes.ts
├── core/
│   ├── layout/            → shell.component.ts
│   ├── models/            → dish, order, restaurant, table
│   ├── services/          → dish, order, restaurant, table
│   └── store/             → cart.store.ts
└── features/
    ├── cart/cart.component.ts
    ├── menu/restaurant-menu.component.ts
    ├── orders/my-orders.component.ts
    ├── orders/order-detail.component.ts
    ├── restaurants/restaurant-list.component.ts
    └── tables/table-selection.component.ts
```

Ninguna de las tres aplicaciones tiene carpeta `shared/` propia: lo compartido vive en `@resttek/web-shared`.

---

## Gestión de Estado: el patrón Store

Es el patrón estándar en **`web-admin` y `web-empleados`**: cada feature con datos remotos tiene su store, un servicio `providedIn: 'root'` con signals privadas expuestas como solo lectura:

```tsx
@Injectable({ providedIn: 'root' })
export class DishStore {
    private readonly service = inject(DishService)

    private readonly _dishes = signal<Dish[]>([])
    private readonly _loading = signal(false)
    private readonly _error = signal<string | null>(null)

    readonly dishes = this._dishes.asReadonly()
    readonly loading = this._loading.asReadonly()
    readonly error = this._error.asReadonly()

    async loadByRestaurant(restaurantId: string): Promise<void> {
        this._loading.set(true)
        this._error.set(null)
        try {
            this._dishes.set(await firstValueFrom(this.service.getAll(restaurantId)))
        } catch {
            this._error.set('No se pudieron cargar los platos.')
        } finally {
            this._loading.set(false)
        }
    }
}
```

**Convenciones (`web-admin` / `web-empleados`):**

- El store consume el service (que devuelve `Observable`) y lo convierte con `firstValueFrom`. Los componentes solo hablan con el store.
- El trío `loading` / `error` / datos se repite en todos.
- Tras crear o actualizar, el store actualiza la lista en memoria con `.update()` en vez de recargar.

Caso particular en `web-empleados`:

- `OrderStore` añade **polling cada 30 s** con `startPolling()` / `stopPolling()`, ya que la API no tiene websockets. `TableStore` (feature `tables`) sigue el mismo patrón.

### `web-clientes`: el patrón Store casi no se usa

En `web-clientes` el patrón Store **no es la norma**: el único store real es `CartStore`, y es puramente local (sin HTTP) — vacía el carrito si añades un plato de otro restaurante, pero no envuelve ninguna llamada a la API. También guarda la **mesa elegida** (`table()`, con `restaurantId`, `id` y `number`; ver [Gestión de mesas](#gestión-de-mesas)).

Para todo lo demás (restaurantes, carta/platos, confirmación y consulta de pedidos) los componentes de `features/` inyectan el `*Service` correspondiente directamente y llaman a sus métodos con `.subscribe({ next, error })`, sin pasar por ningún store ni por `firstValueFrom`:

- `restaurant-list.component.ts` → `RestaurantService.getAll()`
- `restaurant-menu.component.ts` → `RestaurantService.getById()` y `DishService.getByRestaurant()`
- `cart.component.ts` (`confirmOrder()`) → `OrderService.createOrder()`
- `my-orders.component.ts` → `OrderService.getMyOrders()`, con **polling cada 10 s** mediante `setInterval`/`clearInterval` en el propio componente
- `order-detail.component.ts` → `OrderService.getOrderById()`, con **polling cada 5 s**, también con `setInterval`/`clearInterval` en el propio componente
- `table-selection.component.ts` → `TableService.getAvailable()` y `TableService.occupy()`

---

## Librería Compartida: `@resttek/web-shared`

Centraliza todo lo que comparten los 3 frontends:

```
web-shared/src/
├── index.ts                  → Barrel exports
└── lib/
    ├── tokens.ts             → InjectionToken API_URL
    ├── auth/
    │   ├── auth.service.ts   → Login, register, logout
    │   ├── auth.store.ts     → Signal-based state (token, user)
    │   └── auth.guard.ts     → Protección de rutas
    ├── http/
    │   ├── auth.interceptor.ts   → Añade Bearer token
    │   └── error.interceptor.ts  → Maneja 401 → redirect login
    ├── components/
    │   ├── login/            → Componente de login reutilizable
    │   └── register/         → Componente de registro
    ├── assets/images/        → Imágenes copiadas al build de cada app
    └── styles/
        └── base.css          → Design system (ver aviso más abajo)
```

El paquete se consume **directamente desde el fuente**: su `package.json` apunta `main` a `src/index.ts`, sin paso de compilación. Por eso los cambios en `web-shared` requieren reiniciar el dev server del frontend.

### Exports de la Librería

```tsx
export * from './lib/tokens'
export * from './lib/auth/auth.service'
export * from './lib/auth/auth.store'
export * from './lib/auth/auth.guard'
export * from './lib/http/auth.interceptor'
export * from './lib/http/error.interceptor'
export * from './lib/components/login/login.component'
export * from './lib/components/register/register.component'
```

---

## Sistema de Autenticación

### AuthStore (Signal-based)

Estado global de autenticación usando **Angular Signals**:

```tsx
@Injectable({ providedIn: 'root' })
export class AuthStore {
    private readonly _token = signal<string | null>(localStorage.getItem('auth_token'))
    private readonly _user = signal<any>(JSON.parse(localStorage.getItem('auth_user') || 'null'))

    readonly token = this._token.asReadonly()
    readonly user = this._user.asReadonly()
    readonly isAuthenticated = computed(() => this._token() !== null)
    readonly userRole = computed(() => this._user()?.role ?? null)

    setSession(token, user) { /* localStorage + signals */ }
    clearSession() { /* limpiar localStorage + signals */ }
}
```

### AuthService

Gestiona login y registro llamando a la API:

```tsx
@Injectable({ providedIn: 'root' })
export class AuthService {
    async login(email, password) {
        const response = await firstValueFrom(
            this.http.post<LoginResponse>(`${this.apiUrl}/auth/login`, { email, password })
        )
        this.store.setSession(response.token, response.employee)
    }
}
```

### AuthGuard

Functional guard que redirige a `/login` si no hay sesión:

```tsx
export const authGuard: CanActivateFn = () => {
    const auth = inject(AuthStore)
    const router = inject(Router)
    if (auth.isAuthenticated()) return true
    return router.createUrlTree(['/login'])
}
```

---

## Interceptors HTTP

### Auth Interceptor

Añade automáticamente el token JWT a cada petición:

```tsx
export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const token = inject(AuthStore).token()
    if (!token) return next(req)
    return next(req.clone({
        setHeaders: { Authorization: `Bearer ${token}` }
    }))
}
```

### Error Interceptor

Intercepta respuestas 401 y redirige al login:

```tsx
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
    return next(req).pipe(
        catchError(error => {
            if (error.status === 401) {
                auth.clearSession()
                router.navigate(['/login'])
            }
            return throwError(() => error)
        })
    )
}
```

---

## Inyección del API_URL

Se usa un `InjectionToken` para configurar la URL base de la API:

```tsx
// web-shared/tokens.ts
export const API_URL = new InjectionToken<string>('API_URL')

// app.config.ts de cada frontend
providers: [
    { provide: API_URL, useValue: environment.apiUrl },
    // ...
]
```

En los tres `environment.ts` el valor es `'/api/v1'` (ruta relativa que resuelve el proxy), tanto en desarrollo como en producción.

> **Uso desigual.** Las tres apps proveen el token, pero solo lo **inyectan** los servicios de `web-clientes` y el `AuthService` de `web-shared`. Los servicios de `web-admin` y `web-empleados` importan `environment.apiUrl` directamente:
>
> ```tsx
> // web-clientes: inyecta el token
> private readonly apiUrl = inject(API_URL)
>
> // web-admin / web-empleados: importa el environment
> private readonly baseUrl = `${environment.apiUrl}/restaurants`
> ```
>
> El resultado es el mismo, pero solo la primera forma es sustituible en tests.

---

## Routing y Lazy Loading

Las rutas usan **lazy loading** con `loadComponent` y `loadChildren`:

```tsx
export const routes: Routes = [
    {
        path: 'login',
        loadComponent: () => import('@resttek/web-shared').then(m => m.LoginComponent)
    },
    {
        path: '',
        loadComponent: () => import('./core/layout/shell.component').then(m => m.ShellComponent),
        canActivate: [authGuard],
        children: [
            {
                path: 'restaurants',
                loadChildren: () => import('./features/restaurants/restaurants.routes')
                    .then(m => m.RESTAURANT_ROUTES)
            }
        ]
    }
]
```

El lazy loading **no es universal**: `web-clientes` carga `LoginComponent` y `RegisterComponent` de forma eager con `component:`, y `web-empleados` hace lo mismo con su `ShellComponent`.

`web-clientes` tampoco define ruta comodín `**`, así que una URL desconocida no muestra un "no encontrado".

### Filtrado por Rol (web-empleados)

El filtrado por rol tiene dos piezas. Cada ruta lleva `roleGuard([...])` (`core/guards/role.guard.ts`), que redirige a la página por defecto del rol (`cocinero` y `manager` → `/cocina`, `camarero` → `/barra`) si intenta entrar en una que no le corresponde. Y el `ShellComponent` decide con `computed()` qué enlaces se pintan en el menú:

```tsx
export class ShellComponent {
    readonly userRole = computed(() => this.authStore.userRole())

    readonly canSeeCocina = computed(() =>
        this.userRole() === 'cocinero' || this.userRole() === 'manager'
    )
    readonly canSeeBarra = computed(() =>
        this.userRole() === 'camarero' || this.userRole() === 'manager'
    )
    readonly canSeeSalon = computed(() =>
        this.userRole() === 'camarero' || this.userRole() === 'manager'
    )
    readonly canSeeMesas = computed(() =>
        this.userRole() === 'camarero' || this.userRole() === 'manager'
    )

    readonly defaultRoute = computed(() => { /* cocinero → /cocina, camarero → /barra */ })
}
```

El rol de gerente es `'manager'`, no `'gerente'`. La autorización real es responsabilidad de la API.

---

## Gestión de mesas

Funcionalidad de la issue #5. Las tres apps consumen el contrato [`docs/api/openapi-mesas.yaml`](../api/openapi-mesas.yaml) y deciden por **código HTTP** (o por el nombre del error en `error`), nunca por el texto de `message`. En todas, los pedidos muestran la mesa como `tableNumber ?? tableId`, para que los pedidos antiguos con texto libre sigan viéndose.

### `web-admin`: feature `tables`

`features/tables/{models,services,store,pages,utils}`, con el mismo patrón que `ingredients`:

- Rutas `TABLE_ROUTES` montadas en `restaurants/:restaurantId/tables`: listado (`''`), alta (`new`) y edición (`:id/edit`).
- `table-list`: número, descripción, capacidad y badge de estado, con editar y borrar (con confirmación).
- `table-form`: alta y edición (número, descripción, capacidad, estado) con validación de número y capacidad ≥ 1.
- `TableStore` (`loadByRestaurant`, `create`, `update`, `delete`) mantiene la lista ordenada por número en memoria.
- `utils/table-error.ts` traduce el nombre del error de la API (`DuplicatedTableNumberError`, `TableOccupiedError`, …) a un mensaje en español; si no lo reconoce, usa el código HTTP.
- Acceso: enlace *Mesas* en el submenú de cada restaurante del menú lateral y tarjeta *Mesas* en el dashboard del restaurante.

### `web-empleados`: página *Mesas*

`features/tables/{models,services,store,pages/mesas}`:

- Ruta `mesas` con `roleGuard(['camarero', 'manager'])` y enlace en el shell (`canSeeMesas`). El `cocinero` no ve el enlace y, si entra por URL, se le redirige a `/cocina`.
- Cuadrícula de mesas coloreada por estado con un `<select>` para cambiarlo (`PATCH .../status`); poner `libre` es la forma de liberar una mesa.
- En las mesas `ocupada` se listan sus pedidos activos con el estado de cada ítem. No hay endpoint específico: `MesasComponent` combina `TableStore` y el `OrderStore` existente (`GET /orders/active`) con un `computed` que agrupa los pedidos por `tableId`.
- Ambos stores hacen polling de 30 s mientras la página está abierta (`startPolling` en `ngOnInit`, `stopPolling` en `ngOnDestroy`).
- Cocina, barra y salón muestran `Mesa {{ order.tableNumber ?? order.tableId }}`.

### `web-clientes`: selección de mesa

Flujo: listado de restaurantes → **`restaurants/:id/mesa`** → carta → carrito → pedido.

- El listado de restaurantes enlaza a `/restaurants/:id/mesa` en lugar de ir directamente a la carta.
- `TableSelectionComponent` (`features/tables/table-selection.component.ts`, componente suelto con `.subscribe()`): el cliente indica el número de personas, ve las mesas libres con capacidad suficiente (`GET .../tables/available`), elige una y al pulsar *Continuar* se llama a `occupy`. Si responde 409 (otro cliente la ha ocupado), se avisa y se recarga la lista.
- Tras ocupar la mesa se guarda en `CartStore.setTable({ restaurantId, id, number })` y se navega a la carta. La carta redirige a la selección si no hay mesa elegida para ese restaurante.
- El carrito muestra la mesa, la envía como `tableId` en `createOrder` y no deja confirmar sin mesa. Si el pedido devuelve 404 o 409 (la mesa ya no existe o un empleado la ha liberado), limpia la mesa (`clearTable()`) y lleva de nuevo a la selección.
- **La mesa se conserva en `CartStore` tras pedir**: `clear()` vacía los platos pero no la mesa, de modo que el cliente puede hacer más pedidos en la misma mesa mientras siga ocupada. Se descarta al elegir otra mesa o al añadir un plato de otro restaurante.
- El detalle del pedido muestra la mesa.

---

## Configuración de Angular

### `app.config.ts`

```tsx
export const appConfig: ApplicationConfig = {
    providers: [
        { provide: API_URL, useValue: environment.apiUrl },
        provideZonelessChangeDetection(),
        provideRouter(routes),
        provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
        importProvidersFrom(LucideAngularModule.pick({ ... }))
    ]
}
```

`LucideAngularModule.pick()` recibe solo los iconos que usa cada app, así que la lista es distinta en cada `app.config.ts`.

> **Zoneless**: `web-admin` y `web-empleados` llaman a `provideZonelessChangeDetection()` de forma explícita; `web-clientes` **no**. Funciona igual porque ningún paquete instala `zone.js` ni lo declara en `polyfills`, y Angular 21 opera sin zonas en ese caso. Es una inconsistencia entre apps, no un cambio de comportamiento.

### Proxy de Desarrollo

Cada frontend tiene un `proxy.conf.json` idéntico, que `npm start` aplica con `ng serve --proxy-config proxy.conf.json`:

```json
{
    "/api": {
        "target": "http://localhost:3000",
        "secure": false,
        "changeOrigin": true
    }
}
```

---

## Design System

El sistema de diseño es **dark mode** e incluye:

- **Variables CSS**: colores, radios, sombras, transiciones
- **Componentes base**: `.btn`, `.card`, `.form-control`, `.badge`, `.table`, etc.
- **Tipografía**: Inter (Google Fonts)
- **Animaciones**: `fadeIn`, `spin` (spinner)

> **No se comparte: se duplica.** Aunque existe `web-shared/src/lib/styles/base.css`, **ningún proyecto lo importa** ni se exporta desde `index.ts`. Cada aplicación tiene su propia copia en `src/styles.css`, que es lo que realmente carga Angular:
>
> | Fichero | Estado respecto a `base.css` |
> | --- | --- |
> | `web-admin/src/styles.css` | copia idéntica |
> | `web-clientes/src/styles.css` | copia idéntica |
> | `web-empleados/src/styles.css` | copia con 46 líneas propias añadidas |
>
> En la práctica hay **cuatro copias del design system** y el fichero de `web-shared` es código muerto. Al tocar un estilo común hay que replicarlo en las tres apps, o se desincronizan.