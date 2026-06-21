import type { ContractEvent, LogEvent } from '@/domain';
import type { StoredServer } from '@/lib/data';
import type { NS } from '@ns';
import { HOME, Ports } from '../lib/constants';

/**
 * Gains root on all reachable servers and emits contract file events to Port 4.
 * Also writes the full network topology to tmp/servers.json each loop.
 */
export async function main(ns: NS) {
	ns.disableLog('ALL');
	const alreadyPwned = new Set<string>();

	while (true) {
		const servers = crawl(ns);
		ns.write('tmp/servers.json', JSON.stringify(servers), 'w');
		const newlyPwned: string[] = [];

		for (const server of servers) {
			const host = server.hostname;
			if (host.startsWith('NODE')) continue;

			if (!server.hasAdminRights && !alreadyPwned.has(host)) {
				const gainedAdmin = pwnServer(ns, host);
				if (gainedAdmin) {
					newlyPwned.push(host);
					alreadyPwned.add(host);
				}
			}

			if (ns.getServer(host).hasAdminRights) {
				for (const file of ns.ls(host, '.cct')) {
					ns.writePort(Ports.Contracts, { type: 'contract', file, host } satisfies ContractEvent);
				}
			}
		}

		if (newlyPwned.length) {
			ns.writePort(Ports.Metrics, {
				type: 'log',
				message: `+ACCESS ${newlyPwned.slice(0, 2).join(', ')}${newlyPwned.length > 2 ? ` and ${newlyPwned.length - 2} more` : ''}`,
			} satisfies LogEvent);
		}

		await ns.sleep(5000);
	}
}

function crawl(ns: NS): StoredServer[] {
	const visited = new Set<string>();
	const parent = new Map<string, string>();
	const queue: string[] = [HOME];
	const results: StoredServer[] = [];

	visited.add(HOME);
	parent.set(HOME, '');

	while (queue.length) {
		// biome-ignore lint:
		const host = queue.shift()!;
		const neighbors = ns.scan(host);
		const server = ns.getServer(host);

		const path: string[] = [];
		let cur: string | undefined = host;
		while (cur !== undefined && cur !== '') {
			path.unshift(cur);
			cur = parent.get(cur);
		}

		results.push({ ...server, neighbors, path });

		for (const neighbor of neighbors) {
			if (!visited.has(neighbor)) {
				visited.add(neighbor);
				parent.set(neighbor, host);
				queue.push(neighbor);
			}
		}
	}

	return results;
}

function pwnServer(ns: NS, host: string) {
	try {
		ns.brutessh(host);
	} catch (_) {}
	try {
		ns.ftpcrack(host);
	} catch (_) {}
	try {
		ns.relaysmtp(host);
	} catch (_) {}
	try {
		ns.httpworm(host);
	} catch (_) {}
	try {
		ns.sqlinject(host);
	} catch (_) {}
	try {
		ns.nuke(host);
	} catch (_) {}

	if (ns.getServer(host).hasAdminRights) {
		return true;
	}
	return false;
}
