import { Ports } from '@/utils/constants';
import { Server } from '@/utils/domain';
import { crawlServers } from '@/utils/servers';
import { queueRead } from '@/utils/utils';
import { NS, Player } from '@ns';
import { ScheduledTask, Task } from './domain';

const BLACKLIST = new Set<string>();
const EXECUTOR_SCRIPT = '/feat/hack/executor.js';
const SCRIPT_COST = 2;
// keep this amount of ram free
const HOST_RAM_BLOCKER: Record<string, number> = {
  home: 64,
};

const runningTasks = new Map<string, ScheduledTask[]>();

//TODO: clean this mess called script up
export async function main(ns: NS) {
  ns.disableLog('ALL');
  ns.ui.openTail();
  let servers = await getServers(ns);

  ns.printf('distributing payload');
  for (const server of servers) {
    ns.scp(EXECUTOR_SCRIPT, server!.hostname, 'home');
  }
  runningTasks.clear();

  //TODO: rebuild runningTasks from server state;

  ns.printf('starting loop');
  while (true) {
    updateBlacklist(ns);
    cleanPendingTasks(ns);

    servers = await getServers(ns);
    const targets = getTargets(ns, servers);
    const runners = getRunners(servers);
    const player = ns.getPlayer();

    const ramTotal = runners.reduce((a, c) => (a += c.maxRam), 0);
    const threadsTotal = Math.floor(ramTotal / SCRIPT_COST);

    const targetBatches = targets.map((target) => {
      const batch = getBatch(ns, target, player);
      const threads = batch?.reduce((a, c) => a + c.threads, 0) ?? 0;
      return { target, batch, threads };
    });

    // Schedule the largest possible batch; weaken the next-bigger target we skipped
    let firstBatchIndex = -1;

    for (let i = 0; i < targetBatches.length; i++) {
      const { target, batch, threads } = targetBatches[i];
      const ramCurrent = runners.reduce((a, c) => (a += Math.max(0, getRam(c))), 0);
      const maxThreads = Math.floor(ramCurrent / SCRIPT_COST);

      if (!batch?.length || threads > maxThreads) {
        continue;
      }

      const success = scheduleBatch(ns, batch, runners);
      if (!success) {
        // RAM estimates are off, stop scheduling
        break;
      }

      ns.printf('scheduled batch for %s (%i threads)', target.hostname, threads);
      await ns.sleep(100);
    }

    // No full batch scheduled — use partial batch to prep or generate income
    if (firstBatchIndex === -1) {
      for (const { target } of targetBatches) {
        const ramCurrent = runners.reduce((a, c) => (a += Math.max(0, getRam(c))), 0);
        const maxThreads = Math.floor(ramCurrent / SCRIPT_COST);
        const partial = getPartialBatch(ns, target, player, maxThreads);
        if (!partial?.length) continue;
        const partialThreads = partial.reduce((a, c) => a + c.threads, 0);
        ns.printf(
          'partial[%s] %s available=%i total=%i tasks: %s',
          partial.map((t) => t.action).join('+'),
          target.hostname,
          maxThreads,
          partialThreads,
          partial.map((t) => `${t.action}x${t.threads}`).join(' '),
        );
        const success = scheduleBatch(ns, partial, runners);
        if (!success) {
          ns.printf('partial FAILED for %s', target.hostname);
          break;
        }
        ns.printf('partial ok for %s', target.hostname);
        break;
      }
    }

    await ns.sleep(1000);
  }
}

