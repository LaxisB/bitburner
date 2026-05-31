import type { Server } from '@ns';

export interface ExecutorArgs {
	threads: number;
	delay: number;
	duration: number;
	runner: string;
	target: string;
	_?: string[];
}

export interface ExtendedServerStats extends Server {
	tasks: ScheduledTask[];
}

export interface Task {
	target: string;
	action: 'weaken' | 'grow' | 'hack';
	threads: number;
	duration: number;
	delay?: number;
	label?: string;
}

export interface ScheduledTask extends Task {
	runner: string;
	pid: number;
}
