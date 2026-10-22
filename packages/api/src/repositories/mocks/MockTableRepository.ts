import type { TableRepository } from '@repositories/table.repository.js'
import type { RestaurantTable, TableOrderStats } from '@models/table.model.js'

export class MockTableRepository implements TableRepository {
    private tables: Map<string, RestaurantTable> = new Map()
    private orderStats: Map<string, TableOrderStats> = new Map()
    /** Ids de las mesas cuyos pedidos se han archivado, en orden. */
    readonly archivedTables: string[] = []

    /** Simula los pedidos que la mesa tiene en `orders`. */
    setOrderStats(tableId: string, stats: TableOrderStats): void {
        this.orderStats.set(tableId, stats)
    }

    async findById(id: string): Promise<RestaurantTable | null> {
        const table = this.tables.get(id)
        return table ? { ...table } : null
    }

    async findByRestaurantId(restaurantId: string): Promise<RestaurantTable[]> {
        return Array.from(this.tables.values())
            .filter(t => t.restaurantId === restaurantId)
            .sort((a, b) => a.number - b.number)
    }

    async findAvailable(restaurantId: string, people: number): Promise<RestaurantTable[]> {
        return Array.from(this.tables.values())
            .filter(t => t.restaurantId === restaurantId && t.status === 'libre' && t.capacity >= people)
            .sort((a, b) => a.capacity - b.capacity || a.number - b.number)
    }

    async findByNumber(restaurantId: string, number: number): Promise<RestaurantTable | null> {
        return Array.from(this.tables.values())
            .find(t => t.restaurantId === restaurantId && t.number === number) || null
    }

    async findByOccupant(restaurantId: string, clientId: string): Promise<RestaurantTable | null> {
        return Array.from(this.tables.values())
            .find(t => t.restaurantId === restaurantId && t.occupiedBy === clientId) || null
    }

    async getOrderStats(tableId: string): Promise<TableOrderStats> {
        return this.orderStats.get(tableId) ?? { orders: 0, activeOrders: 0 }
    }

    async save(table: RestaurantTable, options: { archiveOrders?: boolean } = {}): Promise<void> {
        if (options.archiveOrders) {
            this.archive(table.id)
        }
        this.tables.set(table.id, { ...table })
    }

    async occupyIfFree(id: string, restaurantId: string, people: number, clientId: string, updatedAt: string): Promise<RestaurantTable | null> {
        const table = this.tables.get(id)
        if (!table || table.restaurantId !== restaurantId || table.status !== 'libre' || table.capacity < people) {
            return null
        }
        if (await this.findByOccupant(restaurantId, clientId)) {
            return null
        }
        const occupied: RestaurantTable = { ...table, status: 'ocupada', occupiedBy: clientId, updatedAt }
        this.tables.set(id, occupied)
        return { ...occupied }
    }

    async delete(id: string): Promise<void> {
        this.archive(id)
        this.tables.delete(id)
    }

    private archive(tableId: string): void {
        this.archivedTables.push(tableId)
        this.orderStats.delete(tableId)
    }
}
