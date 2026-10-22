import type { OrderRepository } from '@repositories/order.repository.js'
import type { Order } from '@models/order.model.js'

export class MockOrderRepository implements OrderRepository {
    orders: Order[] = []
    /** Platos que existen, por id → restaurantId. */
    private dishes: Map<string, string> = new Map()

    addDish(restaurantId: string, dishId: string): void {
        this.dishes.set(dishId, restaurantId)
    }

    async create(order: Order): Promise<void> {
        this.orders.push(order)
    }

    async findById(id: string): Promise<Order | null> {
        return this.orders.find(o => o.id === id) || null
    }

    async updateItemStatus(_orderId: string, _itemId: string, _status: string): Promise<void> {
        // En un repositorio real esto es un UPDATE SQL. El mock no necesita
        // persistir nada porque el service ya muta el item en memoria
        // antes de llamar a este método.
    }

    async findActiveByRestaurant(restaurantId: string): Promise<Order[]> {
        return this.orders.filter(o => o.restaurantId === restaurantId)
    }

    async findByClientId(clientId: string): Promise<Order[]> {
        return this.orders.filter(o => o.clientId === clientId)
    }

    async findDishIdsInRestaurant(restaurantId: string, dishIds: string[]): Promise<string[]> {
        return dishIds.filter(id => this.dishes.get(id) === restaurantId)
    }
}
