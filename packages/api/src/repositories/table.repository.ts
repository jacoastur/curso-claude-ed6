import { Database } from '@config/database.js'
import type { RestaurantTable, TableOrderStats } from '@models/table.model.js'
import { normalizeTableStatus } from '@models/table.model.js'
import { DuplicatedTableNumberError } from '@errors/DomainErrors.js'

interface TableRow {
    id: string
    restaurantId: string
    number: number
    description: string | null
    capacity: number
    status: string
    occupiedBy: string | null
    createdAt: string
    updatedAt: string
}

const TABLE_COLUMNS = 'id, restaurant_id as restaurantId, number, description, capacity, status, occupied_by as occupiedBy, created_at as createdAt, updated_at as updatedAt'
const SELECT_TABLE = `SELECT ${TABLE_COLUMNS} FROM restaurant_tables`

export interface TableRepository {
    findById(id: string): Promise<RestaurantTable | null>
    findByRestaurantId(restaurantId: string): Promise<RestaurantTable[]>
    findAvailable(restaurantId: string, people: number): Promise<RestaurantTable[]>
    findByNumber(restaurantId: string, number: number): Promise<RestaurantTable | null>
    /** Mesa del restaurante que ocupa el cliente (como mucho una). */
    findByOccupant(restaurantId: string, clientId: string): Promise<RestaurantTable | null>
    /** Pedidos de la mesa que siguen en `orders` y cuántos están activos (algún ítem sin entregar). */
    getOrderStats(tableId: string): Promise<TableOrderStats>
    /**
     * Inserta o actualiza la mesa. Con `archiveOrders` mueve antes sus pedidos al histórico,
     * todo en una transacción. Lanza `DuplicatedTableNumberError` si el número ya existe.
     */
    save(table: RestaurantTable, options?: { archiveOrders?: boolean }): Promise<void>
    /**
     * Ocupa la mesa para `clientId` solo si es del restaurante, está libre, cabe `people` y el
     * cliente no ocupa ya otra mesa del restaurante. Devuelve la mesa ocupada o `null`.
     */
    occupyIfFree(id: string, restaurantId: string, people: number, clientId: string, updatedAt: string): Promise<RestaurantTable | null>
    /** Borra la mesa moviendo antes al histórico los pedidos que le queden, en una transacción. */
    delete(id: string): Promise<void>
}

export class SqliteTableRepository implements TableRepository {
    constructor(private db: Database) {}

    async findById(id: string): Promise<RestaurantTable | null> {
        const row = await this.db.get<TableRow>(`${SELECT_TABLE} WHERE id = ?`, [id])
        if (!row) return null
        return this.mapToTable(row)
    }

    async findByRestaurantId(restaurantId: string): Promise<RestaurantTable[]> {
        const rows = await this.db.all<TableRow>(
            `${SELECT_TABLE} WHERE restaurant_id = ? ORDER BY number ASC`,
            [restaurantId]
        )
        return rows.map(row => this.mapToTable(row))
    }

    async findAvailable(restaurantId: string, people: number): Promise<RestaurantTable[]> {
        const rows = await this.db.all<TableRow>(
            `${SELECT_TABLE} WHERE restaurant_id = ? AND status = 'libre' AND capacity >= ? ORDER BY capacity ASC, number ASC`,
            [restaurantId, people]
        )
        return rows.map(row => this.mapToTable(row))
    }

    async findByNumber(restaurantId: string, number: number): Promise<RestaurantTable | null> {
        const row = await this.db.get<TableRow>(
            `${SELECT_TABLE} WHERE restaurant_id = ? AND number = ?`,
            [restaurantId, number]
        )
        if (!row) return null
        return this.mapToTable(row)
    }

    async findByOccupant(restaurantId: string, clientId: string): Promise<RestaurantTable | null> {
        const row = await this.db.get<TableRow>(
            `${SELECT_TABLE} WHERE restaurant_id = ? AND occupied_by = ? ORDER BY updated_at DESC`,
            [restaurantId, clientId]
        )
        if (!row) return null
        return this.mapToTable(row)
    }

