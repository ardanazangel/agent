#!/bin/bash
# search_memory.sh — Busca entradas relevantes en el vault por palabras clave
#
# Uso: search_memory.sh "palabra clave"

QUERY="$1"
VAULT="$HOME/Vault/Claude"

if [ ! -d "$VAULT" ]; then
  echo "❌ El vault no existe en $VAULT. Ejecuta setup_vault.sh primero."
  exit 1
fi

if [ -z "$QUERY" ]; then
  echo "📂 Listando todas las entradas del vault:"
  echo "========================================"
  RESULTS=$(find "$VAULT" -name "*.md" 2>/dev/null | grep -v "README.md" | grep -v "INDEX.md")
else
  echo "🔍 Buscando: \"$QUERY\""
  echo "========================================"
  RESULTS=$(grep -ril "$QUERY" "$VAULT" --include="*.md" 2>/dev/null | grep -v "README.md" | grep -v "INDEX.md" | grep -v "app.json" | grep -v "appearance.json")
fi

if [ -z "$RESULTS" ]; then
  if [ -z "$QUERY" ]; then
    echo "El vault está vacío — no hay entradas guardadas."
  else
    echo "No se encontraron entradas relacionadas con: $QUERY"
  fi
  exit 0
fi

COUNT=0
while IFS= read -r file; do
  TITLE=$(grep '^title:' "$file" | sed 's/title: //' | tr -d '"')
  TYPE=$(grep '^type:' "$file" | sed 's/type: //' | tr -d '"')
  DATE=$(grep '^date:' "$file" | sed 's/date: //' | tr -d '"')
  PROJECT=$(grep '^project:' "$file" | sed 's/project: //' | tr -d '"')
  echo "  [$TYPE] $DATE ($PROJECT) — $TITLE"
  echo "  📄 $file"
  echo ""
  COUNT=$((COUNT+1))
done <<< "$RESULTS"

echo "========================================"
echo "Total: $COUNT resultado(s)"
