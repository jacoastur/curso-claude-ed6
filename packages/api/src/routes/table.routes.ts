import { Router } from 'express'
import { TableController } from '@controllers/table.controller.js'
import { dbConfig } from '@config/database.js'
import { SqliteTableRepository } from '@repositories/table.repository.js'
import { TableService } from '@services/table.service.js'
import { authenticate, authorize, assertRestaurantAccess } from '@shared/infrastructure/http/middlewares.js'

const tableRepository = new SqliteTableRepository(dbConfig)
const tableService = new TableService(tableRepository)
const tableController = new TableController(tableService)

const router = Router({ mergeParams: true })

// El cocinero no gestiona mesas: solo ve pedidos.
const STAFF_ROLES = ['admin', 'manager', 'camarero']

router.post('/', authenticate, authorize(['admin']), assertRestaurantAccess(), tableController.create)
router.get('/', authenticate, authorize(STAFF_ROLES), assertRestaurantAccess(), tableController.getAll)
router.get('/:id', authenticate, authorize(STAFF_ROLES), assertRestaurantAccess(), tableController.getById)
router.put('/:id', authenticate, authorize(['admin']), assertRestaurantAccess(), tableController.update)
router.patch('/:id/status', authenticate, authorize(STAFF_ROLES), assertRestaurantAccess(), tableController.changeStatus)
router.delete('/:id', authenticate, authorize(['admin']), assertRestaurantAccess(), tableController.delete)

export default router
