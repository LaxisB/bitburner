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

		// Priority 1: buy a new node
		if (ns.hacknet.numNodes() < maxNodes) {
			await waitForROI();
			const cost = ns.hacknet.getPurchaseNodeCost();
			if (ns.hacknet.purchaseNode() >= 0) {
				totalSpent += cost;
				bought = true;
			}
		}

		if (!bought) {
			// Priority 2-4: level → RAM → core, first node that has room
			outer: for (let i = 0; i < ns.hacknet.numNodes(); i++) {
				for (const [getCost, upgrade] of [
					[() => ns.hacknet.getLevelUpgradeCost(i, 1), () => ns.hacknet.upgradeLevel(i)],
					[() => ns.hacknet.getRamUpgradeCost(i, 1), () => ns.hacknet.upgradeRam(i)],
					[() => ns.hacknet.getCoreUpgradeCost(i, 1), () => ns.hacknet.upgradeCore(i)],
				] as [() => number, () => boolean][]) {
					const cost = getCost();
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
