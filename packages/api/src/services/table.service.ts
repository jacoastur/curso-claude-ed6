import { randomUUID } from 'crypto'
import type { RestaurantTable, TableStatusType } from '@models/table.model.js'
import { normalizeTableStatus } from '@models/table.model.js'
import type { TableRepository } from '@repositories/table.repository.js'
import { KeyedLock, restaurantLock } from '@services/restaurant-lock.js'
import {
    ClientAlreadyHasTableError,
    DuplicatedTableNumberError,
    InvalidPeopleCountError,
    InvalidTableCapacityError,
    InvalidTableNumberError,
    RestaurantIdRequiredError,
    TableHasActiveOrdersError,
    TableHasOrdersError,
    TableNotAvailableError,
    TableNotFoundError,
    TableNotOwnedError,
    TableOccupiedError
} from '@errors/DomainErrors.js'

// Los DTOs usan `unknown` porque vienen directamente del cuerpo JSON y se validan aquí.
export interface CreateTableDTO {
    restaurantId: string
    number: unknown
    description?: unknown
    capacity: unknown
    status?: unknown
}

export interface UpdateTableDTO {
    number: unknown
    description?: unknown
    capacity: unknown
    status: unknown
}

export interface MyTable {
    table: RestaurantTable
    hasOrders: boolean
}

const isPositiveInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1

/**
 * Las operaciones que comprueban y luego escriben se ejecutan con el lock del restaurante,
 * compartido con OrderService, para que no se crucen entre peticiones concurrentes.
 */
export class TableService {
    constructor(
        private readonly tableRepository: TableRepository,
        private readonly lock: KeyedLock = restaurantLock
    ) {}

    async create(dto: CreateTableDTO): Promise<RestaurantTable> {
        const now = new Date().toISOString()
        const table = this.buildTable({
            id: randomUUID(),
            restaurantId: dto.restaurantId,
            number: dto.number,
            description: dto.description,
            capacity: dto.capacity,
            status: dto.status ?? 'libre',
            occupiedBy: null,
            createdAt: now,
            updatedAt: now
        })

        return this.lock.run(table.restaurantId, async () => {
            await this.assertNumberIsFree(table)
            await this.tableRepository.save(table)
            return table
        })
    }

    async update(restaurantId: string, id: string, dto: UpdateTableDTO): Promise<RestaurantTable> {
        return this.lock.run(restaurantId, async () => {
            const existing = await this.findById(restaurantId, id)

            const updated = this.buildTable({
                id: existing.id,
                restaurantId: existing.restaurantId,
                number: dto.number,
                description: dto.description,
                capacity: dto.capacity,
                status: dto.status,
                occupiedBy: existing.occupiedBy,
                createdAt: existing.createdAt,
                updatedAt: new Date().toISOString()
            })

            await this.assertNumberIsFree(updated)
            return this.saveWithStatus(existing, updated)
        })
    }

    async changeStatus(restaurantId: string, id: string, status: unknown): Promise<RestaurantTable> {
        const newStatus = normalizeTableStatus(status)
        return this.lock.run(restaurantId, async () => {
            const existing = await this.findById(restaurantId, id)
            if (newStatus === existing.status) {
                return existing
            }
            return this.saveWithStatus(existing, { ...existing, status: newStatus, updatedAt: new Date().toISOString() })
        })
    }

    async delete(restaurantId: string, id: string): Promise<void> {
        await this.lock.run(restaurantId, async () => {
            const existing = await this.findById(restaurantId, id)
            if (existing.status === 'ocupada') {
                throw new TableOccupiedError()
            }
            const stats = await this.tableRepository.getOrderStats(id)
            if (stats.activeOrders > 0) {
                throw new TableHasActiveOrdersError()
            }
            // El repositorio archiva los pedidos completados que queden.
            await this.tableRepository.delete(id)
        })
    }

    async findById(restaurantId: string, id: string): Promise<RestaurantTable> {
        const table = await this.tableRepository.findById(id)
        if (!table || table.restaurantId !== restaurantId) {
            throw new TableNotFoundError()
        }
        return table
    }

    async findByRestaurantId(restaurantId: string): Promise<RestaurantTable[]> {
        return this.tableRepository.findByRestaurantId(restaurantId)
    }

    async findAvailable(restaurantId: string, people: unknown): Promise<RestaurantTable[]> {
        return this.tableRepository.findAvailable(restaurantId, this.validatePeople(people))
    }

