/**
 * Embeddings via Ollama — búsqueda semántica opcional.
 *
 * Requiere: ollama pull nomic-embed-text
 * Endpoint:  http://localhost:11434/api/embeddings
 *
 * Si Ollama no está disponible o el modelo no existe, las funciones
 * devuelven null y el sistema cae al modo BM25.
 */

const OLLAMA_URL   = "http://localhost:11434";
const EMBED_MODEL  = "nomic-embed-text";
const TIMEOUT_MS   = 8_000;

// ── Cosine similarity ─────────────────────────────────────────────────────────

export function cosine(a: number[], b: number[]): number {
	let dot = 0, magA = 0, magB = 0;
	for (let i = 0; i < a.length; i++) {
		dot  += a[i] * b[i];
		magA += a[i] * a[i];
		magB += b[i] * b[i];
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB);
	return denom === 0 ? 0 : dot / denom;
}

// ── Ollama client ─────────────────────────────────────────────────────────────

async function fetchEmbedding(text: string, signal?: AbortSignal): Promise<number[] | null> {
	try {
		const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
			method:  "POST",
			headers: { "Content-Type": "application/json" },
			body:    JSON.stringify({ model: EMBED_MODEL, prompt: text }),
			signal,
		});
		if (!res.ok) return null;
		const data = await res.json() as { embedding?: number[] };
		return data.embedding ?? null;
	} catch {
		return null;
	}
}

export async function isAvailable(): Promise<boolean> {
	try {
		const controller = new AbortController();
		const id = setTimeout(() => controller.abort(), 3_000);
		const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
		clearTimeout(id);
		if (!res.ok) return false;
		const data = await res.json() as { models?: { name: string }[] };
		return (data.models ?? []).some((m) => m.name.startsWith("nomic-embed-text"));
	} catch {
		return false;
	}
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Calcula embeddings para un array de textos.
 * Devuelve null si Ollama no está disponible.
 */
export async function embedBatch(
	texts:  string[],
	signal?: AbortSignal,
): Promise<number[][] | null> {
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), TIMEOUT_MS * texts.length);
	const combined = signal
		? AbortSignal.any([signal, controller.signal])
		: controller.signal;

	try {
		const results = await Promise.all(texts.map((t) => fetchEmbedding(t, combined)));
		clearTimeout(id);
		if (results.some((r) => r === null)) return null;
		return results as number[][];
	} catch {
		clearTimeout(id);
		return null;
	}
}

export async function embedOne(text: string, signal?: AbortSignal): Promise<number[] | null> {
	const res = await embedBatch([text], signal);
	return res ? res[0] : null;
}
