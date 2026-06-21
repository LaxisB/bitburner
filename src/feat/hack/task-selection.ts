import type { NS, Person, Server } from '@ns';
import { SCRIPT_COST, type ScheduledTask, type Task } from './domain';
import { getTasksFor } from './scheduler';

const INTER_BATCH_GAP = 1000;
const PIPELINE_BUFFER = 200;
const TASK_BUFFER = 10;
const BATCH_SPAN = 40; // ms from first to last task finish within a single batch

export const HACK_FRACTION = 0.5; // fraction of available money to steal per batch (0.0–1.0)

export function scoreTarget(ns: NS, server: Server, player: Person): number {
	if (!server.moneyMax) return 0;

	const f = ns.formulas.hacking;
	const hackPercent = f.hackPercent(server, player);
	const hackChance = f.hackChance(server, player);
	const hackTime = f.hackTime(server, player);

	if (!hackPercent || !hackTime) return 0;

	const hackPct = hackPercent * hackChance;
	const hackThreads = Math.ceil(HACK_FRACTION / hackPct);
	const expectedHackedMoneyFraction = hackThreads * hackPct;

	const secDelta = f.weakenEffect(1);
	const weaken1Threads = Math.ceil(ns.hackAnalyzeSecurity(hackThreads, server.hostname) / secDelta);

	const moneyAfterHack = Math.max(1, server.moneyMax * (1 - expectedHackedMoneyFraction));
	const growThreads = f.growThreads({ ...server, moneyAvailable: moneyAfterHack }, player, server.moneyMax);
	const weaken2Threads = Math.ceil(ns.growthAnalyzeSecurity(growThreads) / secDelta);

	const moneyPerCycle = server.moneyMax * expectedHackedMoneyFraction;
	return moneyPerCycle / hackTime;
}

/** projects the expected server state after applying given tasks */
function projectServerState(ns: NS, server: Server, tasks: Task[], player: Person): Server {
	const projected = { ...server };
	const f = ns.formulas.hacking;
	const sorted = [...tasks].sort((a, b) => (a.delay ?? 0) + a.duration - ((b.delay ?? 0) + b.duration));

	for (const task of sorted) {
		if (task.action === 'weaken') {
			const reduction = f.weakenEffect(task.threads);
			projected.hackDifficulty = Math.max(projected.minDifficulty ?? 0, (projected.hackDifficulty ?? 0) - reduction);
		} else if (task.action === 'grow') {
			projected.moneyAvailable = f.growAmount(projected, player, task.threads);
			projected.hackDifficulty = Math.min(
				100,
				(projected.hackDifficulty ?? 0) + ns.growthAnalyzeSecurity(task.threads),
			);
		} else if (task.action === 'hack') {
			const pct = f.hackPercent(projected, player);
			projected.moneyAvailable = Math.max(0, (projected.moneyAvailable ?? 0) * (1 - task.threads * pct));
			projected.hackDifficulty = Math.min(
				100,
				(projected.hackDifficulty ?? 0) + ns.hackAnalyzeSecurity(task.threads, server.hostname),
			);
		}
	}

	return projected;
}

/** build a set of tasks to run a full WGWH batch on target server */
function buildBatch(ns: NS, server: Server, player: Person): Task[] {
	const f = ns.formulas.hacking;
	const hackTime = f.hackTime(server, player);
	const weakenTime = f.weakenTime(server, player);
	const growTime = f.growTime(server, player);

	const secDelta = f.weakenEffect(1);
	const weaken1Threads = Math.ceil(((server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)) / secDelta);

	const growTarget = (server.moneyMax ?? 1) * HACK_FRACTION;
	const serverForGrow = { ...server, moneyAvailable: Math.max(1, server.moneyAvailable ?? 1) };
	const growthThreads = f.growThreads(serverForGrow, player, growTarget);

	const weaken2Threads = Math.ceil(ns.growthAnalyzeSecurity(growthThreads) / secDelta);

	const hackPct = f.hackPercent(server, player) * f.hackChance(server, player);
	const hackThreads = Math.max(Math.ceil(HACK_FRACTION / hackPct), 1);

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
		delay: weakenTime + TASK_BUFFER - growTime,
		duration: growTime,
	};
	const weaken2: Task = {
		action: 'weaken',
		label: 'weaken 2',
		target: server.hostname,
		threads: growthThreads > 0 ? weaken2Threads : 0,
		delay: TASK_BUFFER * 2,
		duration: weakenTime,
	};
	const hack: Task = {
		action: 'hack',
		target: server.hostname,
		threads: hackThreads,
		delay: weakenTime + TASK_BUFFER * 3 - hackTime,
		duration: hackTime,
	};

	const isEmpty = (server.moneyAvailable ?? 0) <= 0;
	return [weaken1, grow, weaken2, ...(isEmpty ? [] : [hack])].filter((t) => t.threads > 0);
}

/** get a ready-to-run batch for a given server. this batch is automatically adjusted to factor in running tasks  */
export function getBatch(ns: NS, server: Server, player: Person): Task[] | null {
	const pending = getTasksFor(server);

	if (!pending?.length) {
		return buildBatch(ns, server, player);
	}

	const absFinish = (t: ScheduledTask) => t.startTime + (t.delay ?? 0) + t.duration;
	const windowStart = Math.min(...pending.map(absFinish));
	const windowEnd = Math.max(...pending.map(absFinish));

	const projected = projectServerState(ns, server, pending, player);
	const batch = buildBatch(ns, projected, player);
	if (!batch.length) return null;

	const firstOff = Math.min(...batch.map((t) => (t.delay ?? 0) + t.duration));
	const lastOff = Math.max(...batch.map((t) => (t.delay ?? 0) + t.duration));

	// Pipeline-full: the new batch's last task would land beyond one batch duration past windowStart
	const projectedNewEnd = windowEnd + INTER_BATCH_GAP + (lastOff - firstOff);
	if (projectedNewEnd > windowStart + lastOff + PIPELINE_BUFFER) {
		return null;
	}

	// Shift all tasks so this batch's first-finishing task lands just after the current window end
	const now = Date.now();
	const offset = Math.max(0, windowEnd + INTER_BATCH_GAP - now - firstOff);

	return batch.map((t) => ({ ...t, delay: (t.delay ?? 0) + offset }));
}

/** get the number of batches we can theoretically schedule concurrently without overlapping */
export function getMaxConcurrentBatches(ns: NS, server: Server, player: Person): number {
	const weakenTime = ns.formulas.hacking.weakenTime(server, player);
	return Math.max(1, Math.floor((weakenTime + PIPELINE_BUFFER) / (BATCH_SPAN + INTER_BATCH_GAP)));
}
