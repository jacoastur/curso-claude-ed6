import { SqliteTableRepository } from './table.repository.js'
import { Database } from '@config/database.js'
import type { RestaurantTable } from '@models/table.model.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const buildTable = (overrides: Partial<RestaurantTable>): RestaurantTable => ({
    id: 't1',
    restaurantId: 'r1',
    number: 1,
    description: null,
    capacity: 4,
    status: 'libre',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
})

describe('SqliteTableRepository (Integration)', () => {
    let db: Database
    let repo: SqliteTableRepository

    beforeAll(async () => {
        process.env.NODE_ENV = 'test'
        db = new Database()
        await db.initialize()
        repo = new SqliteTableRepository(db)

        for (const id of ['r1', 'r2']) {
            await db.run(
                'INSERT INTO restaurants (id, name, address, email, phone, owner_first_name, owner_last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [id, `Restaurante ${id}`, 'Calle Mayor 10', `${id}@resttek.com`, '+34 612345678', 'Carlos', 'García', new Date().toISOString(), new Date().toISOString()]
            )
        }

        await repo.save(buildTable({ id: 't1', number: 1, capacity: 2, description: 'Ventana' }))
        await repo.save(buildTable({ id: 't2', number: 2, capacity: 4 }))
        await repo.save(buildTable({ id: 't3', number: 3, capacity: 6, status: 'ocupada' }))
        await repo.save(buildTable({ id: 't4', number: 4, capacity: 4, status: 'reservada' }))
        await repo.save(buildTable({ id: 't5', number: 5, capacity: 4 }))
    })

    afterAll(async () => {
        await db.close()
    })

    it('should save and find a table by id', async () => {
        const found = await repo.findById('t1')
        expect(found).toMatchObject({ id: 't1', restaurantId: 'r1', number: 1, capacity: 2, description: 'Ventana', status: 'libre' })
    })

    it('should list the tables of a restaurant ordered by number', async () => {
        const tables = await repo.findByRestaurantId('r1')
        expect(tables.map(t => t.number)).toEqual([1, 2, 3, 4, 5])
    })

    it('should reject a duplicated number in the same restaurant', async () => {
        await expect(repo.save(buildTable({ id: 't-dup', number: 1 }))).rejects.toThrow()
    })

    it('should allow the same number in another restaurant', async () => {
        await repo.save(buildTable({ id: 'r2-t1', restaurantId: 'r2', number: 1 }))
        expect(await repo.findByNumber('r2', 1)).not.toBeNull()
    })

    it('should find available tables filtering by status and capacity', async () => {
        const tables = await repo.findAvailable('r1', 3)
        expect(tables.map(t => t.id)).toEqual(['t2', 't5'])
    })

    it('should update an existing table', async () => {
        await repo.save(buildTable({ id: 't5', number: 15, capacity: 8, description: 'Terraza' }))
        const found = await repo.findById('t5')
        expect(found).toMatchObject({ number: 15, capacity: 8, description: 'Terraza' })
    })

    it('should update only the status', async () => {
        await repo.updateStatus('t4', 'libre', new Date().toISOString())
        expect((await repo.findById('t4'))?.status).toBe('libre')
    })

    it('should occupy a free table only once', async () => {
        const now = new Date().toISOString()
        expect(await repo.occupyIfFree('t2', 'r1', 4, now)).toBe(true)
        expect(await repo.occupyIfFree('t2', 'r1', 4, now)).toBe(false)
        expect((await repo.findById('t2'))?.status).toBe('ocupada')
    })

    it('should not occupy a table with insufficient capacity or from another restaurant', async () => {
        const now = new Date().toISOString()
        expect(await repo.occupyIfFree('t1', 'r1', 3, now)).toBe(false)
        expect(await repo.occupyIfFree('t1', 'r2', 1, now)).toBe(false)
        expect((await repo.findById('t1'))?.status).toBe('libre')
    })

    it('should delete a table', async () => {
        await repo.delete('t1')
        expect(await repo.findById('t1')).toBeNull()
    })
})
