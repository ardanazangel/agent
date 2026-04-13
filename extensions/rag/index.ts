/**
 * RAG Extension — Retrieval Augmented Generation
 *
 * Indexa archivos locales y enriquece el contexto del agente con fragmentos relevantes.
 *
 * Modos de búsqueda:
 *   - BM25 (por defecto)   — keyword search, sin dependencias extra
 *   - Semántico (opcional) — cosine similarity via Ollama nomic-embed-text
 *                            Activa con: ollama pull nomic-embed-text
 *
 * Comandos:
 *   /rag index <ruta|url> — Indexa un directorio, archivo o repo de GitHub
 *   /rag status         — Muestra qué está indexado y el modo de búsqueda
 *   /rag search <query> — Prueba una búsqueda manualmente
 *   /rag clear          — Borra el índice
 *   /rag toggle         — Activa/desactiva la inyección automática
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { join, extname, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import { chunkFile, INDEXABLE_EXTS, type Chunk } from "./chunker.js";
import { buildIndex, search, type BM25Index } from "./bm25.js";
import { embedBatch, embedOne, cosine, isAvailable as ollamaAvailable } from "./embeddings.js";

// ── Config ────────────────────────────────────────────────────────────────────

const INDEX_DIR  = join(process.env.HOME ?? "~", ".pi", "rag");
const INDEX_FILE = join(INDEX_DIR, "index.json");
const REPOS_DIR  = join(INDEX_DIR, "repos");
const TOP_K      = 4;
const MAX_INJECT_CHARS = 3_000;
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".pi"]);

// ── Tipos de índice ───────────────────────────────────────────────────────────

interface StoredIndex {
	chunks:       Chunk[];
	bm25:         BM25Index;
	embeddings:   Record<string, number[]>; // chunk.id → vector
	sources:      string[];
	githubSources: Record<string, string>;  // localPath → githubUrl
	indexedAt:    number;
	useEmbeds:    boolean;
}

// ── Estado en memoria ─────────────────────────────────────────────────────────

let idx: StoredIndex | null = null;
let injectEnabled = true;

// ── Persistencia ──────────────────────────────────────────────────────────────

async function loadIndex(): Promise<StoredIndex | null> {
	try {
		if (!existsSync(INDEX_FILE)) return null;
		const raw = await readFile(INDEX_FILE, "utf8");
		const parsed = JSON.parse(raw) as StoredIndex;
		// compatibilidad con índices anteriores sin githubSources
		parsed.githubSources ??= {};
		return parsed;
	} catch {
		return null;
	}
}

async function saveIndex(data: StoredIndex): Promise<void> {
	await mkdir(INDEX_DIR, { recursive: true });
	await writeFile(INDEX_FILE, JSON.stringify(data), "utf8");
}

// ── GitHub helpers ───────────────────────────────────────────────────────────

function isGithubUrl(arg: string): boolean {
	return /^https?:\/\/(www\.)?github\.com\/.+\/.+/.test(arg) || /^github\.com\/.+\/.+/.test(arg);
}

function normalizeGithubUrl(arg: string): string {
	const url = arg.startsWith("http") ? arg : `https://${arg}`;
	return url.replace(/\.git$/, "");
}

function repoNameFromUrl(url: string): string {
	const parts = url.replace(/\.git$/, "").split("/");
	return parts.slice(-2).join("--");
}

async function cloneOrUpdateRepo(
	url: string,
	signal?: AbortSignal,
	onProgress?: (msg: string) => void,
): Promise<string> {
	const normalized = normalizeGithubUrl(url);
	const name = repoNameFromUrl(normalized);
	const dest = join(REPOS_DIR, name);

	await mkdir(REPOS_DIR, { recursive: true });

	if (existsSync(dest)) {
		onProgress?.(`🔄 Repo ya clonado, actualizando ${name}...`);
		await execFileAsync("git", ["-C", dest, "pull", "--ff-only"], { signal } as any);
	} else {
		onProgress?.(`📥 Clonando ${normalized}...`);
		await execFileAsync("git", ["clone", "--depth=1", normalized, dest], { signal } as any);
	}

	return dest;
}

// ── Fetch de URLs ────────────────────────────────────────────────────────────

function isWebUrl(arg: string): boolean {
	return /^https?:\/\/.+/.test(arg);
}

function extractTextFromHtml(html: string): string {
	// Eliminar scripts, styles y tags — dejar texto plano
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

async function fetchUrl(
	url: string,
	signal?: AbortSignal,
): Promise<{ content: string; label: string }> {
	const res = await fetch(url, {
		signal,
		headers: { "User-Agent": "Mozilla/5.0 (compatible; RAG-indexer/1.0)" },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} al obtener ${url}`);

	const contentType = res.headers.get("content-type") ?? "";
	const raw = await res.text();

	const isHtml = contentType.includes("html") || raw.trimStart().startsWith("<!");
	const content = isHtml ? extractTextFromHtml(raw) : raw;

	// Label corto para el chunk (hostname + path)
	const u = new URL(url);
	const label = `${u.hostname}${u.pathname}`.replace(/\/+$/, "") || u.hostname;

	return { content, label };
}

async function buildRAGIndexFromUrl(
	url: string,
	signal?: AbortSignal,
	onProgress?: (msg: string) => void,
): Promise<StoredIndex> {
	onProgress?.("🌐 Descargando URL...");
	const { content, label } = await fetchUrl(url, signal);

	onProgress?.("✂️ Dividiendo en fragmentos...");
	const chunks = chunkFile(content, label);

	onProgress?.(`🔤 ${chunks.length} fragmentos — construyendo índice BM25...`);
	const bm25 = buildIndex(chunks);

	const canEmbed = await ollamaAvailable();
	const embedsMap: Record<string, number[]> = {};

	if (canEmbed && !signal?.aborted) {
		onProgress?.("🧠 Calculando embeddings semánticos...");
		const BATCH = 20;
		for (let i = 0; i < chunks.length; i += BATCH) {
			if (signal?.aborted) break;
			const batch = chunks.slice(i, i + BATCH);
			const texts = batch.map((c) => (c.heading ? `${c.heading}: ${c.text}` : c.text));
			const vecs  = await embedBatch(texts, signal);
			if (vecs) {
				for (let j = 0; j < batch.length; j++) embedsMap[batch[j].id] = vecs[j];
			}
		}
	}

	// Preservar fuentes previas que no sean esta URL
	const prevChunks = idx?.chunks.filter((c) => !c.file.startsWith(new URL(url).hostname)) ?? [];
	const allChunks  = [...prevChunks, ...chunks];
	const prevSources = idx?.sources.filter((s) => s !== url) ?? [];

	return {
		chunks:        allChunks,
		bm25:          buildIndex(allChunks),
		embeddings:    { ...(idx?.embeddings ?? {}), ...embedsMap },
		sources:       [...prevSources, url],
		githubSources: idx?.githubSources ?? {},
		indexedAt:     Date.now(),
		useEmbeds:     Object.keys({ ...(idx?.embeddings ?? {}), ...embedsMap }).length > 0,
	};
}

// ── Auto-formateo ────────────────────────────────────────────────────────────

const FORMATTABLE_EXTS = new Set([".js", ".ts", ".jsx", ".tsx", ".css", ".json", ".html"]);

function isMinified(content: string): boolean {
	const lines = content.split("\n");
	if (lines.length === 0) return false;
	const avgLen = content.length / lines.length;
	const maxLen = Math.max(...lines.map((l) => l.length));
	// Minificado si: pocas líneas y líneas muy largas
	return maxLen > 500 || (lines.length < 5 && content.length > 500);
}

async function formatContent(content: string, filePath: string): Promise<string> {
	const ext = extname(filePath).toLowerCase();
	if (!FORMATTABLE_EXTS.has(ext)) return content;
	if (!isMinified(content)) return content;

	try {
		const { stdout } = await execFileAsync(
			"npx",
			["--yes", "prettier", "--stdin-filepath", `file${ext}`],
			{ input: content, timeout: 10_000 } as any,
		);
		return stdout || content;
	} catch {
		// prettier no disponible o error — devolver original
		return content;
	}
}

// ── Indexación ────────────────────────────────────────────────────────────────

async function collectFiles(root: string): Promise<string[]> {
	const files: string[] = [];

	async function walk(dir: string) {
		let entries;
		try { entries = await readdir(dir, { withFileTypes: true }); }
		catch { return; }

		for (const entry of entries) {
			if (IGNORE_DIRS.has(entry.name)) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
			} else if (entry.isFile()) {
				const ext = extname(entry.name).toLowerCase();
				if (INDEXABLE_EXTS.has(ext)) files.push(full);
			}
		}
	}

	const s = await stat(root);
	if (s.isFile()) {
		files.push(root);
	} else {
		await walk(root);
	}
	return files;
}

async function buildRAGIndex(
	source: string,
	signal?: AbortSignal,
	onProgress?: (msg: string) => void,
): Promise<StoredIndex> {
	const absSource = resolve(source);
	const files     = await collectFiles(absSource);
	const allChunks: Chunk[] = [];

	onProgress?.(`📂 ${files.length} archivos encontrados...`);

	for (const file of files) {
		if (signal?.aborted) break;
		try {
			let content   = await readFile(file, "utf8");
			content       = await formatContent(content, file);
			const rel     = relative(absSource, file);
			const chunks  = chunkFile(content, rel);
			allChunks.push(...chunks);
		} catch { /* skip unreadable */ }
	}

	onProgress?.(`🔤 ${allChunks.length} fragmentos — construyendo índice BM25...`);
	const bm25 = buildIndex(allChunks);

	// Intentar embeddings semánticos
	const canEmbed = await ollamaAvailable();
	const embedsMap: Record<string, number[]> = {};

	if (canEmbed && !signal?.aborted) {
		onProgress?.("🧠 Calculando embeddings semánticos (Ollama)...");
		const BATCH = 20;
		for (let i = 0; i < allChunks.length; i += BATCH) {
			if (signal?.aborted) break;
			const batch  = allChunks.slice(i, i + BATCH);
			const texts  = batch.map((c) => (c.heading ? `${c.heading}: ${c.text}` : c.text));
			const vecs   = await embedBatch(texts, signal);
			if (vecs) {
				for (let j = 0; j < batch.length; j++) {
					embedsMap[batch[j].id] = vecs[j];
				}
			}
			onProgress?.(`🧠 Embeddings: ${Math.min(i + BATCH, allChunks.length)}/${allChunks.length}`);
		}
	}

	// Fuentes: preservar las que ya estaban si no se solapan
	const prevSources = idx?.sources.filter((s) => !s.startsWith(absSource)) ?? [];
	const prevGithub  = Object.fromEntries(
		Object.entries(idx?.githubSources ?? {}).filter(([k]) => !k.startsWith(absSource))
	);

	return {
		chunks:       allChunks,
		bm25,
		embeddings:   embedsMap,
		sources:      [...prevSources, absSource],
		githubSources: prevGithub,
		indexedAt:    Date.now(),
		useEmbeds:    Object.keys(embedsMap).length > 0,
	};
}

