import { Component, inject, computed, OnInit, OnDestroy } from '@angular/core';
import { AuthStore } from '@resttek/web-shared';
import { OrderStore } from '../../../orders/store/order.store';
import { Order } from '../../../orders/models/order.model';
import { RestaurantTable, TableStatus } from '../../models/table.model';
import { TableStore } from '../../store/table.store';

@Component({
  selector: 'app-mesas',
  standalone: true,
  templateUrl: './mesas.component.html',
  styleUrl: './mesas.component.css'
})
export class MesasComponent implements OnInit, OnDestroy {
  private readonly authStore = inject(AuthStore);
  readonly tableStore = inject(TableStore);
  readonly orderStore = inject(OrderStore);

  readonly statuses: TableStatus[] = ['libre', 'ocupada', 'reservada'];

  /** Pedidos activos agrupados por `tableId`. */
  readonly ordersByTable = computed(() => {
    const map = new Map<string, Order[]>();
    for (const order of this.orderStore.orders()) {
      if (!order.tableId) continue;
      map.set(order.tableId, [...(map.get(order.tableId) ?? []), order]);
    }
    return map;
  });

  ngOnInit(): void {
    const restaurantId = this.authStore.user()?.restaurantId;
    if (restaurantId) {
      this.tableStore.startPolling(restaurantId);
      this.orderStore.startPolling(restaurantId);
    }
  }

  ngOnDestroy(): void {
    this.tableStore.stopPolling();
    this.orderStore.stopPolling();
  }

  ordersOf(table: RestaurantTable): Order[] {
    return table.status === 'ocupada' ? (this.ordersByTable().get(table.id) ?? []) : [];
  }

  /** Una mesa ocupada con pedidos activos no se puede liberar (la API respondería 409). */
  isLocked(table: RestaurantTable): boolean {
    return this.ordersOf(table).length > 0;
  }

  onStatusChange(table: RestaurantTable, event: Event): void {
    const restaurantId = this.authStore.user()?.restaurantId;
    const status = (event.target as HTMLSelectElement).value as TableStatus;
    if (restaurantId && status !== table.status) {
      this.tableStore.changeStatus(restaurantId, table.id, status);
    }
  }
}
