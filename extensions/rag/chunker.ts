/**
 * Chunker — divide archivos en fragmentos para indexar.
 *
 * Estrategias:
 *   - Markdown: divide por headers (##, ###)
 *   - Código (.ts/.js/.py): divide por funciones/clases
 *   - Resto: divide por párrafos con overlap
 */

export interface Chunk {
	id: string;
	file: string;      // ruta relativa al source
	heading?: string;  // contexto (header de sección, nombre de función, etc.)
	text: string;
}

const MAX_CHUNK_CHARS = 1_200;
const OVERLAP_CHARS   = 150;

// ── Utilidades ────────────────────────────────────────────────────────────────

function makeId(file: string, index: number): string {
	return `${file}#${index}`;
}

function splitBySize(text: string, file: string, heading?: string, startIndex = 0): Chunk[] {
	const chunks: Chunk[] = [];
	let pos = 0;
	let index = startIndex;

	while (pos < text.length) {
		const end = Math.min(pos + MAX_CHUNK_CHARS, text.length);
		const slice = text.slice(pos, end).trim();
		if (slice.length > 40) {
			chunks.push({ id: makeId(file, index++), file, heading, text: slice });
		}
		if (end >= text.length) break;
		pos = end - OVERLAP_CHARS;
	}
	return chunks;
}

// ── Markdown ──────────────────────────────────────────────────────────────────

function chunkMarkdown(content: string, file: string): Chunk[] {
	const chunks: Chunk[] = [];
	const headerRe = /^#{1,3}\s+(.+)$/m;
	const sections = content.split(/(?=^#{1,3}\s)/m);

	let index = 0;
	for (const section of sections) {
		const match = section.match(headerRe);
		const heading = match ? match[1].trim() : undefined;
		const body = section.replace(/^#{1,3}\s+.+\n/, "").trim();
		if (!body) continue;

		for (const chunk of splitBySize(body, file, heading, index)) {
			chunks.push(chunk);
			index++;
		}
	}
	return chunks;
}

// ── Código (TS/JS/PY) ─────────────────────────────────────────────────────────

function chunkCode(content: string, file: string): Chunk[] {
	// Divide por bloques de funciones/clases/exports
	const blockRe = /(?=^(?:export\s+)?(?:async\s+)?(?:function|class|const\s+\w+\s*=|def\s+\w+|interface\s+\w+|type\s+\w+\s*=))/m;
	const blocks = content.split(blockRe);
	const chunks: Chunk[] = [];
	let index = 0;

	for (const block of blocks) {
		if (!block.trim()) continue;
		// Extraer nombre del bloque como heading
		const nameMatch = block.match(/(?:function|class|def|const|interface|type)\s+(\w+)/);
		const heading = nameMatch ? nameMatch[1] : undefined;

		for (const chunk of splitBySize(block.trim(), file, heading, index)) {
			chunks.push(chunk);
			index++;
		}
	}
	return chunks;
}

// ── Plain text / fallback ─────────────────────────────────────────────────────

function chunkPlainText(content: string, file: string): Chunk[] {
	// Divide por párrafos (líneas en blanco)
	const paragraphs = content.split(/\n{2,}/);
	const chunks: Chunk[] = [];
	let index = 0;
	let buffer = "";

	for (const para of paragraphs) {
		const trimmed = para.trim();
		if (!trimmed) continue;

		buffer = buffer ? `${buffer}\n\n${trimmed}` : trimmed;

		if (buffer.length >= MAX_CHUNK_CHARS) {
			chunks.push({ id: makeId(file, index++), file, text: buffer.slice(0, MAX_CHUNK_CHARS) });
			buffer = buffer.slice(MAX_CHUNK_CHARS - OVERLAP_CHARS);
		}
	}

	if (buffer.trim().length > 40) {
		chunks.push({ id: makeId(file, index++), file, text: buffer.trim() });
	}
	return chunks;
}

// ── Entrada principal ─────────────────────────────────────────────────────────

const CODE_EXTS = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".cpp", ".c"]);
const MD_EXTS   = new Set([".md", ".mdx"]);
const TEXT_EXTS = new Set([".txt", ".yaml", ".yml", ".toml", ".json"]);

export function chunkFile(content: string, file: string): Chunk[] {
	const ext = file.slice(file.lastIndexOf(".")).toLowerCase();

	if (MD_EXTS.has(ext))   return chunkMarkdown(content, file);
	if (CODE_EXTS.has(ext)) return chunkCode(content, file);
	if (TEXT_EXTS.has(ext)) return chunkPlainText(content, file);
	return chunkPlainText(content, file);
}

export const INDEXABLE_EXTS = new Set([...CODE_EXTS, ...MD_EXTS, ...TEXT_EXTS]);
