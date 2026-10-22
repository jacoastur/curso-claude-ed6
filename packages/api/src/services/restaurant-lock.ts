/**
 * Exclusión mutua por clave en memoria. Serializa las operaciones de comprobar y
 * escribir (número de mesa libre, mesa sin pedidos activos, una mesa por cliente...)
 * de un mismo restaurante. Solo vale para un proceso, que es como se despliega la API.
 */
export class KeyedLock {
    private readonly tails = new Map<string, Promise<void>>()

    async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
        let release!: () => void
        const current = new Promise<void>(resolve => { release = resolve })
        const previous = this.tails.get(key) ?? Promise.resolve()
        const tail = previous.then(() => current)
        this.tails.set(key, tail)

        await previous
        try {
            return await fn()
        } finally {
            release()
            if (this.tails.get(key) === tail) {
                this.tails.delete(key)
            }
        }
    }
}

/** Instancia compartida por TableService y OrderService (las rutas crean varias instancias). */
export const restaurantLock = new KeyedLock()
