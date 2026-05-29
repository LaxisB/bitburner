import type { NS } from '@ns';

const AUTO_LAUNCH = [
	'infra/autopwn.js',
	'infra/servers.js',
	'feat/metrics.js',
	'feat/hack/orchestrator.js',
	// 'feat/hacknet.js',
	//  'feat/stocks.js',
];

export async function main(ns: NS) {
	for (const script of AUTO_LAUNCH) {
		const pid = ns.exec(script, ns.getHostname(), 1);
		if (!pid) {
			ns.alert(`ERROR failed to launch ${script}`);
		}
	}
}
