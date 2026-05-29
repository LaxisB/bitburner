/* eslint-disable no-empty */
import { crawlServers } from '../lib/servers';
import { HOME, Ports } from '../lib/constants';
import type { NS } from '@ns';
import type { LogEvent } from '@/domain';

/**
 * automatically gains root on all possible targets
 */
export async function main(ns: NS) {
  ns.disableLog('ALL');
  const servers = await crawlServers(ns, HOME, 100);

  while (true) {
    for (const server of servers) {
      if (server.hasAdminRights || server.hostname.startsWith('NODE')) {
        continue;
      }
      const host = server.hostname;
      try {
        ns.brutessh(host);
      } catch (e) {}
      try {
        ns.ftpcrack(host);
      } catch (e) {}
      try {
        ns.relaysmtp(host);
      } catch (e) {}
      try {
        ns.httpworm(host);
      } catch (e) {}
      try {
        ns.sqlinject(host);
      } catch (e) {}
      try {
        ns.nuke(host);
      } catch (e) {}

      const s = ns.getServer(server.hostname);
      if (s.hasAdminRights) {
        ns.writePort(Ports.Metrics, { type: 'log', message: `pwned ${host}` } satisfies LogEvent);
      }
    }

    await ns.sleep(5000);
  }
}
