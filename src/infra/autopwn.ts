/* eslint-disable no-empty */
import { crawlServers } from '../lib/servers';
import { HOME, Ports } from '../lib/constants';
import type { NS } from '@ns';
import type { LogEvent } from '@/domain';

/**
 * automatically gains root on all possible targets
 */
export async function main(ns: NS) {
	ns.disableLog('ALL');
	const alreadyPwned = new Set<string>();

	while (true) {
		const servers = await crawlServers(ns, HOME, 100);
		const serverspwned = [];
		for (const server of servers) {
			const host = server.hostname;
			if (server.hasAdminRights || host.startsWith('NODE') || alreadyPwned.has(host)) {
				continue;
			}
			try {
				ns.brutessh(host);
			} catch (e) {}
			try {
				ns.ftpcrack(host);
			} catch (e) {}
			try {
				ns.relaysmtp(host);
			} catch (e) {}
			try {
				ns.httpworm(host);
			} catch (e) {}
			try {
				ns.sqlinject(host);
			} catch (e) {}
			try {
				ns.nuke(host);
			} catch (e) {}

			const s = ns.getServer(host);
			if (s.hasAdminRights) {
				serverspwned.push(host);
				alreadyPwned.add(host);
			}
		}
		if (serverspwned.length) {
			ns.writePort(Ports.Metrics, {
				type: 'log',
				message: `pwned ${serverspwned.join(',').slice(0, 50)}... new servers`,
			} satisfies LogEvent);
		}

		await ns.sleep(5000);
	}
}
