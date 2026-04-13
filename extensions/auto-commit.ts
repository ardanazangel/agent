/**
 * Auto-Commit Extension
 *
 * Detecta automáticamente cuando el agente completa una feature y ofrece hacer commit.
 * Analiza el último mensaje del asistente buscando señales de trabajo completado.
 *
 * Comandos:
 *   /commit              - Commit manual de los cambios actuales
 *   /autocommit          - Muestra el estado actual (on/off)
 *   /autocommit on|off   - Activa o desactiva la detección automática
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Patrones que sugieren que se completó algo significativo
const COMPLETION_PATTERNS = [
	// Español
	/\b(he implementado|he añadido|he creado|he desarrollado|he completado|he terminado|he agregado)\b/i,
	/\b(implementé|añadí|creé|desarrollé|completé|terminé|agregué)\b/i,
	/\b(la feature|la funcionalidad|el componente|el módulo|la extensión) (está|queda) (lista|listo|completa|completo|implementada|implementado)\b/i,
	/\b(listo|completado|terminado|implementado|funcionando)\b.*\b(feature|funcionalidad|componente|módulo)\b/i,
	/\bya (puedes|puede|podés)\b/i,
	// Inglés
	/\b(i('ve| have) (implemented|added|created|built|completed|finished))\b/i,
	/\b(the feature|the component|the module) is (ready|complete|done|working)\b/i,
	/\b(done|completed|finished|implemented|ready)\b/i,
];

// Patrones que sugieren trabajo parcial (evitar falsos positivos)
const PARTIAL_PATTERNS = [
	/\b(falta|faltan|pendiente|pendientes|todavía|aún|next step|still need|TODO|FIXME)\b/i,
	/\b(paso \d|step \d)\b/i,
	/\b(primero|luego|después|a continuación)\b/i,
];

function detectFeatureCompletion(text: string): boolean {
	if (!text || text.length < 20) return false;

	const hasCompletion = COMPLETION_PATTERNS.some((p) => p.test(text));
	if (!hasCompletion) return false;

	const hasPartial = PARTIAL_PATTERNS.some((p) => p.test(text));
	return !hasPartial;
}

function extractCommitMessage(text: string): string {
	// Buscar la primera oración que mencione qué se hizo
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 10 && l.length < 200);

	// Priorizar líneas con verbos de acción
	const actionLine = lines.find((l) =>
		/\b(implementé|añadí|creé|agregué|implemented|added|created|built|feat|fix|add)\b/i.test(l),
	);

	const candidate = actionLine || lines[0] || "feat: cambios del agente";

	// Limpiar markdown y truncar
	const clean = candidate
		.replace(/^[#*\->`]+\s*/g, "")
		.replace(/\*\*(.*?)\*\*/g, "$1")
		.replace(/`(.*?)`/g, "$1")
		.trim();

	const message = clean.length > 72 ? clean.slice(0, 69) + "..." : clean;
	return `[pi] ${message}`;
}

async function getGitChanges(pi: ExtensionAPI): Promise<{ hasChanges: boolean; summary: string }> {
	const { stdout: status, code } = await pi.exec("git", ["status", "--porcelain"]);
	if (code !== 0 || status.trim().length === 0) {
		return { hasChanges: false, summary: "" };
	}

	const lines = status.trim().split("\n");
	const added = lines.filter((l) => l.startsWith("A") || l.startsWith("??")).length;
	const modified = lines.filter((l) => l.startsWith("M") || l.startsWith(" M")).length;
	const deleted = lines.filter((l) => l.startsWith("D")).length;

	const parts = [];
	if (added > 0) parts.push(`+${added} nuevos`);
	if (modified > 0) parts.push(`~${modified} modificados`);
	if (deleted > 0) parts.push(`-${deleted} eliminados`);

	return { hasChanges: true, summary: parts.join(", ") };
}

async function performCommit(
	pi: ExtensionAPI,
	message: string,
): Promise<{ success: boolean; error?: string }> {
	const { code: addCode } = await pi.exec("git", ["add", "-A"]);
	if (addCode !== 0) return { success: false, error: "git add falló" };

	const { code: commitCode, stderr } = await pi.exec("git", ["commit", "-m", message]);
	if (commitCode !== 0) return { success: false, error: stderr.trim() };

	return { success: true };
}

export default function (pi: ExtensionAPI) {
	let enabled = true;

	// ── Comando /autocommit ──────────────────────────────────────────────
	pi.registerCommand("autocommit", {
		description: "Activa/desactiva la detección automática. Uso: /autocommit [on|off]",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") {
				enabled = true;
				ctx.ui.notify("Auto-commit activado", "info");
			} else if (arg === "off") {
				enabled = false;
				ctx.ui.notify("Auto-commit desactivado", "info");
			} else {
				ctx.ui.notify(`Auto-commit está ${enabled ? "✅ activado" : "❌ desactivado"}`, "info");
			}
		},
	});

	// ── Comando /commit (manual) ─────────────────────────────────────────
	pi.registerCommand("commit", {
		description: "Commit manual de los cambios actuales",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			const { hasChanges, summary } = await getGitChanges(pi);
			if (!hasChanges) {
				ctx.ui.notify("No hay cambios para commitear", "info");
				return;
			}

			// Mensaje: usa el argumento si se pasó, si no genera uno
			let message = args.trim();
			if (!message) {
				const entries = ctx.sessionManager.getEntries();
				for (let i = entries.length - 1; i >= 0; i--) {
					const entry = entries[i];
					if (entry.type === "message" && entry.message.role === "assistant") {
						const content = entry.message.content;
						if (Array.isArray(content)) {
							const text = content
								.filter((c): c is { type: "text"; text: string } => c.type === "text")
								.map((c) => c.text)
								.join("\n");
							message = extractCommitMessage(text);
						}
						break;
					}
				}
				message = message || "[pi] cambios manuales";
			}

			const confirmed = await ctx.ui.confirm(
				"Confirmar commit",
				`${summary}\n\nMensaje: "${message}"`,
			);
			if (!confirmed) return;

			const result = await performCommit(pi, message);
			if (result.success) {
				ctx.ui.notify(`✅ Commit realizado: ${message}`, "info");
			} else {
				ctx.ui.notify(`❌ Error: ${result.error}`, "error");
			}
		},
	});

	// ── Detección automática al final de cada turno ──────────────────────
	pi.on("agent_end", async (event, ctx) => {
		if (!enabled || !ctx.hasUI) return;

		const { hasChanges, summary } = await getGitChanges(pi);
		if (!hasChanges) return;

		// Obtener el texto del último mensaje del asistente
		const messages = event.messages;
		let lastAssistantText = "";
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				const content = msg.content;
				if (Array.isArray(content)) {
					lastAssistantText = content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n");
				}
				break;
			}
		}

		if (!detectFeatureCompletion(lastAssistantText)) return;

		const message = extractCommitMessage(lastAssistantText);

		const confirmed = await ctx.ui.confirm(
			"🎯 Feature detectada — ¿hacer commit?",
			`${summary}\n\nMensaje: "${message}"`,
		);
		if (!confirmed) return;

		const result = await performCommit(pi, message);
		if (result.success) {
			ctx.ui.notify(`✅ Commit: ${message}`, "info");
		} else {
			ctx.ui.notify(`❌ Error al commitear: ${result.error}`, "error");
		}
	});
}
