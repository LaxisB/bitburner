import type { NS, Server } from '@ns';

export const HOST_RAM_BLOCKER: Record<string, number> = {
	home: 64,
};

export const getRam = (server: Server) => server.maxRam - server.ramUsed - (HOST_RAM_BLOCKER[server.hostname] ?? 0);
export const getMaxRam = (server: Server) => server.maxRam - (HOST_RAM_BLOCKER[server.hostname] ?? 0);

export const readRamUsed = (ns: NS, hostname: string, fallback: number) => {
	try {
		return ns.getServer(hostname).ramUsed;
	} catch {
		return fallback;
	}
};

export function syncRamUsed(ns: NS, servers: Server[]) {
	for (const server of servers) {
		Object.assign(server, { ramUsed: readRamUsed(ns, server.hostname, server.maxRam) });
	}
}

export function getRunners(servers: Server[]) {
	return servers.filter((x) => x.hasAdminRights).sort((a, b) => getRam(b) - getRam(a));
}

export function getTargets(ns: NS, servers: Server[], scoreTarget: (ns: NS, server: Server) => number) {
	const hackLevel = ns.getHackingLevel();
	return servers
		.filter(
			(x) =>
				x &&
				!x.purchasedByPlayer &&
				x.hasAdminRights &&
				ns.getServerRequiredHackingLevel(x.hostname) <= hackLevel &&
				(x.moneyMax ?? 0) > 0,
		)
		.map((x) => ({ server: x, score: scoreTarget(ns, x) }))
		.sort((a, b) => b.score - a.score)
		.map((x) => x.server);
}
