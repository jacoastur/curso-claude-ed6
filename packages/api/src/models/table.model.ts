import { InvalidTableStatusError } from '@errors/DomainErrors.js'

const VALID_TABLE_STATUSES = ['libre', 'ocupada', 'reservada'] as const

export type TableStatusType = typeof VALID_TABLE_STATUSES[number]

export interface RestaurantTable {
    id: string
    restaurantId: string
    number: number
    description: string | null
    capacity: number
    status: TableStatusType
    createdAt: string
    updatedAt: string
}

export function normalizeTableStatus(value: unknown): TableStatusType {
    if (value === undefined || value === null) {
        throw new InvalidTableStatusError('Table status is required')
    }

    const normalized = String(value).trim().toLowerCase()
    if (!VALID_TABLE_STATUSES.includes(normalized as TableStatusType)) {
        throw new InvalidTableStatusError(`Invalid table status: ${String(value)}. Must be one of: ${VALID_TABLE_STATUSES.join(', ')}`)
    }
    return normalized as TableStatusType
}
