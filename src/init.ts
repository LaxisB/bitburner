import type { NS } from '@ns';

const AUTO_LAUNCH = [
	'feat/cloud.js',
	'feat/hack/autopwn.js',
	'feat/hack/orchestrator.js',
	'feat/dashboard.js',
	'feat/hacknet.js',
	'feat/share.js',
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
