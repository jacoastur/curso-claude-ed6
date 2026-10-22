import { describe, it, expect, beforeEach } from 'vitest'
import { TableService } from './table.service.js'
import { normalizeTableStatus } from '@models/table.model.js'
import { MockTableRepository } from '@repositories/mocks/MockTableRepository.js'
import {
    DuplicatedTableNumberError,
    InvalidPeopleCountError,
    InvalidTableCapacityError,
    InvalidTableNumberError,
    InvalidTableStatusError,
    TableNotAvailableError,
    TableNotFoundError,
    TableOccupiedError
} from '@errors/DomainErrors.js'

describe('normalizeTableStatus', () => {
    it('should accept and normalize a valid status', () => {
        expect(normalizeTableStatus(' Ocupada ')).toBe('ocupada')
    })

    it('should throw "Table status is required" when missing', () => {
        expect(() => normalizeTableStatus(undefined)).toThrow('Table status is required')
    })

    it('should throw InvalidTableStatusError for an unknown status', () => {
        expect(() => normalizeTableStatus('rota')).toThrow('Invalid table status: rota. Must be one of: libre, ocupada, reservada')
    })
})

describe('TableService', () => {
    let repo: MockTableRepository
    let service: TableService

    const validInput = { restaurantId: 'r1', number: 1, description: 'Ventana', capacity: 4 }

    beforeEach(() => {
        repo = new MockTableRepository()
        service = new TableService(repo)
    })

    describe('create', () => {
        it('should create a free table by default', async () => {
            const table = await service.create(validInput)
            expect(table).toMatchObject({ restaurantId: 'r1', number: 1, description: 'Ventana', capacity: 4, status: 'libre' })
            expect(await repo.findById(table.id)).not.toBeNull()
        })

        it('should store an empty description as null', async () => {
            const table = await service.create({ ...validInput, description: '   ' })
            expect(table.description).toBeNull()
        })

        it.each([undefined, null, 0, -1, 1.5, '4'])('should reject number %s', async (number) => {
            await expect(service.create({ ...validInput, number })).rejects.toThrow(InvalidTableNumberError)
        })

        it.each([undefined, null, 0, -2, 2.5, '4'])('should reject capacity %s', async (capacity) => {
            await expect(service.create({ ...validInput, capacity })).rejects.toThrow(InvalidTableCapacityError)
        })

        it('should validate number before capacity', async () => {
            await expect(service.create({ restaurantId: 'r1', number: undefined, capacity: undefined }))
                .rejects.toThrow(InvalidTableNumberError)
        })

        it('should reject an invalid status', async () => {
            await expect(service.create({ ...validInput, status: 'rota' })).rejects.toThrow(InvalidTableStatusError)
        })

        it('should reject a duplicated number in the same restaurant', async () => {
            await service.create(validInput)
            await expect(service.create(validInput)).rejects.toThrow(DuplicatedTableNumberError)
        })

        it('should allow the same number in another restaurant', async () => {
            await service.create(validInput)
            await expect(service.create({ ...validInput, restaurantId: 'r2' })).resolves.toBeDefined()
        })
    })

    describe('update', () => {
        it('should update a table and keep its own number', async () => {
            const table = await service.create(validInput)
            const updated = await service.update('r1', table.id, { number: 1, capacity: 6, status: 'reservada' })
            expect(updated).toMatchObject({ number: 1, capacity: 6, status: 'reservada', description: null })
        })

        it('should require the status', async () => {
            const table = await service.create(validInput)
            await expect(service.update('r1', table.id, { number: 1, capacity: 6, status: undefined }))
                .rejects.toThrow('Table status is required')
        })

        it('should reject a number used by another table', async () => {
            await service.create(validInput)
            const other = await service.create({ ...validInput, number: 2 })
            await expect(service.update('r1', other.id, { number: 1, capacity: 4, status: 'libre' }))
                .rejects.toThrow(DuplicatedTableNumberError)
        })

        it('should throw TableNotFoundError for a table of another restaurant', async () => {
            const table = await service.create(validInput)
            await expect(service.update('r2', table.id, { number: 1, capacity: 4, status: 'libre' }))
                .rejects.toThrow(TableNotFoundError)
        })
    })

    describe('delete', () => {
        it('should delete a free table', async () => {
            const table = await service.create(validInput)
            await service.delete('r1', table.id)
            expect(await repo.findById(table.id)).toBeNull()
        })

        it('should reject deleting an occupied table', async () => {
            const table = await service.create({ ...validInput, status: 'ocupada' })
            await expect(service.delete('r1', table.id)).rejects.toThrow(TableOccupiedError)
        })

        it('should throw TableNotFoundError for an unknown table', async () => {
            await expect(service.delete('r1', 'nope')).rejects.toThrow(TableNotFoundError)
        })
    })

    describe('findAvailable', () => {
        it('should return free tables with enough capacity, smallest first', async () => {
            await service.create({ ...validInput, number: 1, capacity: 6 })
            await service.create({ ...validInput, number: 2, capacity: 2 })
            await service.create({ ...validInput, number: 3, capacity: 4 })
            await service.create({ ...validInput, number: 4, capacity: 4, status: 'reservada' })

            const tables = await service.findAvailable('r1', 3)
            expect(tables.map(t => t.number)).toEqual([3, 1])
        })

        it.each([undefined, 0, 1.5, '3'])('should reject people %s', async (people) => {
            await expect(service.findAvailable('r1', people)).rejects.toThrow(InvalidPeopleCountError)
        })
    })

    describe('changeStatus', () => {
        it('should change the status', async () => {
            const table = await service.create({ ...validInput, status: 'ocupada' })
            const updated = await service.changeStatus('r1', table.id, 'libre')
            expect(updated.status).toBe('libre')
            expect((await repo.findById(table.id))?.status).toBe('libre')
        })

        it('should reject an invalid status', async () => {
            const table = await service.create(validInput)
            await expect(service.changeStatus('r1', table.id, 'rota')).rejects.toThrow(InvalidTableStatusError)
        })
    })

    describe('occupy', () => {
        it('should occupy a free table', async () => {
            const table = await service.create(validInput)
            const occupied = await service.occupy('r1', table.id, 3)
            expect(occupied.status).toBe('ocupada')
        })

        it('should reject occupying a table twice', async () => {
            const table = await service.create(validInput)
            await service.occupy('r1', table.id, 3)
            await expect(service.occupy('r1', table.id, 3)).rejects.toThrow(TableNotAvailableError)
        })

        it('should reject a table with insufficient capacity', async () => {
            const table = await service.create(validInput)
            await expect(service.occupy('r1', table.id, 5)).rejects.toThrow(TableNotAvailableError)
        })

        it('should reject a reserved table', async () => {
            const table = await service.create({ ...validInput, status: 'reservada' })
            await expect(service.occupy('r1', table.id, 2)).rejects.toThrow(TableNotAvailableError)
        })

        it('should throw TableNotFoundError for a table of another restaurant', async () => {
            const table = await service.create(validInput)
            await expect(service.occupy('r2', table.id, 2)).rejects.toThrow(TableNotFoundError)
        })

        it('should reject an invalid people count', async () => {
            const table = await service.create(validInput)
            await expect(service.occupy('r1', table.id, 0)).rejects.toThrow(InvalidPeopleCountError)
        })
    })
})
