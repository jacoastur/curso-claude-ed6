import { SqliteTableRepository } from './table.repository.js'
import { Database } from '@config/database.js'
import type { RestaurantTable } from '@models/table.model.js'
import { DuplicatedTableNumberError } from '@errors/DomainErrors.js'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const buildTable = (overrides: Partial<RestaurantTable>): RestaurantTable => ({
    id: 't1',
    restaurantId: 'r1',
    number: 1,
    description: null,
    capacity: 4,
    status: 'libre',
    occupiedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
})

const now = () => new Date().toISOString()

describe('SqliteTableRepository (Integration)', () => {
    let db: Database
    let repo: SqliteTableRepository

    const insertOrder = async (id: string, tableId: string, itemStatuses: string[]) => {
        await db.run(
            'INSERT INTO orders (id, restaurant_id, table_id, client_id, created_at) VALUES (?, ?, ?, ?, ?)',
            [id, 'r1', tableId, 'c1', now()]
        )
        for (const [i, status] of itemStatuses.entries()) {
            await db.run(
                'INSERT INTO order_items (id, order_id, dish_id, quantity, notes, status) VALUES (?, ?, ?, ?, ?, ?)',
                [`${id}-item-${i}`, id, 'd1', 1, null, status]
            )
        }
    }

    const count = async (table: string) =>
        (await db.get<{ n: number }>(`SELECT COUNT(*) as n FROM ${table}`))?.n

    beforeEach(async () => {
        process.env.NODE_ENV = 'test'
        db = new Database()
        await db.initialize()
        repo = new SqliteTableRepository(db)

        for (const id of ['r1', 'r2']) {
            await db.run(
                'INSERT INTO restaurants (id, name, address, email, phone, owner_first_name, owner_last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [id, `Restaurante ${id}`, 'Calle Mayor 10', `${id}@resttek.com`, '+34 612345678', 'Carlos', 'García', now(), now()]
            )
        }
        await db.run(
            'INSERT INTO dishes (id, name, description, price, category, available, restaurant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ['d1', 'Pizza', null, 10, 'principal', 1, 'r1', now(), now()]
        )

        await repo.save(buildTable({ id: 't1', number: 1, capacity: 2, description: 'Ventana' }))
        await repo.save(buildTable({ id: 't2', number: 2, capacity: 4 }))
        await repo.save(buildTable({ id: 't3', number: 3, capacity: 6, status: 'ocupada', occupiedBy: 'c1' }))
        await repo.save(buildTable({ id: 't4', number: 4, capacity: 4, status: 'reservada' }))
        await repo.save(buildTable({ id: 't5', number: 5, capacity: 4 }))
    })

    afterEach(async () => {
        await db.close()
    })

    it('should save and find a table by id, including its occupant', async () => {
        expect(await repo.findById('t1')).toMatchObject({ id: 't1', restaurantId: 'r1', number: 1, capacity: 2, description: 'Ventana', status: 'libre', occupiedBy: null })
        expect((await repo.findById('t3'))?.occupiedBy).toBe('c1')
    })

    it('should list the tables of a restaurant ordered by number', async () => {
        const tables = await repo.findByRestaurantId('r1')
        expect(tables.map(t => t.number)).toEqual([1, 2, 3, 4, 5])
    })

    it('should translate a duplicated number to DuplicatedTableNumberError', async () => {
        await expect(repo.save(buildTable({ id: 't-dup', number: 1 }))).rejects.toThrow(DuplicatedTableNumberError)
    })

    it('should allow the same number in another restaurant', async () => {
        await repo.save(buildTable({ id: 'r2-t1', restaurantId: 'r2', number: 1 }))
        expect(await repo.findByNumber('r2', 1)).not.toBeNull()
    })

    it('should find available tables filtering by status and capacity', async () => {
        const tables = await repo.findAvailable('r1', 3)
        expect(tables.map(t => t.id)).toEqual(['t2', 't5'])
    })

    it('should find the table occupied by a client in a restaurant', async () => {
        expect((await repo.findByOccupant('r1', 'c1'))?.id).toBe('t3')
        expect(await repo.findByOccupant('r2', 'c1')).toBeNull()
    })

    it('should update an existing table', async () => {
        await repo.save(buildTable({ id: 't5', number: 15, capacity: 8, description: 'Terraza' }))
        expect(await repo.findById('t5')).toMatchObject({ number: 15, capacity: 8, description: 'Terraza' })
    })

    describe('occupyIfFree', () => {
        it('should occupy a free table only once and return it', async () => {
            const occupied = await repo.occupyIfFree('t2', 'r1', 4, 'c2', now())
            expect(occupied).toMatchObject({ id: 't2', status: 'ocupada', occupiedBy: 'c2' })
            expect(await repo.occupyIfFree('t2', 'r1', 4, 'c9', now())).toBeNull()
        })

        it('should not occupy a table with insufficient capacity or from another restaurant', async () => {
            expect(await repo.occupyIfFree('t1', 'r1', 3, 'c2', now())).toBeNull()
            expect(await repo.occupyIfFree('t1', 'r2', 1, 'c2', now())).toBeNull()
            expect((await repo.findById('t1'))?.status).toBe('libre')
        })

        it('should not let a client occupy a second table in the same restaurant', async () => {
            expect(await repo.occupyIfFree('t2', 'r1', 2, 'c1', now())).toBeNull()
            expect((await repo.findById('t2'))?.status).toBe('libre')
        })
    })

    describe('orders of a table', () => {
        it('should count the orders and the active ones', async () => {
            await insertOrder('o1', 't3', ['entregado', 'pendiente'])
            await insertOrder('o2', 't3', ['entregado'])
            expect(await repo.getOrderStats('t3')).toEqual({ orders: 2, activeOrders: 1 })
            expect(await repo.getOrderStats('t1')).toEqual({ orders: 0, activeOrders: 0 })
        })

        it('should move the orders to the history when saving with archiveOrders', async () => {
            await insertOrder('o1', 't3', ['entregado', 'entregado'])
            await insertOrder('o-other', 't2', ['pendiente'])

            await repo.save(buildTable({ id: 't3', number: 3, capacity: 6, status: 'libre' }), { archiveOrders: true })

            expect((await repo.findById('t3'))?.status).toBe('libre')
            expect(await repo.getOrderStats('t3')).toEqual({ orders: 0, activeOrders: 0 })
            const archived = await db.get<{ table_id: string; archived_at: string }>('SELECT table_id, archived_at FROM orders_history WHERE id = ?', ['o1'])
            expect(archived?.table_id).toBe('t3')
            expect(archived?.archived_at).toBeTruthy()
            expect(await count('order_items_history')).toBe(2)
            expect(await count('orders')).toBe(1)
            expect(await count('order_items')).toBe(1)
        })

        it('should roll back the archive if saving the table fails', async () => {
            await insertOrder('o1', 't3', ['entregado'])
            await expect(repo.save(buildTable({ id: 't3', number: 1, status: 'libre' }), { archiveOrders: true }))
                .rejects.toThrow(DuplicatedTableNumberError)
            expect(await count('orders')).toBe(1)
            expect(await count('orders_history')).toBe(0)
            expect((await repo.findById('t3'))?.status).toBe('ocupada')
        })

        it('should archive the remaining orders when deleting a table', async () => {
            await insertOrder('o1', 't4', ['entregado'])
            await repo.delete('t4')
            expect(await repo.findById('t4')).toBeNull()
            expect(await count('orders')).toBe(0)
            expect(await count('orders_history')).toBe(1)
        })
    })

    it('should add occupied_by to a table created before the column existed', async () => {
        await db.run('ALTER TABLE restaurant_tables DROP COLUMN occupied_by')
        await (db as unknown as { runInitialMigrations(): Promise<void> }).runInitialMigrations()
        const columns = await db.all<{ name: string }>('PRAGMA table_info(restaurant_tables)')
        expect(columns.map(c => c.name)).toContain('occupied_by')
    })
})
