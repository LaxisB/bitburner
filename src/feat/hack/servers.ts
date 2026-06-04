import type { NS, Server } from '@ns';
import { SCRIPT_COST } from './domain';

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

export function getTargets(ns: NS, servers: Server[]) {
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

export function scoreTarget(ns: NS, server: Server): number {
	if (!server.moneyMax) return 0;
	const hostname = server.hostname;

	const hackPercent = ns.hackAnalyze(hostname);
	const hackTime = ns.getHackTime(hostname);
	const hackChance = ns.hackAnalyzeChance(hostname);

	if (!hackPercent || !hackTime) return 0;

	const HACK_FRACTION = 0.5;
	const hackThreads = Math.ceil(HACK_FRACTION / hackPercent);
	const actualFraction = hackThreads * hackPercent;

	const secDelta = ns.weakenAnalyze(1);
	const weaken1Threads = Math.ceil(ns.hackAnalyzeSecurity(hackThreads, hostname) / secDelta);

	const growRatio = 1 / (1 - Math.min(actualFraction, 0.999));
	const growThreads = Math.ceil(ns.growthAnalyze(hostname, growRatio));
	const weaken2Threads = Math.ceil(ns.growthAnalyzeSecurity(growThreads) / secDelta);

	const totalThreads = hackThreads + weaken1Threads + growThreads + weaken2Threads;
	const moneyPerCycle = (server.moneyMax ?? 0) * actualFraction * hackChance;
	return moneyPerCycle / hackTime / (totalThreads * SCRIPT_COST);
}
