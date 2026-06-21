import type { StoredServer } from '@/lib/data';
import type { NS } from '@ns';

export async function main(ns: NS) {
	const target = ns.args[0] as string;
	if (!target) {
		ns.tprint('Usage: run scripts/trace.js <hostname>');
		return;
	}

	const raw = ns.read('tmp/servers.json');
	if (!raw) {
		ns.tprint('ERROR: tmp/servers.json not found — is feat/crawler.js running?');
		return;
	}

	const servers = JSON.parse(raw) as StoredServer[];
	const entry = servers.find((s) => s.hostname === target);
	if (!entry) {
		ns.tprint(`ERROR: ${target} not found`);
		return;
	}

	ns.tprint(entry.path.join(' -> '));
}