    async findMine(restaurantId: string, clientId: string): Promise<MyTable> {
        const table = await this.tableRepository.findByOccupant(restaurantId, clientId)
        if (!table) {
            throw new TableNotFoundError()
        }
        const stats = await this.tableRepository.getOrderStats(table.id)
        return { table, hasOrders: stats.orders > 0 }
    }

    async occupy(restaurantId: string, id: string, people: unknown, clientId: string): Promise<RestaurantTable> {
        const validPeople = this.validatePeople(people)

        return this.lock.run(restaurantId, async () => {
            // Camino feliz en una sola consulta; las lecturas siguientes solo explican el fallo.
            const occupied = await this.tableRepository.occupyIfFree(id, restaurantId, validPeople, clientId, new Date().toISOString())
            if (occupied) {
                return occupied
            }

            await this.findById(restaurantId, id)
            const current = await this.tableRepository.findByOccupant(restaurantId, clientId)
            if (current && current.id !== id) {
                throw new ClientAlreadyHasTableError()
            }
            throw new TableNotAvailableError()
        })
    }

    async release(restaurantId: string, id: string, clientId: string): Promise<RestaurantTable> {
        return this.lock.run(restaurantId, async () => {
            const existing = await this.findById(restaurantId, id)
            if (existing.status !== 'ocupada' || existing.occupiedBy !== clientId) {
                throw new TableNotOwnedError()
            }
            const stats = await this.tableRepository.getOrderStats(id)
            if (stats.orders > 0) {
                throw new TableHasOrdersError()
            }

            const released: RestaurantTable = { ...existing, status: 'libre', occupiedBy: null, updatedAt: new Date().toISOString() }
            await this.tableRepository.save(released)
            return released
        })
    }

    /**
     * Aplica las reglas del cambio de estado y guarda:
     * - salir de `ocupada` exige que no haya pedidos activos, limpia el dueño y archiva los pedidos;
     * - entrar en `ocupada` a mano deja la mesa sin dueño;
     * - mantenerse en `ocupada` conserva dueño y pedidos.
     */
    private async saveWithStatus(existing: RestaurantTable, updated: RestaurantTable): Promise<RestaurantTable> {
        const leavesOccupied = existing.status === 'ocupada' && updated.status !== 'ocupada'

        if (leavesOccupied) {
            const stats = await this.tableRepository.getOrderStats(existing.id)
            if (stats.activeOrders > 0) {
                throw new TableHasActiveOrdersError()
            }
        }

        const toSave: RestaurantTable = {
            ...updated,
            occupiedBy: this.ownerAfter(existing, updated.status)
        }
        await this.tableRepository.save(toSave, { archiveOrders: leavesOccupied })
        return toSave
    }

    private ownerAfter(existing: RestaurantTable, newStatus: TableStatusType): string | null {
        return existing.status === 'ocupada' && newStatus === 'ocupada' ? existing.occupiedBy : null
    }

    private validatePeople(people: unknown): number {
        if (!isPositiveInteger(people)) {
            throw new InvalidPeopleCountError()
        }
        return people
    }

    private async assertNumberIsFree(table: RestaurantTable): Promise<void> {
        const sameNumber = await this.tableRepository.findByNumber(table.restaurantId, table.number)
        if (sameNumber && sameNumber.id !== table.id) {
            throw new DuplicatedTableNumberError()
        }
    }

    private buildTable(props: {
        id: string
        restaurantId: string
        number: unknown
        description: unknown
        capacity: unknown
        status: unknown
        occupiedBy: string | null
        createdAt: string
        updatedAt: string
    }): RestaurantTable {
        if (!props.restaurantId || props.restaurantId.trim() === '') {
            throw new RestaurantIdRequiredError()
        }
        if (!isPositiveInteger(props.number)) {
            throw new InvalidTableNumberError()
        }
        if (!isPositiveInteger(props.capacity)) {
            throw new InvalidTableCapacityError()
        }
        const status = normalizeTableStatus(props.status)

        const description = typeof props.description === 'string' && props.description.trim() !== ''
            ? props.description.trim()
            : null

        return {
            id: props.id,
            restaurantId: props.restaurantId,
            number: props.number,
            description,
            capacity: props.capacity,
            status,
            occupiedBy: props.occupiedBy,
            createdAt: props.createdAt,
            updatedAt: props.updatedAt
        }
    }
}
