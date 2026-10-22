import { Database } from '@config/database.js'
import type { RestaurantTable, TableStatusType } from '@models/table.model.js'
import { normalizeTableStatus } from '@models/table.model.js'

interface TableRow {
    id: string
    restaurantId: string
    number: number
    description: string | null
    capacity: number
    status: string
    createdAt: string
    updatedAt: string
}

const SELECT_TABLE = 'SELECT id, restaurant_id as restaurantId, number, description, capacity, status, created_at as createdAt, updated_at as updatedAt FROM restaurant_tables'

export interface TableRepository {
    findById(id: string): Promise<RestaurantTable | null>
    findByRestaurantId(restaurantId: string): Promise<RestaurantTable[]>
    findAvailable(restaurantId: string, people: number): Promise<RestaurantTable[]>
    findByNumber(restaurantId: string, number: number): Promise<RestaurantTable | null>
    save(table: RestaurantTable): Promise<void>
    updateStatus(id: string, status: TableStatusType, updatedAt: string): Promise<void>
    /** Ocupa la mesa solo si es del restaurante, está libre y cabe `people`. Devuelve si la ha ocupado. */
    occupyIfFree(id: string, restaurantId: string, people: number, updatedAt: string): Promise<boolean>
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

    async save(table: RestaurantTable): Promise<void> {
        const existing = await this.findById(table.id)
        if (existing) {
            await this.db.run(
                'UPDATE restaurant_tables SET number = ?, description = ?, capacity = ?, status = ?, updated_at = ? WHERE id = ?',
                [table.number, table.description, table.capacity, table.status, table.updatedAt, table.id]
            )
        } else {
            await this.db.run(
                'INSERT INTO restaurant_tables (id, restaurant_id, number, description, capacity, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [table.id, table.restaurantId, table.number, table.description, table.capacity, table.status, table.createdAt, table.updatedAt]
            )
        }
    }

    async updateStatus(id: string, status: TableStatusType, updatedAt: string): Promise<void> {
        await this.db.run(
            'UPDATE restaurant_tables SET status = ?, updated_at = ? WHERE id = ?',
            [status, updatedAt, id]
        )
    }

    async occupyIfFree(id: string, restaurantId: string, people: number, updatedAt: string): Promise<boolean> {
        const result = await this.db.run(
            `UPDATE restaurant_tables SET status = 'ocupada', updated_at = ?
             WHERE id = ? AND restaurant_id = ? AND status = 'libre' AND capacity >= ?`,
            [updatedAt, id, restaurantId, people]
        )
        return result.changes === 1
    }

    async delete(id: string): Promise<void> {
        await this.db.run('DELETE FROM restaurant_tables WHERE id = ?', [id])
    }

    private mapToTable(row: TableRow): RestaurantTable {
        return {
            id: row.id,
            restaurantId: row.restaurantId,
            number: row.number,
            description: row.description,
            capacity: row.capacity,
            status: normalizeTableStatus(row.status),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
        }
    }
}
