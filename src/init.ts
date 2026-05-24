import { NS } from '@ns';

export async function main(ns: NS) {
  const AUTO_LAUNCH = ['infra/autopwn.js', 'infra/servers.js', 'hack/manager.js'];

  for (const script of AUTO_LAUNCH) {
    ns.exec(script, ns.getHostname(), 1);
  }
}
