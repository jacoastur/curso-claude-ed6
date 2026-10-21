import { describe, it, expect, vi } from 'vitest'
import type { Response, NextFunction } from 'express'
import { authorize, assertRestaurantAccess, type AuthRequest, type AuthUser } from './middlewares.js'

const run = (mw: (req: AuthRequest, res: Response, next: NextFunction) => void, user: AuthUser | undefined, params: Record<string, string> = {}) => {
    const req = { user, params } as unknown as AuthRequest
    const json = vi.fn()
    const status = vi.fn().mockReturnValue({ json })
    const res = { status } as unknown as Response
    const next = vi.fn()
    mw(req, res, next)
    return { status, next }
}

describe('authorize', () => {
    it('permite un rol incluido', () => {
        const { next } = run(authorize(['manager']), { id: '1', role: 'manager', restaurantId: 'r1' })
        expect(next).toHaveBeenCalled()
    })

    it('responde 403 con un rol no incluido o sin usuario', () => {
        expect(run(authorize(['manager']), { id: '1', role: 'cliente', restaurantId: null }).status).toHaveBeenCalledWith(403)
        expect(run(authorize(['manager']), undefined).status).toHaveBeenCalledWith(403)
    })
})

describe('assertRestaurantAccess', () => {
    it('deja pasar al admin a cualquier restaurante', () => {
        const { next } = run(assertRestaurantAccess(), { id: '1', role: 'admin', restaurantId: null }, { restaurantId: 'r2' })
        expect(next).toHaveBeenCalled()
    })

    it('deja pasar al staff de su propio restaurante', () => {
        const { next } = run(assertRestaurantAccess(), { id: '1', role: 'camarero', restaurantId: 'r1' }, { restaurantId: 'r1' })
        expect(next).toHaveBeenCalled()
    })

    it('responde 403 al staff de otro restaurante', () => {
        const { status, next } = run(assertRestaurantAccess(), { id: '1', role: 'camarero', restaurantId: 'r1' }, { restaurantId: 'r2' })
        expect(status).toHaveBeenCalledWith(403)
        expect(next).not.toHaveBeenCalled()
    })

    it('responde 403 si el usuario no tiene restaurante', () => {
        const { status } = run(assertRestaurantAccess(), { id: '1', role: 'cliente', restaurantId: null }, { restaurantId: 'r1' })
        expect(status).toHaveBeenCalledWith(403)
    })

    it('usa el nombre de parámetro indicado', () => {
        const { next } = run(assertRestaurantAccess('id'), { id: '1', role: 'manager', restaurantId: 'r1' }, { id: 'r1' })
        expect(next).toHaveBeenCalled()
    })
})
