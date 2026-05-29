import { Server } from '@/utils/domain';
import { crawlServers } from '@/utils/servers';
import { NS, Player } from '@ns';
import { Task } from './domain';
import { getRam, runningTasks } from './scheduler';

export function getTargets(ns: NS, servers: Server[]) {
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

export function getRunners(servers: Server[]) {
  return servers.filter((x) => x.hasAdminRights).sort((a, b) => getRam(b) - getRam(a));
}

export async function getServers(ns: NS) {
  const servers = await crawlServers(ns, 'home');
  const byHostname: Record<string, Server> = servers.reduce((acc, curr) => ({ ...acc, [curr.hostname]: curr }), {});
  return Object.values(byHostname);
}

export function getWeaken(ns: NS, server: Server): Task {
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

export function getBatch(ns: NS, server: Server, player: Player): Task[] | null {
  const pending = runningTasks.get(server.hostname);

  //TODO if we were smart, we'd forecast the result of our pending tasks and already queue the next one
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
    : Math.min(8, ns.growthAnalyze(server.hostname, (server.moneyMax ?? 1) / (server.moneyAvailable ?? 1)));

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

export function getPartialBatch(ns: NS, server: Server, player: Player, maxThreads: number): Task[] | null {
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

  // Tier 2: money below max: grow + counter weaken
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

export function hasFormulas(ns: NS) {
  try {
    ns.formulas.hacking.weakenTime(ns.getServer('foodnstuff'), ns.getPlayer());
    return true;
  } catch {
    return false;
  }
}
