import { crawlServers } from '@/lib/servers';
import type { NS, Player, Server } from '@ns';
import { BLACKLIST, updateBlacklist } from './blacklist';
import {
	cleanPendingTasks,
	EXECUTOR_SCRIPTS,
	getMaxRam,
	getRam,
	runningTasks,
	scheduleBatch,
	ScheduleStrategy,
	scheduleTask,
	SCRIPT_COST,
} from './scheduler';
import { getBatch, scoreTarget } from './task-selection';

let servers: Server[];

export async function main(ns: NS) {
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
	cleanPendingTasks(ns);

	servers = await crawlServers(ns, 'home');
	const player = ns.getPlayer();
	const targets = getTargets(ns, servers, player);
	const runners = getRunners(servers);

	const targetBatches = targets.map((target) => {
		const batch = getBatch(ns, target, player);
		const threads = batch?.reduce((a, c) => a + c.threads, 0) ?? 0;
		return { target, batch, threads, scheduled: false };
	});

	for (let i = 0; i < targetBatches.length; i++) {
		const { target, batch, threads } = targetBatches[i];

		const getRunnerThreads = (runner: Server) => Math.max(0, Math.floor(getRam(runner) / SCRIPT_COST));
		const maxThreads = runners.reduce((a, c) => a + getRunnerThreads(c), 0);

		if (!batch?.length || threads > maxThreads) {
			continue;
		}

		const success = scheduleBatch(ns, batch, runners, ScheduleStrategy.AS_SPECIFIED);
		if (!success) {
			// Refresh runner RAM state — killed tasks freed RAM but runner objects are stale
			for (const runner of runners) {
				try {
					Object.assign(runner, { ramUsed: ns.getServer(runner.hostname).ramUsed });
				} catch {
					Object.assign(runner, { ramUsed: runner.maxRam });
				}
			}
			ns.print(`WARN miscalculated batch feasability for ${target.hostname} (${threads}/${maxThreads} threads)`);
			continue;
		}

		targetBatches[i].scheduled = true;
		ns.print(`SUCCESS scheduled batch for ${target.hostname} (${threads} threads)`);
		await ns.sleep(100);
		// Refresh runner RAM after sleep — other scripts may have consumed RAM during the pause
		for (const runner of runners) {
			Object.assign(runner, { ramUsed: ns.getServer(runner.hostname).ramUsed });
		}
	}

	// Guard: partial tasks must not steal RAM that full batches need.
	// Greedily simulate batch packing to find how much RAM full batches can actually claim,
	// then give partials only the leftover.
	const totalMaxRam = runners.reduce((a, c) => a + getMaxRam(c), 0);
	let simAvailable = totalMaxRam;
	for (const { threads } of targetBatches) {
		const batchRam = threads * SCRIPT_COST;
		if (batchRam <= simAvailable) simAvailable -= batchRam;
	}
	let partialThreadBudget = Math.floor(simAvailable / SCRIPT_COST);

	// No full batch scheduled - schedule a capped partial task to prep or generate income
	// we're starting from the smallest batch, and work our way up.
	// this way, we can guarantee some results, because doing partial work on the max batch is kinda useless
	for (const { target, batch, scheduled } of targetBatches.slice().reverse()) {
		if (!batch?.length || scheduled) continue;
		const getRunnerThreads = (runner: Server) => Math.max(0, Math.floor(getRam(runner) / SCRIPT_COST));
		const maxThreads = runners.reduce((a, c) => a + getRunnerThreads(c), 0);

		if (maxThreads < 1 || partialThreadBudget < 1) continue;
		const task = batch.find((t) => t.threads >= 1);
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
		ns.print(
			`SUCCESS partial[${task.label ?? task.action}] for ${target.hostname} (threads: ${threadsToSchedule}/${Math.floor(task.threads)}, budget left: ${partialThreadBudget})`,
		);
	}

	await ns.sleep(1000);
}

function getRunners(servers: Server[]) {
	return servers.filter((x) => x.hasAdminRights).sort((a, b) => getRam(b) - getRam(a));
}

function getTargets(ns: NS, servers: Server[], player: Player) {
	return servers
		.filter(
			(x) =>
				x &&
				!x.purchasedByPlayer &&
				x.hasAdminRights &&
				ns.getServerRequiredHackingLevel(x.hostname) <= ns.getHackingLevel() &&
				(x.moneyMax ?? 0) > 0,
		)
		.sort((a, b) => scoreTarget(ns, b, player) - scoreTarget(ns, a, player));
}
