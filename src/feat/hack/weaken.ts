import type { NS } from '@ns';
import { emitExec, parseArgs } from './executor';

export async function main(ns: NS) {
	const args = parseArgs(ns);
	if (!args.target) return;
	ns.ramOverride(1.75);
	emitExec(ns, 'exec_start', 'weaken', args);
	await ns.weaken(args.target, { threads: args.threads, additionalMsec: args.delay });
	emitExec(ns, 'exec_end', 'weaken', args);
}
