export interface AvailableTable {
  id: string
  number: number
  description: string | null
  capacity: number
}

export interface MyTable {
  table: {
    id: string
    restaurantId: string
    number: number
    description: string | null
    capacity: number
    status: string
  }
  hasOrders: boolean
}

export type TableRecovery = 'restored' | 'released' | 'none' | 'error'
