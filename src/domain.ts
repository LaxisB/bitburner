export type BaseEvent = { type: string };

export interface ExecStartEvent extends BaseEvent {
	type: 'exec_start';
	func: string;
	pid: number;
	runner: string;
	target: string;
	threads: number;
	duration?: number;
	delay?: number;
}

export interface ExecEndEvent extends BaseEvent {
	type: 'exec_end';
	func: string;
	pid: number;
	runner: string;
	target: string;
	threads: number;
	duration?: number;
	delay?: number;
}

export interface LogEvent extends BaseEvent {
	type: 'log';
	message: string;
}

export interface ServerDeathEvent extends BaseEvent {
	type: 'serverdeath';
	host: string;
}

export interface ContractEvent extends BaseEvent {
	type: 'contract';
	file: string;
	host: string;
}

export type Event = ExecStartEvent | ExecEndEvent | LogEvent | ServerDeathEvent | ContractEvent;
