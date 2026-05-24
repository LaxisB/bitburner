import { groupBy } from '@/utils/utils';
import { NS } from '@ns';
import { HOME } from '../utils/constants';
import type { Server } from '../utils/domain';
import { crawlServers } from '../utils/servers';

export interface ServerWithEstimates extends Server {
  security: {
    min: number;
    current: number;
  };
  money: {
    max: number;
    current: number;
    hacked: number;
    grown: number;
  };
  canHack: boolean;
  tasksRunning: number;
}

export interface Task {
  target: string;
  action: string;
  result: number;
  threads: number;
  duration: number;
  comment?: string;
}
export interface ScheduledTask extends Task {
  finishesAt: number;
  runner: string;
}

export interface SchedulerOpts {
  cost: number;
  execute(ac: ScheduledTask): Promise<number>;
}

export interface Scheduler {
  schedule(task: Task): Promise<ScheduledTask | null>;
  getServers(): Server[];
  updateServers(full: boolean): Promise<Record<string, Server>>;
  getAvailableTargets(): ServerWithEstimates[];
  getPendingTasks(): ScheduledTask[];
  getAvailableRunners(): Server[];
}

// keep this amount of ram free
export const HOST_RAM_BLOCKER: Record<string, number> = {
  home: 64,
};

const getRam = (server: Server) => server.maxRam - server.ramUsed - (HOST_RAM_BLOCKER[server.hostname] ?? 0);

export async function createScheduler(ns: NS, opts: SchedulerOpts): Promise<Scheduler> {
  const servers: Record<string, Server> = {};
  await updateServers(true);

  const runningTasks = new Set<ScheduledTask>();

  /**
   * try to find a spot on any available server to execute {action} against {server}
   * also inser
   * @param server server to target
   * @param task action to execute
   * @returns -
   */
  async function schedule(task: Task) {
    const runner = getAvailableRunners().sort((a, b) => (getRam(a) > getRam(b) ? -1 : 1))[0];

    if (!runner) {
      return null;
    }
    const requestedThreads = Math.floor(task.threads);
    const possibleThreads = Math.floor(getRam(runner) / opts.cost);
    const scheduled: ScheduledTask = {
      ...task,
      finishesAt: task.duration + Date.now(),
      runner: runner.hostname,
      threads: Math.max(Math.min(requestedThreads, possibleThreads), 0),
    };

    const pid = await opts.execute(scheduled);
    if (pid) {
      Object.assign(servers[runner.hostname], ns.getServer(runner.hostname));
      runningTasks.add(scheduled);
      setTimeout(() => {
        runningTasks.delete(scheduled);
      }, scheduled.duration);
    }

    return pid ? scheduled : null;
  }

  function getServers() {
    return Object.values(servers);
  }

  /**
   * get a list of targets to aim for
   * this includes some estimated properties regarding in-flight tasks
   */
  function getAvailableTargets() {
    return Object.values(servers)
      .filter((s) => s.hostname != HOME)
      .filter((s) => s.moneyAvailable)
      .map((s) => {
        const taskList = Array.from(runningTasks).filter((task) => task.target === s.hostname);

        const tasks = groupBy(taskList, (s) => s.action);

        const weakens = (tasks.weaken ?? []).reduce((acc, curr) => acc + curr.result * curr.threads, 0);

        const moneyGrown = (tasks.grow ?? []).reduce(
          (acc, curr) => acc + (s.moneyAvailable ?? 0) * (curr.threads * curr.result),
          0,
        );
        const moneyHacked = (tasks.hack ?? []).reduce(
          (acc, curr) => acc + (s.moneyMax ?? 0) * curr.result * curr.threads,
          0,
        );

        const securityMin = ns.getServerMinSecurityLevel(s.hostname);
        const securityCurrent = ns.getServerSecurityLevel(s.hostname);

        return {
          ...s,
          security: {
            min: securityMin,
            current: securityCurrent - weakens,
          },
          money: {
            max: s.moneyMax ?? 0,
            current: (s.moneyAvailable ?? 0) - moneyHacked + moneyGrown,
            hacked: moneyHacked,
            grown: moneyGrown,
          },
          canHack: ns.getServerRequiredHackingLevel(s.hostname) <= ns.getHackingLevel(),
          tasksRunning: taskList.length,
        };
      })
      .sort((a, b) => a.money.current - b.money.current);
  }

  function getAvailableRunners() {
    return Object.values(servers).filter((s) => getRam(s) > opts.cost);
  }

  function getPendingTasks() {
    return Array.from(runningTasks);
  }

  async function updateServers(full = false) {
    const serverlist = full ? await crawlServers(ns, HOME) : Object.values(servers);
    serverlist.filter((s) => s.hasAdminRights).forEach((s) => (servers[s.hostname] = ns.getServer(s.hostname)));

    return servers;
  }

  return {
    getServers,
    updateServers,
    getAvailableTargets,
    getPendingTasks,
    getAvailableRunners,
    schedule,
  };
}
