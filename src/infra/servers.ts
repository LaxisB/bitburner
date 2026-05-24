import * as fmt from '../utils/format';
import { NS } from '@ns';
const prefix = `NODE`;

export async function main(ns: NS) {
  ns.disableLog('ALL');
  const max = ns.cloud.getServerLimit();
  while (true) {
    const player = ns.getPlayer();
    const maxCost = player.money * 0.1;

    const servers = ns.cloud
      .getServerNames()
      .map((server) => ({ host: server, ram: ns.getServerMaxRam(server) }))
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
    if (servers.length >= max) {
      const toDelete = servers[0];
      ns.printf(
        '[%s] reached limit. deleting smallest node (ram=%s)',
        new Date().toLocaleTimeString(),
        fmt.formatRam(toDelete.ram),
      );
      ns.killall(toDelete.host);
      const res = ns.cloud.deleteServer(toDelete.host);
      if (!res) {
        ns.printf("couldn't delete...");
        await ns.sleep(10_000);
        continue;
      }
    }
    ns.printf('[%s] bought a %s box', new Date().toLocaleTimeString(), fmt.formatRam(2 ** pow));
    ns.cloud.purchaseServer(prefix, targetRam);
    await ns.sleep(5_000);
  }
}
