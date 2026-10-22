import { Component, inject, OnInit, signal } from '@angular/core'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { FormsModule } from '@angular/forms'
import { TableService } from '../../core/services/table.service'
import { CartStore } from '../../core/store/cart.store'
import { AvailableTable } from '../../core/models/table.model'

@Component({
  selector: 'app-table-selection',
  standalone: true,
  imports: [RouterLink, FormsModule],
  template: `
    <div class="container">
      <div class="page-header">
        <div>
          <a routerLink="/restaurants" class="back-link">← Volver a restaurantes</a>
          <h1>Elige tu mesa</h1>
          <p>Indica cuántas personas sois y selecciona una mesa libre</p>
        </div>
      </div>

      <div class="search card">
        <label for="people">Número de personas</label>
        <input id="people" type="number" min="1" step="1" [ngModel]="people()" (ngModelChange)="people.set($event)" />
        <button class="btn btn-primary" [disabled]="loading()" (click)="search()">Buscar mesas</button>
      </div>

      @if (notice()) {
        <div class="alert-error">{{ notice() }}</div>
      }

      @if (loading()) {
        <div class="spinner"></div>
      } @else if (searched()) {
        @if (tables().length === 0) {
          <div class="empty-state card">
            <p>No hay mesas libres para {{ searchedPeople() }} personas</p>
          </div>
        } @else {
          <div class="tables-list">
            @for (table of tables(); track table.id) {
              <button type="button" class="table-card card" [class.selected]="selectedId() === table.id"
                      (click)="selectedId.set(table.id)">
                <strong>Mesa {{ table.number }}</strong>
                <span class="capacity">{{ table.capacity }} personas</span>
                @if (table.description) {
                  <span class="description">{{ table.description }}</span>
                }
              </button>
            }
          </div>
          <button class="btn btn-primary continue" [disabled]="!selectedId() || occupying()" (click)="continue()">
            @if (occupying()) { Reservando... } @else { Continuar }
          </button>
        }
      }
    </div>
  `,
  styles: [`
    .container {
      max-width: 700px;
      margin: 0 auto;
    }
    .back-link {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 8px;
      display: inline-block;
    }
    .search {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .search input {
      width: 100px;
    }
    .tables-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 20px;
    }
    .table-card {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px 20px;
      text-align: left;
      color: var(--text-primary);
      cursor: pointer;
    }
    .table-card.selected {
      border-color: var(--green-light);
      background: var(--green-glow);
    }
    .capacity, .description {
      color: var(--text-muted);
      font-size: 13px;
    }
    .continue {
      width: 100%;
      justify-content: center;
    }
  `]
})
export class TableSelectionComponent implements OnInit {
  private readonly route = inject(ActivatedRoute)
  private readonly router = inject(Router)
  private readonly tableService = inject(TableService)
  private readonly cartStore = inject(CartStore)

  private restaurantId = ''
  readonly people = signal<number | null>(2)
  readonly tables = signal<AvailableTable[]>([])
  readonly selectedId = signal<string | null>(null)
  readonly searched = signal(false)
  readonly searchedPeople = signal(0)
  readonly loading = signal(false)
  readonly occupying = signal(false)
  readonly notice = signal<string | null>(null)

  ngOnInit(): void {
    this.restaurantId = this.route.snapshot.paramMap.get('id')!
    const aviso = history.state?.aviso
    if (typeof aviso === 'string') {
      this.notice.set(aviso)
    }
  }

  search(keepNotice = false): void {
    const people = Number(this.people())
    if (!Number.isInteger(people) || people < 1) {
      this.notice.set('Indica un número de personas válido (1 o más)')
      return
    }
    if (!keepNotice) this.notice.set(null)
    this.loading.set(true)
    this.selectedId.set(null)
    this.tableService.getAvailable(this.restaurantId, people).subscribe({
      next: (tables) => {
        this.tables.set(tables)
        this.searchedPeople.set(people)
        this.searched.set(true)
        this.loading.set(false)
      },
      error: () => {
        this.notice.set('Error al cargar las mesas disponibles')
        this.loading.set(false)
      }
    })
  }

  continue(): void {
    const table = this.tables().find(t => t.id === this.selectedId())
    if (!table || this.occupying()) return

    this.occupying.set(true)
    this.notice.set(null)
    this.tableService.occupy(this.restaurantId, table.id, this.searchedPeople()).subscribe({
      next: () => {
        this.cartStore.setTable({ restaurantId: this.restaurantId, id: table.id, number: table.number })
        this.occupying.set(false)
        this.router.navigate(['/restaurants', this.restaurantId])
      },
      error: (err) => {
        this.occupying.set(false)
        if (err?.status === 409) {
          this.notice.set('Esa mesa acaba de ser ocupada. Elige otra de la lista actualizada.')
          this.search(true)
        } else {
          this.notice.set('No se pudo reservar la mesa. Inténtalo de nuevo.')
        }
      }
    })
  }
}
