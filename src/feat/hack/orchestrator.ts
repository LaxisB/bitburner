import { Ports } from '@/utils/constants';
import { Server } from '@/utils/domain';
import { crawlServers } from '@/utils/servers';
import { NS, Player } from '@ns';
import { ScheduledTask, Task } from './domain';

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
    cleanPendingTasks(ns);

    servers = await getServers(ns);
    const targets = getTargets(ns, servers);
    const runners = getRunners(servers);
    const player = ns.getPlayer();
    for (const target of targets) {
      const batch = getBatch(ns, target, player);
      if (!batch?.length) {
        continue;
      }
      const success = scheduleBatch(ns, batch, runners);
      if (!success) {
        // ns.printf(
        //   'batch too large: %i threads targeted at %s',
        //   batch.reduce((a, c) => a + c.threads, 0),
        //   batch[0].target,
        // );
        break;
      }
      ns.printf(
        'scheduled batch for %s (%i threads)',
        batch[0].target,
        batch.reduce((a, c) => a + c.threads, 0),
      );
    }

    await ns.sleep(1000);
  }
}

function scheduleBatch(ns: NS, tasks: Task[], runners: Server[]): boolean {
  const [w, g, w2, h] = tasks;
  let pids: number[] = [];
  if (w?.threads) {
    const wPids = schedule(ns, w, runners);
    pids = pids.concat(wPids);
    if (!wPids.length) {
      return false;
    }
  }
  if (g?.threads) {
    const gPids = schedule(ns, g, runners);
    pids = pids.concat(gPids);
    if (!gPids.length) {
      pids.forEach((pid) => ns.kill(pid));
      return false;
    }
  }
  if (w2?.threads) {
    const w2Pids = schedule(ns, w2, runners);
    pids = pids.concat(w2Pids);
    if (!w2Pids.length) {
      pids.forEach((pid) => ns.kill(pid));
      return false;
    }
  }
  if (h?.threads) {
    const hPids = schedule(ns, h, runners);
    pids = pids.concat(hPids);
    if (!hPids.length) {
      pids.forEach((pid) => ns.kill(pid));
      return false;
    }
  }
  return true;
}

function schedule(ns: NS, task: Task, runners: Server[]): number[] {
  if (!runners.length) {
    ns.printf('no runner available');
    return [];
  }

  //TODO: don't naively cap threads to fit on one machine, but rather split the task over multiple machines
  //to get the wanted result
  const requestedThreads = Math.floor(task.threads);

  let scheduledThreads = 0;
  let pids = [];

  while (scheduledThreads < requestedThreads) {
    let runner = runners.find((x) => x.ramUsed + SCRIPT_COST < x.maxRam)!;
    if (!runner) {
      ns.printf('no runner available');
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

  const secCurr = ns.getServerSecurityLevel(server.hostname);
  const secMin = ns.getServerMinSecurityLevel(server.hostname);
  const secDelta = ns.weakenAnalyze(1);
  const weaken1Threads = Math.ceil((secCurr - secMin) / secDelta);

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
    action: 'w',
    target: server.hostname,
    threads: weaken1Threads,
  };

  const grow: Task = {
    action: 'g',
    target: server.hostname,
    threads: growthThreads,
    delay: weakenTime + 10 - growTime,
  };
  const weaken2: Task = {
    action: 'w',
    target: server.hostname,
    threads: weaken2Threads,
    delay: weakenTime + 20 - growTime,
  };
  const hack: Task = {
    action: 'h',
    target: server.hostname,
    threads: hackThreads,
    delay: weakenTime + 30 - hackTime,
  };

  return [weaken1, grow, weaken2, hack];
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
  const args = ['threads', 'delay', 'action', 'target']
    .filter((key) => !!(task as any)[key])
    .flatMap((key) => [`--${key}`, (task as Record<string, any>)[key]]);
  const pid = ns.exec(EXECUTOR_SCRIPT, task.runner, task.threads, ...(args as any));
  ns.writePort(Ports.Metrics, {
    type: `hacking.${task.action}`,
    time: Date.now(),
    threads: task.threads,
    delay: task.delay,
    runner: task.runner,
    target: task.target,
    pid,
  });
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
