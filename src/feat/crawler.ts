import type { ContractEvent, LogEvent } from '@/domain';
import type { NS } from '@ns';
import { HOME, Ports } from '../lib/constants';
import { crawlServers } from '../lib/network';

/**
 * Gains root on all reachable servers and emits contract file events to Port 4.
 */
export async function main(ns: NS) {
	ns.disableLog('ALL');
	const alreadyPwned = new Set<string>();

	while (true) {
		const servers = await crawlServers(ns, HOME, 100);
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
