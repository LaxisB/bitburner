/**
 * buy and upgrade cloud servers to run scripts on
 */
import type { LogEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import { ensureSingleton } from '@/lib/utils';
import type { NS } from '@ns';
const prefix = 'NODE';

export async function main(ns: NS) {
	ns.disableLog('ALL');
	ensureSingleton(ns);
	const max = ns.cloud.getServerLimit();
	while (true) {
		const player = ns.getPlayer();
		const maxCost = player.money * 0.8;

		const servers = ns.cloud
			.getServerNames()
			.map((server) => ({ hostname: server, ram: ns.getServerMaxRam(server) }))
			.sort((a, b) => a.ram - b.ram);

		// get max pow
		let pow = 1;
		do {
			pow += 1;
		} while (ns.cloud.getServerCost(2 ** pow) < maxCost);
		const targetRam = 2 ** (pow - 1);

		if (targetRam < 8 || (servers.length >= max && targetRam <= servers[0].ram)) {
			// not an increase
			await ns.sleep(60_000);
			continue;
		}

		const deletionCandidate = servers[0];
		let deletedSmallest = false;
		if (servers.length >= max && deletionCandidate) {
			ns.writePort(Ports.Servers, { added: true, host: deletionCandidate.hostname });
			ns.killall(deletionCandidate.hostname);
			ns.cloud.deleteServer(deletionCandidate.hostname);
			ns.writePort(Ports.Metrics, {
				type: 'log',
				message: `-SERVER ${deletionCandidate.hostname}`,
			} satisfies LogEvent);
			deletedSmallest = true;
			ns.writePort(Ports.Servers, { added: false, host: deletionCandidate.hostname });
		}

		const newServer = ns.cloud.purchaseServer(prefix, targetRam);
		if (newServer) {
			const message = `+SERVER ${newServer} (${ns.format.ram(targetRam)})`;
			ns.writePort(Ports.Metrics, {
				type: 'log',
				message,
			} satisfies LogEvent);
			ns.print(`INFO ${message}`);
		}
	}
}
