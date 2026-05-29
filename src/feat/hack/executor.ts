import type { ExecStartEvent, ExecEndEvent } from '@/domain';
import type { NS } from '@ns';

interface Args {
	threads: number;
	delay: number;
	duration: number;
	action: string;
	runner: string;
	target: string;
	_?: string[];
}

/**
 * simple slave script that runs the command provided
 */
export async function main(ns: NS) {
	const args: Args = ns.flags([
		['threads', 1],
		['delay', 0],
		['duration', 0],
		['action', ''],
		['runner', ''],
		['target', ''],
		// biome-ignore lint:
	]) as any;

	if (!args.action) {
		return;
	}
	if (!args.target) {
		return;
	}

	ns.ramOverride(2);

	ns.writePort(2, {
		type: 'exec_start',
		pid: ns.pid,
		func: args.action,
		threads: args.threads,
		duration: args.duration,
		delay: args.delay,
		target: args.target,
		runner: args.runner,
	} satisfies ExecStartEvent);

	switch (args.action) {
		case 'hack':
			await ns.hack(args.target, { threads: args.threads, additionalMsec: args.delay });
			break;
		case 'grow':
			await ns.grow(args.target, { threads: args.threads, additionalMsec: args.delay });
			break;
		case 'weaken':
			await ns.weaken(args.target, { threads: args.threads, additionalMsec: args.delay });
			break;
	}

	ns.writePort(2, {
		type: 'exec_end',
		pid: ns.pid,
		func: args.action,
		threads: args.threads,
		duration: args.duration,
		delay: args.delay,
		target: args.target,
		runner: args.runner,
	} satisfies ExecEndEvent);
}
