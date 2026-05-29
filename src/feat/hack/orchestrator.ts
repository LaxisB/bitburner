import { crawlServers } from '@/lib/servers';
import type { NS, Player, Server } from '@ns';
import { updateBlacklist } from './blacklist';
import {
	cleanPendingTasks,
	EXECUTOR_SCRIPT,
	getMaxRam,
	getRam,
	runningTasks,
	scheduleBatch,
	ScheduleStrategy,
	SCRIPT_COST,
} from './scheduler';
import { getBatch, scoreTarget } from './task-selection';

let servers: Server[];

export async function main(ns: NS) {
	ns.disableLog('ALL');
	ns.clearLog();
	ns.ui.openTail();

	servers = await crawlServers(ns, 'home');
	ns.print('INFO distributing payload');
	for (const server of servers) {
		ns.scp(EXECUTOR_SCRIPT, server.hostname, 'home');
	}
	runningTasks.clear();

	ns.print('INFO starting loop');
	while (true) {
		await loop(ns);
	}
}

async function loop(ns: NS) {
	updateBlacklist(ns);
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
		const ramCurrent = runners.reduce((a, c) => a + Math.max(0, getRam(c)), 0);
		const maxThreads = Math.floor(ramCurrent / SCRIPT_COST);

		if (!batch?.length || threads > maxThreads) {
			if (batch?.length) {
				//ns.print(
				//`WARN bad Batch on ${target.hostname}: length=${batch?.length ?? 0}, threads = ${threads} / ${maxThreads}`,
				//);
			}
			continue;
		}

		const success = scheduleBatch(ns, batch, runners, ScheduleStrategy.AS_SPECIFIED);
		if (!success) {
			// RAM estimates are off, stop scheduling
			ns.print('ERROR miscalculated batch feasability.');
			break;
		}

		targetBatches[i].scheduled = true;
		ns.print('SUCCESS scheduled batch for %s (%i threads)', target.hostname, threads);
		await ns.sleep(100);
	}

	// No full batch scheduled - schedule a capped partial task to prep or generate income
	// we're starting from the smallest batch, and work our way up.
	// this way, we can guarantee some results, because doing partial work on the max batch is kinda useless
	for (const { target, batch, scheduled } of targetBatches.slice().reverse()) {
		if (!batch?.length || scheduled) continue;
		const ramCurrent = runners.reduce((a, c) => a + Math.max(0, getRam(c)), 0);
		const maxThreads = Math.floor(ramCurrent / SCRIPT_COST);
		if (maxThreads < 1) continue;
		const task = batch.find((t) => t.threads);
		if (!task) continue;
		const success = scheduleBatch(ns, [task], runners, ScheduleStrategy.MAX_POSSIBLE);
		if (!success) {
			ns.print(
				`WARN partial[${task.label ?? task.action}] FAILED for ${target.hostname} (task max: ${task.threads.toPrecision(3)}, total max: ${maxThreads})`,
			);
			break;
		}
		ns.print(
			`SUCCESS partial[${task.label ?? task.action}] SUCCCESS for ${target.hostname} (task max: ${task.threads.toPrecision(3)}, total max: ${maxThreads})`,
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
				x.moneyAvailable,
		)
		.sort((a, b) => scoreTarget(ns, b, player) - scoreTarget(ns, a, player));
}
