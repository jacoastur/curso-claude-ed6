import { describe, it, expect, beforeEach } from 'vitest'
import { TableService } from './table.service.js'
import { KeyedLock } from './restaurant-lock.js'
import { normalizeTableStatus } from '@models/table.model.js'
import { MockTableRepository } from '@repositories/mocks/MockTableRepository.js'
import {
    ClientAlreadyHasTableError,
    DuplicatedTableNumberError,
    InvalidPeopleCountError,
    InvalidTableCapacityError,
    InvalidTableNumberError,
    InvalidTableStatusError,
    TableHasActiveOrdersError,
    TableHasOrdersError,
    TableNotAvailableError,
    TableNotFoundError,
    TableNotOwnedError,
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

    /** Mesa ocupada por `clientId` mediante occupy. */
    const occupiedTable = async (clientId = 'c1', number = 1) => {
        const table = await service.create({ ...validInput, number })
        return service.occupy('r1', table.id, 2, clientId)
    }

    beforeEach(() => {
        repo = new MockTableRepository()
        service = new TableService(repo, new KeyedLock())
    })

    describe('create', () => {
        it('should create a free table without occupant by default', async () => {
            const table = await service.create(validInput)
            expect(table).toMatchObject({ restaurantId: 'r1', number: 1, description: 'Ventana', capacity: 4, status: 'libre', occupiedBy: null })
            expect(await repo.findById(table.id)).not.toBeNull()
        })

        it('should create an occupied table without occupant', async () => {
            const table = await service.create({ ...validInput, status: 'ocupada' })
            expect(table.occupiedBy).toBeNull()
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

        it('should serialize concurrent creations with the same number', async () => {
            const results = await Promise.allSettled([service.create(validInput), service.create(validInput)])
            expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
            const rejected = results.find(r => r.status === 'rejected')
            expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(DuplicatedTableNumberError)
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

        it('should keep the occupant and the orders while it stays occupied', async () => {
            const table = await occupiedTable()
            const updated = await service.update('r1', table.id, { number: 1, capacity: 8, status: 'ocupada' })
            expect(updated.occupiedBy).toBe('c1')
            expect(repo.archivedTables).toEqual([])
        })

        it.each(['libre', 'reservada'])('should reject leaving ocupada to %s with active orders, changing nothing', async (status) => {
            const table = await occupiedTable()
            repo.setOrderStats(table.id, { orders: 1, activeOrders: 1 })
            await expect(service.update('r1', table.id, { number: 9, capacity: 8, status }))
                .rejects.toThrow(TableHasActiveOrdersError)
            expect(await repo.findById(table.id)).toMatchObject({ number: 1, status: 'ocupada', occupiedBy: 'c1' })
        })

        it('should archive the orders and clear the occupant when leaving ocupada', async () => {
            const table = await occupiedTable()
            repo.setOrderStats(table.id, { orders: 2, activeOrders: 0 })
            const updated = await service.update('r1', table.id, { number: 1, capacity: 4, status: 'reservada' })
            expect(updated).toMatchObject({ status: 'reservada', occupiedBy: null })
            expect(repo.archivedTables).toEqual([table.id])
        })
    })

    describe('changeStatus', () => {
        it('should change the status', async () => {
            const table = await service.create(validInput)
            const updated = await service.changeStatus('r1', table.id, 'reservada')
            expect(updated.status).toBe('reservada')
            expect((await repo.findById(table.id))?.status).toBe('reservada')
            expect(repo.archivedTables).toEqual([])
        })

        it('should reject an invalid status', async () => {
            const table = await service.create(validInput)
            await expect(service.changeStatus('r1', table.id, 'rota')).rejects.toThrow(InvalidTableStatusError)
        })

        it.each(['libre', 'reservada'])('should reject leaving ocupada to %s with active orders', async (status) => {
            const table = await occupiedTable()
            repo.setOrderStats(table.id, { orders: 1, activeOrders: 1 })
            await expect(service.changeStatus('r1', table.id, status)).rejects.toThrow(TableHasActiveOrdersError)
            expect((await repo.findById(table.id))?.status).toBe('ocupada')
            expect(repo.archivedTables).toEqual([])
        })

        it('should free a table whose orders are all delivered, archiving them and clearing the occupant', async () => {
            const table = await occupiedTable()
            repo.setOrderStats(table.id, { orders: 3, activeOrders: 0 })
            const updated = await service.changeStatus('r1', table.id, 'libre')
            expect(updated).toMatchObject({ status: 'libre', occupiedBy: null })
            expect(repo.archivedTables).toEqual([table.id])
            expect(await repo.getOrderStats(table.id)).toEqual({ orders: 0, activeOrders: 0 })
        })

        it('should leave a manually occupied table without occupant', async () => {
            const table = await service.create(validInput)
            const updated = await service.changeStatus('r1', table.id, 'ocupada')
            expect(updated).toMatchObject({ status: 'ocupada', occupiedBy: null })
        })

        it('should do nothing when setting the same status', async () => {
            const table = await occupiedTable()
            const updated = await service.changeStatus('r1', table.id, 'ocupada')
            expect(updated.occupiedBy).toBe('c1')
            expect(repo.archivedTables).toEqual([])
        })
    })

    describe('delete', () => {
        it('should delete a free table archiving its remaining orders', async () => {
            const table = await service.create(validInput)
            await service.delete('r1', table.id)
            expect(await repo.findById(table.id)).toBeNull()
            expect(repo.archivedTables).toEqual([table.id])
        })

        it('should reject deleting an occupied table', async () => {
            const table = await service.create({ ...validInput, status: 'ocupada' })
            await expect(service.delete('r1', table.id)).rejects.toThrow(TableOccupiedError)
        })

        it('should reject deleting a table with active orders', async () => {
            const table = await service.create({ ...validInput, status: 'reservada' })
            repo.setOrderStats(table.id, { orders: 1, activeOrders: 1 })
            await expect(service.delete('r1', table.id)).rejects.toThrow(TableHasActiveOrdersError)
            expect(await repo.findById(table.id)).not.toBeNull()
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

    describe('occupy', () => {
        it('should occupy a free table for the client', async () => {
            const table = await service.create(validInput)
            const occupied = await service.occupy('r1', table.id, 3, 'c1')
            expect(occupied).toMatchObject({ status: 'ocupada', occupiedBy: 'c1' })
        })

        it('should reject occupying a table twice', async () => {
            const table = await occupiedTable('c1')
            await expect(service.occupy('r1', table.id, 2, 'c2')).rejects.toThrow(TableNotAvailableError)
        })

        it('should reject a client occupying the same table again with TableNotAvailableError', async () => {
            const table = await occupiedTable('c1')
            await expect(service.occupy('r1', table.id, 2, 'c1')).rejects.toThrow(TableNotAvailableError)
        })

        it('should reject a second table for the same client in the restaurant', async () => {
            await occupiedTable('c1', 1)
            const other = await service.create({ ...validInput, number: 2 })
            await expect(service.occupy('r1', other.id, 2, 'c1')).rejects.toThrow(ClientAlreadyHasTableError)
        })

        it('should allow the client to occupy a table in another restaurant', async () => {
            await occupiedTable('c1', 1)
            const other = await service.create({ ...validInput, restaurantId: 'r2' })
            await expect(service.occupy('r2', other.id, 2, 'c1')).resolves.toMatchObject({ occupiedBy: 'c1' })
        })

        it('should give 404 before ClientAlreadyHasTableError', async () => {
            await occupiedTable('c1', 1)
            await expect(service.occupy('r1', 'nope', 2, 'c1')).rejects.toThrow(TableNotFoundError)
        })

        it('should reject a table with insufficient capacity', async () => {
            const table = await service.create(validInput)
            await expect(service.occupy('r1', table.id, 5, 'c1')).rejects.toThrow(TableNotAvailableError)
        })

        it('should reject a reserved table', async () => {
            const table = await service.create({ ...validInput, status: 'reservada' })
            await expect(service.occupy('r1', table.id, 2, 'c1')).rejects.toThrow(TableNotAvailableError)
        })

        it('should throw TableNotFoundError for a table of another restaurant', async () => {
            const table = await service.create(validInput)
            await expect(service.occupy('r2', table.id, 2, 'c1')).rejects.toThrow(TableNotFoundError)
        })

        it('should reject an invalid people count', async () => {
            const table = await service.create(validInput)
            await expect(service.occupy('r1', table.id, 0, 'c1')).rejects.toThrow(InvalidPeopleCountError)
        })

        it('should not leave a client with two tables when occupying concurrently', async () => {
            const a = await service.create({ ...validInput, number: 1 })
            const b = await service.create({ ...validInput, number: 2 })
            const results = await Promise.allSettled([service.occupy('r1', a.id, 2, 'c1'), service.occupy('r1', b.id, 2, 'c1')])
            expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        })
    })

    describe('findMine', () => {
        it('should return the table of the client and whether it has orders', async () => {
            const table = await occupiedTable('c1')
            expect(await service.findMine('r1', 'c1')).toMatchObject({ table: { id: table.id }, hasOrders: false })
            repo.setOrderStats(table.id, { orders: 1, activeOrders: 0 })
            expect((await service.findMine('r1', 'c1')).hasOrders).toBe(true)
        })

        it('should throw TableNotFoundError if the client has no table there', async () => {
            await occupiedTable('c1')
            await expect(service.findMine('r1', 'c2')).rejects.toThrow(TableNotFoundError)
            await expect(service.findMine('r2', 'c1')).rejects.toThrow(TableNotFoundError)
        })
    })

    describe('release', () => {
        it('should free the table of the client without orders', async () => {
            const table = await occupiedTable('c1')
            const released = await service.release('r1', table.id, 'c1')
            expect(released).toMatchObject({ status: 'libre', occupiedBy: null })
            expect((await repo.findById(table.id))?.status).toBe('libre')
        })

        it('should reject a client that does not occupy the table', async () => {
            const table = await occupiedTable('c1')
            await expect(service.release('r1', table.id, 'c2')).rejects.toThrow(TableNotOwnedError)
        })

        it('should reject releasing a table that is not occupied', async () => {
            const table = await service.create(validInput)
            await expect(service.release('r1', table.id, 'c1')).rejects.toThrow(TableNotOwnedError)
        })

        it('should reject releasing a table with orders, even delivered ones', async () => {
            const table = await occupiedTable('c1')
            repo.setOrderStats(table.id, { orders: 1, activeOrders: 0 })
            await expect(service.release('r1', table.id, 'c1')).rejects.toThrow(TableHasOrdersError)
        })

        it('should give TableHasOrdersError priority over active orders', async () => {
            const table = await occupiedTable('c1')
            repo.setOrderStats(table.id, { orders: 1, activeOrders: 1 })
            await expect(service.release('r1', table.id, 'c1')).rejects.toThrow(TableHasOrdersError)
        })

        it('should throw TableNotFoundError for a table of another restaurant', async () => {
            const table = await occupiedTable('c1')
            await expect(service.release('r2', table.id, 'c1')).rejects.toThrow(TableNotFoundError)
        })
    })
})
