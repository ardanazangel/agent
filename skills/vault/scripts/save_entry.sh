#!/bin/bash
# save_entry.sh — Guarda una entrada de conocimiento en el vault
#
# Uso:
#   save_entry.sh <tipo> <titulo> <contenido> [proyecto]
#
# Tipos válidos:
#   issue       → Bug o problema pendiente
#   pattern     → Error recurrente con solución
#   architecture → Decisión de arquitectura
#   convention  → Preferencia o convención de código
#
# Si se proporciona [proyecto], la entrada se guarda también en projects/<proyecto>/

TYPE="$1"
TITLE="$2"
CONTENT="$3"
PROJECT="$4"

VAULT="$HOME/Vault/Claude"
DATE=$(date +"%Y-%m-%d")
TIME=$(date +"%H:%M")
TIMESTAMP=$(date +"%Y%m%d%H%M%S")
SLUG=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | cut -c1-50)

# Mapear tipo a carpeta y etiqueta
case "$TYPE" in
  issue)        DIR="global/issues";        LABEL="Issue pendiente"    ;;
  pattern)      DIR="global/patterns";      LABEL="Patrón recurrente"  ;;
  architecture) DIR="global/architecture";  LABEL="Decisión de arquitectura" ;;
  convention)   DIR="global/conventions";   LABEL="Convención"         ;;
  *)
    echo "❌ Tipo inválido: $TYPE (usa: issue, pattern, architecture, convention)"
    exit 1
    ;;
esac

FILEPATH="$VAULT/$DIR/${TIMESTAMP}-${SLUG}.md"

mkdir -p "$VAULT/$DIR"

cat > "$FILEPATH" << EOF
---
type: $TYPE
title: "$TITLE"
date: "$DATE"
time: "$TIME"
project: "${PROJECT:-global}"
status: open
tags: [$TYPE, ${PROJECT:-global}]
---

# $TITLE

**Tipo:** $LABEL
**Fecha:** $DATE
**Proyecto:** ${PROJECT:-global}

---

$CONTENT
EOF

echo "✅ Guardado [$TYPE]: $TITLE"
echo "   📄 $FILEPATH"

# Si hay proyecto, guardar también referencia en projects/<proyecto>/
if [ -n "$PROJECT" ]; then
  PROJ_DIR="$VAULT/projects/$PROJECT"
  mkdir -p "$PROJ_DIR"
  PROJ_INDEX="$PROJ_DIR/INDEX.md"

  # Crear índice de proyecto si no existe
  if [ ! -f "$PROJ_INDEX" ]; then
    cat > "$PROJ_INDEX" << EOF2
---
type: project-index
project: $PROJECT
---

# Proyecto: $PROJECT

Entradas de conocimiento específicas de este proyecto.
EOF2
  fi

  # Añadir referencia al índice del proyecto
  echo "- [$DATE] [$TYPE] [[$TITLE]] → \`$FILEPATH\`" >> "$PROJ_INDEX"
  echo "   🔗 Referenciado en projects/$PROJECT/INDEX.md"
fi
