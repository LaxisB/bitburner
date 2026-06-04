import { crawlServers } from '@/lib/network';
import { ensureSingleton } from '@/lib/utils';
import type { NS, Server } from '@ns';
import { BLACKLIST, updateBlacklist } from './blacklist';
import { SCRIPT_COST, type Task } from './domain';
import { ScheduleStrategy, dropDeadTasks, runningTasks, scheduleBatch, scheduleTask } from './scheduler';
import { getMaxRam, getRam, getRunners, getTargets, syncRamUsed } from './servers';
import { getBatch, getMaxConcurrentBatches } from './task-selection';

let servers: Server[];

export async function main(ns: NS) {
	ensureSingleton(ns);
	BLACKLIST.clear();
	ns.disableLog('ALL');

	runningTasks.clear();

	ns.print('INFO starting loop');
	while (true) {
		await loop(ns);
	}
}

async function loop(ns: NS) {
	if (updateBlacklist(ns)) {
		ns.print('INFO server de-blacklisted — restarting orchestrator');
		ns.spawn('feat/hack/orchestrator.js');
	}
	dropDeadTasks(ns);

	servers = await crawlServers(ns, 'home');
	const targets = getTargets(ns, servers);
	const runners = getRunners(servers);

	const targetBatches = targets.map((target) => {
		const batch = getBatch(ns, target);
		const threads = batch?.reduce((a, c) => a + c.threads, 0) ?? 0;
		return { target, batch, threads, scheduled: false };
	});

	for (let i = 0; i < targetBatches.length; i++) {
		const { target, batch, threads } = targetBatches[i];

		const maxThreads = runners.reduce((a, c) => a + getRunnerThreads(c), 0);

		if (!batch?.length || threads > maxThreads) {
			continue;
		}

		const success = scheduleBatch(ns, batch, runners, ScheduleStrategy.AS_SPECIFIED);
		if (!success) {
			syncRamUsed(ns, runners);
			ns.print(`WARN miscalculated batch feasability for ${target.hostname} (${threads}/${maxThreads} threads)`);
			continue;
		}

		targetBatches[i].scheduled = true;
		ns.print(`SUCCESS scheduled batch for ${target.hostname} (${threads} threads)`);
		await ns.sleep(100);
		syncRamUsed(ns, runners);
	}

	let partialThreadBudget = computePartialBudget(ns, runners, targetBatches);

	// No full batch scheduled — schedule a capped partial task to prep or generate income.
	// Batches are prioritized by score, so start with the largest non-scheduled one.
	for (const { target, batch, scheduled } of targetBatches) {
		if (!batch?.length || scheduled) continue;
		if (runningTasks.get(target.hostname)?.length) continue;
		const maxThreads = runners.reduce((a, c) => a + getRunnerThreads(c), 0);

		if (maxThreads < 1 || partialThreadBudget < 1) continue;
		const atMinSecurity = (target.hackDifficulty ?? 0) <= (target.minDifficulty ?? 0) + 0.001;
		const task = batch.find((t) => t.threads >= 1 && !(atMinSecurity && t.action === 'weaken'));
		if (!task) continue;

		const threadsToSchedule = Math.min(Math.floor(task.threads), partialThreadBudget);
		const cappedTask = { ...task, threads: threadsToSchedule };
		const pids = scheduleTask(ns, cappedTask, runners, ScheduleStrategy.MAX_POSSIBLE);
		if (!pids.length) {
			ns.print(
				`WARN partial[${task.label ?? task.action}] FAILED for ${target.hostname} (threads: ${threadsToSchedule}/${Math.floor(task.threads)}, budget: ${partialThreadBudget})`,
			);
			continue;
		}
		partialThreadBudget -= threadsToSchedule;
	}

	await ns.sleep(100);
}

/** Simulate greedy batch packing to find how many threads are left for partial tasks.
 * Prevents partials from stealing RAM that full batches need. */
function computePartialBudget(
	ns: NS,
	runners: Server[],
	targetBatches: Array<{ target: Server; batch: Task[] | null; threads: number }>,
): number {
	const totalMaxRam = runners.reduce((a, c) => a + getMaxRam(c), 0);
	let simAvailable = totalMaxRam;
	for (const { target, batch, threads } of targetBatches) {
		if (!batch?.length) continue;
		const batchRam = threads * SCRIPT_COST;
		const pending = runningTasks.get(target.hostname);
		const pendingBatchCount = pending?.filter((t) => t.action === 'hack').length ?? 0;
		const toReserve = Math.max(1, getMaxConcurrentBatches(ns, target) - pendingBatchCount);
		for (let i = 0; i < toReserve; i++) {
			if (batchRam <= simAvailable) simAvailable -= batchRam;
			else break;
		}
	}
	return Math.floor(simAvailable / SCRIPT_COST);
}

function getRunnerThreads(runner: Server): number {
	return Math.max(0, Math.floor(getRam(runner) / SCRIPT_COST));
}
