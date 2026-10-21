---
name: plan-feature
description: Planifica cómo implementar una nueva funcionalidad o corregir un bug y genera un plan detallado en docs/plans con una lista de tareas de 5-10 minutos. Úsala cuando el usuario pida planificar, diseñar o preparar el trabajo antes de programarlo.
argument-hint: <descripción de la funcionalidad o del bug>
---

# plan-feature

Genera un plan de implementación en formato Markdown dentro de `docs/plans/`. **Solo planifica: no modifiques código fuente.**

Petición del usuario: $ARGUMENTS

## Procedimiento

1. **Entiende la petición.** Determina si es una *funcionalidad* o un *bug*. Si falta información que cambie el plan (comportamiento esperado, alcance, pasos para reproducir un bug), pregunta con `AskUserQuestion`; no preguntes lo que puedas deducir del código.
2. **Investiga el código.** Lee `CLAUDE.md` y los ficheros afectados de `src/`. Respeta la arquitectura por capas (`routes` → `controllers` → `services` → `repositories` → SQLite), las reglas funcionales y la documentación de `docs/` (por ejemplo la paginación). En un bug, localiza la causa raíz antes de proponer la solución.
3. **Lee la plantilla** [assets/plantilla-plan.md](assets/plantilla-plan.md) y úsala como estructura del plan: mismas secciones, mismo orden y mismos títulos. No elimines secciones; si una no aplica, indícalo ("Ninguno" / "Ninguna").
4. **Redacta la lista de tareas** (sección 5) siguiendo estas reglas:
   - Cada tarea debe poder completarse en **5-10 minutos**. Si es más grande, divídela.
   - Una tarea = un cambio concreto y verificable, normalmente en un solo fichero o capa.
   - Ordénalas según el flujo de capas, de abajo arriba (modelo/helpers → repository → service → controller → route) y deja la documentación al final.
   - Numéralas `T1`, `T2`, … como casillas `- [ ]`, indicando fichero y tiempo estimado.
   - Sin tareas vagas ("implementar la funcionalidad"); di qué se cambia y dónde.
5. **Guarda el plan** en `docs/plans/<AAAA-MM-DD>-<slug>.md`, con `slug` en minúsculas, sin tildes y con guiones (p. ej. `2026-10-15-filtro-por-votos.md`). Crea la carpeta si no existe. Si el fichero ya existe, no lo sobrescribas: pregunta al usuario.
6. **Resume al usuario** la ruta del plan, el número de tareas, el tiempo total estimado y las dudas abiertas. Pregunta si quiere ajustar algo antes de implementarlo.
7. **Avisa por Slack.** Una vez guardado el plan, envía un mensaje al canal `planes-ed8` (ID `C0CAKE90QFR`) con la tool `mcp__slack__slack_post_message` (si su esquema no está cargado, cárgalo antes con `ToolSearch`). El mensaje, en español, indica que el plan ya está listo para revisar e incluye la ruta del fichero y el número de tareas, por ejemplo: `📋 El plan docs/plans/2026-10-15-filtro-por-votos.md ya está listo para revisar (8 tareas, ~60 min).` Si el envío falla, díselo al usuario; no reintentes en bucle.

## Reglas

- Todo el plan se escribe **en español**.
- No inventes ficheros, funciones ni endpoints: verifica en el código que existen.
- No hagas commit del plan salvo que el usuario lo pida.
- No empieces a implementar las tareas.
