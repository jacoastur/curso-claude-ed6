import { Router } from 'express'
import { dbConfig } from '@config/database.js'
import { SqliteTableRepository } from '@repositories/table.repository.js'
import { TableService } from '@services/table.service.js'
import { TableController } from '@controllers/table.controller.js'
import { authenticate, authorize } from '@shared/infrastructure/http/middlewares.js'

const tableRepository = new SqliteTableRepository(dbConfig)
const tableService = new TableService(tableRepository)
const tableController = new TableController(tableService)

const router = Router({ mergeParams: true })

router.get('/available', tableController.getAvailable)
router.post('/:id/occupy', authenticate, authorize(['cliente']), tableController.occupy)

export default router
