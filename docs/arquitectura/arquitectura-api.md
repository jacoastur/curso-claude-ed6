# Arquitectura de la API

La API de Resttek es una aplicación **Node.js con Express 5 y TypeScript** (`packages/api`), con persistencia en SQLite.

En su interior conviven **dos estilos arquitectónicos**. Conocer cuál aplica a cada dominio es lo primero que hay que tener claro antes de tocar código.

---

## Los dos estilos

### 1. Hexagonal + DDD → solo el contexto `employee`

`src/contexts/` es el único sitio donde se aplica arquitectura hexagonal (Ports & Adapters) con DDD. Contiene dos carpetas:

```
src/contexts/
├── employee/        → Empleados, auth, roles
└── shared/          → Value objects y utilidades HTTP comunes
```

El contexto `employee` sigue las tres capas clásicas:

```
contexts/employee/
├── domain/
│   ├── Employee.ts
│   ├── Employee.test.ts
│   ├── IEmployeeRepository.ts
│   ├── IAuthService.ts
│   └── value-objects/
│       ├── Role.ts
│       └── Role.test.ts
├── application/
│   ├── LoginUseCase.ts
│   ├── CreateEmployeeUseCase.ts
│   ├── RegisterClientUseCase.ts
│   ├── *.test.ts
│   └── mocks/
└── infrastructure/
    ├── SqliteEmployeeRepository.ts
    ├── SqliteEmployeeRepository.test.ts
    ├── BcryptAuthService.ts
    └── http/
        ├── AuthController.ts
        ├── EmployeeController.ts
        ├── dependencies.ts
        ├── auth.routes.ts
        ├── employee.routes.ts
        └── restaurant-employee.routes.ts
```

`contexts/shared/` no es un bounded context de negocio: contiene el value object `Email` y los middlewares y el `errorHandler` de Express.

### 2. Por capas → `restaurant`, `dish`, `ingredient`, `order`, `table`

El resto de dominios **no** usan bounded contexts. Se organizan en carpetas transversales por tipo de fichero:

```
src/
├── models/          → Interfaces TypeScript + funciones de normalización
├── repositories/    → Interfaz + implementación SQLite
├── services/        → Lógica de negocio (equivalente a los casos de uso)
├── controllers/     → Adaptadores HTTP
└── routes/          → Definición de rutas y composición de dependencias
```

Con un fichero por dominio en cada carpeta: `models/dish.model.ts`, `services/dish.service.ts`, `repositories/dish.repository.ts`, etc. Las mesas siguen el mismo esquema (`models/table.model.ts`, `repositories/table.repository.ts`, `services/table.service.ts`, `controllers/table.controller.ts`) con dos ficheros de rutas: `routes/table.routes.ts` (privadas) y `routes/table.public.routes.ts` (públicas).

**Diferencia clave**: aquí no hay entidades de dominio con comportamiento. `Restaurant`, `Dish`, `Ingredient`, `Order` y `RestaurantTable` son `interface` planas; la validación vive en los servicios y en funciones sueltas del modelo.

---

## Capa de Dominio (contexto `employee`)

### Entidades

`Employee` es la **única entidad de dominio** del proyecto. Patrón: **constructor privado + factory method `create()`**:

```tsx
export class Employee {
    private constructor(props: { /* ... */ }) { /* asignar campos */ }

    public static create(props: EmployeeProps): Employee {
        if (!props.firstName || props.firstName.trim() === '') {
            throw new FirstNameRequiredError()
        }
        // ... resto de validaciones

        return new Employee({
            ...props,
            email: new Email(props.email),   // Value Object
            role: new Role(props.role)       // Value Object
        })
    }

    get id(): string { return this._id }
    get email(): string { return this._email.getValue() }
    get role(): EmployeeRoleType { return this._role.getValue() }
}
```

**Reglas:**

- Constructor siempre **privado**.
- Validaciones de negocio en `create()`.
- Propiedades con **getters**, sin setters directos.
- Los Value Objects validan dentro de su propio constructor.

### Value Objects

Solo existen **dos clases** Value Object:

| Value Object | Ubicación | Validación |
| --- | --- | --- |
| `Email` | `contexts/shared/domain/value-objects/Email.ts` | Formato email (regex) |
| `Role` | `contexts/employee/domain/value-objects/Role.ts` | admin, manager, camarero, cocinero, cliente |

