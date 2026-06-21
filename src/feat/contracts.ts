// caution:
// this is entirely slopped by claude until i start caring about this feature to impl myself

import type { LogEvent } from '@/domain';
import { solveContract } from '@/lib/contracts';
import { Ports } from '@/lib/constants';
import { crawlServers } from '@/lib/network';
import { ensureSingleton, queueWrite } from '@/lib/utils';
import type { NS } from '@ns';

const SLEEP_MS = 5 * 60 * 1000;
const MIN_TRIES = 2;

export async function main(ns: NS): Promise<void> {
	await ensureSingleton(ns);
	ns.disableLog('ALL');
	while (true) {
		await processContracts(ns);
		await ns.sleep(SLEEP_MS);
	}
}

async function processContracts(ns: NS): Promise<void> {
	const servers = await crawlServers(ns, 'home');
	for (const server of servers) {
		const host = server.hostname;
		const files = ns.ls(host, '.cct');
		for (const file of files) {
			try {
				const tries = ns.codingcontract.getNumTriesRemaining(file, host);
				if (tries <= MIN_TRIES - 1) continue;

				const result = solveContract(ns, file, host);
				if (result.success) {
					log(ns, `+CONTRACT ${result.reward}`);
				} else if (result.reason === 'no_solver') {
					// unknown type, skip silently
				} else if (result.reason === 'no_answer') {
					// solver returned nothing, skip silently
				} else {
					log(ns, `-CONTRACT ${result.type}`);
					ns.print(`data: ${JSON.stringify(result.data)}`);
					ns.print(`answer: ${JSON.stringify(result.answer)}`);
				}
			} catch (e) {
				log(ns, `error on ${file}@${host}: ${e}`);
			}
		}
	}
}

function log(ns: NS, message: string): void {
	queueWrite(ns, Ports.Metrics, { type: 'log', message } satisfies LogEvent);
	ns.print(`${message}`);
}