// ── Búsqueda ──────────────────────────────────────────────────────────────────

interface Hit {
	chunk: Chunk;
	score: number;
}

async function queryIndex(query: string, signal?: AbortSignal): Promise<Hit[]> {
	if (!idx) return [];

	// Modo semántico
	if (idx.useEmbeds) {
		const qVec = await embedOne(query, signal);
		if (qVec) {
			return idx.chunks
				.map((c) => ({
					chunk: c,
					score: idx!.embeddings[c.id] ? cosine(qVec, idx!.embeddings[c.id]) : 0,
				}))
				.filter((r) => r.score > 0.3)
				.sort((a, b) => b.score - a.score)
				.slice(0, TOP_K);
		}
	}

	// Fallback BM25
	return search(query, idx.chunks, idx.bm25, TOP_K);
}

// ── Formato de inyección ──────────────────────────────────────────────────────

function formatHits(hits: Hit[], query: string): string {
	if (hits.length === 0) return "";

	const mode = idx?.useEmbeds ? "semántico" : "BM25";
	const lines = [`[RAG — búsqueda ${mode} para: "${query}"]\n`];

	let total = 0;
	for (const { chunk } of hits) {
		const header = chunk.heading
			? `### ${chunk.file} › ${chunk.heading}\n`
			: `### ${chunk.file}\n`;
		const entry = `${header}${chunk.text}\n`;
		if (total + entry.length > MAX_INJECT_CHARS) break;
		lines.push(entry);
		total += entry.length;
	}

	return lines.join("\n");
}

