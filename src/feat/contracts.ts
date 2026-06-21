import type { ContractEvent, LogEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import { solveContract } from '@/lib/contracts';
import { ensureSingleton, queueWrite } from '@/lib/utils';
import type { NS } from '@ns';

const MIN_TRIES = 2;

export async function main(ns: NS): Promise<void> {
	await ensureSingleton(ns);
	ns.disableLog('ALL');
	while (true) {
		await ns.getPortHandle(Ports.Contracts).nextWrite();
		let msg = ns.readPort(Ports.Contracts);
		while (msg !== 'NULL PORT DATA') {
			const { file, host } = msg as ContractEvent;
			await trysolve(ns, file, host);
			msg = ns.readPort(Ports.Contracts);
		}
	}
}

async function trysolve(ns: NS, file: string, host: string): Promise<void> {
	try {
		const tries = ns.codingcontract.getNumTriesRemaining(file, host);
		if (tries <= MIN_TRIES - 1) return;

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

function log(ns: NS, message: string): void {
	queueWrite(ns, Ports.Metrics, { type: 'log', message } satisfies LogEvent);
	ns.print(`${message}`);
}
