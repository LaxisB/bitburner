import type { NS, Server } from '@ns';

// if we don't make this async, the game explodes
export async function crawlServers(ns: NS, host: string, depth = 10): Promise<Server[]> {
	async function extend(ns: NS, host: string, parent: string, list: Server[], depth = 1) {
		const s = ns.getServer(host);
		list.push(s);

		const children = ns.scan(host).filter((h) => parent !== h);
		children.forEach((host) => {
			list.push(ns.getServer(host));
		});

		if (depth > 0) {
			for (const child of children) {
				await extend(ns, child, host, list, depth - 1);
			}
		}
		return;
	}

	const list: Server[] = [];
	await extend(ns, host, '', list, depth);

	return list;
}