// ── Extensión ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

	// Cargar índice al iniciar + auto-indexar config propia
	pi.on("session_start", async () => {
		idx = await loadIndex();

		const AGENT_DIR = join(process.env.HOME ?? "~", ".pi", "agent");
		const selfSources = [
			join(AGENT_DIR, "SYSTEM.md"),
			join(AGENT_DIR, "extensions"),
		].filter(existsSync);

		// Solo re-indexar si alguna fuente propia no está en el índice
		const alreadyIndexed = selfSources.every((s) => idx?.sources.includes(s));
		if (alreadyIndexed || selfSources.length === 0) return;

		try {
			for (const source of selfSources) {
				const partial = await buildRAGIndex(source, undefined, undefined);
				if (!idx) {
					idx = partial;
				} else {
					// Acumular chunks, fuentes y embeddings
					idx.chunks = [...idx.chunks, ...partial.chunks];
					idx.bm25 = buildIndex(idx.chunks);
					idx.embeddings = { ...idx.embeddings, ...partial.embeddings };
					idx.sources = [...new Set([...idx.sources, ...partial.sources])];
					idx.useEmbeds = Object.keys(idx.embeddings).length > 0;
				}
			}
			await saveIndex(idx!);
		} catch {
			// silencioso — no bloquear el arranque
		}
	});

	// ── Inyección automática de contexto ──────────────────────────────────────
	pi.on("before_agent_start", async (event) => {
		if (!injectEnabled || !idx || !event.prompt.trim()) return;

		const hits = await queryIndex(event.prompt);
		if (hits.length === 0) return;

		const content = formatHits(hits, event.prompt);
		if (!content) return;

		return {
			message: {
				customType: "rag-context",
				content,
				display: false, // silencioso, no aparece en el chat
			},
		};
	});

	// ── Herramienta para búsqueda explícita por el LLM ────────────────────────
	pi.registerTool({
		name: "search_knowledge",
		label: "Search Knowledge",
		description:
			"Busca en la base de conocimiento indexada con RAG. Devuelve fragmentos relevantes de archivos del proyecto.",
		promptSnippet: "Search indexed project files and documents for relevant context",
		parameters: Type.Object({
			query: Type.String({ description: "Qué buscar en la base de conocimiento" }),
		}),
		async execute(_id, params, signal) {
			if (!idx) {
				return {
					content: [{ type: "text", text: "No hay índice RAG. Usa /rag index <ruta> para indexar." }],
					details: { hits: [] },
				};
			}

			const hits = await queryIndex(params.query, signal);
			if (hits.length === 0) {
				return {
					content: [{ type: "text", text: `Sin resultados para: "${params.query}"` }],
					details: { hits: [] },
				};
			}

			const text = formatHits(hits, params.query);
			return {
				content: [{ type: "text", text }],
				details: { hits: hits.map((h) => ({ file: h.chunk.file, score: h.score })) },
			};
		},
	});

	// ── /rag index ────────────────────────────────────────────────────────────
	pi.registerCommand("rag", {
		description: "Gestiona el índice RAG. Subcomandos: index <ruta>, status, search <query>, clear, toggle",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const [sub, ...rest] = args.trim().split(/\s+/);
			const arg = rest.join(" ").trim();

			// ── index ──
			if (sub === "index") {
				if (!arg) {
					ctx.ui.notify("Uso: /rag index <ruta|url-github>", "error");
					return;
				}

				let source: string;
				let githubUrl: string | undefined;

				if (isGithubUrl(arg)) {
					// ── GitHub repo ──
					ctx.ui.setStatus("rag", "📥 preparando repo...");
					try {
						githubUrl = normalizeGithubUrl(arg);
						source = await cloneOrUpdateRepo(arg, ctx.signal, (msg) => {
							ctx.ui.setStatus("rag", msg);
						});
					} catch (e: unknown) {
						ctx.ui.notify(`❌ Error clonando repo: ${(e as Error).message}`, "error");
						ctx.ui.setStatus("rag", undefined);
						return;
					}

					ctx.ui.notify(`Indexando ${githubUrl}...`, "info");
					ctx.ui.setStatus("rag", "⏳ indexando...");

					try {
						idx = await buildRAGIndex(source, ctx.signal, (msg) => {
							ctx.ui.setStatus("rag", msg);
						});
						idx.githubSources[source] = githubUrl;
						await saveIndex(idx);
						const mode = idx.useEmbeds ? "semántico (Ollama)" : "BM25";
						ctx.ui.notify(`✅ Indexados ${idx.chunks.length} fragmentos\nModo: ${mode}`, "info");
					} catch (e: unknown) {
						ctx.ui.notify(`❌ Error: ${(e as Error).message}`, "error");
					} finally {
						ctx.ui.setStatus("rag", undefined);
					}

				} else if (isWebUrl(arg)) {
					// ── URL genérica ──
					ctx.ui.notify(`Indexando URL: ${arg}...`, "info");
					ctx.ui.setStatus("rag", "🌐 descargando...");

					try {
						idx = await buildRAGIndexFromUrl(arg, ctx.signal, (msg) => {
							ctx.ui.setStatus("rag", msg);
						});
						await saveIndex(idx);
						const mode = idx.useEmbeds ? "semántico (Ollama)" : "BM25";
						ctx.ui.notify(`✅ Indexados ${idx.chunks.length} fragmentos de ${arg}\nModo: ${mode}`, "info");
					} catch (e: unknown) {
						ctx.ui.notify(`❌ Error: ${(e as Error).message}`, "error");
					} finally {
						ctx.ui.setStatus("rag", undefined);
					}

				} else {
					// ── Ruta local ──
					source = resolve(ctx.cwd, arg);
					if (!existsSync(source)) {
						ctx.ui.notify(`No encontrado: ${source}`, "error");
						return;
					}

					ctx.ui.notify(`Indexando ${source}...`, "info");
					ctx.ui.setStatus("rag", "⏳ indexando...");

					try {
						idx = await buildRAGIndex(source, ctx.signal, (msg) => {
							ctx.ui.setStatus("rag", msg);
						});
						await saveIndex(idx);
						const mode = idx.useEmbeds ? "semántico (Ollama)" : "BM25";
						ctx.ui.notify(`✅ Indexados ${idx.chunks.length} fragmentos\nModo: ${mode}`, "info");
					} catch (e: unknown) {
						ctx.ui.notify(`❌ Error: ${(e as Error).message}`, "error");
					} finally {
						ctx.ui.setStatus("rag", undefined);
					}
				}
				return;
			}

			// ── status ──
			if (sub === "status" || !sub) {
				if (!idx) {
					ctx.ui.notify("Sin índice. Usa /rag index <ruta>", "info");
					return;
				}
				const date  = new Date(idx.indexedAt).toLocaleString();
				const mode  = idx.useEmbeds ? "🧠 semántico (Ollama)" : "🔤 BM25 (keyword)";
				const sources = idx.sources.map((s) => {
					const gh = idx!.githubSources?.[s];
					return gh ? `  • ${gh} → ${s}` : `  • ${s}`;
				}).join("\n");
				ctx.ui.notify(
					`RAG Status\n\n${mode}\n${idx.chunks.length} fragmentos\nActualizado: ${date}\nInyección: ${injectEnabled ? "✅" : "❌"}\n\nFuentes:\n${sources}`,
					"info",
				);
				return;
			}

			// ── search ──
			if (sub === "search") {
				if (!arg) { ctx.ui.notify("Uso: /rag search <query>", "error"); return; }
				if (!idx)  { ctx.ui.notify("Sin índice. Usa /rag index <ruta>", "error"); return; }

				ctx.ui.setStatus("rag", "🔍 buscando...");
				const hits = await queryIndex(arg, ctx.signal);
				ctx.ui.setStatus("rag", undefined);

				if (hits.length === 0) {
					ctx.ui.notify(`Sin resultados para: "${arg}"`, "info");
					return;
				}

				const lines = hits.map(
					(h, i) =>
						`${i + 1}. [${h.score.toFixed(3)}] ${h.chunk.file}${h.chunk.heading ? ` › ${h.chunk.heading}` : ""}\n   ${h.chunk.text.slice(0, 120).replace(/\n/g, " ")}...`,
				);
				ctx.ui.notify(`Resultados para "${arg}":\n\n${lines.join("\n\n")}`, "info");
				return;
			}

			// ── clear ──
			if (sub === "clear") {
				const ok = await ctx.ui.confirm("Borrar índice RAG", "¿Eliminar todos los datos indexados?");
				if (!ok) return;
				idx = null;
				try { await writeFile(INDEX_FILE, "{}", "utf8"); } catch { /* ok */ }
				ctx.ui.notify("Índice borrado", "info");
				return;
			}

			// ── toggle ──
			if (sub === "toggle") {
				injectEnabled = !injectEnabled;
				ctx.ui.notify(`Inyección automática: ${injectEnabled ? "✅ activada" : "❌ desactivada"}`, "info");
				return;
			}

			ctx.ui.notify("Subcomandos: index <ruta> | status | search <query> | clear | toggle", "info");
		},
	});
}
