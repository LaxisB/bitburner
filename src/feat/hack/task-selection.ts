import type { NS, Player, Server } from '@ns';
import type { Task } from './domain';
import { runningTasks } from './scheduler';

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
	const weaken1Threads = getWeaken(ns, server).threads;

	const growthThreads = formulasAvailable
		? ns.formulas.hacking.growThreads(server, player, server.moneyMax ?? Number.MAX_SAFE_INTEGER)
		: Math.min(8, ns.growthAnalyze(server.hostname, (server.moneyMax ?? 1) / (server.moneyAvailable ?? 1)));

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

	const hackThreads = Math.floor(rawHackThreadsRequired * failureFactor);

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
		delay: weakenTime + 10 - growTime,
		duration: growTime,
	};
	const weaken2: Task = {
		action: 'weaken',
		label: 'weaken 2',
		target: server.hostname,
		threads: weaken2Threads,
		delay: weakenTime + 20 - growTime,
		duration: weakenTime,
	};
	const hack: Task = {
		action: 'hack',
		target: server.hostname,
		threads: hackThreads,
		delay: weakenTime + 30 - hackTime,
		duration: hackTime,
	};

	return [weaken1, grow, weaken2, hack].filter((t) => t.threads > 0);
}

export function hasFormulas(ns: NS) {
	try {
		ns.formulas.hacking.weakenTime(ns.getServer('foodnstuff'), ns.getPlayer());
		return true;
	} catch {
		return false;
	}
}
