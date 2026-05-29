import type { NS, Server } from '@ns';
import type { ScheduledTask, Task } from './domain';

export const EXECUTOR_SCRIPT = '/feat/hack/executor.js';
export const SCRIPT_COST = 2;
export const HOST_RAM_BLOCKER: Record<string, number> = {
	home: 64,
};

export enum ScheduleStrategy {
	SINGLE_PROCESS = 'SINGLE_PROCESS',
	MAX_POSSIBLE = 'MAX_POSSIBLE',
	AS_SPECIFIED = 'AS_SPECIFIED',
}

export const runningTasks = new Map<string, ScheduledTask[]>();

export const getRam = (server: Server) => server.maxRam - server.ramUsed - (HOST_RAM_BLOCKER[server.hostname] ?? 0);
export const getMaxRam = (server: Server) => server.maxRam - (HOST_RAM_BLOCKER[server.hostname] ?? 0);

export function scheduleBatch(ns: NS, tasks: Task[], runners: Server[], strategy = ScheduleStrategy.AS_SPECIFIED): boolean {
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

function scheduleTask(ns: NS, task: Task, runners: Server[], strategy = ScheduleStrategy.AS_SPECIFIED): number[] {
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
		// mutate runner state to update memory
		// we are getting fresh data the next time we run, so this isn't permanent
		Object.assign(runner, { ramUsed: ns.getServer(runner.hostname).ramUsed });
		const running = runningTasks.get(task.target) ?? [];
		running.push(scheduled);
		runningTasks.set(task.target, running);
		return [pid];
	}

	let scheduledThreads = 0;
	let pids: number[] = [];

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
			// mutate runner state to update memory
			// we are getting fresh data the next time we run, so this isn't permanent
			Object.assign(runner, { ramUsed: ns.getServer(runner.hostname).ramUsed });
			const running = runningTasks.get(task.target) ?? [];
			running.push(scheduled);
			runningTasks.set(task.target, running);
			pids.push(pid);
			scheduledThreads += threads;
		} else {
			pids.forEach((pid) => ns.kill(pid));
			return [];
		}
	}

	return pids;
}

export function cleanPendingTasks(ns: NS) {
	runningTasks.forEach((tasks) => {
		tasks.forEach((task, i) => {
			const isDone = !ns.isRunning(task.pid, task.target);
			if (isDone) {
				tasks.splice(i, 1);
			}
		});
	});
}

function executeTask(ns: NS, task: ScheduledTask) {
	const args = ['threads', 'delay', 'duration', 'action', 'target', 'runner']
		//biome-ignore lint/suspicious/noExplicitAny:
		.filter((key) => !!(task as any)[key])
		.flatMap((key) => [`--${key}`, (task as unknown as Record<string, unknown>)[key]]);
	//biome-ignore lint/suspicious/noExplicitAny:
	const pid = ns.exec(EXECUTOR_SCRIPT, task.runner, task.threads, ...(args as any));
	return pid;
}
