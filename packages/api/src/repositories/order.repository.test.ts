import { SqliteOrderRepository } from './order.repository.js'
import { SqliteTableRepository } from './table.repository.js'
import { Database } from '@config/database.js'
import type { Order } from '@models/order.model.js'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const now = () => new Date().toISOString()

const buildOrder = (id: string, overrides: Partial<Order> = {}): Order => ({
    id,
    restaurantId: 'r1',
    tableId: 't1',
    clientId: 'c1',
    createdAt: new Date(),
    items: [{ id: `${id}-i1`, dishId: 'd1', quantity: 1, notes: null, status: 'pendiente' }],
    ...overrides
})

describe('SqliteOrderRepository (Integration)', () => {
    let db: Database
    let repo: SqliteOrderRepository
    let tables: SqliteTableRepository

    const count = async (table: string) =>
        (await db.get<{ n: number }>(`SELECT COUNT(*) as n FROM ${table}`))?.n

    beforeEach(async () => {
        process.env.NODE_ENV = 'test'
        db = new Database()
        await db.initialize()
        repo = new SqliteOrderRepository(db)
        tables = new SqliteTableRepository(db)

        for (const id of ['r1', 'r2']) {
            await db.run(
                'INSERT INTO restaurants (id, name, address, email, phone, owner_first_name, owner_last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [id, `Restaurante ${id}`, 'Calle Mayor 10', `${id}@resttek.com`, '+34 612345678', 'Carlos', 'García', now(), now()]
            )
        }
        for (const [id, restaurantId] of [['d1', 'r1'], ['d2', 'r1'], ['d3', 'r2']]) {
            await db.run(
                'INSERT INTO dishes (id, name, description, price, category, available, restaurant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [id, `Plato ${id}`, null, 10, 'principal', 1, restaurantId, now(), now()]
            )
        }
        await tables.save({
            id: 't1', restaurantId: 'r1', number: 7, description: null, capacity: 4,
            status: 'ocupada', occupiedBy: 'c1', createdAt: now(), updatedAt: now()
        })
    })

    afterEach(async () => {
        await db.close()
    })

    it('should save an order with its items and return its table number', async () => {
        await repo.create(buildOrder('o1'))
        const found = await repo.findById('o1')
        expect(found).toMatchObject({ id: 'o1', tableId: 't1', tableNumber: 7, restaurantName: 'Restaurante r1' })
        expect(found?.items).toHaveLength(1)
        expect(found).not.toHaveProperty('archived')
    })

    it('should not leave a half-saved order if an item fails', async () => {
        const order = buildOrder('o1', {
            items: [
                { id: 'i1', dishId: 'd1', quantity: 1, notes: null, status: 'pendiente' },
                { id: 'i2', dishId: 'no-existe', quantity: 1, notes: null, status: 'pendiente' }
            ]
        })
        await expect(repo.create(order)).rejects.toThrow('SQLITE_CONSTRAINT')
        expect(await count('orders')).toBe(0)
        expect(await count('order_items')).toBe(0)
    })

    it('should return the dishes that exist in the restaurant', async () => {
        const ids = await repo.findDishIdsInRestaurant('r1', ['d1', 'd2', 'd3', 'nope'])
        expect(ids.sort()).toEqual(['d1', 'd2'])
        expect(await repo.findDishIdsInRestaurant('r1', [])).toEqual([])
    })

    describe('archived orders', () => {
        beforeEach(async () => {
            await repo.create(buildOrder('o-old', { createdAt: new Date('2026-10-01T10:00:00.000Z'), items: [{ id: 'old-i1', dishId: 'd1', quantity: 1, notes: null, status: 'entregado' }] }))
            // Liberar la mesa archiva sus pedidos.
            await tables.save({
                id: 't1', restaurantId: 'r1', number: 7, description: null, capacity: 4,
                status: 'libre', occupiedBy: null, createdAt: now(), updatedAt: now()
            }, { archiveOrders: true })
            await repo.create(buildOrder('o-new', { createdAt: new Date('2026-10-22T10:00:00.000Z') }))
        })

        it('should find an archived order by id, marked as archived and with its items', async () => {
            const found = await repo.findById('o-old')
            expect(found).toMatchObject({ id: 'o-old', archived: true, tableNumber: 7 })
            expect(found?.items.map(i => i.status)).toEqual(['entregado'])
        })

        it('should list current and archived orders of the client, newest first', async () => {
            const orders = await repo.findByClientId('c1')
            expect(orders.map(o => [o.id, o.archived ?? false])).toEqual([['o-new', false], ['o-old', true]])
        })

        it('should not include archived orders among the active ones', async () => {
            await db.run("UPDATE order_items_history SET status = 'pendiente'")
            const active = await repo.findActiveByRestaurant('r1')
            expect(active.map(o => o.id)).toEqual(['o-new'])
        })
    })
})
