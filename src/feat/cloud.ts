/**
 * buy and upgrade cloud servers to run scripts on
 */
import type { LogEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import type { NS } from '@ns';
const prefix = 'NODE';

export async function main(ns: NS) {
	ns.disableLog('ALL');
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
			deletedSmallest = true;
			ns.writePort(Ports.Servers, { added: false, host: deletionCandidate.hostname });
		}

		const newServer = ns.cloud.purchaseServer(prefix, targetRam);
		if (newServer) {
			const message = `${deletedSmallest ? `Upgraded from a ${ns.format.ram(deletionCandidate.ram)} to` : 'Bought a'} a ${ns.format.ram(targetRam)} Server`;
			ns.writePort(Ports.Metrics, {
				type: 'log',
				message,
			} satisfies LogEvent);
			ns.print(`INFO ${message}`);
		}
	}
}
