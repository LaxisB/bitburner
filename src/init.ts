import type { NS } from '@ns';

const AUTO_LAUNCH = [
	'infra/autopwn.js',
	'infra/servers.js',
	'feat/hack/orchestrator.js',
	'feat/metrics.js',
	// 'feat/hacknet.js',
	//  'feat/stocks.js',
];

export async function main(ns: NS) {
	for (const script of AUTO_LAUNCH) {
		ns.exec(script, ns.getHostname(), 1);
	}
}
