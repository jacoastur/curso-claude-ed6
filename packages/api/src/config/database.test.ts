import { Database } from './database.js'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('Database.transaction', () => {
    let db: Database

    const names = async () =>
        (await db.all<{ name: string }>('SELECT name FROM restaurants ORDER BY name')).map(r => r.name)

    const insert = (name: string) => db.run(
        'INSERT INTO restaurants (id, name, address, email, phone, owner_first_name, owner_last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, name, 'Calle', `${name}@resttek.com`, '600000000', 'A', 'B', '2026-10-22', '2026-10-22']
    )

    beforeEach(async () => {
        process.env.NODE_ENV = 'test'
        db = new Database()
        await db.initialize()
    })

    afterEach(async () => {
        await db.close()
    })

    it('should commit all the statements and return the result', async () => {
        const result = await db.transaction(async () => {
            await insert('a')
            await insert('b')
            return 'ok'
        })
        expect(result).toBe('ok')
        expect(await names()).toEqual(['a', 'b'])
    })

    it('should roll back everything if a statement fails', async () => {
        await expect(db.transaction(async () => {
            await insert('a')
            await insert('a')
        })).rejects.toThrow('SQLITE_CONSTRAINT')
        expect(await names()).toEqual([])
    })

    it('should reuse the current transaction when nested', async () => {
        await expect(db.transaction(async () => {
            await insert('a')
            await db.transaction(async () => insert('b'))
            throw new Error('boom')
        })).rejects.toThrow('boom')
        expect(await names()).toEqual([])
    })

    it('should keep statements launched outside out of a transaction that rolls back', async () => {
        // Una petición concurrente (programada fuera de la transacción) escribe mientras está abierta.
        const outside = new Promise(resolve => setTimeout(() => resolve(insert('outside')), 5))
        await expect(db.transaction(async () => {
            await insert('a')
            await new Promise(resolve => setTimeout(resolve, 20))
            throw new Error('boom')
        })).rejects.toThrow('boom')
        await outside
        expect(await names()).toEqual(['outside'])
    })

    it('should run concurrent transactions one after another', async () => {
        await Promise.all([
            db.transaction(async () => { await insert('a'); await insert('b') }),
            db.transaction(async () => { await insert('c'); await insert('d') })
        ])
        expect(await names()).toEqual(['a', 'b', 'c', 'd'])
    })
})