Los demás conceptos que podrían ser Value Objects **no están implementados como clases**, sino como tipo unión + función de normalización en `models/`:

| Concepto | Implementación real | Valores válidos |
| --- | --- | --- |
| Unidad de ingrediente | `normalizeIngredientUnit()` en `models/ingredient.model.ts` | kg, g, l, ml, unidad |
| Categoría de plato | `normalizeDishCategory()` en `models/dish.model.ts` | entrante, principal, postre, bebida |
| Estado de pedido | `normalizeOrderStatus()` en `models/order.model.ts` | pendiente, preparando, listo, entregado |
| Estado de mesa | `normalizeTableStatus()` en `models/table.model.ts` | libre, ocupada, reservada |
| Teléfono | `PHONE_REGEX` dentro de `services/restaurant.service.ts` | `/^\+?[\d\s\-()]{7,20}$/` |

Las funciones `normalizeX()` hacen `trim()` + `toLowerCase()` y lanzan el error de dominio correspondiente si el valor no es válido.

### Interfaces de Repositorio

El prefijo `I` **solo** se usa en el contexto `employee` (`IEmployeeRepository`, `IAuthService`). En la capa por capas la interfaz va sin prefijo y convive con su implementación en el mismo fichero:

```tsx
// repositories/restaurant.repository.ts
export interface RestaurantRepository {
    findById(id: string): Promise<Restaurant | null>
    findAll(): Promise<Restaurant[]>
    save(restaurant: Restaurant): Promise<void>
}

export class SqliteRestaurantRepository implements RestaurantRepository { /* ... */ }
```

---

## Capa de Aplicación

### Casos de Uso (solo `employee`)

Clase con un único método `execute()`. Dependencias por **inyección de constructor**. Solo hay tres:

| Caso de uso | Qué hace |
| --- | --- |
| `LoginUseCase` | Valida credenciales y devuelve `{ token, employee }` |
| `CreateEmployeeUseCase` | Alta de empleado por parte de un admin |
| `RegisterClientUseCase` | Auto-registro de cliente; fuerza `role: 'cliente'` y `restaurantId: null`, y devuelve token |

```tsx
export class CreateEmployeeUseCase {
    constructor(
        private readonly employeeRepo: IEmployeeRepository,
        private readonly authService: IAuthService
    ) {}

    async execute(dto: CreateEmployeeDTO): Promise<Employee> {
        const existing = await this.employeeRepo.findByEmail(dto.email)
        if (existing) throw new DuplicatedEmailError()

        const passwordHash = await this.authService.hashPassword(dto.passwordPlain)
        const employee = Employee.create({ id: randomUUID(), ...dto, passwordHash })

        await this.employeeRepo.save(employee)
        return employee
    }
}
```

### Servicios (resto de dominios)

En `restaurant`, `dish`, `ingredient`, `order` y `table` el equivalente al caso de uso es un **servicio con varios métodos**, no una clase por acción:

```tsx
export class RestaurantService {
    constructor(private readonly restaurantRepository: RestaurantRepository) {}

    async create(dto: CreateRestaurantDTO): Promise<Restaurant> {
        const now = new Date().toISOString()
        const restaurant = this.buildRestaurant({ id: randomUUID(), ...dto, createdAt: now, updatedAt: now })
        await this.restaurantRepository.save(restaurant)
        return restaurant
    }

    // update(), getById(), getAll()

    // buildRestaurant() concentra las validaciones que en DDD irían en la entidad
    private buildRestaurant(props): Restaurant { /* validaciones + objeto plano */ }
}
```

### DTOs

Se declaran en el mismo fichero que los consume (el caso de uso o el servicio):

```tsx
export interface CreateRestaurantDTO {
    name: string
    address: string
    email: string
    phone: string
    ownerFirstName: string
    ownerLastName: string
    logoUrl: string | null
}
```

---

## Capa de Infraestructura

### Repositorios SQLite

Todos siguen el mismo patrón: `save()` decide entre UPDATE e INSERT, y un método privado mapea la fila a objeto:

