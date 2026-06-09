import type { NS, Server } from '@ns';
import { SCRIPT_COST, type ScheduledTask, type Task } from './domain';
import { runningTasks } from './scheduler';

const INTER_BATCH_GAP = 50;
const PIPELINE_BUFFER = 200;
const BATCH_SPAN = 300; // ms from first to last task finish within a single batch

export const HACK_FRACTION = 1; // fraction of available money to steal per batch (0.0–1.0)

export function scoreTarget(ns: NS, server: Server): number {
	if (!server.moneyMax) return 0;
	const hostname = server.hostname;

	const hackPercent = ns.hackAnalyze(hostname);
	const hackTime = ns.getHackTime(hostname);
	const hackChance = ns.hackAnalyzeChance(hostname);

	if (!hackPercent || !hackTime) return 0;

	const hackPct = hackPercent * hackChance;
	const hackThreads = Math.ceil(HACK_FRACTION / hackPct);
	const expectedHackedMoneyFraction = hackThreads * hackPct;

	const secDelta = ns.weakenAnalyze(1);
	const weaken1Threads = Math.ceil(ns.hackAnalyzeSecurity(hackThreads, hostname) / secDelta);

	const moneyAfterHack = Math.max(1, server.moneyMax * (1 - expectedHackedMoneyFraction));
	const growRatio = server.moneyMax / moneyAfterHack;
	const growThreads = Math.ceil(ns.growthAnalyze(hostname, growRatio));
	const weaken2Threads = Math.ceil(ns.growthAnalyzeSecurity(growThreads) / secDelta);

	const totalThreads = hackThreads + weaken1Threads + growThreads + weaken2Threads;
	const totalCost = totalThreads * SCRIPT_COST;
	const moneyPerCycle = server.moneyMax * expectedHackedMoneyFraction;
	// return moneyPerCycle / hackTime / (totalThreads * SCRIPT_COST);
	return moneyPerCycle / hackTime;
}

/** projects the expected server state after applying given tasks */
function projectServerState(ns: NS, server: Server, tasks: Task[]): Server {
	const projected = { ...server };
	const sorted = [...tasks].sort((a, b) => (a.delay ?? 0) + a.duration - ((b.delay ?? 0) + b.duration));

	for (const task of sorted) {
		if (task.action === 'weaken') {
			const reduction = task.threads * ns.weakenAnalyze(1);
			projected.hackDifficulty = Math.max(projected.minDifficulty ?? 0, (projected.hackDifficulty ?? 0) - reduction);
		} else if (task.action === 'grow') {
			projected.moneyAvailable = Math.min(
				projected.moneyMax ?? 0,
				(projected.moneyAvailable ?? 0) * (1 + task.threads * 0.03),
			);
			projected.hackDifficulty = Math.min(
				100,
				(projected.hackDifficulty ?? 0) + ns.growthAnalyzeSecurity(task.threads),
			);
		} else if (task.action === 'hack') {
			const pct = ns.hackAnalyze(server.hostname);
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
function buildBatch(ns: NS, server: Server): Task[] {
	const hackTime = ns.getHackTime(server.hostname);
	const weakenTime = hackTime * 4;
	const growTime = hackTime * 3.2;

	const secDelta = ns.weakenAnalyze(1);
	const weaken1Threads = Math.floor(((server.hackDifficulty ?? 0) - (server.minDifficulty ?? 0)) / secDelta);

	const growTarget = (server.moneyMax ?? 1) * HACK_FRACTION;
	const growFrom = Math.max(1, server.moneyAvailable ?? 1);
	const growMultiplier = growTarget / growFrom;
	const growthThreads = growMultiplier > 1 ? Math.ceil(ns.growthAnalyze(server.hostname, growMultiplier)) : 0;

	const growthEffect = ns.growthAnalyzeSecurity(growthThreads);
	const weaken2Threads = Math.ceil(growthEffect / secDelta);

	const hackPct = ns.hackAnalyze(server.hostname) * ns.hackAnalyzeChance(server.hostname);
	const hackThreads = Math.ceil(HACK_FRACTION / hackPct);

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
		delay: 200,
		duration: weakenTime,
	};
	const hack: Task = {
		action: 'hack',
		target: server.hostname,
		threads: hackThreads,
		delay: weakenTime + 300 - hackTime,
		duration: hackTime,
	};

	const isEmpty = (server.moneyAvailable ?? 0) <= 0;
	return [weaken1, grow, weaken2, ...(isEmpty ? [] : [hack])].filter((t) => t.threads > 0);
}

/** get a ready-to-run batch for a given server. this batch is automatically adjusted to factor in running tasks  */
export function getBatch(ns: NS, server: Server): Task[] | null {
	const pending = runningTasks.get(server.hostname) as ScheduledTask[] | undefined;

	if (!pending?.length) {
		return buildBatch(ns, server);
	}

	const absFinish = (t: ScheduledTask) => t.startTime + (t.delay ?? 0) + t.duration;
	const windowStart = Math.min(...pending.map(absFinish));
	const windowEnd = Math.max(...pending.map(absFinish));

	const projected = projectServerState(ns, server, pending);
	const batch = buildBatch(ns, projected);
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
export function getMaxConcurrentBatches(ns: NS, server: Server): number {
	const weakenTime = ns.getHackTime(server.hostname) * 4;
	return Math.max(1, Math.floor((weakenTime + PIPELINE_BUFFER) / (BATCH_SPAN + INTER_BATCH_GAP)));
}
