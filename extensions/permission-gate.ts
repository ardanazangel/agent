/**
 * Permission Gate Extension
 *
 * Pide confirmación antes de ejecutar comandos bash potencialmente peligrosos.
 * Patrones verificados: rm -rf, sudo, chmod/chown 777
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const dangerousPatterns = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i];

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;
		const isDangerous = dangerousPatterns.some((p) => p.test(command));

		if (isDangerous) {
			if (!ctx.hasUI) {
				return { block: true, reason: "Comando peligroso bloqueado (sin UI para confirmar)" };
			}

			const choice = await ctx.ui.select(`⚠️ Comando peligroso:\n\n  ${command}\n\n¿Permitir?`, ["Sí", "No"]);

			if (choice !== "Sí") {
				return { block: true, reason: "Bloqueado por el usuario" };
			}
		}

		return undefined;
	});
}
