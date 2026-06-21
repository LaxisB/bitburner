import { getServers } from '@/lib/data';
import { ensureSingleton } from '@/lib/utils';
import type { NS, Server } from '@ns';

const SHARE_SCRIPT = '/feat/share/share.js';
const SHARE_RAM = 4;
const HOME_RESERVE = 64;

export async function main(ns: NS) {
	ensureSingleton(ns);
	ns.disableLog('ALL');

	const params = ns.flags([['target', 1.25]]) as { target: number };

	// Pareto target: 25% rep boost.
	const TARGET_BONUS = params.target;
	// Inverse of: bonus = 1 + ln(shareThreads)/25
	const TARGET_THREADS = Math.ceil(Math.exp((TARGET_BONUS - 1) * 25)); // ≈ 519

	while (true) {
		const currentPower = ns.getSharePower();
		if (currentPower < TARGET_BONUS) {
			// Derive gap from live bonus. intel/core bonuses ≥1 so this budget is conservative:
			// we may launch slightly fewer raw threads than needed, but next tick closes the gap.
			const currentEffective = Math.exp((currentPower - 1) * 25);
			let remainingBudget = Math.ceil(TARGET_THREADS - currentEffective);

			const servers = await getServers(ns);
			for (const server of servers) {
				if (remainingBudget <= 0) break;
				remainingBudget -= maybeStartShare(ns, server, remainingBudget);
			}
		}
		await ns.sleep(5000);
	}
}

function maybeStartShare(ns: NS, server: Server, maxThreads: number): number {
	if (!server.hasAdminRights) return 0;

	const reserve = server.hostname === 'home' ? HOME_RESERVE : 0;
	const available = server.maxRam - server.ramUsed - reserve;
	const threads = Math.min(Math.floor(available / SHARE_RAM), maxThreads);
	if (threads < 1) return 0;

	const alreadyRunning = ns.ps(server.hostname).some((p) => p.filename === SHARE_SCRIPT);
	if (alreadyRunning) return 0;

	ns.scp(SHARE_SCRIPT, server.hostname, 'home');

	const pid = ns.exec(SHARE_SCRIPT, server.hostname, threads, '--runner', server.hostname, '--threads', threads);
	if (pid) {
		ns.print(`SUCCESS share on ${server.hostname} (${threads} threads)`);
		return threads;
	}
	ns.print(`WARN failed to start share on ${server.hostname}`);
	return 0;
}
