import type { LogEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import { crawlServers } from '@/lib/network';
import { ensureSingleton } from '@/lib/utils';
import type { NS, Server } from '@ns';
import { BLACKLIST, updateBlacklist } from './blacklist';
import { SCRIPT_COST, type Task } from './domain';
import * as scheduler from './scheduler';
import { getMaxRam, getRam, getRunners, getTargets, syncRamUsed } from './servers';
import { getBatch, getMaxConcurrentBatches, scoreTarget } from './task-selection';

let servers: Server[];

export async function main(ns: NS) {
	ensureSingleton(ns);
	scheduler.killAll(ns);
	BLACKLIST.clear();
	ns.disableLog('ALL');
	ns.print('INFO starting loop');
	// sleep to let other init scripts spin up
	await ns.sleep(5_000);
	while (true) {
		await loop(ns);
	}
}

async function loop(ns: NS) {
	const deblacklisted = updateBlacklist(ns);
	if (deblacklisted) {
		BLACKLIST.clear();
		scheduler.killAll(ns, deblacklisted);
	}
	scheduler.dropDeadTasks(ns);

	servers = await crawlServers(ns, 'home');
	const player = ns.getPlayer();
	if (!player) {
		ns.alert('could not get player in feat/hack');
		return;
	}
	const targets = getTargets(ns, servers, (ns, server) => scoreTarget(ns, server, player));
	const runners = getRunners(servers);

	const targetBatches = targets.map((target) => {
		const batch = getBatch(ns, target, player);
		const threads = batch?.reduce((a, c) => a + c.threads, 0) ?? 0;
		return { target, batch, threads, scheduled: false };
	});

	for (let i = 0; i < targetBatches.length; i++) {
		const { target, batch, threads } = targetBatches[i];

		const maxThreads = runners.reduce((a, c) => a + getRunnerThreads(c), 0);

		if (!batch?.length || threads > maxThreads) {
			continue;
		}

		const success = scheduler.scheduleBatch(ns, batch, runners, scheduler.ScheduleStrategy.AS_SPECIFIED);
		if (!success) {
			syncRamUsed(ns, runners);
			ns.print(`WARN miscalculated batch feasability for ${target.hostname} (${threads}/${maxThreads} threads)`);
			continue;
		}

		targetBatches[i].scheduled = true;
		ns.print(`SUCCESS scheduled batch for ${target.hostname} (${threads} threads)`);
		ns.writePort(Ports.Metrics, {
			type: 'log',
			message: `+BATCH ${target.hostname} ${threads}`,
		} satisfies LogEvent);
		await ns.sleep(100);
		syncRamUsed(ns, runners);
	}

	let partialThreadBudget = computePartialBudget(ns, runners, targetBatches, player);

	// No full batch scheduled — schedule a capped partial task to prep or generate income.
	// Batches are prioritized by score, so start with the largest non-scheduled one.
	for (const { target, batch, scheduled } of targetBatches) {
		if (!batch?.length || scheduled) continue;

		const maxThreads = runners.reduce((a, c) => a + getRunnerThreads(c), 0);

		if (maxThreads < 1 || partialThreadBudget < 1) continue;

		const running = scheduler.getTasksFor(target);
		if (running.length) {
			continue;
		}

		const batchThreads = Math.floor(batch.reduce((a, b) => a + b.threads, 0));
		const threadsToSchedule = Math.min(batchThreads, partialThreadBudget);
		const pids = scheduler.scheduleBatch(ns, batch, runners, scheduler.ScheduleStrategy.MAX_POSSIBLE);
		if (!pids.length) {
			ns.print(
				`WARN partial FAILED for ${target.hostname} (threads: ${threadsToSchedule}/${Math.floor(batchThreads)}, budget: ${partialThreadBudget})`,
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
	player: ReturnType<NS['getPlayer']>,
): number {
	const totalMaxRam = runners.reduce((a, c) => a + getMaxRam(c), 0);
	let simAvailable = totalMaxRam;
	for (const { target, batch, threads } of targetBatches) {
		if (!batch?.length) continue;
		const batchRam = threads * SCRIPT_COST;
		const pending = scheduler.getTasksFor(target);
		const pendingBatchCount = pending?.filter((t) => t.action === 'hack').length ?? 0;
		const toReserve = Math.max(1, getMaxConcurrentBatches(ns, target, player) - pendingBatchCount);
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
