# RAG Extension para pi

Extensión de **Retrieval Augmented Generation** para [pi](https://shittycodingagent.ai). Indexa archivos locales y repositorios de GitHub, e inyecta automáticamente fragmentos relevantes en el contexto del agente antes de cada respuesta.

---

## Instalación

La extensión ya está en `~/.pi/agent/extensions/rag/`. Pi la carga automáticamente al iniciar.

Si tienes Ollama y quieres búsqueda semántica (opcional):

```bash
ollama pull nomic-embed-text
```

Sin Ollama, la extensión funciona con BM25 (búsqueda por keywords), sin dependencias extra.

---

## Comandos

| Comando | Descripción |
|---|---|
| `/rag index <ruta>` | Indexa un directorio o archivo local |
| `/rag index <url-github>` | Clona e indexa un repositorio de GitHub |
| `/rag status` | Muestra fuentes indexadas, nº de fragmentos y modo de búsqueda |
| `/rag search <query>` | Prueba una búsqueda manualmente |
| `/rag clear` | Borra el índice completo |
| `/rag toggle` | Activa o desactiva la inyección automática de contexto |

---

## Uso

### Indexar un proyecto local

```
/rag index ./mi-proyecto
/rag index /ruta/absoluta/al/proyecto
```

### Indexar un repositorio de GitHub

Se admiten varios formatos de URL:

```
/rag index https://github.com/usuario/repo
/rag index github.com/usuario/repo
/rag index https://github.com/usuario/repo.git
```

- La primera vez **clona** el repo con `--depth=1` (shallow clone).
- Las veces siguientes hace `git pull --ff-only` para actualizarlo.
- Los repos se guardan en `~/.pi/rag/repos/usuario--repo`.

### Ver el estado del índice

```
/rag status
```

Muestra algo como:

```
RAG Status

🔤 BM25 (keyword)
1842 fragmentos
Actualizado: 11/4/2026, 12:30:00
Inyección: ✅

Fuentes:
  • https://github.com/usuario/repo → ~/.pi/rag/repos/usuario--repo
  • /Users/yo/proyectos/mi-app
```

### Probar una búsqueda

```
/rag search cómo funciona el router
```

Muestra los fragmentos más relevantes con su puntuación y archivo de origen.

---

## Modos de búsqueda

### BM25 (por defecto)
- Búsqueda por keywords, sin dependencias externas.
- Rápido y funciona offline.

### Semántico (con Ollama)
- Usa embeddings de `nomic-embed-text` para buscar por significado, no solo por palabras clave.
- Se activa automáticamente si Ollama está disponible al indexar.
- Requiere tener Ollama corriendo localmente.

```bash
# Activar modo semántico
ollama pull nomic-embed-text
# Luego re-indexar
/rag index <ruta>
```

---

## Inyección automática de contexto

Antes de cada mensaje, la extensión busca fragmentos relevantes en el índice y los añade silenciosamente al contexto del agente. Esto permite que el modelo responda con conocimiento del proyecto sin que tengas que copiar y pegar código.

Para desactivar/activar esta inyección:

```
/rag toggle
```

El agente también puede buscar explícitamente en el índice usando la herramienta `search_knowledge`.

---

## Archivos indexados

Se indexan automáticamente los siguientes tipos de archivo:

| Categoría | Extensiones |
|---|---|
| Código | `.ts` `.js` `.tsx` `.jsx` `.py` `.go` `.rs` `.java` `.cpp` `.c` |
| Markdown | `.md` `.mdx` |
| Texto/Config | `.txt` `.yaml` `.yml` `.toml` `.json` |

Se ignoran: `node_modules`, `.git`, `dist`, `build`, `.next`, `__pycache__`, `.pi`.

---

## Cómo se divide el contenido (chunking)

| Tipo de archivo | Estrategia |
|---|---|
| Markdown | Divide por headers (`#`, `##`, `###`) |
| Código | Divide por funciones, clases y exports |
| Texto/Config | Divide por párrafos con overlap de 150 caracteres |

Cada fragmento tiene máximo **1.200 caracteres**. Se inyectan hasta **4 fragmentos** por consulta, con un límite total de **3.000 caracteres** de contexto.

---

## Almacenamiento

```
~/.pi/rag/
  ├── index.json        ← índice (chunks, BM25, embeddings, fuentes)
  └── repos/
      └── usuario--repo ← repos de GitHub clonados
```

---

## Estructura de la extensión

```
~/.pi/agent/extensions/rag/
  ├── index.ts       ← lógica principal, comandos y herramienta search_knowledge
  ├── chunker.ts     ← divide archivos en fragmentos
  ├── bm25.ts        ← motor de búsqueda por keywords
  ├── embeddings.ts  ← embeddings semánticos via Ollama
  └── README.md      ← esta documentación
```
