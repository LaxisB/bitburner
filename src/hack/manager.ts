import { Server } from '../utils/domain';
import { HOME } from '../utils/constants';
import * as log from '..//utils/log';
import * as fmt from '../utils/format';
import { Task, ScheduledTask, Scheduler, ServerWithEstimates, createScheduler, HOST_RAM_BLOCKER } from './scheduler';
import type { TableConfig } from '../utils/log';
import type { SlaveArgs } from './slave';
import { NS } from '@ns';

const SCRIPT_SLAVE = '/hack/slave.js';
let SCRIPT_COST = 1;
const DEPLOY = ['utils.js', SCRIPT_SLAVE];

export async function main(ns: NS) {
  ns.disableLog('ALL');
  ns.ui.openTail();

  SCRIPT_COST = ns.getScriptRam(SCRIPT_SLAVE);

  const scheduler = await createScheduler(ns, {
    cost: SCRIPT_COST,
    async execute(action) {
      return runSlave(ns, {
        cmd: action.action,
        runner: action.runner,
        target: action.target,
        threads: action.threads,
      });
    },
  });

  const servers = scheduler.getServers();

  for (const server of servers) {
    ns.scp(DEPLOY, server.hostname, HOME);
  }

  let count = 1;
  while (true) {
    await scheduler.updateServers(count % 10 === 0);
    const runners = scheduler.getAvailableRunners();
    const targets = scheduler.getAvailableTargets();
    const servers = scheduler.getServers();
    logStatus(ns, targets, runners, servers, scheduler.getPendingTasks());
    if (!runners.length) {
      await ns.sleep(1000);
      continue;
    }
    await execute(ns, targets, scheduler);
    await ns.sleep(500);
    count++;
  }
}

/**
 *  simple loop to update all servers
 *  it doesn't execute directly, but pass any action to the scheduler
 */
async function execute(ns: NS, servers: ServerWithEstimates[], scheduler: Scheduler) {
  for (const server of servers) {
    try {
      const action = getNextAction(ns, server);
      await scheduler.schedule(action);
    } catch (e) {
      ns.tprintf(e as any);
      ns.printf('failed running %s', server.hostname);
    }
  }
}

/**
 * figure out what to do next on the given server and with how many threads
 * @param ns NS
 * @param server server to target
 * @returns an action the scheduler should handle
 */
function getNextAction(ns: NS, server: ServerWithEstimates): Task {
  const secCurr = server.security.current;
  const secMin = server.security.min;
  const secDelta = ns.weakenAnalyze(1);

  const moneyMax = server.money.max;
  const moneyCurr = server.money.current;
  // check how often we'd need to grow to max out money
  const growthsPerDouble = ns.growthAnalyze(server.hostname, 2);

  const shouldGrow = moneyCurr <= moneyMax * 0.5;

  const hackTime = ns.getHackTime(server.hostname);
  const hackDelta = moneyCurr * ns.hackAnalyze(server.hostname);
  const maxHackThreads = Math.floor(moneyCurr / hackDelta);

  if (secCurr - secDelta >= secMin) {
    const threads = Math.ceil((secCurr - secMin) / secDelta);
    return {
      target: server.hostname,
      action: 'weaken',
      result: secDelta,
      threads: threads,
      duration: ns.getWeakenTime(server.hostname),
    };
  }

  if (shouldGrow || !server.canHack) {
    return {
      target: server.hostname,
      action: 'grow',
      result: 1 / growthsPerDouble,
      threads: growthsPerDouble,
      duration: ns.getGrowTime(server.hostname),
    };
  }

  return {
    target: server.hostname,
    action: 'hack',
    result: ns.hackAnalyze(server.hostname),
    threads: maxHackThreads,
    duration: hackTime,
  };
}

function logStatus(
  ns: NS,
  targets: ServerWithEstimates[],
  runners: Server[],
  servers: Server[],
  tasks: ScheduledTask[],
) {
  const serverTableConfig: TableConfig<ServerWithEstimates> = {
    padding: 1,
    columns: [
      {
        alignLeft: true,
        header: 'host',
        width: 20,
        getter: (item) => fmt.formatString(item.hostname, 20),
      },
      {
        header: '$',
        width: 10,
        getter: (item) => fmt.formatMoney(item.money.current),
      },
      {
        header: '$ -',
        width: 8,
        getter: (item) => fmt.formatMoney(item.money.hacked),
      },
      {
        header: '$ +',
        width: 8,
        getter: (item) => fmt.formatMoney(item.money.grown),
      },
      {
        header: 'secu Δ',
        width: 6,
        getter: (item) => fmt.formatNum(ns.getServerSecurityLevel(item.hostname) - item.security.min),
      },
      {
        header: 'secu -',
        width: 6,
        getter: (item) => fmt.formatNum(item.security.current - ns.getServerSecurityLevel(item.hostname)),
      },
    ],
  };

  const threads = tasks.reduce((acc, curr) => acc + curr.threads, 0);
  const tasksToShow = tasks.sort((a, b) => a.finishesAt - b.finishesAt).slice(0, 5);
  const potentialRam = servers.reduce(
    (acc, curr) => acc + curr.maxRam - curr.ramUsed - (HOST_RAM_BLOCKER[curr.hostname] ?? 0),
    0,
  );

  const byAction = tasks.reduce((acc, curr) => {
    if (!acc[curr.action]) {
      acc[curr.action] = { count: 0, threads: 0 };
    }
    acc[curr.action].count += 1;
    acc[curr.action].threads += curr.threads;
    return acc;
  }, {} as Record<string, { count: number; threads: number }>);

  log.clear(ns);
  log.table(
    ns,
    targets.filter((s) => s.tasksRunning).sort((a, b) => a.hostname.localeCompare(b.hostname)),
    serverTableConfig,
  );
  ns.print('  ');
  tasksToShow.forEach((task: ScheduledTask) =>
    ns.printf(
      '[%6s] %15s ---> %-15s %-15s for %8s',
      fmt.formatDuration(task.finishesAt - Date.now()),
      fmt.formatString(task.runner),
      fmt.formatString(task.target),
      `${task.action} (x${task.threads})`,
      fmt.formatNum(task.result * task.threads),
    ),
  );
  ns.printf(
    `targets=%-3s runners=%-3s ramUsed=%s ramFree=%s`,
    targets.length.toString().padStart(3, '0'),
    runners.length.toString().padStart(3, '0'),
    fmt.formatRam(threads * SCRIPT_COST),
    fmt.formatRam(potentialRam),
  );
  ns.printf(
    `total=%s(%s) hack=%i(%s) grow=%i(%s) weaken=%i(%s)`,
    fmt.formatNum(tasks.length),
    fmt.formatNum(threads),
    byAction.hack?.count ?? 0,
    fmt.formatNum(byAction.hack?.threads ?? 0),
    byAction.grow?.count ?? 0,
    fmt.formatNum(byAction.grow?.threads ?? 0),
    byAction.weaken?.count ?? 0,
    fmt.formatNum(byAction.weaken?.threads ?? 0),
  );
}

async function runSlave(ns: NS, opts: SlaveArgs) {
  const args = Object.keys(opts).flatMap((key) => [`--${key}`, (opts as Record<string, any>)[key]]);
  return ns.exec(SCRIPT_SLAVE, opts.runner, opts.threads, ...args);
}
