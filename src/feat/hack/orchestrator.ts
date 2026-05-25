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

export async function main(ns: NS) {
  ns.disableLog('ALL');
  ns.ui.openTail();
  let servers = await getServers(ns);

  ns.printf('distributing slave script');
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
      if (hasFormulas(ns)) {
        const batch = getBatch(ns, target, player);
        ns.printf('Suggested Batch: %j', batch);
      }
      const task = getTargetAction(ns, target);
      if (task) {
        const success = schedule(ns, task, runners);
        if (!success) {
          // could not schedule task => no more space. stop here
          break;
        }
      }
    }

    await ns.sleep(1000);
  }
}

function schedule(ns: NS, task: Task, runners: Server[]): boolean {
  const runner = runners[0];
  if (!runner) {
    ns.printf('no runner available');
    return false;
  }

  //TODO: don't naively cap threads to fit on one machine, but rather split the task over multiple machines
  //to get the wanted result
  const requestedThreads = Math.floor(task.threads);
  const possibleThreads = Math.floor(getRam(runner) / SCRIPT_COST);
  if (possibleThreads < 1) {
    return false;
  }
  const scheduled: ScheduledTask = {
    ...task,
    runner: runner.hostname,
    threads: Math.min(requestedThreads, possibleThreads),
    pid: -1,
  };

  const pid = executeTask(ns, scheduled);
  scheduled.pid = pid;
  if (pid) {
    // mutate runner state to update memory
    // we are getting fresh data the next time we run, so this isn't permanent
    runner.ramUsed += SCRIPT_COST * scheduled.threads;

    const running = runningTasks.get(task.target) ?? [];
    running.push(scheduled);
    runningTasks.set(task.target, running); // store after mutation in case .get() returned null
    ns.printf('%s -- %s x%i -> %s', scheduled.runner, scheduled.action, scheduled.threads, scheduled.target);
  }

  return !!pid;
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
  const weakenTime = ns.formulas.hacking.weakenTime(server, player);
  const growTime = ns.formulas.hacking.growTime(server, player);
  const hackTime = ns.formulas.hacking.hackTime(server, player);

  const secCurr = ns.getServerSecurityLevel(server.hostname);
  const secMin = ns.getServerMinSecurityLevel(server.hostname);
  const secDelta = ns.weakenAnalyze(1);
  const weaken1Threads = Math.ceil((secCurr - secMin) / secDelta);

  const growthThreads = ns.formulas.hacking.growThreads(server, player, server.moneyMax ?? Number.MAX_SAFE_INTEGER);

  const growthEffect = ns.growthAnalyzeSecurity(growthThreads);
  const weaken2Threads = Math.ceil((secMin + growthEffect) / secDelta);

  // factor to multiply our required hack threads with to handle hacking failures
  // we're adjusting the 'raw' factor down by 1x in case we high roll.
  const failureFactor = Math.max(1, Math.floor(1 / ns.formulas.hacking.hackChance(server, player)) - 1);
  const rawHackThreadsRequired = 100 / ns.formulas.hacking.hackPercent(server, player);
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
    delay: weakenTime + 1 - growTime,
  };
  const weaken2: Task = {
    action: 'w',
    target: server.hostname,
    threads: weaken2Threads,
    delay: weakenTime + 2 - growTime,
  };
  const hack: Task = {
    action: 'h',
    target: server.hostname,
    threads: hackThreads,
    delay: weakenTime + 3 - hackTime,
  };

  return [weaken1, grow, weaken2, hack];
}

function getTargetAction(ns: NS, server: Server): Task | null {
  const pending = runningTasks.get(server.hostname);

  //TODO if we were smart, we'd forecast the result of our pending tasks and already queue the next one
  // alas, we're not
  if (pending?.length) {
    return null;
  }
  const secCurr = ns.getServerSecurityLevel(server.hostname);
  const secMin = ns.getServerMinSecurityLevel(server.hostname);
  const secDelta = ns.weakenAnalyze(1);

  const moneyMax = server.moneyMax ?? 1;
  const moneyCurr = server.moneyAvailable ?? 0;
  const currentToMaxMultiplier = Math.min(Math.max(1, moneyMax / (moneyCurr || 1)), 10); // cap out at 10xing

  const growthsToMax = Math.floor(ns.growthAnalyze(server.hostname, currentToMaxMultiplier));
  // check how often we'd need to grow to max out money

  const shouldGrow = moneyCurr <= moneyMax * 0.5;

  const hackTime = ns.getHackTime(server.hostname);
  const hackDelta = moneyCurr * ns.hackAnalyze(server.hostname);
  const maxHackThreads = Math.max(Math.floor(moneyCurr / hackDelta), 1);

  if (secCurr - secDelta >= secMin + 0.03) {
    const threads = Math.ceil((secCurr - secMin) / secDelta);
    return {
      target: server.hostname,
      action: 'w',
      threads: threads,
    };
  }

  if (shouldGrow && growthsToMax >= 1) {
    return {
      target: server.hostname,
      action: 'g',
      threads: growthsToMax,
    };
  }

  return {
    target: server.hostname,
    action: 'h',
    threads: maxHackThreads,
  };
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
  const servers = await crawlServers(ns, 'home', 100);
  return servers.filter((x) => !!x) as Server[];
}

const getRam = (server: Server) => server.maxRam - server.ramUsed - (HOST_RAM_BLOCKER[server.hostname] ?? 0);

function executeTask(ns: NS, task: ScheduledTask) {
  const args = ['threads', 'delay', 'action', 'target']
    .filter((key) => !!(task as any)[key])
    .flatMap((key) => [`--${key}`, (task as Record<string, any>)[key]]);
  return ns.exec(EXECUTOR_SCRIPT, task.runner, task.threads, ...(args as any));
}

function hasFormulas(ns: NS) {
  try {
    ns.formulas.hacking.weakenTime(ns.getServer('foodnstuff'), ns.getPlayer());
    return true;
  } catch {
    return false;
  }
}
