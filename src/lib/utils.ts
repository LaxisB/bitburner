import type { NS } from '@ns';

export function groupBy<T, R extends string | number>(list: T[], getter: (val: T) => R): Record<R, T[]> {
	return list.reduce(
		(acc, curr) => {
			const key = getter(curr);
			const list = (acc[key] ?? []) as T[];
			list.push(curr);
			acc[key] = list;
			return acc;
		},
		{} as Record<R, T[]>,
	);
}

export function queueWrite(ns: NS, queue: number, data: unknown) {
	const failed = ns.writePort(queue, data);
	return !!failed;
}

export function queueRead(ns: NS, queue: number, cb: (data: unknown) => void) {
	let msg = ns.readPort(queue);
	while (msg !== 'NULL PORT DATA') {
		cb(msg);
		msg = ns.readPort(queue);
	}
}

export async function queueReadAsync(ns: NS, queue: number, cb: (data: unknown) => Promise<unknown>) {
	let msg = ns.readPort(queue);
	while (msg !== 'NULL PORT DATA') {
		await cb(msg);
		msg = ns.readPort(queue);
	}
}

export async function ensureSingleton(ns: NS) {
	ns.ps()
		.filter((p) => p.filename === ns.getScriptName() && p.pid !== ns.pid)
		.forEach((p) => ns.kill(p.pid));
}
