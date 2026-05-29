import type { NS, Server } from '@ns';

// if we don't make this async, the game explodes
export async function crawlServers(ns: NS, host: string, depth = 20): Promise<Server[]> {
	const found: Record<string, Server> = {};

	async function extend(ns: NS, host: string, depth = 1) {
		found[host] = ns.getServer(host);

		const children = ns.scan(host).filter((h) => !found[h]);
		for (const child of children) {
			found[child] = ns.getServer(child);
		}

		if (depth > 0) {
			for (const child of children) {
				await extend(ns, child, depth - 1);
			}
		}
	}

	await extend(ns, host, depth);

	return Object.values(found);
}