    async getOrderStats(tableId: string): Promise<TableOrderStats> {
        const row = await this.db.get<{ orders: number; activeOrders: number | null }>(
            `SELECT COUNT(*) as orders,
                    SUM(CASE WHEN EXISTS (
                        SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.status != 'entregado'
                    ) THEN 1 ELSE 0 END) as activeOrders
             FROM orders o
             WHERE o.table_id = ?`,
            [tableId]
        )
        return { orders: row?.orders ?? 0, activeOrders: row?.activeOrders ?? 0 }
    }

    async save(table: RestaurantTable, options: { archiveOrders?: boolean } = {}): Promise<void> {
        try {
            if (options.archiveOrders) {
                await this.db.transaction(async () => {
                    await this.archiveOrders(table.id)
                    await this.upsert(table)
                })
            } else {
                await this.upsert(table)
            }
        } catch (error) {
            throw this.translateError(error)
        }
    }

    async occupyIfFree(id: string, restaurantId: string, people: number, clientId: string, updatedAt: string): Promise<RestaurantTable | null> {
        const row = await this.db.get<TableRow>(
            `UPDATE restaurant_tables SET status = 'ocupada', occupied_by = ?, updated_at = ?
             WHERE id = ? AND restaurant_id = ? AND status = 'libre' AND capacity >= ?
               AND NOT EXISTS (SELECT 1 FROM restaurant_tables WHERE restaurant_id = ? AND occupied_by = ?)
             RETURNING ${TABLE_COLUMNS}`,
            [clientId, updatedAt, id, restaurantId, people, restaurantId, clientId]
        )
        if (!row) return null
        return this.mapToTable(row)
    }

    async delete(id: string): Promise<void> {
        await this.db.transaction(async () => {
            await this.archiveOrders(id)
            await this.db.run('DELETE FROM restaurant_tables WHERE id = ?', [id])
        })
    }

    private async upsert(table: RestaurantTable): Promise<void> {
        const existing = await this.findById(table.id)
        if (existing) {
            await this.db.run(
                'UPDATE restaurant_tables SET number = ?, description = ?, capacity = ?, status = ?, occupied_by = ?, updated_at = ? WHERE id = ?',
                [table.number, table.description, table.capacity, table.status, table.occupiedBy, table.updatedAt, table.id]
            )
        } else {
            await this.db.run(
                'INSERT INTO restaurant_tables (id, restaurant_id, number, description, capacity, status, occupied_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [table.id, table.restaurantId, table.number, table.description, table.capacity, table.status, table.occupiedBy, table.createdAt, table.updatedAt]
            )
        }
    }

    /** Mueve los pedidos de la mesa (y sus ítems) a las tablas de histórico. Llamar dentro de una transacción. */
    private async archiveOrders(tableId: string): Promise<void> {
        const archivedAt = new Date().toISOString()
        await this.db.run(
            `INSERT INTO orders_history (id, restaurant_id, table_id, client_id, created_at, archived_at)
             SELECT id, restaurant_id, table_id, client_id, created_at, ? FROM orders WHERE table_id = ?`,
            [archivedAt, tableId]
        )
        await this.db.run(
            `INSERT INTO order_items_history (id, order_id, dish_id, quantity, notes, status, archived_at)
             SELECT oi.id, oi.order_id, oi.dish_id, oi.quantity, oi.notes, oi.status, ?
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE o.table_id = ?`,
            [archivedAt, tableId]
        )
        await this.db.run(
            'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE table_id = ?)',
            [tableId]
        )
        await this.db.run('DELETE FROM orders WHERE table_id = ?', [tableId])
    }

    // Dos altas o ediciones concurrentes con el mismo número chocan con UNIQUE(restaurant_id, number).
    private translateError(error: unknown): unknown {
        if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT'
            && error.message.includes('restaurant_tables.number')) {
            return new DuplicatedTableNumberError()
        }
        return error
    }

    private mapToTable(row: TableRow): RestaurantTable {
        return {
            id: row.id,
            restaurantId: row.restaurantId,
            number: row.number,
            description: row.description,
            capacity: row.capacity,
            status: normalizeTableStatus(row.status),
            occupiedBy: row.occupiedBy,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
        }
    }
}
