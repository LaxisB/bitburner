import { emitExec, parseArgs } from '@/lib/exec';
import type { NS } from '@ns';

export async function main(ns: NS) {
	const args = parseArgs(ns);
	while (true) {
		emitExec(ns, 'exec_start', 'share', args);
		await ns.share();
		emitExec(ns, 'exec_end', 'share', args);
	}
}
