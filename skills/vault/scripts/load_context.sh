#!/bin/bash
# load_context.sh — Carga el contexto relevante del vault para la sesión actual
#
# Uso: load_context.sh [proyecto]
#
# Imprime un resumen del conocimiento acumulado para que Claude lo tenga en cuenta.

PROJECT="$1"
VAULT="$HOME/Vault/Claude"

if [ ! -d "$VAULT" ]; then
  echo "⚠️  Vault no inicializado. Ejecuta setup_vault.sh primero."
  exit 1
fi

echo "========================================"
echo "🧠 CLAUDE MEMORY — Contexto de sesión"
echo "========================================"
echo "Fecha: $(date '+%Y-%m-%d %H:%M')"
[ -n "$PROJECT" ] && echo "Proyecto: $PROJECT"
echo ""

# Función para mostrar entradas de una carpeta
show_category() {
  local DIR="$1"
  local LABEL="$2"
  local FILES=("$VAULT/$DIR"/*.md)

  # Filtrar README
  local COUNT=0
  for f in "${FILES[@]}"; do
    [[ "$f" == *"README.md" ]] && continue
    [ -f "$f" ] && COUNT=$((COUNT+1))
  done

  [ "$COUNT" -eq 0 ] && return

  echo "### $LABEL ($COUNT)"
  for f in "${FILES[@]}"; do
    [[ "$f" == *"README.md" ]] && continue
    [ -f "$f" ] || continue
    TITLE=$(grep '^title:' "$f" | sed 's/title: //' | tr -d '"')
    DATE=$(grep '^date:' "$f" | sed 's/date: //' | tr -d '"')
    STATUS=$(grep '^status:' "$f" | sed 's/status: //' | tr -d '"')
    echo "  • [$STATUS] $DATE — $TITLE"
  done
  echo ""
}

show_category "global/issues"        "🐛 Issues pendientes"
show_category "global/patterns"      "🔁 Patrones recurrentes"
show_category "global/architecture"  "🏗  Decisiones de arquitectura"
show_category "global/conventions"   "📐 Convenciones"

# Contexto específico del proyecto
if [ -n "$PROJECT" ] && [ -d "$VAULT/projects/$PROJECT" ]; then
  echo "========================================"
  echo "📁 Contexto del proyecto: $PROJECT"
  echo "========================================"
  for f in "$VAULT/projects/$PROJECT"/*.md; do
    [[ "$f" == *"INDEX.md" ]] && continue
    [ -f "$f" ] || continue
    TITLE=$(grep '^title:' "$f" | sed 's/title: //' | tr -d '"')
    TYPE=$(grep '^type:' "$f" | sed 's/type: //' | tr -d '"')
    DATE=$(grep '^date:' "$f" | sed 's/date: //' | tr -d '"')
    echo "  • [$TYPE] $DATE — $TITLE"
  done
  echo ""
fi

echo "========================================"
echo "Vault: $VAULT"
echo "========================================"
