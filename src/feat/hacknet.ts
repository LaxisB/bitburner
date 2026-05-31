/**
 * buy and upgrade hacknet nodes for income
 */
import type { NS } from '@ns';

export async function main(ns: NS) {
	ns.disableLog('ALL');
	const maxNodes = ns.hacknet.maxNumNodes();
	let totalSpent = 0;

	function totalProduction(): number {
		let prod = 0;
		for (let i = 0; i < ns.hacknet.numNodes(); i++) {
			prod += ns.hacknet.getNodeStats(i).totalProduction;
		}
		return prod;
	}

	async function waitForROI() {
		while (totalProduction() < totalSpent) {
			await ns.sleep(10_000);
		}
	}

	while (true) {
		let bought = false;

		if (ns.hacknet.numNodes() < maxNodes) {
			await waitForROI();
			const cost = ns.hacknet.getPurchaseNodeCost();
			if (ns.hacknet.purchaseNode() >= 0) {
				totalSpent += cost;
				bought = true;
			}
		}

		if (!bought) {
			outer: for (const getUpgrade of [
				(i: number) => [ns.hacknet.getLevelUpgradeCost(i, 1), () => ns.hacknet.upgradeLevel(i)] as const,
				(i: number) => [ns.hacknet.getRamUpgradeCost(i, 1), () => ns.hacknet.upgradeRam(i)] as const,
				(i: number) => [ns.hacknet.getCoreUpgradeCost(i, 1), () => ns.hacknet.upgradeCore(i)] as const,
			]) {
				for (let i = 0; i < ns.hacknet.numNodes(); i++) {
					const [cost, upgrade] = getUpgrade(i);
					// biome-ignore lint: Infinity is what the functions return
					if (cost === Infinity) continue;
					await waitForROI();
					if (upgrade()) {
						totalSpent += cost;
						bought = true;
						break outer;
					}
				}
			}
		}

		if (!bought) {
			await ns.sleep(30_000);
		}
	}
}
