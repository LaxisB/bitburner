import { crawlServers } from '@/lib/servers';
import type { NS, Server } from '@ns';
import { updateBlacklist } from './blacklist';
import {
	cleanPendingTasks,
	EXECUTOR_SCRIPT,
	getRam,
	runningTasks,
	scheduleBatch,
	ScheduleStrategy,
	SCRIPT_COST,
} from './scheduler';
import { getBatch } from './task-selection';

let servers: Server[];

export async function main(ns: NS) {
	ns.disableLog('ALL');
	ns.ui.openTail();

	servers = await getServers(ns);
	ns.printf('distributing payload');
	for (const server of servers) {
		ns.scp(EXECUTOR_SCRIPT, server.hostname, 'home');
	}
	runningTasks.clear();

	ns.printf('starting loop');
	while (true) {
		await loop(ns);
	}
}

async function loop(ns: NS) {
	updateBlacklist(ns);
	cleanPendingTasks(ns);

	servers = await getServers(ns);
	const targets = getTargets(ns, servers);
	const runners = getRunners(servers);
	const player = ns.getPlayer();

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
			continue;
		}

		const success = scheduleBatch(ns, batch, runners, ScheduleStrategy.AS_SPECIFIED);
		if (!success) {
			// RAM estimates are off, stop scheduling
			ns.print('ERROR miscalculated batch feasability.');
			break;
		}

		targetBatches[i].scheduled = true;
		ns.printf('scheduled batch for %s (%i threads)', target.hostname, threads);
		await ns.sleep(100);
	}

	// No full batch scheduled - schedule a capped partial task to prep or generate income
	for (const { target, batch, scheduled } of targetBatches) {
		if (!batch?.length || scheduled) continue;
		const ramCurrent = runners.reduce((a, c) => a + Math.max(0, getRam(c)), 0);
		const maxThreads = Math.floor(ramCurrent / SCRIPT_COST);
		if (maxThreads < 1) continue;
		const firstTask = batch.find((t) => t.threads > 0);
		if (!firstTask) continue;
		const success = scheduleBatch(ns, [firstTask], runners, ScheduleStrategy.MAX_POSSIBLE);
		if (!success) {
			ns.printf('partial FAILED for %s', target.hostname);
			break;
		}
	}

	await ns.sleep(1000);
}

async function getServers(ns: NS) {
	const servers = await crawlServers(ns, 'home');
	const byHostname: Record<string, Server> = servers.reduce(
		(acc, curr) => {
			acc[curr.hostname] = curr;
			return acc;
		},
		{} as Record<string, Server>,
	);
	return Object.values(byHostname);
}

function getRunners(servers: Server[]) {
	return servers.filter((x) => x.hasAdminRights).sort((a, b) => getRam(b) - getRam(a));
}

function getTargets(ns: NS, servers: Server[]) {
	return servers
		.filter(
			(x) =>
				x &&
				!x.purchasedByPlayer &&
				x.hasAdminRights &&
				ns.getServerRequiredHackingLevel(x.hostname) <= ns.getHackingLevel() &&
				x.moneyAvailable,
		)
		.sort((a, b) => (b?.moneyMax ?? 1) - (a?.moneyMax ?? 1));
}
