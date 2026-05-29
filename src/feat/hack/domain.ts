import type { Server } from '@ns';

export interface ExtendedServerStats extends Server {
	tasks: ScheduledTask[];
}

export interface Task {
	target: string;
	action: 'weaken' | 'grow' | 'hack';
	threads: number;
	duration: number;
	delay?: number;
}

export interface ScheduledTask extends Task {
	runner: string;
	pid: number;
}
