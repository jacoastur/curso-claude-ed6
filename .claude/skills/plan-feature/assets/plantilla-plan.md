# {{Título del plan}}

- **Tipo**: {{funcionalidad | bug}}
- **Fecha**: {{AAAA-MM-DD}}
- **Estado**: Pendiente

## 1. Contexto y objetivo

{{Qué se quiere conseguir y por qué. En un bug: síntoma observado, comportamiento esperado y pasos para reproducirlo.}}

## 2. Alcance

### Incluye

- {{Qué entra en este plan}}

### No incluye

- {{Qué queda explícitamente fuera}}

## 3. Análisis del código actual

{{Ficheros, capas y reglas funcionales afectados (según CLAUDE.md). En un bug, causa raíz identificada.}}

| Capa | Fichero | Cambio previsto |
| ---- | ------- | --------------- |
| {{routes / controllers / services / repositories / models / helpers}} | {{ruta/al/fichero.js}} | {{Qué hay que cambiar}} |

## 4. Diseño de la solución

{{Decisiones técnicas: contrato de la API (endpoint, método, parámetros, respuestas y códigos de estado), cambios en el modelo o en el SQL, validaciones y errores. Indicar alternativas descartadas si las hay.}}

## 5. Lista de tareas

Cada tarea debe poder hacerse en 5-10 minutos y tener un resultado verificable.

- [ ] **T1** – {{Descripción concreta}} · `{{fichero}}` · ⏱ {{5-10}} min
- [ ] **T2** – {{Descripción concreta}} · `{{fichero}}` · ⏱ {{5-10}} min

## 6. Plan de pruebas

{{Cómo comprobar que funciona (el proyecto no tiene tests): peticiones de ejemplo con `curl`, casos límite y regresiones a vigilar.}}

- [ ] {{Caso de prueba y resultado esperado}}

## 7. Riesgos y dudas abiertas

- {{Riesgo, dependencia o pregunta pendiente. Si no hay, escribir "Ninguno".}}

## 8. Documentación a actualizar

- {{Ficheros de `docs/` o secciones de CLAUDE.md afectados. Si no hay, escribir "Ninguna".}}
