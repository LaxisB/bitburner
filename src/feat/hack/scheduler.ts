import type { NS, Server } from '@ns';
import { type ScheduledTask, SCRIPT_COST, type Task } from './domain';
import { getRam, readRamUsed, syncRamUsed } from './servers';

export const EXECUTOR_SCRIPTS: Record<string, string> = {
	hack: '/feat/hack/hack.js',
	grow: '/feat/hack/grow.js',
	weaken: '/feat/hack/weaken.js',
};

export enum ScheduleStrategy {
	SINGLE_PROCESS = 'SINGLE_PROCESS',
	MAX_POSSIBLE = 'MAX_POSSIBLE',
	AS_SPECIFIED = 'AS_SPECIFIED',
}

export const runningTasks = new Map<string, ScheduledTask[]>();

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
		const scheduled: ScheduledTask = { ...task, runner: runner.hostname, threads, pid: -1, startTime: Date.now() };
		const pid = executeTask(ns, scheduled);
		if (!pid) return [];
		scheduled.pid = pid;
		syncRamUsed(ns, [runner]);
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
		const scheduled: ScheduledTask = { ...task, runner: runner.hostname, threads, pid: -1, startTime: Date.now() };
		const pid = executeTask(ns, scheduled);
		scheduled.pid = pid;
		if (pid) {
			syncRamUsed(ns, [runner]);
			const running = runningTasks.get(task.target) ?? [];
			running.push(scheduled);
			runningTasks.set(task.target, running);
			pids.push(pid);
			scheduledThreads += threads;
		} else {
			const ramFree = runner.maxRam - readRamUsed(ns, runner.hostname, runner.maxRam);
			ns.print(
				`WARN exec failed on ${runner.hostname}: requested=${threads}t (${(threads * SCRIPT_COST).toFixed(2)}GB), actual ramFree=${ramFree.toFixed(2)}GB, script=${EXECUTOR_SCRIPTS[task.action]}`,
			);
			pids.forEach((pid) => ns.kill(pid));
			return [];
		}
	}

	return pids;
}

export function dropDeadTasks(ns: NS) {
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
	// wrap in try-catch to never block execution
	try {
		const missing = !ns.fileExists(script, task.runner);
		if (missing) {
			ns.print(`INFO script missing on ${task.runner}. copying`);
			ns.scp(script, task.runner, 'home');
		}
	} catch {}
	//biome-ignore lint/suspicious/noExplicitAny:
	const pid = ns.exec(script, task.runner, task.threads, ...(args as any));
	return pid;
}
