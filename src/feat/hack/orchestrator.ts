import { NS } from '@ns';
import { updateBlacklist } from './blacklist';
import { cleanPendingTasks, EXECUTOR_SCRIPT, getRam, runningTasks, scheduleBatch, SCRIPT_COST } from './scheduler';
import { getBatch, getPartialBatch, getRunners, getServers, getTargets } from './task-selection';

export async function main(ns: NS) {
  ns.disableLog('ALL');
  ns.ui.openTail();
  let servers = await getServers(ns);

  ns.printf('distributing payload');
  for (const server of servers) {
    ns.scp(EXECUTOR_SCRIPT, server!.hostname, 'home');
  }
  runningTasks.clear();

  ns.printf('starting loop');
  while (true) {
    updateBlacklist(ns);
    cleanPendingTasks(ns);

    servers = await getServers(ns);
    const targets = getTargets(ns, servers);
    const runners = getRunners(servers);
    const player = ns.getPlayer();

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

    // No full batch scheduled use partial batch to prep or generate income
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
