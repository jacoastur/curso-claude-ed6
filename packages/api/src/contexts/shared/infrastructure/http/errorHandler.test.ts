import { describe, it, expect, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { errorHandler } from './errorHandler.js'
import {
    ClientAlreadyHasTableError,
    DuplicatedTableNumberError,
    InvalidOrderDishError,
    InvalidOrderItemError,
    OrderItemsRequiredError,
    TableHasActiveOrdersError,
    TableHasOrdersError,
    TableNotAvailableError,
    TableNotFoundError,
    TableNotOwnedError,
    TableOccupiedError
} from '@errors/DomainErrors.js'

const handle = (error: unknown) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
    errorHandler(error, {} as Request, res as unknown as Response, (() => {}) as NextFunction)
    return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] }
}

describe('errorHandler', () => {
    it.each([
        [new TableNotOwnedError(), 403],
        [new TableNotFoundError(), 404],
        [new DuplicatedTableNumberError(), 409],
        [new TableNotAvailableError(), 409],
        [new TableOccupiedError(), 409],
        [new TableHasActiveOrdersError(), 409],
        [new TableHasOrdersError(), 409],
        [new ClientAlreadyHasTableError(), 409],
        [new OrderItemsRequiredError(), 400],
        [new InvalidOrderItemError(), 400],
        [new InvalidOrderDishError(), 400]
    ])('should map %s to %i with { error, message }', (error, status) => {
        expect(handle(error)).toEqual({ status, body: { error: error.name, message: error.message } })
    })

    it('should answer 500 for an unexpected error', () => {
        expect(handle(new TypeError('boom'))).toEqual({
            status: 500,
            body: { error: 'InternalServerError', message: 'Something went wrong' }
        })
    })
})
