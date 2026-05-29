import { NS } from '@ns';

const AUTO_LAUNCH: string | [string, ...any] = [
  './ui.js',
  'infra/autopwn.js',
  'infra/servers.js',
  // 'feat/hacknet.js',
  //  'feat/stocks.js',
  'feat/hack/orchestrator.js',
  'feat/metrics.js',
];

export async function main(ns: NS) {
  for (const script of AUTO_LAUNCH) {
    ns.exec(script, ns.getHostname(), 1);
  }
}
