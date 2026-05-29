import type { NS, Player, Server } from '@ns';
import type { Task } from './domain';
import { runningTasks, SCRIPT_COST } from './scheduler';

export function getWeaken(ns: NS, server: Server): Task {
	const secCurr = ns.getServerSecurityLevel(server.hostname);
	const secMin = ns.getServerMinSecurityLevel(server.hostname);
	const secDelta = ns.weakenAnalyze(1);
	const threads = Math.floor((secCurr - secMin) / secDelta);
	return {
		action: 'weaken',
		target: server.hostname,
		duration: ns.getHackTime(server.hostname) * 3.2,
		threads,
	};
}

export function getBatch(ns: NS, server: Server, player: Player): Task[] | null {
	const pending = runningTasks.get(server.hostname);

	//TODO if we were smart, we'd forecast the result of our pending tasks and already queue the next one
	if (pending?.length) {
		return null;
	}

	let hackTime: number;
	let weakenTime: number;
	let growTime: number;
	const formulasAvailable = hasFormulas(ns);
	if (formulasAvailable) {
		weakenTime = ns.formulas.hacking.weakenTime(server, player);
		growTime = ns.formulas.hacking.growTime(server, player);
		hackTime = ns.formulas.hacking.hackTime(server, player);
	} else {
		hackTime = ns.getHackTime(server.hostname);
		weakenTime = hackTime * 4;
		growTime = hackTime * 3.2;
	}

	const secDelta = ns.weakenAnalyze(1);
	const weaken1Threads = Math.ceil(getWeaken(ns, server).threads);

	const growthThreads = Math.ceil(
		formulasAvailable
			? ns.formulas.hacking.growThreads(server, player, server.moneyMax ?? Number.MAX_SAFE_INTEGER)
			: ns.growthAnalyze(server.hostname, (server.moneyMax ?? 1) / (server.moneyAvailable ?? 1)),
	);

	const growthEffect = ns.growthAnalyzeSecurity(growthThreads);
	const weaken2Threads = Math.ceil(growthEffect / secDelta);

	// factor to multiply our required hack threads with to handle hacking failures
	// we're adjusting the 'raw' factor down by 1x in case we high roll.
	const failureFactor = formulasAvailable
		? Math.max(1, Math.floor(1 / ns.formulas.hacking.hackChance(server, player)) - 1)
		: 1;

	const rawHackThreadsRequired = formulasAvailable
		? 100 / ns.formulas.hacking.hackPercent(server, player)
		: 1 / ns.hackAnalyze(server.hostname);

	const hackThreads = Math.ceil(rawHackThreadsRequired * failureFactor);

	const weaken1: Task = {
		action: 'weaken',
		target: server.hostname,
		threads: weaken1Threads,
		duration: weakenTime,
	};

	const grow: Task = {
		action: 'grow',
		target: server.hostname,
		threads: growthThreads,
		delay: weakenTime + 100 - growTime,
		duration: growTime,
	};
	const weaken2: Task = {
		action: 'weaken',
		label: 'weaken 2',
		target: server.hostname,
		threads: growthThreads > 0 ? weaken2Threads : 0,
		delay: weakenTime + 200 - growTime,
		duration: weakenTime,
	};
	const hack: Task = {
		action: 'hack',
		target: server.hostname,
		threads: hackThreads,
		delay: weakenTime + 300 - hackTime,
		duration: hackTime,
	};

	return [weaken1, grow, weaken2, hack].filter((t) => t.threads > 0);
}

export function scoreTarget(ns: NS, server: Server, player: Player): number {
	if (!server.moneyMax) return 0;
	const hostname = server.hostname;
	const formulasAvailable = hasFormulas(ns);

	const peakServer = formulasAvailable
		? { ...server, hackDifficulty: server.minDifficulty, moneyAvailable: server.moneyMax }
		: server;

	const hackPercent = formulasAvailable
		? ns.formulas.hacking.hackPercent(peakServer, player)
		: ns.hackAnalyze(hostname);
	const hackTime = formulasAvailable ? ns.formulas.hacking.hackTime(peakServer, player) : ns.getHackTime(hostname);
	const hackChance = formulasAvailable
		? ns.formulas.hacking.hackChance(peakServer, player)
		: ns.hackAnalyzeChance(hostname);

	if (!hackPercent || !hackTime) return 0;

	const HACK_FRACTION = 0.5;
	const hackThreads = Math.ceil(HACK_FRACTION / hackPercent);
	const actualFraction = hackThreads * hackPercent;

	const secDelta = ns.weakenAnalyze(1);
	const weaken1Threads = Math.ceil(ns.hackAnalyzeSecurity(hackThreads, hostname) / secDelta);

	const growRatio = 1 / (1 - Math.min(actualFraction, 0.999));
	const growThreads = formulasAvailable
		? Math.ceil(
				ns.formulas.hacking.growThreads(
					{ ...peakServer, moneyAvailable: (server.moneyMax ?? 0) * (1 - actualFraction) },
					player,
					server.moneyMax ?? 0,
				),
			)
		: Math.ceil(ns.growthAnalyze(hostname, growRatio));
	const weaken2Threads = Math.ceil(ns.growthAnalyzeSecurity(growThreads) / secDelta);

	const totalThreads = hackThreads + weaken1Threads + growThreads + weaken2Threads;
	const moneyPerCycle = (server.moneyMax ?? 0) * actualFraction * hackChance;
	return moneyPerCycle / hackTime / (totalThreads * SCRIPT_COST);
}

export function hasFormulas(ns: NS) {
	try {
		ns.formulas.hacking.weakenTime(ns.getServer('foodnstuff'), ns.getPlayer());
		return true;
	} catch {
		return false;
	}
}
