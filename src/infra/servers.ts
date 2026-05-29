import type { LogEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import { NS } from '@ns';
const prefix = `NODE`;

/**
 * continuously buys / upgrades servers to run scipts on
 */
export async function main(ns: NS) {
  ns.disableLog('ALL');
  const max = ns.cloud.getServerLimit();
  while (true) {
    const player = ns.getPlayer();
    const maxCost = player.money * 0.3;

    const servers = ns.cloud
      .getServerNames()
      .map((server) => ({ hostname: server, ram: ns.getServerMaxRam(server) }))
      .sort((a, b) => a.ram - b.ram);

    // get max pow
    let pow = 4;
    do {
      pow += 1;
    } while (ns.cloud.getServerCost(2 ** pow) < maxCost);
    const targetRam = 2 ** pow;

    if (servers.length && targetRam <= servers[0].ram) {
      // not a n increase
      await ns.sleep(10_000);
      continue;
    }
    const toDelete = servers[0];
    let deletedAThing = false;
    if (servers.length >= max && toDelete) {
      ns.writePort(Ports.Servers, { added: true, host: toDelete.hostname });
      ns.killall(toDelete.hostname);
      const res = ns.cloud.deleteServer(toDelete.hostname);
      if (!res) {
        ns.printf("couldn't delete...");
        ns.writePort(Ports.Servers, { added: false, host: toDelete.hostname });
        await ns.sleep(10_000);
        continue;
      }
      deletedAThing = true;
    }

    const newServer = ns.cloud.purchaseServer(prefix, targetRam);
    if (toDelete) {
      ns.writePort(Ports.Servers, { added: false, host: toDelete.hostname });
    }
    if (newServer) {
      ns.writePort(Ports.Servers, { added: false, host: newServer });

      ns.writePort(Ports.Metrics, {
        type: 'log',
        message: `${deletedAThing ? `Upgraded from a ${ns.format.ram(toDelete.ram)} to` : 'Bought a'} a ${ns.format.ram(
          2 ** pow,
        )} Server`,
      } satisfies LogEvent);
    }
    await ns.sleep(5_000);
  }
}
