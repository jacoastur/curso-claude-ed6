import type { Request, Response, NextFunction } from 'express'
import type { TableService } from '@services/table.service.js'
import type { RestaurantTable } from '@models/table.model.js'
import type { AuthRequest } from '@shared/infrastructure/http/middlewares.js'

export class TableController {
    constructor(private readonly tableService: TableService) {}

    create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const table = await this.tableService.create({
                restaurantId: req.params.restaurantId as string,
                number: req.body?.number,
                description: req.body?.description,
                capacity: req.body?.capacity,
                status: req.body?.status
            })
            res.status(201).json(this.toJSON(table))
        } catch (error) {
            next(error)
        }
    }

    getAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const tables = await this.tableService.findByRestaurantId(req.params.restaurantId as string)
            res.status(200).json(tables.map(t => this.toJSON(t)))
        } catch (error) {
            next(error)
        }
    }

    getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const table = await this.tableService.findById(req.params.restaurantId as string, req.params.id as string)
            res.status(200).json(this.toJSON(table))
        } catch (error) {
            next(error)
        }
    }

    update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const table = await this.tableService.update(req.params.restaurantId as string, req.params.id as string, {
                number: req.body?.number,
                description: req.body?.description,
                capacity: req.body?.capacity,
                status: req.body?.status
            })
            res.status(200).json(this.toJSON(table))
        } catch (error) {
            next(error)
        }
    }

    changeStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const table = await this.tableService.changeStatus(req.params.restaurantId as string, req.params.id as string, req.body?.status)
            res.status(200).json(this.toJSON(table))
        } catch (error) {
            next(error)
        }
    }

    delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            await this.tableService.delete(req.params.restaurantId as string, req.params.id as string)
            res.status(204).send()
        } catch (error) {
            next(error)
        }
    }

    getAvailable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const raw = req.query.people
            const people = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : undefined
            const tables = await this.tableService.findAvailable(req.params.restaurantId as string, people)
            res.status(200).json(tables.map(t => this.toPublicJSON(t)))
        } catch (error) {
            next(error)
        }
    }

    occupy = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const table = await this.tableService.occupy(req.params.restaurantId as string, req.params.id as string, req.body?.people, this.clientIdOf(req))
            res.status(200).json(this.toJSON(table))
        } catch (error) {
            next(error)
        }
    }

    getMine = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const mine = await this.tableService.findMine(req.params.restaurantId as string, this.clientIdOf(req))
            res.status(200).json({ table: this.toJSON(mine.table), hasOrders: mine.hasOrders })
        } catch (error) {
            next(error)
        }
    }

    release = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const table = await this.tableService.release(req.params.restaurantId as string, req.params.id as string, this.clientIdOf(req))
            res.status(200).json(this.toJSON(table))
        } catch (error) {
            next(error)
        }
    }

    // Las rutas públicas de cliente pasan por authenticate, así que req.user existe.
    private clientIdOf(req: AuthRequest): string {
        return req.user?.id as string
    }

    private toJSON(table: RestaurantTable) {
        return {
            id: table.id,
            restaurantId: table.restaurantId,
            number: table.number,
            description: table.description,
            capacity: table.capacity,
            status: table.status,
            createdAt: table.createdAt,
            updatedAt: table.updatedAt
        }
    }

    private toPublicJSON(table: RestaurantTable) {
        return {
            id: table.id,
            number: table.number,
            description: table.description,
            capacity: table.capacity
        }
    }
}
