import { Injectable, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { RestaurantTable, TableStatus } from '../models/table.model';
import { TableService } from '../services/table.service';

/** Mensaje en español según el código HTTP (el texto del servidor está en inglés). */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    switch (err.status) {
      case 400: return 'Estado de mesa no válido';
      case 401: return 'Sesión caducada, vuelve a iniciar sesión';
      case 403: return 'No tienes permiso para gestionar las mesas de este restaurante';
      case 404: return 'La mesa ya no existe';
    }
  }
  return fallback;
}

@Injectable({ providedIn: 'root' })
export class TableStore {
  private readonly tableService = inject(TableService);

  private readonly _tables = signal<RestaurantTable[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  readonly tables = this._tables.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  async loadTables(restaurantId: string): Promise<void> {
    this._loading.set(true);
    try {
      const tables = await firstValueFrom(this.tableService.getAll(restaurantId));
      this._tables.set(tables);
      this._error.set(null);
    } catch (err) {
      this._error.set(errorMessage(err, 'Error al cargar las mesas'));
    } finally {
      this._loading.set(false);
    }
  }

  async changeStatus(restaurantId: string, tableId: string, status: TableStatus): Promise<void> {
    try {
      const updated = await firstValueFrom(this.tableService.changeStatus(restaurantId, tableId, { status }));
      this._tables.update(tables => tables.map(t => (t.id === tableId ? updated : t)));
      this._error.set(null);
    } catch (err) {
      this._error.set(errorMessage(err, 'Error al cambiar el estado de la mesa'));
      // Recarga para que el selector vuelva al estado real.
      await this.loadTables(restaurantId);
    }
  }

  startPolling(restaurantId: string): void {
    this.stopPolling();
    this.loadTables(restaurantId);
    this.pollingInterval = setInterval(() => {
      this.loadTables(restaurantId);
    }, 30000);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}
