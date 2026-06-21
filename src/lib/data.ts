import type { NS, Server } from '@ns';

export type StoredServer = Server & { neighbors: string[]; path: string[] };

export async function getServers(ns: NS): Promise<StoredServer[]> {
	const raw = ns.read('tmp/servers.json');
	if (!raw) return [];
	const stored = JSON.parse(raw) as StoredServer[];
	return stored.map((entry) => ({ ...entry, ...ns.getServer(entry.hostname) }));
}
