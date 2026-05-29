import type { LogEvent, ServerDeathEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import type { NS } from '@ns';
const prefix = 'NODE';

/**
 * continuously buys / upgrades servers to run scipts on
 */
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

		if (servers.length >= max && targetRam <= servers[0].ram) {
			// not an increase
			await ns.sleep(10_000);
			continue;
		}

		const deletionCandidate = servers[0];
		let deletedSmallest = false;
		if (servers.length >= max && deletionCandidate) {
			ns.writePort(Ports.Servers, { added: true, host: deletionCandidate.hostname });
			ns.killall(deletionCandidate.hostname);
			ns.writePort(Ports.Metrics, { type: 'serverdeath', host: deletionCandidate.hostname } satisfies ServerDeathEvent);
			const res = ns.cloud.deleteServer(deletionCandidate.hostname);
			if (!res) {
				ns.printf("couldn't delete...");
				ns.writePort(Ports.Servers, { added: false, host: deletionCandidate.hostname });
				await ns.sleep(10_000);
				continue;
			}
			deletedSmallest = true;
		}

		const newServer = ns.cloud.purchaseServer(prefix, targetRam);
		if (deletionCandidate && deletedSmallest) {
			ns.writePort(Ports.Servers, { added: false, host: deletionCandidate.hostname });
		}
		if (newServer) {
			ns.writePort(Ports.Servers, { added: false, host: newServer });

			ns.writePort(Ports.Metrics, {
				type: 'log',
				message: `${deletedSmallest ? `Upgraded from a ${ns.format.ram(deletionCandidate.ram)} to` : 'Bought a'} a ${ns.format.ram(targetRam)} Server`,
			} satisfies LogEvent);
			ns.print(`INFO bought ${newServer} ${deletedSmallest ? '(replacing the smallest)' : ''}`);
		}
		await ns.sleep(5_000);
	}
}
