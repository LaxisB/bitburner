/**
 * buy and upgrade hacknet nodes for income
 */
import { ensureSingleton } from '@/lib/utils';
import type { NS } from '@ns';

export async function main(ns: NS) {
	ns.disableLog('ALL');
	ensureSingleton(ns);
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
		await waitForROI();

		// biome-ignore lint: Infinity is what the functions return
		let bestCost = Infinity;
		let bestAction: (() => boolean) | null = null;

		if (ns.hacknet.numNodes() < maxNodes) {
			const cost = ns.hacknet.getPurchaseNodeCost();
			if (cost < bestCost) {
				bestCost = cost;
				bestAction = () => ns.hacknet.purchaseNode() >= 0;
			}
		}

		for (let i = 0; i < ns.hacknet.numNodes(); i++) {
			const candidates: [number, () => boolean][] = [
				[ns.hacknet.getLevelUpgradeCost(i, 1), () => ns.hacknet.upgradeLevel(i)],
				[ns.hacknet.getRamUpgradeCost(i, 1), () => ns.hacknet.upgradeRam(i)],
				[ns.hacknet.getCoreUpgradeCost(i, 1), () => ns.hacknet.upgradeCore(i)],
			];
			for (const [cost, action] of candidates) {
				if (cost < bestCost) {
					bestCost = cost;
					bestAction = action;
				}
			}
		}

		if (bestAction?.()) {
			totalSpent += bestCost;
		}
	}
}
