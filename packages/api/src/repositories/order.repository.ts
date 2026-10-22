import { Database } from '@config/database.js'
import type { Order, OrderItem } from '@models/order.model.js'
import { normalizeOrderStatus } from '@models/order.model.js'

interface OrderRow {
    id: string
    restaurant_id: string
    table_id: string | null
    client_id: string | null
    created_at: string
    table_number: number | null
}

interface OrderRowWithRestaurant extends OrderRow {
    restaurant_name: string
    restaurant_logo_url: string | null
    archived: number
}

interface OrderItemRow {
    id: string
    order_id: string
    dish_id: string
    quantity: number
    notes: string | null
    status: string
}

interface OrderItemWithDishRow extends OrderItemRow {
    dish_name: string
    dish_price: number
    dish_category: string
}

// Pedidos vigentes (`orders`) y archivados al liberar o borrar su mesa (`orders_history`).
const SOURCES = {
    current: { orders: 'orders', items: 'order_items', archived: 0 },
    history: { orders: 'orders_history', items: 'order_items_history', archived: 1 }
} as const

type Source = typeof SOURCES[keyof typeof SOURCES]

// Mesa del pedido: solo si el table_id es el id de una mesa del mismo restaurante
// (los pedidos antiguos guardan un texto libre y no casan).
const JOIN_TABLE = 'LEFT JOIN restaurant_tables t ON o.table_id = t.id AND t.restaurant_id = o.restaurant_id'

const selectWithRestaurant = (source: Source, where: string) => `
    SELECT o.*, r.name as restaurant_name, r.logo_url as restaurant_logo_url, t.number as table_number,
           ${source.archived} as archived
    FROM ${source.orders} o
    LEFT JOIN restaurants r ON o.restaurant_id = r.id
    ${JOIN_TABLE}
    WHERE ${where}`

const tableNumberOf = (row: OrderRow): { tableNumber?: number } =>
    row.table_number === null || row.table_number === undefined ? {} : { tableNumber: row.table_number }

export interface OrderRepository {
    /** Guarda el pedido y sus ítems en una transacción. */
    create(order: Order): Promise<void>
    /** Busca entre los pedidos vigentes y, si no está, entre los archivados. */
    findById(id: string): Promise<Order | null>
    updateItemStatus(orderId: string, itemId: string, status: string): Promise<void>
    findActiveByRestaurant(restaurantId: string): Promise<Order[]>
    /** Pedidos vigentes y archivados del cliente, del más reciente al más antiguo. */
    findByClientId(clientId: string): Promise<Order[]>
    /** De los platos indicados, los que existen en el restaurante. */
    findDishIdsInRestaurant(restaurantId: string, dishIds: string[]): Promise<string[]>
}

export class SqliteOrderRepository implements OrderRepository {
    constructor(private readonly db: Database) {}

    async create(order: Order): Promise<void> {
        await this.db.transaction(async () => {
            await this.db.run(
                'INSERT INTO orders (id, restaurant_id, table_id, client_id, created_at) VALUES (?, ?, ?, ?, ?)',
                [order.id, order.restaurantId, order.tableId, order.clientId, order.createdAt.toISOString()]
            )

            for (const item of order.items) {
                await this.db.run(
                    'INSERT INTO order_items (id, order_id, dish_id, quantity, notes, status) VALUES (?, ?, ?, ?, ?, ?)',
                    [item.id, order.id, item.dishId, item.quantity, item.notes, item.status]
                )
            }
        })
    }

    async findById(id: string): Promise<Order | null> {
        for (const source of [SOURCES.current, SOURCES.history]) {
            const row = await this.db.get<OrderRowWithRestaurant>(selectWithRestaurant(source, 'o.id = ?'), [id])
            if (row) {
                return this.mapWithRestaurant(row, await this.getOrderItems(source, row.id))
            }
        }
        return null
    }

    async updateItemStatus(orderId: string, itemId: string, status: string): Promise<void> {
        await this.db.run(
            'UPDATE order_items SET status = ? WHERE id = ? AND order_id = ?',
            [status, itemId, orderId]
        )
    }

    async findActiveByRestaurant(restaurantId: string): Promise<Order[]> {
        const query = `
            SELECT DISTINCT o.*, t.number as table_number
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            ${JOIN_TABLE}
            WHERE o.restaurant_id = ? AND oi.status != 'entregado'
            ORDER BY o.created_at ASC
        `
        const orderRows = await this.db.all<OrderRow>(query, [restaurantId])

        const orders: Order[] = []
        for (const row of orderRows) {
            const items = await this.getOrderItems(SOURCES.current, row.id)
            orders.push({
                id: row.id,
                restaurantId: row.restaurant_id,
                tableId: row.table_id,
                ...tableNumberOf(row),
                clientId: row.client_id,
                createdAt: new Date(row.created_at),
                items
            })
        }

        return orders
    }

    async findByClientId(clientId: string): Promise<Order[]> {
        const orders: Order[] = []
        for (const source of [SOURCES.current, SOURCES.history]) {
            const rows = await this.db.all<OrderRowWithRestaurant>(selectWithRestaurant(source, 'o.client_id = ?'), [clientId])
            for (const row of rows) {
                orders.push(this.mapWithRestaurant(row, await this.getOrderItems(source, row.id)))
            }
        }

        return orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    }

    async findDishIdsInRestaurant(restaurantId: string, dishIds: string[]): Promise<string[]> {
        if (dishIds.length === 0) return []
        const placeholders = dishIds.map(() => '?').join(', ')
        const rows = await this.db.all<{ id: string }>(
            `SELECT id FROM dishes WHERE restaurant_id = ? AND id IN (${placeholders})`,
            [restaurantId, ...dishIds]
        )
        return rows.map(row => row.id)
    }

    private mapWithRestaurant(row: OrderRowWithRestaurant, items: OrderItem[]): Order {
        return {
            id: row.id,
            restaurantId: row.restaurant_id,
            tableId: row.table_id,
            ...tableNumberOf(row),
            clientId: row.client_id,
            createdAt: new Date(row.created_at),
            items,
            restaurantName: row.restaurant_name,
            restaurantLogoUrl: row.restaurant_logo_url,
            ...(row.archived ? { archived: true } : {})
        }
    }

    private async getOrderItems(source: Source, orderId: string): Promise<OrderItem[]> {
        const itemRows = await this.db.all<OrderItemWithDishRow>(`
            SELECT oi.*, d.name as dish_name, d.price as dish_price, d.category as dish_category
            FROM ${source.items} oi
            LEFT JOIN dishes d ON oi.dish_id = d.id
            WHERE oi.order_id = ?
        `, [orderId])

        return itemRows.map(row => ({
            id: row.id,
            dishId: row.dish_id,
            quantity: row.quantity,
            notes: row.notes,
            status: normalizeOrderStatus(row.status),
            dishName: row.dish_name,
            dishPrice: row.dish_price,
            dishCategory: row.dish_category
        }))
    }
}
