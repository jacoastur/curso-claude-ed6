import { randomUUID } from 'crypto'
import type { Order, OrderItem } from '@models/order.model.js'
import { normalizeOrderStatus } from '@models/order.model.js'
import type { OrderRepository } from '@repositories/order.repository.js'
import type { TableRepository } from '@repositories/table.repository.js'
import { KeyedLock, restaurantLock } from '@services/restaurant-lock.js'
import {
    RestaurantIdRequiredError,
    OrderNotFoundError,
    TableIdRequiredError,
    TableNotFoundError,
    TableNotAvailableError,
    TableNotOwnedError,
    OrderItemsRequiredError,
    InvalidOrderItemError,
    InvalidOrderDishError
} from '@errors/DomainErrors.js'

// Los campos vienen directamente del cuerpo JSON y se validan en `create`.
export interface CreateOrderRequest {
    restaurantId: unknown
    tableId: unknown
    clientId: string | null
    items: unknown
}

interface ValidItem {
    dishId: string
    quantity: number
    notes: string | null
}

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim() !== ''

export class OrderService {
    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly tableRepository: TableRepository,
        private readonly lock: KeyedLock = restaurantLock
    ) {}

    async create(request: CreateOrderRequest): Promise<Order> {
        const restaurantId = request.restaurantId
        if (!isNonEmptyString(restaurantId)) {
            throw new RestaurantIdRequiredError()
        }
        const requestedItems = this.validateItems(request.items)

        // Todo pedido va asociado a una mesa del restaurante ocupada por quien pide.
        const tableId = request.tableId
        if (!isNonEmptyString(tableId)) {
            throw new TableIdRequiredError()
        }

        // Con el lock del restaurante la mesa no puede liberarse entre la comprobación y el guardado.
        return this.lock.run(restaurantId, async () => {
            const table = await this.tableRepository.findById(tableId)
            if (!table || table.restaurantId !== restaurantId) {
                throw new TableNotFoundError()
            }
            if (table.status !== 'ocupada') {
                throw new TableNotAvailableError()
            }
            if (!request.clientId || table.occupiedBy !== request.clientId) {
                throw new TableNotOwnedError()
            }

            const dishIds = [...new Set(requestedItems.map(item => item.dishId))]
            const existingDishIds = await this.orderRepository.findDishIdsInRestaurant(restaurantId, dishIds)
            if (existingDishIds.length !== dishIds.length) {
                throw new InvalidOrderDishError()
            }

            const items: OrderItem[] = []
            for (const item of requestedItems) {
                for (let i = 0; i < item.quantity; i++) {
                    items.push({
                        id: randomUUID(),
                        dishId: item.dishId,
                        quantity: 1,
                        notes: item.notes,
                        status: 'pendiente'
                    })
                }
            }

            const order: Order = {
                id: randomUUID(),
                restaurantId,
                tableId: table.id,
                tableNumber: table.number,
                clientId: request.clientId,
                createdAt: new Date(),
                items
            }

            await this.orderRepository.create(order)

            return order
        })
    }

    async listActive(restaurantId: string): Promise<Order[]> {
        return this.orderRepository.findActiveByRestaurant(restaurantId)
    }

    async getById(orderId: string): Promise<Order> {
        const order = await this.orderRepository.findById(orderId)
        if (!order) {
            throw new OrderNotFoundError()
        }
        return order
    }

    async getByClientId(clientId: string): Promise<Order[]> {
        return this.orderRepository.findByClientId(clientId)
    }

    async updateItemStatus(orderId: string, itemId: string, status: string): Promise<void> {
        const order = await this.orderRepository.findById(orderId)
        // Los pedidos archivados ya no se pueden modificar.
        if (!order || order.archived) {
            throw new OrderNotFoundError()
        }

        const item = order.items.find(i => i.id === itemId)
        if (!item) {
            throw new OrderNotFoundError() // Or ItemNotFoundError
        }

        const normalizedStatus = normalizeOrderStatus(status)
        item.status = normalizedStatus

        await this.orderRepository.updateItemStatus(orderId, itemId, normalizedStatus)
    }

    private validateItems(items: unknown): ValidItem[] {
        if (!Array.isArray(items) || items.length === 0) {
            throw new OrderItemsRequiredError()
        }
        return items.map((item: unknown) => {
            const { dishId, quantity, notes } = (item ?? {}) as Record<string, unknown>
            const validNotes = notes === undefined ? null : notes
            if (!isNonEmptyString(dishId)
                || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1
                || (validNotes !== null && typeof validNotes !== 'string')) {
                throw new InvalidOrderItemError()
            }
            return { dishId, quantity, notes: validNotes }
        })
    }
}
