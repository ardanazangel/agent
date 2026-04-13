/**
 * Git Checkpoint Extension
 *
 * Crea stash checkpoints en cada turno para poder restaurar el código al hacer /fork.
 * Al hacer fork, ofrece restaurar el estado del código a ese punto del historial.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const checkpoints = new Map<string, string>();
	let currentEntryId: string | undefined;

	// Rastrear el entry ID actual cuando se guardan mensajes de herramientas
	pi.on("tool_result", async (_event, ctx) => {
		const leaf = ctx.sessionManager.getLeafEntry();
		if (leaf) currentEntryId = leaf.id;
	});

	pi.on("turn_start", async () => {
		// Crear un stash antes de que el LLM haga cambios
		const { stdout } = await pi.exec("git", ["stash", "create"]);
		const ref = stdout.trim();
		if (ref && currentEntryId) {
			checkpoints.set(currentEntryId, ref);
		}
	});

	pi.on("session_before_fork", async (event, ctx) => {
		const ref = checkpoints.get(event.entryId);
		if (!ref) return;

		if (!ctx.hasUI) return;

		const choice = await ctx.ui.select("¿Restaurar el estado del código?", [
			"Sí, restaurar código a ese punto",
			"No, mantener el código actual",
		]);

		if (choice?.startsWith("Sí")) {
			await pi.exec("git", ["stash", "apply", ref]);
			ctx.ui.notify("✅ Código restaurado al checkpoint", "info");
		}
	});

	pi.on("agent_end", async () => {
		// Limpiar checkpoints al finalizar el agente
		checkpoints.clear();
	});
}
