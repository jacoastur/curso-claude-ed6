import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ChangeTableStatusDto, RestaurantTable } from '../models/table.model';
import { environment } from '../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TableService {
  private readonly http = inject(HttpClient);

  private url(restaurantId: string): string {
    return `${environment.apiUrl}/restaurants/${restaurantId}/tables`;
  }

  getAll(restaurantId: string): Observable<RestaurantTable[]> {
    return this.http.get<RestaurantTable[]>(this.url(restaurantId));
  }

  changeStatus(restaurantId: string, tableId: string, dto: ChangeTableStatusDto): Observable<RestaurantTable> {
    return this.http.patch<RestaurantTable>(`${this.url(restaurantId)}/${tableId}/status`, dto);
  }
}
