import { randomUUID } from 'crypto'
import type { RestaurantTable } from '@models/table.model.js'
import { normalizeTableStatus } from '@models/table.model.js'
import type { TableRepository } from '@repositories/table.repository.js'
import {
    DuplicatedTableNumberError,
    InvalidPeopleCountError,
    InvalidTableCapacityError,
    InvalidTableNumberError,
    RestaurantIdRequiredError,
    TableNotAvailableError,
    TableNotFoundError,
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

const isPositiveInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1

export class TableService {
    constructor(private readonly tableRepository: TableRepository) {}

    async create(dto: CreateTableDTO): Promise<RestaurantTable> {
        const now = new Date().toISOString()
        const table = this.buildTable({
            id: randomUUID(),
            restaurantId: dto.restaurantId,
            number: dto.number,
            description: dto.description,
            capacity: dto.capacity,
            status: dto.status ?? 'libre',
            createdAt: now,
            updatedAt: now
        })

        await this.assertNumberIsFree(table)
        await this.tableRepository.save(table)
        return table
    }

    async update(restaurantId: string, id: string, dto: UpdateTableDTO): Promise<RestaurantTable> {
        const existing = await this.findById(restaurantId, id)

        const updated = this.buildTable({
            id: existing.id,
            restaurantId: existing.restaurantId,
            number: dto.number,
            description: dto.description,
            capacity: dto.capacity,
            status: dto.status,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString()
        })

        await this.assertNumberIsFree(updated)
        await this.tableRepository.save(updated)
        return updated
    }

    async delete(restaurantId: string, id: string): Promise<void> {
        const existing = await this.findById(restaurantId, id)
        if (existing.status === 'ocupada') {
            throw new TableOccupiedError()
        }
        await this.tableRepository.delete(id)
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

    async changeStatus(restaurantId: string, id: string, status: unknown): Promise<RestaurantTable> {
        const existing = await this.findById(restaurantId, id)
        const updated: RestaurantTable = {
            ...existing,
            status: normalizeTableStatus(status),
            updatedAt: new Date().toISOString()
        }
        await this.tableRepository.updateStatus(id, updated.status, updated.updatedAt)
        return updated
    }

    async occupy(restaurantId: string, id: string, people: unknown): Promise<RestaurantTable> {
        const validPeople = this.validatePeople(people)
        await this.findById(restaurantId, id)

        const occupied = await this.tableRepository.occupyIfFree(id, restaurantId, validPeople, new Date().toISOString())
        if (!occupied) {
            throw new TableNotAvailableError()
        }
        return this.findById(restaurantId, id)
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
            createdAt: props.createdAt,
            updatedAt: props.updatedAt
        }
    }
}
