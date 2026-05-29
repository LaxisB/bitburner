import type { Event, ExecStartEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import { formatDuration } from '@/lib/format';
import { crawlServers } from '@/lib/servers';
import { queueRead } from '@/lib/utils';
import type { NS, Server } from '@ns';

const tasks = new Map<string, ExecStartEvent & { time: number }>();
let events = ['', '', '', '', ''] as string[];

const FONT_SIZE = 16;
const CHAR_WIDTH = 50;

export async function main(ns: NS) {
	tasks.clear();
	ns.disableLog('ALL');
	ns.clearLog();
	ns.ui.openTail();
	ns.ui.setTailTitle('Server Metrics');
	ns.ui.resizeTail(CHAR_WIDTH * FONT_SIZE, 40 * FONT_SIZE);
	ns.ui.setTailFontSize(FONT_SIZE);
	let lastRender = 0;
	while (true) {
		if (updateState(ns) || Date.now() - lastRender > 2000) {
			const servers = await crawlServers(ns, 'home');
			logState(ns, servers);
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

function logState(ns: NS, servers: Server[]) {
	ns.clearLog();
	const hackLevel = ns.getHackingLevel();

	const taskByTarget = new Map<string, { next: number; weaken: number; grow: number; hack: number }>();
	tasks.forEach((t) => {
		const entry = taskByTarget.get(t.target) ?? { next: Number.POSITIVE_INFINITY, weaken: 0, grow: 0, hack: 0 };
		entry.next = Math.min(entry.next, t.time + (t.delay ?? 0) + (t.duration ?? 0) - Date.now());
		entry[t.func as 'weaken' | 'grow' | 'hack'] = (entry[t.func as 'weaken' | 'grow' | 'hack'] ?? 0) + 1;
		taskByTarget.set(t.target, entry);
	});

	const serverRows = servers
		.filter(
			(s) =>
				s &&
				!s.purchasedByPlayer &&
				s.hasAdminRights &&
				ns.getServerRequiredHackingLevel(s.hostname) <= hackLevel &&
				(s.moneyMax ?? 0) > 0,
		)
		.map((s) => {
			const fresh = ns.getServer(s.hostname);
			const money = fresh.moneyAvailable ?? 0;
			const moneyMax = fresh.moneyMax ?? 1;
			const task = taskByTarget.get(fresh.hostname);
			return {
				hostname: fresh.hostname,
				money,
				moneyMax,
				moneyPct: (money / moneyMax) * 100,
				sec: fresh.hackDifficulty ?? 0,
				minSec: fresh.minDifficulty ?? 0,
				duration: task ? formatDuration(task.next) : '-',
				weaken: task?.weaken ?? 0,
				grow: task?.grow ?? 0,
				hack: task?.hack ?? 0,
			};
		})
		.sort((a, b) => b.moneyMax - a.moneyMax);

	ns.printf('%-20s %10s %6s %6s %6s %10s %4s %4s %4s', 'Server', 'Money', '%', 'Sec', 'Min', 'Duration', 'W', 'G', 'H');
	ns.printf(
		'%-20s %10s %6s %6s %6s %10s %4s %4s %4s',
		'--------------------',
		'----------',
		'------',
		'------',
		'------',
		'----------',
		'----',
		'----',
		'----',
	);
	for (const r of serverRows) {
		ns.printf(
			'%-20s %10s %5.1f%% %6.2f %6.2f %10s %4i %4i %4i',
			r.hostname,
			ns.format.number(r.money),
			r.moneyPct,
			r.sec,
			r.minSec,
			r.duration,
			r.weaken,
			r.grow,
			r.hack,
		);
	}

	ns.print('\n ');
	events.forEach((e) => ns.print(e));
}
