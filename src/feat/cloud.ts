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
		const purchases: string[] = [];

		while (true) {
			const maxCost = ns.getPlayer().money * 0.1;
			const servers = ns.cloud
				.getServerNames()
				.map((server) => ({ hostname: server, ram: ns.getServerMaxRam(server) }))
				.sort((a, b) => a.ram - b.ram);

			let pow = 1;
			do {
				pow += 1;
			} while (ns.cloud.getServerCost(2 ** pow) < maxCost);
			const targetRam = 2 ** (pow - 1);

			if (targetRam < 8 || (servers.length >= max && targetRam <= servers[0].ram)) {
				break;
			}

			const deletionCandidate = servers[0];
			if (servers.length >= max && deletionCandidate) {
				ns.writePort(Ports.Servers, { added: true, host: deletionCandidate.hostname });
				ns.killall(deletionCandidate.hostname);
				ns.cloud.deleteServer(deletionCandidate.hostname);
				ns.writePort(Ports.Servers, { added: false, host: deletionCandidate.hostname });
			}

			const newServer = ns.cloud.purchaseServer(prefix, targetRam);
			if (!newServer) break;
			purchases.push(ns.format.ram(targetRam));
		}

		if (purchases.length > 0) {
			const message = `+CLOUD ${purchases.join(', ')}`;
			ns.writePort(Ports.Metrics, { type: 'log', message } satisfies LogEvent);
			ns.print(`INFO ${message}`);
		}

		await ns.sleep(60_000);
	}
}
