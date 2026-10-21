import { inject } from '@angular/core'
import { Router, type CanActivateFn } from '@angular/router'
import { AuthStore } from '@resttek/web-shared'

/** Página a la que se redirige a cada rol cuando intenta entrar en una que no le corresponde. */
const DEFAULT_ROUTE: Record<string, string> = {
  cocinero: '/cocina',
  manager: '/cocina',
  camarero: '/barra'
}

export const roleGuard = (allowedRoles: string[]): CanActivateFn => () => {
  const auth = inject(AuthStore)
  const router = inject(Router)
  const role = auth.userRole()

  if (role && allowedRoles.includes(role)) return true
  return router.createUrlTree([(role && DEFAULT_ROUTE[role]) || '/login'])
}
