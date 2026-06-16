import type { NS } from '@ns';

export async function main(ns: NS) {
	const target = ns.args[0] as string;
	if (!target) {
		ns.tprint('Usage: run scripts/trace.js <hostname>');
		return;
	}

	const parent = new Map<string, string>();
	const queue = ['home'];
	parent.set('home', '');

	while (queue.length) {
		const host = queue.shift()!;
		if (host === target) {
			const path: string[] = [];
			let cur = target;
			while (cur !== undefined) {
				path.unshift(cur);
				cur = parent.get(cur)!;
			}
			ns.tprint(path.join(' -> '));
			return;
		}
		for (const neighbor of ns.scan(host)) {
			if (!parent.has(neighbor)) {
				parent.set(neighbor, host);
				queue.push(neighbor);
			}
		}
	}

	ns.tprint(`ERROR: ${target} not found`);
}
