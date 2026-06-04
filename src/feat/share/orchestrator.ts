import { crawlServers } from '@/lib/network';
import { ensureSingleton } from '@/lib/utils';
import type { NS, Server } from '@ns';

const SHARE_SCRIPT = '/feat/share/share.js';
const SHARE_RAM = 4;
const HOME_RESERVE = 64;

export async function main(ns: NS) {
	ensureSingleton(ns);
	ns.disableLog('ALL');

	while (true) {
		const servers = await crawlServers(ns, 'home');
		for (const server of servers) {
			maybeStartShare(ns, server);
		}
		await ns.sleep(5000);
	}
}

function maybeStartShare(ns: NS, server: Server) {
	if (!server.hasAdminRights) return;

	const reserve = server.hostname === 'home' ? HOME_RESERVE : 0;
	const available = server.maxRam - server.ramUsed - reserve;
	const threads = Math.floor(available / SHARE_RAM);
	if (threads < 1) return;

	const alreadyRunning = ns.ps(server.hostname).some((p) => p.filename === SHARE_SCRIPT);
	if (alreadyRunning) return;

	if (!ns.fileExists(SHARE_SCRIPT, server.hostname)) {
		ns.scp(SHARE_SCRIPT, server.hostname, 'home');
	}

	const pid = ns.exec(SHARE_SCRIPT, server.hostname, threads, '--runner', server.hostname, '--threads', threads);
	if (pid) {
		ns.print(`SUCCESS share on ${server.hostname} (${threads} threads)`);
	} else {
		ns.print(`WARN failed to start share on ${server.hostname}`);
	}
}