```tsx
export class SqliteRestaurantRepository implements RestaurantRepository {
    constructor(private db: Database) {}

    async save(restaurant: Restaurant): Promise<void> {
        const existing = await this.findById(restaurant.id)
        // UPDATE si existe, INSERT si no
    }

    private mapToRestaurant(row: RestaurantRow): Restaurant {
        return { id: row.id, /* ... */ }   // objeto plano
    }
}
```

En `employee` el mapeo reconstruye la entidad con `Employee.create()`; en el resto devuelve el objeto plano directamente. El renombrado `snake_case` → `camelCase` se hace con alias en el propio SQL (`owner_first_name as ownerFirstName`).

### Controladores y Rutas

Las rutas conectan URLs con controladores y aplican middlewares. La **composición de dependencias se hace en el propio fichero de rutas**:

```tsx
const dishRepository = new SqliteDishRepository(dbConfig)
const dishService = new DishService(dishRepository)
const dishController = new DishController(dishService)

const router = Router({ mergeParams: true })

router.post('/', authenticate, authorize(['admin', 'manager']), dishController.create)
```

La excepción es `employee`: como sus rutas están repartidas en tres ficheros, el cableado se extrae a `contexts/employee/infrastructure/http/dependencies.ts`, que exporta `authController` y `employeeController` ya construidos.

`mergeParams: true` es obligatorio en los routers montados bajo un prefijo con parámetros (`/restaurants/:restaurantId/...`) para poder leer `req.params.restaurantId`.

---

## Endpoints

Todos cuelgan de `/api/v1`. La columna **Roles** indica qué valores de `req.user.role` acepta `authorize()`; “autenticado” significa que basta con un JWT válido, sin filtro de rol.

El contrato detallado (cuerpos, respuestas, códigos y ejemplos) de las mesas y de los pedidos está en OpenAPI 3.1: [`docs/api/openapi-mesas.yaml`](../api/openapi-mesas.yaml).

