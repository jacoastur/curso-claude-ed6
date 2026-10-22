import { HttpErrorResponse } from '@angular/common/http'

// La API responde { error: NombreDelError, message } en inglés; la UI muestra textos propios
// en español y decide por el nombre del error (y, si no lo reconoce, por el código HTTP).
const MESSAGES_BY_ERROR: Record<string, string> = {
  DuplicatedTableNumberError: 'Ya existe una mesa con ese número',
  TableOccupiedError: 'No se puede borrar una mesa ocupada',
  TableNotFoundError: 'La mesa no existe',
  InvalidTableNumberError: 'El número de mesa debe ser un entero mayor o igual que 1',
  InvalidTableCapacityError: 'La capacidad debe ser un entero mayor o igual que 1',
  InvalidTableStatusError: 'El estado de la mesa no es válido'
}

export function tableErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof HttpErrorResponse)) return fallback

  const name = typeof err.error?.error === 'string' ? err.error.error : ''
  const byName = MESSAGES_BY_ERROR[name]
  if (byName) return byName

  if (err.status === 403) return 'No tienes permisos para realizar esta acción'
  return fallback
}
