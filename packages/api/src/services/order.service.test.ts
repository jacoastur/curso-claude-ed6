import { describe, it, expect, beforeEach } from 'vitest'
import { OrderService } from './order.service.js'
import { MockOrderRepository } from '@repositories/mocks/MockOrderRepository.js'
import { MockTableRepository } from '@repositories/mocks/MockTableRepository.js'
import type { Order } from '@models/order.model.js'
import type { RestaurantTable, TableStatusType } from '@models/table.model.js'
import {
    OrderNotFoundError,
    InvalidOrderStatusError,
    TableIdRequiredError,
    TableNotFoundError,
    TableNotAvailableError
} from '@errors/DomainErrors.js'

const buildTable = (id: string, restaurantId: string, status: TableStatusType): RestaurantTable => ({
    id,
    restaurantId,
    number: 7,
    description: null,
    capacity: 4,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
})

describe('OrderService.updateItemStatus', () => {
    let repo: MockOrderRepository
    let service: OrderService
    let testOrder: Order

    beforeEach(async () => {
        repo = new MockOrderRepository()
        service = new OrderService(repo, new MockTableRepository())

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

    it('should throw DomainError if status is invalid', async () => {
        await expect(service.updateItemStatus('order-1', 'item-1', 'invalid-status'))
            .rejects.toThrow(InvalidOrderStatusError)
    })
})

describe('OrderService.create', () => {
    let repo: MockOrderRepository
    let tables: MockTableRepository
    let service: OrderService

    const request = (tableId: string | null) => ({
        restaurantId: 'rest-1',
        tableId,
        clientId: 'client-1',
        items: [{ dishId: 'dish-1', quantity: 2, notes: null }]
    })

    beforeEach(async () => {
        repo = new MockOrderRepository()
        tables = new MockTableRepository()
        service = new OrderService(repo, tables)

        await tables.save(buildTable('t-ocupada', 'rest-1', 'ocupada'))
        await tables.save(buildTable('t-libre', 'rest-1', 'libre'))
        await tables.save(buildTable('t-reservada', 'rest-1', 'reservada'))
        await tables.save(buildTable('t-otro', 'rest-2', 'ocupada'))
    })

    it('should create an order for an occupied table and return its number', async () => {
        const order = await service.create(request('t-ocupada'))
        expect(order).toMatchObject({ tableId: 't-ocupada', tableNumber: 7 })
        expect(order.items).toHaveLength(2)
        expect(repo.orders).toHaveLength(1)
    })

    it('should allow several orders for the same occupied table', async () => {
        await service.create(request('t-ocupada'))
        await service.create(request('t-ocupada'))
        expect(repo.orders).toHaveLength(2)
    })

    it.each([null, '', '  '])('should require a table id (%s)', async (tableId) => {
        await expect(service.create(request(tableId))).rejects.toThrow(TableIdRequiredError)
    })

    it('should throw TableNotFoundError for an unknown table', async () => {
        await expect(service.create(request('nope'))).rejects.toThrow(TableNotFoundError)
    })

    it('should throw TableNotFoundError for a table of another restaurant', async () => {
        await expect(service.create(request('t-otro'))).rejects.toThrow(TableNotFoundError)
    })

    it.each(['t-libre', 't-reservada'])('should throw TableNotAvailableError for a table that is not occupied (%s)', async (tableId) => {
        await expect(service.create(request(tableId))).rejects.toThrow(TableNotAvailableError)
        expect(repo.orders).toHaveLength(0)
    })
})