### Públicos (sin autenticación)

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/health` | Healthcheck. Devuelve `{ status: 'ok' }`. **No lleva el prefijo `/api/v1`** |
| `POST` | `/api/v1/auth/login` | Login. Devuelve `{ token, employee }` |
| `POST` | `/api/v1/auth/register` | Auto-registro de cliente. Devuelve `{ token, employee }` (201) |
| `GET` | `/api/v1/public/restaurants` | Listado de restaurantes para la app de clientes |
| `GET` | `/api/v1/public/restaurants/:id` | Detalle de restaurante |
| `GET` | `/api/v1/public/restaurants/:restaurantId/dishes` | Carta pública del restaurante |
| `GET` | `/api/v1/public/restaurants/:restaurantId/tables/available?people=N` | Mesas libres con capacidad ≥ N (ver [Mesas](#mesas)) |

### Restaurantes

| Método | Ruta | Roles |
| --- | --- | --- |
| `POST` | `/api/v1/restaurants` | admin |
| `GET` | `/api/v1/restaurants` | autenticado |
| `GET` | `/api/v1/restaurants/:id` | autenticado |
| `PUT` | `/api/v1/restaurants/:id` | admin |

`GET /api/v1/restaurants` no devuelve lo mismo a todo el mundo: si el rol es `admin` devuelve todos los restaurantes; si no, devuelve un array con el restaurante de `req.user.restaurantId`, o vacío si el usuario no tiene restaurante asignado.

### Empleados

| Método | Ruta | Roles |
| --- | --- | --- |
| `POST` | `/api/v1/employees` | admin |
| `GET` | `/api/v1/employees` | admin — acepta `?limit=`, `?offset=` y `?role=` |
| `GET` | `/api/v1/employees/:id` | admin |
| `GET` | `/api/v1/restaurants/:restaurantId/employees` | admin |

### Platos e ingredientes

| Método | Ruta | Roles |
| --- | --- | --- |
| `POST` | `/api/v1/restaurants/:restaurantId/dishes` | admin, manager |
| `GET` | `/api/v1/restaurants/:restaurantId/dishes` | admin, manager, camarero, cocinero |
| `GET` | `/api/v1/restaurants/:restaurantId/dishes/:id` | admin, manager, camarero, cocinero |
| `PUT` | `/api/v1/restaurants/:restaurantId/dishes/:id` | admin, manager |
| `DELETE` | `/api/v1/restaurants/:restaurantId/dishes/:id` | admin, manager |
| `POST` | `/api/v1/restaurants/:restaurantId/ingredients` | admin |
| `GET` | `/api/v1/restaurants/:restaurantId/ingredients` | admin, manager, cocinero |
| `GET` | `/api/v1/restaurants/:restaurantId/ingredients/:id` | admin, manager, cocinero |
| `PUT` | `/api/v1/restaurants/:restaurantId/ingredients/:id` | admin |
| `DELETE` | `/api/v1/restaurants/:restaurantId/ingredients/:id` | admin |

Los ingredientes son **más restrictivos** que los platos: solo `admin` puede crear, editar o borrar.

### Mesas

Privadas, bajo `/api/v1/restaurants/:restaurantId/tables`. Todas aplican `authenticate` → `authorize()` → `assertRestaurantAccess()`, así que `manager` y `camarero` solo acceden a las mesas de su restaurante (el `admin` a todas). El `cocinero` **no** tiene acceso: solo ve pedidos.

| Método | Ruta | Roles | Respuesta |
| --- | --- | --- | --- |
| `GET` | `/` | admin, manager, camarero | 200 `RestaurantTable[]` ordenadas por `number` |
| `GET` | `/:id` | admin, manager, camarero | 200 / 404 si no existe o es de otro restaurante |
| `POST` | `/` | admin | 201 / 400 / 409 (número repetido). `status` opcional, por defecto `libre` |
| `PUT` | `/:id` | admin | 200 / 400 / 404 / 409 (número repetido o salida de `ocupada` con pedidos activos). `number`, `capacity` y `status` obligatorios; `description` ausente o vacía → `null` |
| `PATCH` | `/:id/status` | admin, manager, camarero | 200 / 400 / 404 / 409 (salida de `ocupada` con pedidos activos). Cualquier transición; fijar el mismo estado no tiene efectos |
| `DELETE` | `/:id` | admin | 204 / 404 / 409 si está `ocupada` o tiene pedidos activos |

Públicas, bajo `/api/v1/public/restaurants/:restaurantId/tables`:

| Método | Ruta | Auth | Respuesta |
| --- | --- | --- | --- |
| `GET` | `/available?people=N` | ninguna | 200 `{ id, number, description, capacity }[]`: solo `libre` con `capacity >= N`, la más ajustada primero. 400 si `people` falta o no es entero ≥ 1 |
| `POST` | `/:id/occupy` | `cliente` | 200 con la mesa ya `ocupada` / 400 / 401 / 403 / 404 / 409 si no está libre, no cabe o el cliente ya ocupa otra mesa del restaurante (`ClientAlreadyHasTableError`) |
| `GET` | `/mine` | `cliente` | 200 `{ table, hasOrders }` con la mesa que ocupa el cliente en ese restaurante / 404 si no ocupa ninguna |
| `POST` | `/:id/release` | `cliente` | 200 con la mesa `libre` / 403 `TableNotOwnedError` si no es suya / 404 / 409 `TableHasOrdersError` si ya ha pedido |

Reglas:

- Número y capacidad son enteros JSON ≥ 1 (la cadena `"4"` se rechaza). El número es único dentro del restaurante (`UNIQUE(restaurant_id, number)`).
- **Dueño de la mesa**: `occupy` guarda en `occupied_by` al cliente que la ocupa (no se devuelve en la API). Solo ese cliente puede pedir en ella. Un cliente ocupa como mucho **una mesa por restaurante**. Si un empleado pone una mesa en `ocupada` a mano, queda sin dueño y nadie puede pedir en ella.
- **Ocupar es atómico**: `occupyIfFree()` es un único `UPDATE ... WHERE status = 'libre' AND capacity >= ? AND NOT EXISTS (otra mesa del cliente) RETURNING ...`. En el caso normal es una sola consulta; si no ocupa nada, el servicio lee la mesa solo para elegir el error (404, `ClientAlreadyHasTableError` o `TableNotAvailableError`).
- **Salir de `ocupada`** (a `libre` o `reservada`, por `PATCH` o `PUT`): si la mesa tiene **pedidos activos** (algún ítem sin `entregado`, igual que `/orders/active`) responde 409 `TableHasActiveOrdersError` y no cambia nada; si no, en una transacción limpia el dueño y **mueve sus pedidos al histórico** (`orders_history`, `order_items_history`). Así cada ocupación empieza sin pedidos.
- **Liberar**: la libera un empleado (cuando todo está entregado) o el propio cliente con `release` si todavía no ha pedido nada. No hay liberación automática.
- **Borrar**: no se puede si está `ocupada` ni si tiene pedidos activos; los pedidos completados que le queden se archivan en la misma transacción.
- **Concurrencia**: las operaciones que comprueban y luego escriben (número libre, sin pedidos activos, una mesa por cliente, mesa ocupada por quien pide) se ejecutan con un lock por restaurante (`services/restaurant-lock.ts`) compartido por `TableService` y `OrderService`. Además, si salta `UNIQUE(restaurant_id, number)`, el repositorio lo traduce a `DuplicatedTableNumberError`: dos altas simultáneas con el mismo número dan 201 y 409, nunca 500. El lock vive en memoria, así que solo es válido con un único proceso de la API.

### Pedidos

| Método | Ruta | Roles |
| --- | --- | --- |
| `POST` | `/api/v1/orders` | autenticado — el `clientId` se toma del JWT, no del body |
| `GET` | `/api/v1/orders/active` | autenticado — **requiere `?restaurantId=`** (400 si falta) |
| `GET` | `/api/v1/orders/mine` | autenticado — pedidos del usuario del JWT |
| `GET` | `/api/v1/orders/:id` | autenticado |
| `PATCH` | `/api/v1/orders/:orderId/items/:itemId/status` | autenticado — devuelve 204 sin cuerpo |

**Todo pedido va asociado a una mesa ocupada por quien pide** (no hay pedidos para llevar). `POST /orders` valida en este orden y devuelve el primer error, siempre a través del `errorHandler`:

1. Sin `restaurantId` → 400 `RestaurantIdRequiredError`.
2. `items` ausente, no array o vacío → 400 `OrderItemsRequiredError`.
3. Algún ítem sin `dishId`, con `quantity` que no es entero ≥ 1 o con `notes` que no es cadena ni `null` → 400 `InvalidOrderItemError`.
4. Sin `tableId` (ausente, `null` o vacío) → 400 `TableIdRequiredError`.
5. La mesa no existe o es de otro restaurante → 404 `TableNotFoundError`.
6. La mesa no está `ocupada` → 409 `TableNotAvailableError`.
7. La mesa no la ocupó el usuario del token (incluidas las ocupadas a mano, sin dueño) → 403 `TableNotOwnedError`, también para empleados.
8. Algún plato no existe o es de otro restaurante → 400 `InvalidOrderDishError`.

Se admiten varios pedidos para la misma mesa mientras siga ocupada por el mismo cliente. El pedido y sus ítems se guardan en una transacción. `OrderService` recibe dos repositorios: `new OrderService(orderRepository, tableRepository)`. Las lecturas de pedidos (`/active`, `/mine`, `/:id`) y la respuesta de `POST` incluyen `tableNumber`, obtenido con `LEFT JOIN restaurant_tables` sobre la misma `restaurant_id`. Si `tableId` no corresponde a ninguna mesa (pedidos antiguos con texto libre o mesa borrada), la clave `tableNumber` **se omite** y los frontends muestran "Sin mesa".

**Pedidos archivados**: `GET /orders/mine` y `GET /orders/:id` buscan también en `orders_history` y marcan esos pedidos con `archived: true` (en el resto la clave se omite). `GET /orders/active` solo lee `orders`, así que nunca los incluye. Los ítems de un pedido archivado no se pueden cambiar de estado (el `PATCH` responde como si no existiera).

Ninguna ruta de pedidos aplica `authorize()`: cualquier usuario autenticado puede cambiar el estado de cualquier ítem.

`GET /orders/active` devuelve los pedidos del restaurante que tengan **al menos un ítem** en estado distinto de `entregado`.

Al crear un pedido, el servicio **expande las cantidades**: un ítem con `quantity: 3` se guarda como 3 filas de `order_items` con `quantity: 1` cada una, para poder seguir el estado de cada unidad por separado.

---

## Middlewares

Definidos en `contexts/shared/infrastructure/http/middlewares.ts`.

| Middleware | Función | Respuesta al fallar |
| --- | --- | --- |
| `authenticate` | Verifica el JWT de `Authorization: Bearer <token>` y vuelca el payload en `req.user` | 401 |
| `authorize(roles)` | Comprueba que `req.user.role` está en la lista | 403 |
| `assertRestaurantAccess(param)` | Aislamiento por restaurante: el `admin` pasa siempre; el resto solo si `req.params[param]` (por defecto `restaurantId`) coincide con `req.user.restaurantId`. Hoy solo lo usan las rutas de mesas | 403 |

Los tres responden directamente, sin pasar por el `errorHandler`.

---

## Gestión de Errores

Jerarquía: `Error` → `AppError` (abstracta) → errores específicos en `errors/DomainErrors.ts`. `AppError` asigna `this.name = this.constructor.name`, y el `errorHandler` decide el código HTTP a partir de ese nombre:

- **404**: `EmployeeNotFoundError`, `RestaurantNotFoundError`, `IngredientNotFoundError`, `DishNotFoundError`, `TableNotFoundError`
- **401**: `InvalidCredentialsError`
- **403** (`FORBIDDEN_ERRORS`): `TableNotOwnedError`
- **409** (`CONFLICT_ERRORS`): `DuplicatedTableNumberError`, `TableNotAvailableError`, `TableOccupiedError`, `TableHasActiveOrdersError`, `TableHasOrdersError`, `ClientAlreadyHasTableError`
- **400**: cualquier otro `AppError`
- **500**: errores no controlados

Excepciones que conviene conocer:

- `OrderNotFoundError` **no** está en la lista de 404. Si llegase al `errorHandler` se traduciría a 400.
- `OrderController` no delega en el `errorHandler`: es el único controlador que **no llama a `next(error)`**, sino que hace su propio `try/catch` y construye la respuesta a mano. Por eso `GET /orders/:id` sí devuelve 404, pero el `PATCH` de estado devuelve 400 para el mismo error. La excepción es `createOrder`, que delega con `next(error)`: sus errores salen del `errorHandler` (`{ error: <NombreDelError>, message }`) y un error inesperado da 500. El resto de handlers responden `{ error: <mensaje> }`.
- Un cuerpo JSON mal formado lo rechaza `express.json()` antes de llegar al router; el `errorHandler` lo reconoce (`err.type === 'entity.parse.failed'`) y responde 400 `{ error: 'InvalidJsonError', message: 'Malformed JSON body' }` en cualquier endpoint.

Errores de mesas y pedidos (los textos de `message` están en inglés, como el resto; los frontends deciden por código HTTP o por el nombre en `error`):

| Error | HTTP | Cuándo |
| --- | --- | --- |
| `TableIdRequiredError` | 400 | Se crea un pedido sin `tableId` |
| `OrderItemsRequiredError` | 400 | Pedido sin ítems o con `items` que no es un array |
| `InvalidOrderItemError` | 400 | Ítem sin `dishId`, con `quantity` no entera ≥ 1 o `notes` inválidas |
| `InvalidOrderDishError` | 400 | Plato inexistente o de otro restaurante |
| `InvalidTableNumberError` | 400 | `number` ausente, no entero o < 1 |
| `InvalidTableCapacityError` | 400 | `capacity` ausente, no entera o < 1 |
| `InvalidTableStatusError` | 400 | `status` ausente (cuando es obligatorio) o fuera de la lista |
| `InvalidPeopleCountError` | 400 | `people` ausente, no entero o < 1 |
| `TableNotOwnedError` | 403 | Pedir en una mesa (o liberarla con `release`) sin ser quien la ocupó |
| `TableNotFoundError` | 404 | La mesa no existe o no pertenece al restaurante (o el cliente no ocupa ninguna en `/mine`) |
| `DuplicatedTableNumberError` | 409 | Ya hay una mesa con ese número en el restaurante |
| `TableNotAvailableError` | 409 | Ocupar una mesa no libre o sin capacidad, o pedir en una mesa no `ocupada` |
| `TableOccupiedError` | 409 | Borrar una mesa ocupada |
| `TableHasActiveOrdersError` | 409 | Borrar una mesa o sacarla de `ocupada` con pedidos activos |
| `TableHasOrdersError` | 409 | El cliente intenta liberar (`release`) una mesa en la que ya ha pedido |
| `ClientAlreadyHasTableError` | 409 | El cliente ya ocupa otra mesa en ese restaurante |

---

## Path Aliases

Definidos en `tsconfig.json` (`baseUrl: ./src`). En tiempo de ejecución los resuelve `tsx`, y en los tests el plugin `vite-tsconfig-paths`.

| Alias | Ruta real |
| --- | --- |
| `@config/*` | `src/config/*` |
| `@errors/*` | `src/errors/*` |
| `@shared/*` | `src/contexts/shared/*` |
| `@employee/*` | `src/contexts/employee/*` |
| `@models/*` | `src/models/*` |
| `@repositories/*` | `src/repositories/*` |
| `@services/*` | `src/services/*` |
| `@controllers/*` | `src/controllers/*` |
| `@routes/*` | `src/routes/*` |
| `@scripts/*` | `src/scripts/*` |

Los imports llevan extensión `.js` (`import { dbConfig } from '@config/database.js'`) porque el paquete es ESM (`"type": "module"`, `module: nodenext`).

---

## Base de Datos

La clase `Database` (`config/database.ts`) encapsula `sqlite3` con una API basada en promesas:

- `initialize()`: abre la conexión y ejecuta `runInitialMigrations()` (`CREATE TABLE IF NOT EXISTS`)
- `run()`: INSERT/UPDATE/DELETE
- `all<T>()`: SELECT de múltiples filas
- `get<T>()`: SELECT de una fila
- `close()`: cierra la conexión
- `getDb()`: acceso crudo; lanza `DatabaseNotInitializedError` si no se ha llamado a `initialize()`
- `transaction(fn)`: ejecuta `fn` entre `BEGIN IMMEDIATE` y `COMMIT` (`ROLLBACK` si lanza). Como hay una sola conexión, marca el contexto asíncrono con `AsyncLocalStorage`: las sentencias lanzadas desde fuera de la transacción esperan a que termine (no se cuelan dentro ni se deshacen con su `ROLLBACK`), las transacciones se encolan y una transacción anidada reutiliza la actual. La usan el guardado de un pedido con sus ítems y el archivado de pedidos

El módulo exporta una **instancia única** (`export const dbConfig = new Database()`) que se importa allá donde hace falta. No es un singleton con `getInstance()`: nada impide construir otra `Database`, y de hecho los tests lo hacen.

La ruta del fichero se decide en el constructor: `:memory:` si `NODE_ENV=test`, y `packages/api/resttek.db` en cualquier otro caso.

`initialize()` activa `PRAGMA foreign_keys = ON`, por lo que el orden de inserción importa. El seed (`scripts/seed.ts`) crea primero los restaurantes y después los empleados: antes lo hacía al revés y fallaba con `SQLITE_CONSTRAINT` sobre una base de datos vacía. El seed también crea 6 mesas por restaurante con ids fijos `rest-N-mesa-M` (la 3 ocupada y la 5 reservada) y el pedido de ejemplo usa `rest-1-mesa-3` (ocupada sin dueño, como si la hubiera ocupado un empleado).

Las migraciones son `CREATE TABLE IF NOT EXISTS`, que no añade columnas a una tabla que ya existe. Para `restaurant_tables.occupied_by`, `runInitialMigrations()` comprueba `PRAGMA table_info` y hace `ALTER TABLE ... ADD COLUMN` si falta, así que una base de datos anterior sigue funcionando sin volver a sembrar.

---

## Tests

Con **Vitest** (`npm test` desde la raíz, o `npm run test:watch` dentro de `packages/api`). Los tests son unitarios y conviven con el código que prueban:

- Dominio y casos de uso de `employee`, con dobles en `contexts/employee/application/mocks/`
- Servicios y repositorios de `restaurant`, `ingredient`, `order` y `table`, con dobles en `repositories/mocks/` (`MockTableRepository` permite fijar los pedidos de una mesa con `setOrderStats()` y registra las mesas archivadas)
- `Database.transaction()` (`config/database.test.ts`), los middlewares y el mapeo de errores del `errorHandler`

**No hay tests de integración HTTP.** `supertest` figura como dependencia de desarrollo pero no se usa en ningún test, así que las rutas no están cubiertas.
