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
	label?: string;
}

export interface ScheduledTask extends Task {
	runner: string;
	pid: number;
	startTime: number;
}

export const SCRIPT_COST = 1.75;
