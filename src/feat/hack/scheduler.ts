import type { NS, Server } from '@ns';
import type { ScheduledTask, Task } from './domain';

export const EXECUTOR_SCRIPTS: Record<string, string> = {
	hack: '/feat/hack/hack.js',
	grow: '/feat/hack/grow.js',
	weaken: '/feat/hack/weaken.js',
};
export const SCRIPT_COST = 1.75;
export const HOST_RAM_BLOCKER: Record<string, number> = {
	home: 64,
};

export enum ScheduleStrategy {
	SINGLE_PROCESS = 'SINGLE_PROCESS',
	MAX_POSSIBLE = 'MAX_POSSIBLE',
	AS_SPECIFIED = 'AS_SPECIFIED',
}

export const runningTasks = new Map<string, ScheduledTask[]>();

/**
 * getRamUsed() function that refreshes server state to handle some of our nodes being replaced in the background
 */
const safeGetRamUsed = (ns: NS, hostname: string, fallback: number) => {
	try {
		return ns.getServer(hostname).ramUsed;
	} catch {
		return fallback;
	}
};

/**
 * returns the available ram on the target server
 */
export const getRam = (server: Server) => server.maxRam - server.ramUsed - (HOST_RAM_BLOCKER[server.hostname] ?? 0);
export const getMaxRam = (server: Server) => server.maxRam - (HOST_RAM_BLOCKER[server.hostname] ?? 0);

export function scheduleBatch(
	ns: NS,
	tasks: Task[],
	runners: Server[],
	strategy = ScheduleStrategy.AS_SPECIFIED,
): boolean {
	let pids: number[] = [];
	for (const task of tasks) {
		if (!task.threads) continue;
		const taskPids = scheduleTask(ns, task, runners, strategy);
		if (!taskPids.length) {
			pids.forEach((pid) => ns.kill(pid));
			return false;
		}
		pids = pids.concat(taskPids);
	}
	return true;
}

export function scheduleTask(
	ns: NS,
	task: Task,
	runners: Server[],
	strategy = ScheduleStrategy.AS_SPECIFIED,
): number[] {
	if (!runners.length || task.threads === 0) {
		return [];
	}

	const requestedThreads = Math.floor(task.threads);

	if (strategy === ScheduleStrategy.SINGLE_PROCESS) {
		const runner = runners.filter((r) => getRam(r) >= SCRIPT_COST).sort((a, b) => getRam(b) - getRam(a))[0];
		if (!runner) return [];
		const possibleThreads = Math.floor(getRam(runner) / SCRIPT_COST);
		if (possibleThreads < 1) return [];
		const threads = Math.min(requestedThreads, possibleThreads);
		const scheduled: ScheduledTask = { ...task, runner: runner.hostname, threads, pid: -1 };
		const pid = executeTask(ns, scheduled);
		if (!pid) return [];
		scheduled.pid = pid;
		Object.assign(runner, { ramUsed: safeGetRamUsed(ns, runner.hostname, runner.maxRam) });
		const running = runningTasks.get(task.target) ?? [];
		running.push(scheduled);
		runningTasks.set(task.target, running);
		return [pid];
	}

	let scheduledThreads = 0;
	const pids: number[] = [];

	while (scheduledThreads < requestedThreads) {
		const runner = runners.find((x) => getRam(x) >= SCRIPT_COST);
		if (!runner) {
			if (strategy === ScheduleStrategy.AS_SPECIFIED) {
				pids.forEach((pid) => ns.kill(pid));
				return [];
			}
			return pids;
		}
		const possibleThreads = Math.floor(getRam(runner) / SCRIPT_COST);
		if (possibleThreads < 1) {
			if (strategy === ScheduleStrategy.AS_SPECIFIED) {
				pids.forEach((pid) => ns.kill(pid));
				return [];
			}
			return pids;
		}

		const threads = Math.min(requestedThreads - scheduledThreads, possibleThreads);
		const scheduled: ScheduledTask = { ...task, runner: runner.hostname, threads, pid: -1 };
		const pid = executeTask(ns, scheduled);
		scheduled.pid = pid;
		if (pid) {
			Object.assign(runner, { ramUsed: safeGetRamUsed(ns, runner.hostname, runner.maxRam) });
			const running = runningTasks.get(task.target) ?? [];
			running.push(scheduled);
			runningTasks.set(task.target, running);
			pids.push(pid);
			scheduledThreads += threads;
		} else {
			const ramFree = runner.maxRam - safeGetRamUsed(ns, runner.hostname, runner.maxRam);
			ns.print(
				`WARN exec failed on ${runner.hostname}: requested=${threads}t (${(threads * SCRIPT_COST).toFixed(2)}GB), actual ramFree=${ramFree.toFixed(2)}GB, script=${EXECUTOR_SCRIPTS[task.action]}`,
			);
			pids.forEach((pid) => ns.kill(pid));
			return [];
		}
	}

	return pids;
}

export function refreshRunners(ns: NS, runners: Server[]) {
	for (const runner of runners) {
		Object.assign(runner, { ramUsed: safeGetRamUsed(ns, runner.hostname, runner.maxRam) });
	}
}

export function cleanPendingTasks(ns: NS) {
	runningTasks.forEach((tasks, target) => {
		runningTasks.set(
			target,
			tasks.filter((task) => ns.isRunning(task.pid, task.runner)),
		);
	});
}

function executeTask(ns: NS, task: ScheduledTask) {
	const args = ['threads', 'delay', 'duration', 'target', 'runner']
		//biome-ignore lint/suspicious/noExplicitAny:
		.filter((key) => (task as any)[key] != null)
		.flatMap((key) => [`--${key}`, (task as unknown as Record<string, unknown>)[key]]);
	const script = EXECUTOR_SCRIPTS[task.action];
	// wrap in try-catch no never block execution
	try {
		if (!ns.fileExists(script, task.runner)) {
			ns.print(`WARN ${script} missing on ${task.runner}, re-scp'ing`);
			ns.scp(script, task.runner, 'home');
		}
	} catch {}
	//biome-ignore lint/suspicious/noExplicitAny:
	const pid = ns.exec(script, task.runner, task.threads, ...(args as any));
	return pid;
}
