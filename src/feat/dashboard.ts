import type { Event, ExecStartEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import { formatDuration } from '@/lib/format';
import { crawlServers } from '@/lib/network';
import { ensureSingleton, queueRead } from '@/lib/utils';
import type { NS, Server } from '@ns';

const tasks = new Map<string, ExecStartEvent & { time: number }>();
const recentByTarget = new Map<string, string>();
let events = ['', '', '', '', ''] as string[];

function taskChar(func: string): string {
	if (func === 'weaken') return 'w';
	if (func === 'grow') return 'g';
	if (func === 'hack') return 'h';
	return '?';
}

export async function main(ns: NS) {
	ensureSingleton(ns);

	const params = ns.flags([['full', false]]) as { full: boolean };
	ns.disableLog('ALL');
	ns.clearLog();
	ns.ui.openTail();
	ns.ui.setTailTitle('Dashboard');
	let lastRender = 0;
	while (true) {
		if (updateState(ns) || Date.now() - lastRender > 2000) {
			const servers = await crawlServers(ns, 'home');
			logState(ns, servers, params);
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
			case 'exec_end': {
				tasks.delete(msg.pid.toString());
				const prev = recentByTarget.get(msg.target) ?? '';
				const char = taskChar(msg.func);
				if (prev.at(-1) !== char) recentByTarget.set(msg.target, (prev + char).slice(-10));
				break;
			}
			case 'log':
				events.push(msg.message);
				break;
			case 'serverdeath':
				tasks.forEach((t) => {
					if (t.runner === msg.host) {
						tasks.delete(t.pid.toString());
					}
				});
				break;
		}
	});

	// Remove tasks whose deadline has long passed; usually orphaned by killed scripts that never sent exec_end
	const now = Date.now();
	tasks.forEach((t, key) => {
		if (t.time + (t.delay ?? 0) + (t.duration ?? 0) < now - 10_000) tasks.delete(key);
	});

	events = events.slice(-5);
	return count > 0;
}

function logState(ns: NS, servers: Server[], params: { full: boolean }) {
	ns.clearLog();
	const [scriptIncome] = ns.getTotalScriptIncome();
	const scriptExp = ns.getTotalScriptExpGain();
	const hackLevel = ns.getHackingLevel();
	ns.printf('Script Income: %-10s\tScript Exp: %-10s', ns.format.number(scriptIncome), ns.format.number(scriptExp));

	if (params.full) {
		const taskByTarget = new Map<string, { next: number; weaken: number; grow: number; hack: number }>();
		tasks.forEach((t) => {
			const entry = taskByTarget.get(t.target) ?? { next: Number.POSITIVE_INFINITY, weaken: 0, grow: 0, hack: 0 };
			entry.next = Math.min(entry.next, t.time + (t.delay ?? 0) + (t.duration ?? 0) - Date.now());
			entry[t.func as 'weaken' | 'grow' | 'hack'] = (entry[t.func as 'weaken' | 'grow' | 'hack'] ?? 0) + t.threads;
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
			.sort((a, b) => a.hostname.localeCompare(b.hostname))
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
					history: recentByTarget.get(fresh.hostname) ?? '',
				};
			});
		ns.printf(
			'%-20s %10s %6s %6s %10s %6s %6s %6s %10s',
			'Server',
			'Money',
			'%',
			'Sec↓',
			'Next',
			'W',
			'G',
			'H',
			'Hist',
		);
		ns.printf(
			'%-20s %10s %6s %6s %10s %4s %4s %4s %10s',
			'--------------------',
			'----------',
			'------',
			'------',
			'----------',
			'------',
			'------',
			'------',
			'----------',
		);
		for (const r of serverRows) {
			ns.printf(
				'%-20s %10s %5.1f%% %6.2f %10s %6i %6i %6i %10s',
				r.hostname,
				ns.format.number(r.money),
				r.moneyPct,
				r.sec - r.minSec,
				r.duration,
				r.weaken,
				r.grow,
				r.hack,
				r.history,
			);
		}
	}

	ns.print('\n ');
	events.forEach((e) => ns.print(e));
}
