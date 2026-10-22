import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable, catchError, map, of, switchMap } from 'rxjs'
import { API_URL } from '@resttek/web-shared'
import { AvailableTable, MyTable, TableRecovery } from '../models/table.model'
import { CartStore } from '../store/cart.store'

@Injectable({ providedIn: 'root' })
export class TableService {
  private readonly http = inject(HttpClient)
  private readonly apiUrl = inject(API_URL)
  private readonly cartStore = inject(CartStore)

  getAvailable(restaurantId: string, people: number): Observable<AvailableTable[]> {
    const params = new HttpParams().set('people', people)
    return this.http.get<AvailableTable[]>(
      `${this.apiUrl}/public/restaurants/${restaurantId}/tables/available`,
      { params }
    )
  }

  occupy(restaurantId: string, tableId: string, people: number): Observable<unknown> {
    return this.http.post(
      `${this.apiUrl}/public/restaurants/${restaurantId}/tables/${tableId}/occupy`,
      { people }
    )
  }

  getMine(restaurantId: string): Observable<MyTable> {
    return this.http.get<MyTable>(`${this.apiUrl}/public/restaurants/${restaurantId}/tables/mine`)
  }

  release(restaurantId: string, tableId: string): Observable<unknown> {
    return this.http.post(
      `${this.apiUrl}/public/restaurants/${restaurantId}/tables/${tableId}/release`,
      {}
    )
  }

  /**
   * Recupera la mesa que el cliente ya ocupa en el restaurante (p. ej. tras recargar la página).
   * - restored: tenía pedidos; la mesa queda en el CartStore.
   * - released: no tenía pedidos; se ha liberado y debe elegir mesa de nuevo.
   * - none: no ocupa ninguna mesa (404).
   * - error: no se pudo comprobar.
   */
  recover(restaurantId: string): Observable<TableRecovery> {
    const restore = (mine: MyTable): TableRecovery => {
      this.cartStore.setTable({ restaurantId, id: mine.table.id, number: mine.table.number })
      return 'restored'
    }
    return this.getMine(restaurantId).pipe(
      switchMap((mine): Observable<TableRecovery> => {
        if (mine.hasOrders) return of(restore(mine))
        return this.release(restaurantId, mine.table.id).pipe(
          map((): TableRecovery => 'released'),
          // Si entre medias aparecen pedidos (409) la mesa sigue siendo suya
          catchError((err): Observable<TableRecovery> =>
            of(err?.status === 409 ? restore(mine) : 'error'))
        )
      }),
      catchError((err): Observable<TableRecovery> => of(err?.status === 404 ? 'none' : 'error'))
    )
  }
}
