import { NS } from '@ns';
import { Files, Ports } from '../../utils/constants';
import { crawlServers } from '@/utils/servers';
import { ExtendedServerStats } from './domain';

type PortMsg = { hostname: string } & Partial<ExtendedServerStats>;
const serverStatus = new Map<string, ExtendedServerStats>();

/*
 * Regularly updates our db of servers
 * this has a tick every 10ms
 */
export async function main(ns: NS) {
  ns.disableLog('sleep');
  ns.disableLog('scan');
  let servers = await crawlServers(ns, 'home', 100);
  let changedHosts = new Set<string>();

  // care: ns.ls is returning a flat list of all files. it doesn't work like unix ls
  const files = ns.ls('home', 'tmp/servers');
  ns.printf('Cleaning up %i files', files.length);
  for (const file of files) {
    ns.rm(file);
  }

  ns.printf('Starting update loop');
  let c = 0;
  while (true) {
    // update server list every minute
    if (c % 6000 == 0) {
      servers = await crawlServers(ns, 'home', 100);
      writeServerList(
        ns,
        servers.map((x) => x.hostname),
      );
      c = 0;
    }
    // update servers every 100 ticks => 1s
    if (c % 100 == 0) {
      servers.forEach((s) => updateBaseServerStatus(ns, s.hostname));
    }

    // empty out port queue
    // this contains updates from other scripts
    let msg: PortMsg | string = ns.readPort(Ports.Servers);
    let msgCount = 0;
    while (msg != 'NULL PORT DATA') {
      const m = msg as PortMsg;
      ns.printf('Got new message %j', m);
      msgCount++;

      const s = serverStatus.get(m.hostname) ?? {};
      Object.assign(s, m, ns.getServer(m.hostname));
      serverStatus.set(m.hostname, s as any);
      changedHosts.add(m.hostname);
      msg = ns.readPort(Ports.Servers);
    }
    if (changedHosts.size) {
      changedHosts.forEach((h) => persistServerState(ns, h));
      changedHosts.clear();
    }

    if (msgCount == 0) {
      await ns.sleep(100);
      c += 10;
      continue;
    }

    await ns.sleep(10);
    c++;
  }
}

export function updateServerState(ns: NS, data: PortMsg) {
  ns.writePort(Ports.Servers, data);
}

function updateBaseServerStatus(ns: NS, hostname: string) {
  const s = ns.getServer(hostname);
  const stored = serverStatus.get(hostname) ?? ({} as ExtendedServerStats);
  Object.assign(stored, s);
  serverStatus.set(hostname, stored);
  writeServerState(ns, stored);
}

// persist the current state to file
function persistServerState(ns: NS, hostname: string) {
  const data = serverStatus.get(hostname);
  if (!data) {
    return;
  }
  writeServerState(ns, data);
}

export function getServers(ns: NS): ExtendedServerStats[] {
  return (readServerList(ns) ?? []).map((s) => readServerState(ns, s)).filter((x) => !!x) as any;
}
function writeServerList(ns: NS, servers: string[]) {
  ns.write(`${Files.SERVER_PATH}_servers.json`, JSON.stringify(servers, null, 4), 'w');
}
function readServerList(ns: NS): string[] | null {
  const content = ns.read(`${Files.SERVER_PATH}_servers.json`);
  if (!content) return null;
  return JSON.parse(content);
}

// overwrite file with provided data
export function writeServerState(ns: NS, data: ExtendedServerStats) {
  ns.write(`${Files.SERVER_PATH}${data.hostname}.json`, JSON.stringify(data, null, 4), 'w');
}
// get the current persisted server state
export function readServerState(ns: NS, hostname: string): ExtendedServerStats | null {
  const content = ns.read(`${Files.SERVER_PATH}${hostname}.json`);
  if (!content) {
    return null;
  }
  return JSON.parse(content);
}
