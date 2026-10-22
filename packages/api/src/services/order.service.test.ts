import { describe, it, expect, beforeEach } from 'vitest'
import { OrderService } from './order.service.js'
import { KeyedLock } from './restaurant-lock.js'
import { MockOrderRepository } from '@repositories/mocks/MockOrderRepository.js'
import { MockTableRepository } from '@repositories/mocks/MockTableRepository.js'
import type { Order } from '@models/order.model.js'
import type { RestaurantTable, TableStatusType } from '@models/table.model.js'
import {
    OrderNotFoundError,
    InvalidOrderStatusError,
    TableIdRequiredError,
    TableNotFoundError,
    TableNotAvailableError,
    TableNotOwnedError,
    RestaurantIdRequiredError,
    OrderItemsRequiredError,
    InvalidOrderItemError,
    InvalidOrderDishError
} from '@errors/DomainErrors.js'

const buildTable = (id: string, restaurantId: string, status: TableStatusType, occupiedBy: string | null = null): RestaurantTable => ({
    id,
    restaurantId,
    number: 7,
    description: null,
    capacity: 4,
    status,
    occupiedBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
})

describe('OrderService.updateItemStatus', () => {
    let repo: MockOrderRepository
    let service: OrderService
    let testOrder: Order

    beforeEach(async () => {
        repo = new MockOrderRepository()
        service = new OrderService(repo, new MockTableRepository(), new KeyedLock())

        testOrder = {
            id: 'order-1',
            restaurantId: 'rest-1',
            tableId: null,
            clientId: null,
            createdAt: new Date(),
            items: [
                { id: 'item-1', dishId: 'dish-1', quantity: 1, notes: null, status: 'pendiente' }
            ]
        }
        await repo.create(testOrder)
    })

    it('should update the status of an item successfully', async () => {
        await service.updateItemStatus('order-1', 'item-1', 'preparando')
        const updatedItem = testOrder.items[0]!
        expect(updatedItem.status).toBe('preparando')
    })

    it('should throw an error if the order does not exist', async () => {
        await expect(service.updateItemStatus('order-bad', 'item-1', 'preparando'))
            .rejects.toThrow(OrderNotFoundError)
    })

    it('should throw an error if the item does not exist inside the order', async () => {
        await expect(service.updateItemStatus('order-1', 'item-bad', 'preparando'))
            .rejects.toThrow(OrderNotFoundError)
    })

    it('should reject changing an item of an archived order', async () => {
        await repo.create({ ...testOrder, id: 'order-archived', archived: true })
        await expect(service.updateItemStatus('order-archived', 'item-1', 'listo'))
            .rejects.toThrow(OrderNotFoundError)
    })

    it('should throw DomainError if status is invalid', async () => {
        await expect(service.updateItemStatus('order-1', 'item-1', 'invalid-status'))
            .rejects.toThrow(InvalidOrderStatusError)
    })
})

