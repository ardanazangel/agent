/**
 * Protected Paths Extension
 *
 * Bloquea operaciones de escritura/edición en rutas sensibles.
 * Previene modificaciones accidentales a archivos críticos.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const protectedPaths = [
		".env",
		".env.local",
		".env.production",
		".env.staging",
		".git/",
		"node_modules/",
	];

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") {
			return undefined;
		}

		const path = event.input.path as string;
		const matched = protectedPaths.find((p) => path.includes(p));

		if (matched) {
			if (ctx.hasUI) {
				ctx.ui.notify(`🔒 Escritura bloqueada en ruta protegida: ${path}`, "warning");
			}
			return { block: true, reason: `La ruta "${path}" está protegida (coincide con "${matched}")` };
		}

		return undefined;
	});
}
