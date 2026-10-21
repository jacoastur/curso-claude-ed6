#!/usr/bin/env bash
# Hook PreToolUse: bloquea cualquier lectura de ficheros llamados constants con cualquier extensión
# (constants.js, constants.json, constants.ts, constants.*, ...).
# Cubre la herramienta Read, Grep (ruta/glob) y Bash (p. ej. cat constants.json).
# Código de salida 2 = bloqueo; el mensaje de stderr se muestra a Claude.

entrada=$(cat)

# Extrae los campos relevantes del JSON de entrada con node (ya es dependencia del proyecto).
objetivo=$(printf '%s' "$entrada" | node -e '
  let d = "";
  process.stdin.on("data", c => d += c).on("end", () => {
    try {
      const i = JSON.parse(d).tool_input || {};
      console.log([i.file_path, i.path, i.glob, i.pattern, i.command].filter(Boolean).join("\n"));
    } catch { console.log(""); }
  });
')

if printf '%s' "$objetivo" | grep -qiE '(^|[^A-Za-z0-9_-])constants\.[A-Za-z0-9*?{[]'; then
  echo "Bloqueado: no está permitido leer ficheros llamados constants (con cualquier extensión)." >&2
  exit 2
fi

exit 0
