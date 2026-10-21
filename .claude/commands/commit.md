---
description: Crea un commit siguiendo la especificación Conventional Commits
argument-hint: [contexto opcional sobre el cambio]
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), mcp__slack__slack_post_message
---

## Contexto

- Estado del repositorio: !`git status --short`
- Cambios en staging: !`git diff --cached`
- Cambios sin añadir: !`git diff`
- Rama actual: !`git branch --show-current`
- Últimos commits: !`git log --oneline -10 2>/dev/null || echo "(sin commits todavía)"`

## Tarea

Crea un único commit con los cambios actuales siguiendo la especificación [Conventional Commits 1.0.0](https://www.conventionalcommits.org/es/v1.0.0/).

Contexto adicional del usuario (puede estar vacío): $ARGUMENTS

### Formato

```
<tipo>[ámbito opcional][!]: <descripción>

[cuerpo opcional]

[pie(s) opcional(es)]
```

### Tipos permitidos

- `feat`: nueva funcionalidad.
- `fix`: corrección de un error.
- `docs`: cambios solo de documentación.
- `style`: formato que no afecta al código (espacios, comas, etc.).
- `refactor`: cambio de código que ni corrige un error ni añade funcionalidad.
- `perf`: mejora de rendimiento.
- `test`: añadir o corregir tests.
- `build`: cambios en el sistema de build o dependencias (`package.json`, etc.).
- `ci`: cambios en la configuración de integración continua.
- `chore`: tareas de mantenimiento que no modifican `src` ni tests.
- `revert`: revierte un commit anterior.

### Reglas

1. **Descripción**: en español, en imperativo o infinitivo según el estilo de los últimos commits, en minúscula, sin punto final y de 72 caracteres como máximo (incluido el prefijo).
2. **Ámbito** (opcional): sustantivo entre paréntesis que indique la zona afectada. En este proyecto, usa la capa o el recurso, por ejemplo `routes`, `controllers`, `services`, `repositories`, `models`, `helpers`, `db` o `vendehumos`.
3. **Cuerpo** (opcional): separado por una línea en blanco; explica el *qué* y el *porqué*, no el *cómo*. Líneas de unos 72 caracteres.
4. **Cambios incompatibles**: añade `!` tras el tipo/ámbito y/o un pie `BREAKING CHANGE: <explicación>`.
5. **Pies**: formato `Clave: valor` (p. ej. `Refs: #12`). Solo si aplica.
6. Los tipos y las palabras clave (`BREAKING CHANGE`) se mantienen en inglés; el resto del mensaje va en español.

### Procedimiento

1. Analiza los cambios del contexto. Si no hay ninguno (ni en staging ni sin añadir), informa al usuario y detente.
2. Si hay cambios en staging, comitea solo esos. Si no hay nada en staging, añade con `git add` los ficheros relevantes **por nombre** (nunca `git add -A` ni `git add .`).
3. No añadas ficheros que no deban versionarse: `.env`, credenciales, ficheros `.db`, `node_modules/`. Avisa al usuario si los detectas.
4. Si los cambios mezclan varios propósitos independientes, propón dividirlos en varios commits en lugar de uno solo y pregunta antes de continuar.
5. Elige el tipo y el ámbito que mejor describan el cambio y redacta el mensaje según las reglas anteriores y muestraselo al usuario utilizando la tool `AskUserQuestion` para preguntarle si le parece bien el mensaje. Si no le parece bien, genera otro mensaje y le vuelves a preguntar. Cuando lo de por válido sigue con el paso 6.
6. Crea el commit con `git commit -m` (usa varios `-m` o un heredoc para cuerpo y pies).
7. Muestra el mensaje final y el resultado de `git status` tras el commit.
8. **Avisa por Slack.** Tras crear el commit, envía un mensaje al canal `planes-ed8` (ID `C0CAKE90QFR`) con la tool `mcp__slack__slack_post_message` (si su esquema no está cargado, cárgalo antes con `ToolSearch`). El mensaje, en español, indica que la implementación ya está lista para revisar e incluye el hash corto y el mensaje del commit, por ejemplo: `✅ La implementación ya está lista para revisar: a1b2c3d feat(vendehumos): añadir filtro por votos.` Si el envío falla, díselo al usuario; no reintentes en bucle.

### Restricciones

- No hagas `git push`.
- No uses `--amend`, `--no-verify` ni modifiques la configuración de git.
- Si un hook de pre-commit falla, corrige el problema y crea un commit nuevo; no lo saltes.
