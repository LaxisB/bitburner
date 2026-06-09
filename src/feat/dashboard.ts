import type { Event, ExecStartEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import { crawlServers } from '@/lib/network';
import { ensureSingleton, queueRead } from '@/lib/utils';
import type { NS, Server } from '@ns';

const RAM_COST: Record<string, number> = { grow: 1.75, weaken: 1.75, hack: 1.75, share: 4 };
const LOG_LENGTH = 10;

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
		if (t.time + (t.delay ?? 0) + (t.duration ?? 0) < now - 2_000) tasks.delete(key);
	});

	events = events.slice(-LOG_LENGTH);
	return count > 0;
}

function logState(ns: NS, servers: Server[], params: { full: boolean }) {
	ns.clearLog();
	const [scriptIncome] = ns.getTotalScriptIncome();
	const scriptExp = ns.getTotalScriptExpGain();
	const hackLevel = ns.getHackingLevel();
	ns.printf('Script Income: %-10s\tScript Exp: %-10s', ns.format.number(scriptIncome), ns.format.number(scriptExp));

	const totalRam = servers.filter((s) => s.hasAdminRights).reduce((a, s) => a + s.maxRam, 0);
	const bar = ramBar(tasks.values(), { width: 45, totalRam });
	ns.print(`RAM: ${bar}`);

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
					weaken: task?.weaken ?? 0,
					grow: task?.grow ?? 0,
					hack: task?.hack ?? 0,
					history: recentByTarget.get(fresh.hostname) ?? '',
				};
			})
			.filter((s) => s.weaken || s.hack || s.grow); // only show servers with active tasks
		ns.printf('%-20s %10s %6s %6s %6s %6s %6s %10s', 'Server', 'Money', '%', 'Sec↓', 'W', 'G', 'H', 'Hist');
		ns.printf(
			'%-20s %10s %6s %6s %6s %6s %6s %10s',
			'--------------------',
			'----------',
			'------',
			'------',
			'------',
			'------',
			'------',
			'----------',
		);
		for (const r of serverRows) {
			ns.printf(
				'%-20s %10s %5.1f%% %6.2f %6s %6s %6s %10s',
				r.hostname,
				ns.format.number(r.money),
				r.moneyPct,
				r.sec - r.minSec,
				r.weaken || '',
				r.grow || '',
				r.hack || '',
				r.history,
			);
		}
		ns.print('\n ');
	}

	events.forEach((e) => ns.print(e));
}
type RamBarOpts = {
	width: number;
	totalRam: number;
	chars?: Partial<Record<string, string>>;
	colors?: Partial<Record<string, string>>;
};

const DEFAULT_CHARS: Record<string, string> = { grow: 'g', weaken: 'w', hack: 'h', share: 's' };
const DEFAULT_COLORS: Record<string, string> = {
	grow: '\x1b[32m',
	weaken: '\x1b[36m',
	hack: '\x1b[31m',
	share: '\x1b[33m',
};
const RESET = '\x1b[0m';

function ramBar(tasks: Iterable<ExecStartEvent & { time: number }>, opts: RamBarOpts): string {
	const { width, totalRam, chars = DEFAULT_CHARS, colors = DEFAULT_COLORS } = opts;
	const inner = width - 2;
	const ramBy: Record<string, number> = {};
	for (const t of tasks) {
		const cost = RAM_COST[t.func] ?? 1.75;
		ramBy[t.func] = (ramBy[t.func] ?? 0) + t.threads * cost;
	}

	const order = ['weaken', 'grow', 'hack', 'share'];
	const allActions = [...order, ...Object.keys(ramBy).filter((a) => !order.includes(a))];
	let bar = '';
	let filled = 0;

	for (const action of allActions) {
		const ram = ramBy[action] ?? 0;
		if (ram === 0 || filled >= inner) continue;
		const slots = Math.min(inner - filled, Math.round((ram / totalRam) * inner));
		if (slots <= 0) continue;
		const char = (chars[action] ?? '?')[0];
		const color = colors[action] ?? '';
		bar += color + char.repeat(slots) + (color ? RESET : '');
		filled += slots;
	}
	bar += ' '.repeat(inner - filled);
	return `[${bar}]`;
}
