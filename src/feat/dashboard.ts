import type { Event, ExecStartEvent } from '@/domain';
import { scoreTarget } from '@/feat/hack/task-selection';
import { Ports } from '@/lib/constants';
import { crawlServers } from '@/lib/network';
import { ensureSingleton, queueRead } from '@/lib/utils';
import type { NS, Server } from '@ns';

const RAM_COST: Record<string, number> = { grow: 1.75, weaken: 1.75, hack: 1.75, share: 4 };
const LOG_LENGTH = 4;

const RAMBAR_WIDTH = 78;
const TASKBAR_WIDTH = 45;

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
	ns.ui.resizeTail(800, 600);
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
	// remove orphans
	tasks.forEach((t, key) => {
		if (!ns.isRunning(t.pid, t.runner)) {
			tasks.delete(key);
		}
	});

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
				if (prev.at(-1) !== char) {
					// replace batch hits with b and limit to 10 entries
					const hist = (prev + char).replaceAll('gwhw', 'b').slice(-10);
					recentByTarget.set(msg.target, hist);
				}
				break;
			}
			case 'log': {
				const lastLog = events[events.length - 1];
				// skip logging if it's `BATCH <server>` messages
				if (msg.message.startsWith('+BATCH')) {
					break;
				}
				events.push(msg.message);
				break;
			}
			case 'serverdeath':
				tasks.forEach((t) => {
					if (t.runner === msg.host) {
						tasks.delete(t.pid.toString());
					}
				});
				break;
		}
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
	const bar = ramBar(tasks.values(), { width: RAMBAR_WIDTH, totalRam });
	ns.print(`RAM: ${bar}`);

	if (params.full) {
		const tasksByTarget = new Map<string, (ExecStartEvent & { time: number })[]>();
		tasks.forEach((t) => {
			const arr = tasksByTarget.get(t.target) ?? [];
			arr.push(t);
			tasksByTarget.set(t.target, arr);
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
				return {
					hostname: fresh.hostname,
					moneyPct: (money / moneyMax) * 100,
					sec: fresh.hackDifficulty ?? 0,
					minSec: fresh.minDifficulty ?? 0,
					history: recentByTarget.get(fresh.hostname) ?? '',
					score: scoreTarget(ns, fresh),
				};
			})
			.filter((s) => tasksByTarget.has(s.hostname))
			.sort((a, b) => b.score - a.score)
			.slice(0, 15);
		ns.printf('%-20s %6s %6s  %s', 'Server', '$ %', 'Sec↓', `[${'task graph'.padEnd(TASKBAR_WIDTH)}]`);
		ns.printf('%-20s %6s %6s  %s', '--------------------', '------', '------', `[${'-'.repeat(TASKBAR_WIDTH)}]`);
		for (const r of serverRows) {
			ns.printf(
				'%-20s %5.1f%% %6.2f  %s',
				r.hostname,
				r.moneyPct,
				r.sec - r.minSec,
				taskBar(r.history, tasksByTarget.get(r.hostname) ?? []),
			);
		}
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

function taskBar(history: string, liveTasks: (ExecStartEvent & { time: number })[]): string {
	const inner = TASKBAR_WIDTH;
	const sorted = liveTasks.slice().sort((a, b) => {
		const endA = a.time + (a.delay ?? 0) + (a.duration ?? 0);
		const endB = b.time + (b.delay ?? 0) + (b.duration ?? 0);
		return endA - endB;
	});
	const hist = history.slice(-inner);
	const remaining = inner - hist.length;
	const liveCount = Math.min(sorted.length, remaining);
	const liveChars = sorted
		.slice(0, liveCount)
		.map((t) => {
			const char = DEFAULT_CHARS[t.func] ?? '?';
			const color = DEFAULT_COLORS[t.func] ?? '';
			return color + char + (color ? RESET : '');
		})
		.join('');
	const padding = ' '.repeat(remaining - liveCount);
	return `[${hist}${liveChars}${padding}]`;
}

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
