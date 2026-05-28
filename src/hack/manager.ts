import { Server } from '../utils/domain';
import { HOME } from '../utils/constants';
import * as log from '..//utils/log';
import * as fmt from '../utils/format';
import { Task, ScheduledTask, Scheduler, ServerWithEstimates, createScheduler } from './scheduler';
import type { TableConfig } from '../utils/log';
import type { SlaveArgs } from './slave';
import { NS } from '@ns';

const SCRIPT_SLAVE = '/hack/slave.js';
let SCRIPT_COST = 2;
const DEPLOY = ['utils.js', SCRIPT_SLAVE];

const serverEstimates = new Map<string, Server>();

/**
 * main script setting up the server hacking loop
 *
 */
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
        delay: action.delay ?? 0,
      });
    },
  });

  const servers = scheduler.getServers();

  for (const server of servers) {
    ns.scp(DEPLOY, server.hostname, HOME);
    serverEstimates.set(server.hostname, server);
  }

  let count = 1;
  while (true) {
    await scheduler.updateServers(count % 10 === 0); // do a full crawl every 10 updates ~= every 5 sec
    const runners = scheduler.getAvailableRunners();
    const targets = scheduler.getAvailableTargets();
    const servers = scheduler.getServers();
    logStatus(ns, targets, runners, servers, scheduler.getPendingTasks());
    if (!runners.length) {
      await ns.sleep(1000);
      continue;
    }
    await execute(ns, targets, scheduler);
    await ns.sleep(1000);
    count++;
  }
}

/**
 *  simple loop to update all servers
 *  it doesn't execute directly, but pass any action to the scheduler
 *
 *  this decides what to execute (weaken, grow, hack) on the servers and schedules the task
 */
async function execute(ns: NS, servers: ServerWithEstimates[], scheduler: Scheduler) {
  for (const server of servers) {
    const pendingTasks = scheduler.getPendingTasks().filter((x) => x.target == server.hostname);
    if (pendingTasks.length > 3) {
      continue;
    }
    try {
      const action = getNextAction(ns, server);
      //  don't run duplicate tasks
      if (pendingTasks.find((x) => x.action === action.action)) {
        continue;
      }
      const res = await scheduler.schedule(action);
      if (!res) {
        // no runners available. wait until we're good again
        break;
      }
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
  const secCurr = ns.getServerSecurityLevel(server.hostname);
  const secMin = server.security.min;
  const secDelta = ns.weakenAnalyze(1);

  const moneyMax = server.money.max;
  const moneyCurr = ns.getServer(server.hostname).moneyAvailable ?? 0;
  const moneyMissing = moneyMax - moneyCurr;
  const currentToMaxMultiplier = Math.min((moneyCurr + moneyMissing) / (moneyCurr || 1), 10); // cap out at 10xing

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
      result: secDelta,
      threads: threads,
      duration: ns.getWeakenTime(server.hostname),
    };
  }

  if (shouldGrow && growthsToMax >= 1) {
    return {
      target: server.hostname,
      action: 'g',
      result: 1 / growthsToMax,
      threads: growthsToMax,
      duration: ns.getGrowTime(server.hostname),
    };
  }

  return {
    target: server.hostname,
    action: 'h',
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
        header: '$ (% max)',
        width: 16,
        getter: (item) =>
          `${fmt.formatMoney(item.money.current)} (${ns.format.percent(item.money.current / item.money.max)})`,
      },
      {
        header: 'sec (over base)',
        width: 16,
        getter: (item) =>
          `${ns.format.number(ns.getServerSecurityLevel(item.hostname))} (${fmt.formatNum(
            (ns.getServerSecurityLevel(item.hostname) - ns.getServerMinSecurityLevel(item.hostname)) /
              ns.getServerMinSecurityLevel(item.hostname),
          )}x)`,
      },
      {
        header: ' grow |  weak |  hack ',
        width: 20,
        getter: (item) => {
          const running = (tasks ?? [])
            .filter((t) => t.target == item.hostname)
            .reduce(
              (acc, curr) => {
                acc[curr.action as 'g' | 'w' | 'h'] += curr.threads;
                return acc;
              },
              { g: 0, h: 0, w: 0 },
            );
          return `${running.g.toString().padStart(5, ' ')} | ${running.w.toString().padStart(5, ' ')} | ${running.h
            .toString()
            .padStart(5, ' ')}`;
        },
      },
    ],
  };

  const threads = tasks.reduce((acc, curr) => acc + curr.threads, 0);
  const potentialRam = servers.reduce((acc, curr) => acc + curr.maxRam - curr.ramUsed, 0) ?? 0;

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
    targets.sort((a, b) => a.hostname.localeCompare(b.hostname)),
    serverTableConfig,
  );
  ns.printf(
    `targets: %-3s runners: %-3s ram used: %s free: %s`,
    targets.length.toString().padStart(3, '0'),
    runners.length.toString().padStart(3, '0'),
    ns.format.ram(threads * SCRIPT_COST).padEnd(10, ' '),
    ns.format.ram(potentialRam),
  );

  ns.printf(
    `hack: %i(%s) grow: %i(%s) weaken: %i(%s)`,
    byAction.h?.count ?? 0,
    fmt.formatNum(byAction.h?.threads ?? 0),
    byAction.g?.count ?? 0,
    fmt.formatNum(byAction.g?.threads ?? 0),
    byAction.w?.count ?? 0,
    fmt.formatNum(byAction.w?.threads ?? 0),
  );
}

async function runSlave(ns: NS, opts: SlaveArgs) {
  const args = Object.keys(opts).flatMap((key) => [`--${key}`, (opts as Record<string, any>)[key]]);
  return ns.exec(SCRIPT_SLAVE, opts.runner, opts.threads, ...args);
}
