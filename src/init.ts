import type { NS, ScriptArg } from '@ns';
import type { LogEvent } from './domain';
import { Ports } from './lib/constants';

const AUTO_LAUNCH: [string, ScriptArg[]][] = [
	['feat/hack/orchestrator.js', []],
	['feat/hack/autopwn.js', []],
	['feat/cloud.js', []],
	['feat/dashboard.js', []],
	['feat/hacknet.js', []],
	['feat/share.js', []],
	['feat/stocks.js', []],
];

export async function main(ns: NS) {
	for (const [script, args] of AUTO_LAUNCH) {
		const pid = ns.exec(script, ns.getHostname(), 1, ...args);
		if (!pid) {
			ns.writePort(Ports.Metrics, { type: 'log', message: `+LAUNCH ${script} [${args.join(' ')}]` } satisfies LogEvent);
			ns.toast(`ERROR failed to launch ${script}. Stopping here`, 'warning');
			break;
		}
	}
}
