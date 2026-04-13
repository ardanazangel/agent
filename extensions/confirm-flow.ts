/**
 * Confirm Flow Extension
 *
 * Flujos de confirmación para las acciones más importantes del agente.
 *
 * Funcionalidades:
 *   1. Confirmar escritura a disco (write/edit)
 *   2. Protección de sesión (/new, /resume, /fork con confirm)
 *   3. Comando /run: ejecuta bash con editor previo para editar el comando
 *
 * Comandos:
 *   /confirm-flow          - Ver estado de cada módulo
 *   /confirm-flow writes   - Toggle confirmación de escritura
 *   /confirm-flow session  - Toggle protección de sesión
 *   /run [cmd]             - Abre editor para revisar/editar un comando antes de ejecutarlo
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

// ── Timeouts ─────────────────────────────────────────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────
function shortPath(fullPath: string, cwd: string): string {
	if (fullPath.startsWith(cwd)) return fullPath.slice(cwd.length).replace(/^\//, "");
	const home = process.env.HOME ?? "";
	if (home && fullPath.startsWith(home)) return "~" + fullPath.slice(home.length);
	return fullPath;
}

export default function (pi: ExtensionAPI) {
	// ── Estado ────────────────────────────────────────────────────────────────
	let writesEnabled = true;
	let sessionEnabled = true;

	// ── Comando /confirm-flow ─────────────────────────────────────────────────
	pi.registerCommand("confirm-flow", {
		description: "Ver/toggle los módulos de confirmación. Uso: /confirm-flow [writes|actions|session]",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "writes") {
				writesEnabled = !writesEnabled;
				ctx.ui.notify(`Confirmación de escritura: ${writesEnabled ? "✅ activada" : "❌ desactivada"}`, "info");
			} else if (arg === "session") {
				sessionEnabled = !sessionEnabled;
				ctx.ui.notify(`Protección de sesión: ${sessionEnabled ? "✅ activada" : "❌ desactivada"}`, "info");
			} else {
				const status = [
					`escritura ${writesEnabled ? "✅" : "❌"}  /confirm-flow writes`,
					`sesión    ${sessionEnabled ? "✅" : "❌"}  /confirm-flow session`,
				].join("\n");
				ctx.ui.notify(`Confirm Flow\n\n${status}`, "info");
			}
		},
	});

	// ── 1. Confirmación de escritura a disco ──────────────────────────────────
	//    Intercepta write y edit antes de ejecutarse,.
	pi.on("tool_call", async (event, ctx) => {
		if (!writesEnabled || !ctx.hasUI) return;

		if (isToolCallEventType("write", event)) {
			const path = shortPath(event.input.path, ctx.cwd);
			const lines = event.input.content.split("\n").length;
			const confirmed = await ctx.ui.confirm(
				"✏️  Escribir archivo",
				`${path}\n${lines} líneas — ¿continuar?`,
			);
			if (!confirmed) return { block: true, reason: `Escritura cancelada: ${path}` };
		}

		if (isToolCallEventType("edit", event)) {
			const path = shortPath(event.input.path, ctx.cwd);
			const edits = Array.isArray(event.input.edits) ? event.input.edits.length : 1;
			const confirmed = await ctx.ui.confirm(
				"✏️  Editar archivo",
				`${path}\n${edits} ${edits === 1 ? "cambio" : "cambios"} — ¿continuar?`,
			);
			if (!confirmed) return { block: true, reason: `Edición cancelada: ${path}` };
		}
	});

	// ── 2. Protección de sesión ───────────────────────────────────────────────
	//    Confirm antes de /new, /resume y /fork.

	pi.on("session_before_switch", async (event, ctx) => {
		if (!sessionEnabled || !ctx.hasUI) return;

		if (event.reason === "new") {
			const confirmed = await ctx.ui.confirm(
				"🗑️  Nueva sesión",
				"Se perderá el contexto actual. ¿Continuar?",
			);
			if (!confirmed) {
				ctx.ui.notify("Nueva sesión cancelada", "info");
				return { cancel: true };
			}
		}

		if (event.reason === "resume") {
			const target = event.targetSessionFile
				? event.targetSessionFile.split("/").pop()
				: "otra sesión";
			const confirmed = await ctx.ui.confirm(
				"🔀  Cambiar sesión",
				`Cambiar a: ${target}\n¿Continuar?`,
			);
			if (!confirmed) {
				ctx.ui.notify("Cambio de sesión cancelado", "info");
				return { cancel: true };
			}
		}
	});

	pi.on("session_before_fork", async (event, ctx) => {
		if (!sessionEnabled || !ctx.hasUI) return;

		const id = event.entryId.slice(0, 8);
		const choice = await ctx.ui.select(
			`🍴 Fork desde ${id}`,
			["Sí, crear fork", "No, quedarme aquí"],
		);

		if (choice !== "Sí, crear fork") {
			ctx.ui.notify("Fork cancelado", "info");
			return { cancel: true };
		}
	});

	// ── 3. Comando /run ───────────────────────────────────────────────────────
	//    Abre un editor con el comando prellenado para revisarlo/editarlo antes de ejecutar.
	pi.registerCommand("run", {
		description: "Edita y ejecuta un comando bash. Uso: /run [comando]",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			const initial = args.trim() || "";
			const cmd = await ctx.ui.editor("Comando a ejecutar:", initial);

			if (!cmd?.trim()) {
				ctx.ui.notify("Comando vacío, cancelado", "info");
				return;
			}

			const confirmed = await ctx.ui.confirm(
				"⚡ Ejecutar comando",
				`$ ${cmd.trim()}`,
			);

			if (!confirmed) {
				ctx.ui.notify("Ejecución cancelada", "info");
				return;
			}

			pi.sendUserMessage(`Ejecuta este comando bash exactamente: \`${cmd.trim()}\``);
		},
	});
}
