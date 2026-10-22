import type { TableRepository } from '@repositories/table.repository.js'
import type { RestaurantTable, TableStatusType } from '@models/table.model.js'

export class MockTableRepository implements TableRepository {
    private tables: Map<string, RestaurantTable> = new Map()

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

    async save(table: RestaurantTable): Promise<void> {
        this.tables.set(table.id, { ...table })
    }

    async updateStatus(id: string, status: TableStatusType, updatedAt: string): Promise<void> {
        const table = this.tables.get(id)
        if (table) {
            this.tables.set(id, { ...table, status, updatedAt })
        }
    }

    async occupyIfFree(id: string, restaurantId: string, people: number, updatedAt: string): Promise<boolean> {
        const table = this.tables.get(id)
        if (!table || table.restaurantId !== restaurantId || table.status !== 'libre' || table.capacity < people) {
            return false
        }
        this.tables.set(id, { ...table, status: 'ocupada', updatedAt })
        return true
    }

    async delete(id: string): Promise<void> {
        this.tables.delete(id)
    }
}
