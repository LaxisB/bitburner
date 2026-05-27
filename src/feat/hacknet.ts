import { NS } from '@ns';

export async function main(ns: NS) {
  ns.disableLog('ALL');
  const maxNodes = ns.hacknet.maxNumNodes();
  while (true) {
    // buy nodes
    while (maxNodes > ns.hacknet.numNodes() && ns.hacknet.purchaseNode() >= 0) {
      await ns.sleep(100);
    }
    // simply buy max levels, ram, cores for each node in that order
    // continue once we're out of money
    for (let i = 0; i < ns.hacknet.numNodes(); i++) {
      while (ns.hacknet.upgradeLevel(i)) {}
      while (ns.hacknet.upgradeRam(i)) {}
      while (ns.hacknet.upgradeCore(i)) {}
    }
    await ns.sleep(30_000);
  }
}