function scheduleBatch(ns: NS, tasks: Task[], runners: Server[]): boolean {
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
      runningTasks.set(task.target, running); // store after mutation in case .get() returned null
      pids.push(pid);
      scheduledThreads += threads;
    } else {
      // kill each partial task if we couldn't schedule it fully
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

function cleanPendingTasks(ns: NS) {
  runningTasks.forEach((tasks) => {
    tasks.forEach((task, i) => {
      const isDone = !ns.isRunning(task.pid, task.target);
      if (isDone) {
        tasks.splice(i, 1);
      }
    });
  });
}

function getWeaken(ns: NS, server: Server): Task {
  const secCurr = ns.getServerSecurityLevel(server.hostname);
  const secMin = ns.getServerMinSecurityLevel(server.hostname);
  const secDelta = ns.weakenAnalyze(1);
  const threads = Math.ceil((secCurr - secMin) / secDelta);
  return {
    action: 'weaken',
    target: server.hostname,
    duration: ns.getHackTime(server.hostname) * 3.2,
    threads,
  };
}
function getBatch(ns: NS, server: Server, player: Player): Task[] | null {
  const pending = runningTasks.get(server.hostname);

  //TODO if we were smart, we'd forecast the result of our pending tasks and already queue the next one
  // alas, we're not
  if (pending?.length) {
    return null;
  }

  let hackTime;
  let weakenTime;
  let growTime;
  const formulasAvailable = hasFormulas(ns);
  if (formulasAvailable) {
    weakenTime = ns.formulas.hacking.weakenTime(server, player);
    growTime = ns.formulas.hacking.growTime(server, player);
    hackTime = ns.formulas.hacking.hackTime(server, player);
  } else {
    hackTime = ns.getHackTime(server.hostname);
    weakenTime = hackTime * 4;
    growTime = hackTime * 3.2;
  }

  const secMin = ns.getServerMinSecurityLevel(server.hostname);
  const secDelta = ns.weakenAnalyze(1);
  const weaken1Threads = getWeaken(ns, server).threads;

  const growthThreads = formulasAvailable
    ? ns.formulas.hacking.growThreads(server, player, server.moneyMax ?? Number.MAX_SAFE_INTEGER)
    : Math.min(8, ns.growthAnalyze(server.hostname, (server.moneyMax ?? 1) / (server.moneyAvailable ?? 1))); // cap naiive growths at 128 threads

  const growthEffect = ns.growthAnalyzeSecurity(growthThreads);
  const weaken2Threads = Math.ceil((secMin + growthEffect) / secDelta);

  // factor to multiply our required hack threads with to handle hacking failures
  // we're adjusting the 'raw' factor down by 1x in case we high roll.
  const failureFactor = formulasAvailable
    ? Math.max(1, Math.floor(1 / ns.formulas.hacking.hackChance(server, player)) - 1)
    : 1;

  const rawHackThreadsRequired = formulasAvailable
    ? 100 / ns.formulas.hacking.hackPercent(server, player)
    : 1 / ns.hackAnalyze(server.hostname);

  const hackThreads = Math.floor(rawHackThreadsRequired * failureFactor);

  const weaken1: Task = {
    action: 'weaken',
    target: server.hostname,
    threads: weaken1Threads,
    duration: weakenTime,
  };

  const grow: Task = {
    action: 'grow',
    target: server.hostname,
    threads: growthThreads,
    delay: weakenTime + 10 - growTime,
    duration: growTime,
  };
  const weaken2: Task = {
    action: 'weaken',
    target: server.hostname,
    threads: weaken2Threads,
    delay: weakenTime + 20 - growTime,
    duration: weakenTime,
  };
  const hack: Task = {
    action: 'hack',
    target: server.hostname,
    threads: hackThreads,
    delay: weakenTime + 30 - hackTime,
    duration: hackTime,
  };

  return [weaken1, grow, weaken2, hack];
}

function getPartialBatch(ns: NS, server: Server, player: Player, maxThreads: number): Task[] | null {
  if (runningTasks.get(server.hostname)?.length) return null;
  if (maxThreads < 1) return null;

  const formulasAvailable = hasFormulas(ns);
  const hackTime = formulasAvailable ? ns.formulas.hacking.hackTime(server, player) : ns.getHackTime(server.hostname);
  const weakenTime = formulasAvailable ? ns.formulas.hacking.weakenTime(server, player) : hackTime * 4;
  const growTime = formulasAvailable ? ns.formulas.hacking.growTime(server, player) : hackTime * 3.2;

  // Tier 1: security elevated
  const secCurr = ns.getServerSecurityLevel(server.hostname);
  const secMin = ns.getServerMinSecurityLevel(server.hostname);
  if (secCurr > secMin) {
    const w = getWeaken(ns, server);
    return [{ ...w, threads: Math.min(w.threads, maxThreads) }];
  }

  // Tier 2: money below max: row + counter weaken
  if ((server.moneyAvailable ?? 0) < (server.moneyMax ?? 1)) {
    const growRatio = ns.growthAnalyzeSecurity(1) / ns.weakenAnalyze(1);
    const growThreads = Math.max(1, Math.floor(maxThreads / (1 + growRatio)));
    const weakenThreads = Math.ceil(growThreads * growRatio);
    return [
      { action: 'grow', target: server.hostname, threads: growThreads, duration: growTime },
      { action: 'weaken', target: server.hostname, threads: weakenThreads, duration: weakenTime },
    ];
  }

  // Tier 3: server ready: hack + counter weaken (income!)
  const hackRatio = ns.hackAnalyzeSecurity(1) / ns.weakenAnalyze(1);
  const hackThreads = Math.max(1, Math.floor(maxThreads / (1 + hackRatio)));
  const weakenThreads = Math.ceil(hackThreads * hackRatio);
  return [
    { action: 'hack', target: server.hostname, threads: hackThreads, duration: hackTime },
    { action: 'weaken', target: server.hostname, threads: weakenThreads, duration: weakenTime },
  ];
}

// get a sorted list of servers that can run scripts
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

async function getServers(ns: NS) {
  const servers = await crawlServers(ns, 'home');
  const byHostname: Record<string, Server> = servers.reduce((acc, curr) => ({ ...acc, [curr.hostname]: curr }), {});
  return Object.values(byHostname);
}

const getRam = (server: Server) => server.maxRam - server.ramUsed - (HOST_RAM_BLOCKER[server.hostname] ?? 0);

function executeTask(ns: NS, task: ScheduledTask) {
  const args = ['threads', 'delay', 'duration', 'action', 'target', 'runner']
    .filter((key) => !!(task as any)[key])
    .flatMap((key) => [`--${key}`, (task as Record<string, any>)[key]]);
  const pid = ns.exec(EXECUTOR_SCRIPT, task.runner, task.threads, ...(args as any));
  return pid;
}

function hasFormulas(ns: NS) {
  try {
    ns.formulas.hacking.weakenTime(ns.getServer('foodnstuff'), ns.getPlayer());
    return true;
  } catch {
    return false;
  }
}
function updateBlacklist(ns: NS) {
  queueRead(ns, Ports.Servers, (msg) => {
    const { added, host } = msg;
    ns.printf('Blacklist change %j', msg);
    if (added) {
      BLACKLIST.add(host);
      ns.printf('+BLACKLIST %s', host);
    } else {
      BLACKLIST.delete(host);
      ns.printf('-BLACKLIST %s', host);
    }
  });
}
