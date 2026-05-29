import type { ExecStartEvent, ExecEndEvent } from '@/domain';
import type { NS } from '@ns';

interface Args {
	threads: number;
	delay: number;
	duration: number;
	runner: string;
	target: string;
	_?: string[];
}

export async function main(ns: NS) {
	const args: Args = ns.flags([
		['threads', 1],
		['delay', 0],
		['duration', 0],
		['runner', ''],
		['target', ''],
		// biome-ignore lint:
	]) as any;

	if (!args.target) return;

	ns.ramOverride(1.75);

	ns.writePort(2, {
		type: 'exec_start',
		pid: ns.pid,
		func: 'grow',
		threads: args.threads,
		duration: args.duration,
		delay: args.delay,
		target: args.target,
		runner: args.runner,
	} satisfies ExecStartEvent);

	await ns.grow(args.target, { threads: args.threads, additionalMsec: args.delay });

	ns.writePort(2, {
		type: 'exec_end',
		pid: ns.pid,
		func: 'grow',
		threads: args.threads,
		duration: args.duration,
		delay: args.delay,
		target: args.target,
		runner: args.runner,
	} satisfies ExecEndEvent);
}
