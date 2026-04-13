#!/bin/bash
# setup_vault.sh — Inicializa el vault de memoria de Claude Code

VAULT="$HOME/Vault/Claude"

echo "Inicializando Claude Memory en: $VAULT"

mkdir -p "$VAULT/.obsidian"
mkdir -p "$VAULT/global/issues"
mkdir -p "$VAULT/global/patterns"
mkdir -p "$VAULT/global/architecture"
mkdir -p "$VAULT/global/conventions"
mkdir -p "$VAULT/projects"

# Índice global
cat > "$VAULT/INDEX.md" << 'EOF'
---
type: index
---

# Claude Memory — Índice Global

Base de conocimiento viva gestionada por Claude Code.
Actualizada automáticamente durante las sesiones de trabajo.

## Estructura

```
global/
  issues/        → Bugs y problemas pendientes
  patterns/      → Errores recurrentes y cómo resolverlos
  architecture/  → Decisiones de arquitectura tomadas
  conventions/   → Preferencias y convenciones de código
projects/
  <proyecto>/    → Contexto específico de cada proyecto
```

## Uso
Claude consulta este vault al inicio de cada sesión y cuando
detecta algo relacionado con el conocimiento existente.
EOF

# Archivos de resumen por categoría global
for category in issues patterns architecture conventions; do
  cat > "$VAULT/global/$category/README.md" << EOF
---
type: category-index
category: $category
---

# $(echo $category | sed 's/issues/Issues pendientes/;s/patterns/Patrones recurrentes/;s/architecture/Decisiones de arquitectura/;s/conventions/Convenciones y preferencias/')

_Las entradas se añaden automáticamente por Claude Code._
EOF
done

# Config Obsidian
cat > "$VAULT/.obsidian/app.json" << 'EOF'
{
  "defaultViewMode": "preview",
  "showLineNumber": true,
  "foldHeading": false
}
EOF

cat > "$VAULT/.obsidian/appearance.json" << 'EOF'
{ "theme": "obsidian" }
EOF

echo ""
echo "Vault listo en: $VAULT"
echo "Abre Obsidian -> 'Open folder as vault' -> selecciona: $VAULT"