describe('OrderService.create', () => {
    let repo: MockOrderRepository
    let tables: MockTableRepository
    let service: OrderService

    const request = (overrides: Record<string, unknown> = {}) => ({
        restaurantId: 'rest-1',
        tableId: 't-mia',
        clientId: 'client-1',
        items: [{ dishId: 'dish-1', quantity: 2, notes: null }],
        ...overrides
    })

    beforeEach(async () => {
        repo = new MockOrderRepository()
        tables = new MockTableRepository()
        service = new OrderService(repo, tables, new KeyedLock())

        repo.addDish('rest-1', 'dish-1')
        repo.addDish('rest-1', 'dish-2')
        repo.addDish('rest-2', 'dish-otro')
        await tables.save(buildTable('t-mia', 'rest-1', 'ocupada', 'client-1'))
        await tables.save(buildTable('t-ajena', 'rest-1', 'ocupada', 'client-2'))
        await tables.save(buildTable('t-sin-duenio', 'rest-1', 'ocupada'))
        await tables.save(buildTable('t-libre', 'rest-1', 'libre'))
        await tables.save(buildTable('t-reservada', 'rest-1', 'reservada'))
        await tables.save(buildTable('t-otro', 'rest-2', 'ocupada', 'client-1'))
    })

    it('should create an order for the table occupied by the client and return its number', async () => {
        const order = await service.create(request({ items: [{ dishId: 'dish-1', quantity: 2, notes: null }, { dishId: 'dish-2', quantity: 1 }] }))
        expect(order).toMatchObject({ tableId: 't-mia', tableNumber: 7, clientId: 'client-1' })
        expect(order.items).toHaveLength(3)
        expect(order.items.every(i => i.quantity === 1 && i.status === 'pendiente')).toBe(true)
        expect(order.items[2]?.notes).toBeNull()
        expect(repo.orders).toHaveLength(1)
    })

    it('should allow several orders for the same occupied table', async () => {
        await service.create(request())
        await service.create(request())
        expect(repo.orders).toHaveLength(2)
    })

    it.each([undefined, '', 5])('should require the restaurant id (%s)', async (restaurantId) => {
        await expect(service.create(request({ restaurantId }))).rejects.toThrow(RestaurantIdRequiredError)
    })

    it.each([undefined, null, [], 'x'])('should require at least one item (%s)', async (items) => {
        await expect(service.create(request({ items }))).rejects.toThrow(OrderItemsRequiredError)
    })

    it.each([
        [{ quantity: 1 }],
        [{ dishId: '', quantity: 1 }],
        [{ dishId: 'dish-1', quantity: 0 }],
        [{ dishId: 'dish-1', quantity: 1.5 }],
        [{ dishId: 'dish-1', quantity: '2' }],
        [{ dishId: 'dish-1', quantity: 1, notes: 3 }],
        [null]
    ])('should reject an invalid item %j', async (item) => {
        await expect(service.create(request({ items: [item] }))).rejects.toThrow(InvalidOrderItemError)
    })

    it('should validate the items before the table', async () => {
        await expect(service.create(request({ tableId: null, items: [] }))).rejects.toThrow(OrderItemsRequiredError)
    })

    it.each([null, '', '  '])('should require a table id (%s)', async (tableId) => {
        await expect(service.create(request({ tableId }))).rejects.toThrow(TableIdRequiredError)
    })

    it('should throw TableNotFoundError for an unknown table', async () => {
        await expect(service.create(request({ tableId: 'nope' }))).rejects.toThrow(TableNotFoundError)
    })

    it('should throw TableNotFoundError for a table of another restaurant', async () => {
        await expect(service.create(request({ tableId: 't-otro' }))).rejects.toThrow(TableNotFoundError)
    })

    it.each(['t-libre', 't-reservada'])('should throw TableNotAvailableError for a table that is not occupied (%s)', async (tableId) => {
        await expect(service.create(request({ tableId }))).rejects.toThrow(TableNotAvailableError)
        expect(repo.orders).toHaveLength(0)
    })

    it.each(['t-ajena', 't-sin-duenio'])('should throw TableNotOwnedError if the client did not occupy the table (%s)', async (tableId) => {
        await expect(service.create(request({ tableId }))).rejects.toThrow(TableNotOwnedError)
        expect(repo.orders).toHaveLength(0)
    })

    it('should throw TableNotOwnedError for an employee without client id', async () => {
        await expect(service.create(request({ clientId: null }))).rejects.toThrow(TableNotOwnedError)
    })

    it.each(['dish-nope', 'dish-otro'])('should throw InvalidOrderDishError for a dish that is not in the restaurant (%s)', async (dishId) => {
        await expect(service.create(request({ items: [{ dishId: 'dish-1', quantity: 1 }, { dishId, quantity: 1 }] })))
            .rejects.toThrow(InvalidOrderDishError)
        expect(repo.orders).toHaveLength(0)
    })
})
