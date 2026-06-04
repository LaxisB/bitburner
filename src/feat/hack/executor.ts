import type { ExecEndEvent, ExecStartEvent } from '@/domain';
import type { NS } from '@ns';
import type { ExecutorArgs } from './domain';

const PORT_METRICS = 2;

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
	ns.writePort(PORT_METRICS, {
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
