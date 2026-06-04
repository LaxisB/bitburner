import type { NS } from '@ns';
import { emitExec, parseArgs } from './executor';

export async function main(ns: NS) {
	const args = parseArgs(ns);
	if (!args.target) return;
	ns.ramOverride(1.7);
	emitExec(ns, 'exec_start', 'hack', args);
	await ns.hack(args.target, { threads: args.threads, additionalMsec: args.delay });
	emitExec(ns, 'exec_end', 'hack', args);
}
