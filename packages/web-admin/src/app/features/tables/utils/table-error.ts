import { HttpErrorResponse } from '@angular/common/http'

// Pedidos activos al borrar la mesa (por defecto) o al sacarla de `ocupada` con PUT
export const TABLE_DELETE_ACTIVE_ORDERS_MESSAGE = 'No se puede borrar la mesa: tiene pedidos activos'
export const TABLE_RELEASE_ACTIVE_ORDERS_MESSAGE = 'No se puede liberar la mesa mientras tenga pedidos activos'

// La API responde { error: NombreDelError, message } en inglés; la UI muestra textos propios
// en español y decide por el nombre del error (y, si no lo reconoce, por el código HTTP).
const MESSAGES_BY_ERROR: Record<string, string> = {
  DuplicatedTableNumberError: 'Ya existe una mesa con ese número',
  TableOccupiedError: 'No se puede borrar una mesa ocupada',
  TableNotFoundError: 'La mesa no existe',
  InvalidTableNumberError: 'El número de mesa debe ser un entero mayor o igual que 1',
  InvalidTableCapacityError: 'La capacidad debe ser un entero mayor o igual que 1',
  InvalidTableStatusError: 'El estado de la mesa no es válido',
  TableHasActiveOrdersError: TABLE_DELETE_ACTIVE_ORDERS_MESSAGE
}

export function tableErrorMessage(err: unknown, fallback: string, activeOrdersMessage = TABLE_DELETE_ACTIVE_ORDERS_MESSAGE): string {
  if (!(err instanceof HttpErrorResponse)) return fallback

  const name = typeof err.error?.error === 'string' ? err.error.error : ''
  if (name === 'TableHasActiveOrdersError') return activeOrdersMessage

  const byName = MESSAGES_BY_ERROR[name]
  if (byName) return byName

  if (err.status === 403) return 'No tienes permisos para realizar esta acción'
  return fallback
}
