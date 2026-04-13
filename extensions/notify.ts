/**
 * Notify Extension
 *
 * Envía una notificación nativa del sistema cuando el agente termina y espera input.
 * - macOS: usa osascript (notificación en el Centro de Notificaciones)
 * - Windows Terminal: toast de Windows
 * - Kitty: OSC 99
 * - Otros terminales (Ghostty, iTerm2, WezTerm): OSC 777
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";

function notifyMacOS(title: string, body: string): void {
	execFile("osascript", [
		"-e",
		`display notification "${body}" with title "${title}" sound name "Ping"`,
	]);
}

function notifyWindows(title: string, body: string): void {
	const type = "Windows.UI.Notifications";
	const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText01`;
	const toast = `[${type}.ToastNotification]::new($xml)`;
	const script = [
		`${mgr} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show(${toast})`,
	].join("; ");
	execFile("powershell.exe", ["-NoProfile", "-Command", script]);
}

function notifyOSC777(title: string, body: string): void {
	process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyOSC99(title: string, body: string): void {
	process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
	process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

function notify(title: string, body: string): void {
	if (process.platform === "darwin") {
		notifyMacOS(title, body);
	} else if (process.env.WT_SESSION) {
		notifyWindows(title, body);
	} else if (process.env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body);
	} else {
		notifyOSC777(title, body);
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("notify", {
		description: "Envía una notificación de prueba. Uso: /notify [mensaje opcional]",
		handler: async (args, ctx) => {
			const body = args.trim() || "Notificación de prueba";
			notify("Pi", body);
			ctx.ui.notify(`Notificación enviada: "${body}"`, "info");
		},
	});

	pi.on("agent_start", async () => {
		notify("Pi", "Pensando…");
	});

	pi.on("agent_end", async () => {
		notify("Pi", "Listo — esperando tu respuesta");
	});
}
