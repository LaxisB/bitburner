import type { ExecEndEvent, ExecStartEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import type { NS } from '@ns';
import type { ExecutorArgs } from './domain';

export async function main(ns: NS) {
	const args: ExecutorArgs = ns.flags([
		['threads', 1],
		['delay', 0],
		['duration', 0],
		['runner', ''],
		['target', ''],
		// biome-ignore lint:
	]) as any;

	if (!args.target) return;

	ns.ramOverride(1.75);

	ns.writePort(Ports.Metrics, {
		type: 'exec_start',
		pid: ns.pid,
		func: 'weaken',
		threads: args.threads,
		duration: args.duration,
		delay: args.delay,
		target: args.target,
		runner: args.runner,
	} satisfies ExecStartEvent);

	await ns.weaken(args.target, { threads: args.threads, additionalMsec: args.delay });

	ns.writePort(Ports.Metrics, {
		type: 'exec_end',
		pid: ns.pid,
		func: 'weaken',
		threads: args.threads,
		duration: args.duration,
		delay: args.delay,
		target: args.target,
		runner: args.runner,
	} satisfies ExecEndEvent);
}
