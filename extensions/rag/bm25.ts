/**
 * BM25 — motor de búsqueda sin dependencias externas.
 *
 * Parámetros estándar Robertson:
 *   k1 = 1.5  (saturación de frecuencia de término)
 *   b  = 0.75 (normalización por longitud de documento)
 */

import type { Chunk } from "./chunker.js";

const K1 = 1.5;
const B  = 0.75;

// Stopwords ES + EN
const STOPWORDS = new Set([
	"the","a","an","and","or","but","in","on","at","to","for","of","with","by","from",
	"is","are","was","were","be","been","have","has","had","do","does","did","will",
	"would","could","should","may","might","that","this","these","those","it","its",
	"el","la","los","las","un","una","de","en","y","que","se","es","por","con","para",
	"como","más","pero","su","sus","al","del","lo","le","me","te","nos","mi","si","ya",
	"no","not","i","we","you","he","she","they","me","him","her","us","them",
]);

export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9áéíóúüñ\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export interface BM25Index {
	df:    Record<string, number>;  // document frequency por término
	avgDL: number;                  // longitud media de documento
}

export function buildIndex(chunks: Chunk[]): BM25Index {
	const df: Record<string, number> = {};
	let totalLen = 0;

	for (const chunk of chunks) {
		const terms = new Set(tokenize(chunk.text));
		totalLen += terms.size;
		for (const term of terms) {
			df[term] = (df[term] ?? 0) + 1;
		}
	}

	return { df, avgDL: chunks.length > 0 ? totalLen / chunks.length : 1 };
}

export function score(
	query: string,
	chunk: Chunk,
	index: BM25Index,
	N: number,
): number {
	const queryTerms = tokenize(query);
	const docTerms   = tokenize(chunk.text);
	const dl         = docTerms.length;

	// Term frequency map para este chunk
	const tf: Record<string, number> = {};
	for (const t of docTerms) tf[t] = (tf[t] ?? 0) + 1;

	let s = 0;
	for (const term of queryTerms) {
		const freq = tf[term] ?? 0;
		if (freq === 0) continue;

		const df  = index.df[term] ?? 0;
		const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
		const tf_ = (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (dl / index.avgDL)));
		s += idf * tf_;
	}
	return s;
}

export interface SearchResult {
	chunk:  Chunk;
	score:  number;
}

export function search(
	query:  string,
	chunks: Chunk[],
	index:  BM25Index,
	topK:   number,
): SearchResult[] {
	const N = chunks.length;
	return chunks
		.map((c) => ({ chunk: c, score: score(query, c, index, N) }))
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}
