import { Server } from '@/utils/domain';
import { NS } from '@ns';
import { ScheduledTask, Task } from './domain';

export const EXECUTOR_SCRIPT = '/feat/hack/executor.js';
export const SCRIPT_COST = 2;
export const HOST_RAM_BLOCKER: Record<string, number> = {
  home: 64,
};

export const runningTasks = new Map<string, ScheduledTask[]>();

export const getRam = (server: Server) => server.maxRam - server.ramUsed - (HOST_RAM_BLOCKER[server.hostname] ?? 0);

export function scheduleBatch(ns: NS, tasks: Task[], runners: Server[]): boolean {
  let pids: number[] = [];
  for (const task of tasks) {
    if (!task.threads) continue;
    const taskPids = scheduleTask(ns, task, runners);
    if (!taskPids.length) {
      pids.forEach((pid) => ns.kill(pid));
      return false;
    }
    pids = pids.concat(taskPids);
  }
  return true;
}

function scheduleTask(ns: NS, task: Task, runners: Server[], reduceThreads = false): number[] {
  if (!runners.length || task.threads == 0) {
    return [];
  }

  const requestedThreads = Math.floor(task.threads);

  let scheduledThreads = 0;
  let pids = [];

  while (scheduledThreads < requestedThreads) {
    let runner = runners.find((x) => getRam(x) >= SCRIPT_COST)!;
    if (!runner) {
      pids.forEach((pid) => ns.kill(pid));
      return [];
    }
    const possibleThreads = Math.floor(getRam(runner) / SCRIPT_COST);
    if (possibleThreads < 1) {
      pids.forEach((pid) => ns.kill(pid));
      return [];
    }

    const threads = Math.min(requestedThreads - scheduledThreads, possibleThreads);
    const scheduled: ScheduledTask = {
      ...task,
      runner: runner.hostname,
      threads,
      pid: -1,
    };
    let pid = executeTask(ns, scheduled);
    scheduled.pid = pid;
    if (pid) {
      // mutate runner state to update memory
      // we are getting fresh data the next time we run, so this isn't permanent
      const updated = ns.getServer(runner.hostname);
      Object.assign(runner, { ramUsed: updated.ramUsed });

      const running = runningTasks.get(task.target) ?? [];
      running.push(scheduled);
      runningTasks.set(task.target, running);
      pids.push(pid);
      scheduledThreads += threads;
    } else {
      pids.forEach((pid) => ns.kill(pid));
      pids = [];
      break;
    }
    if (reduceThreads && scheduledThreads < requestedThreads) {
      return pids;
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
    .filter((key) => !!(task as any)[key])
    .flatMap((key) => [`--${key}`, (task as Record<string, any>)[key]]);
  const pid = ns.exec(EXECUTOR_SCRIPT, task.runner, task.threads, ...(args as any));
  return pid;
}
