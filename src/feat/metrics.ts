import type { Event, ExecStartEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import { formatDuration } from '@/lib/format';
import { queueRead } from '@/lib/utils';
import type { NS } from '@ns';

const tasks = new Map<string, ExecStartEvent & { time: number }>();
let events = ['', '', '', '', ''] as string[];

export async function main(ns: NS) {
	tasks.clear();
	ns.disableLog('ALL');
	ns.clearLog();
	ns.ui.openTail();
	let lastRender = 0;
	while (true) {
		if (updateState(ns) || Date.now() - lastRender > 2000) {
			logState(ns);
			lastRender = Date.now();
		}
		await ns.sleep(50);
	}
}

function updateState(ns: NS) {
	ns.disableLog('ALL');
	let count = 0;
	queueRead(ns, Ports.Metrics, (m) => {
		const msg = m as Event;
		count++;
		switch (msg.type) {
			case 'exec_start':
				tasks.set(msg.pid.toString(), { ...msg, time: Date.now() });
				break;
			case 'exec_end':
				tasks.delete(msg.pid.toString());
				break;
			case 'log':
				events.push(msg.message);
				break;
			case 'serverdeath':
				events.push(`Killed ${msg.host}`);
				tasks.forEach((t) => {
					if (t.runner === msg.host) {
						tasks.delete(t.pid.toString());
					}
				});
				break;
		}
	});

	events = events.slice(-5);
	return count > 0;
}

function logState(ns: NS) {
	let threads = 0;
	ns.clearLog();
	const taskTree: Record<string, { next: 0; hack: number; grow: number; weaken: number }> = {};
	tasks.forEach((t) => {
		threads += t.threads;
		//biome-ignore lint/suspicious/noExplicitAny:
		const obj: any = taskTree[t.target] ?? { hack: 0, grow: 0, weaken: 0 };
		obj[t.func] = (obj[t.func] ?? 0) + t.threads;
		const timeRemaining = t.time + (t.delay ?? 0) + (t.duration ?? 0) - Date.now();
		obj.next = obj.next ? Math.min(obj.next, timeRemaining) : timeRemaining;
		taskTree[t.target] = obj;
	});
	const hosts = Object.keys(taskTree).sort();
	ns.printf('Tasks: %i\tThreads: %i', tasks.size, threads);
	hosts.forEach((h) => {
		const stats = taskTree[h];
		ns.printf(
			`${h.slice(0, 15).padEnd(15, ' ')} ${formatDuration(stats.next).padEnd(15, ' ')} weaken(${stats.weaken
				.toString()
				.padStart(4, ' ')}) grow(${stats.grow.toString().padStart(4, ' ')}) hack(${stats.hack
				.toString()
				.padStart(4, ' ')})`,
		);
	});
	ns.print('\n');
	events.forEach((e) => ns.print(e));
}
