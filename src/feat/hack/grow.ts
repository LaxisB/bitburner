// only import types in this script: it's deployed to targets standalone
import type { ExecEndEvent, ExecStartEvent } from '@/domain';
import type { ExecutorArgs } from '@/lib/exec';
import type { NS } from '@ns';

export function parseArgs(ns: NS): ExecutorArgs {
	return ns.flags([
		['threads', 1],
		['delay', 0],
		['duration', 0],
		['runner', ''],
		['target', ''],
	]) as unknown as ExecutorArgs;
}

export function emitExec(ns: NS, type: 'exec_start' | 'exec_end', func: string, args: ExecutorArgs): void {
	ns.writePort(2, {
		type,
		pid: ns.pid,
		func,
		threads: args.threads,
		duration: args.duration,
		delay: args.delay,
		target: args.target,
		runner: args.runner,
	} as ExecStartEvent | ExecEndEvent);
}

export async function main(ns: NS) {
	const args = parseArgs(ns);
	if (!args.target) return;
	ns.ramOverride(1.75);
	emitExec(ns, 'exec_start', 'grow', args);
	await ns.grow(args.target, { threads: args.threads, additionalMsec: args.delay });
	emitExec(ns, 'exec_end', 'grow', args);
}
