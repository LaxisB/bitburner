import { NS } from '@ns';
import { HOME } from './utils/constants';

/**
 * deprecated script
 * it once handled running a file on multiple hosts with variable threads etc
 */

export interface HostTree {
  root: boolean;
  hostname: string;
  parents: string[];
  server: ReturnType<NS['getServer']>;
  children: Record<string, HostTree>;
}
interface ScriptdArgs {
  update: boolean;
  force: boolean;
  verbose: boolean;
  silent: boolean;
  fill: boolean;
  logs: boolean;
  local: boolean;
  host: string;
  blacklist: string[];
  threads: number;
  _: string[];
}

interface SpawnResult {
  host: string;
  threads: number;
}

const BASE_FILES = ['utils.js'];

export async function main(ns: NS) {
  ns.disableLog('run');

  const args: ScriptdArgs = ns.flags([
    ['update', false],
    ['force', false],
    ['verbose', false],
    ['silent', false],
    ['fill', false],
    ['logs', false],
    ['local', false],
    ['host', 'home'],
    ['blacklist', ['home', 'darkweb']],
    ['threads', 1],
  ]) as any;

  if (args.threads != 1 && args.fill) {
    ns.tprint('cannot use threads and fill simultaneously');
    return;
  }

  if (args.update) {
    const newTree = await buildTree(ns, args.host);
    if (args.host === HOME) {
      writeTree(ns, newTree);
    } else {
      const tree = readTree(ns);
      if (!tree) {
        return;
      }
      const oldNode = findNode(ns, tree, args.host);
      if (!oldNode) {
        return;
      }
      Object.assign(oldNode, newTree);
      writeTree(ns, tree);
    }
  }

  if (!args._.length) {
    return;
  }
  const [script, scriptArgs] = args._ as string[];

  if (!script || !script.endsWith('.js')) {
    ns.tprintf('bad script: %s', script);
    ns.tprintf('usage: run scriptd.js <script> <...args>');
    return;
  }

  const success: SpawnResult[] = [];
  const skipped: SpawnResult[] = [];
  const failed: SpawnResult[] = [];

  const tree = readTree(ns);
  const start = findNode(ns, tree, args.host);

  if (!start) {
    ns.tprintf('could not find host in tree. try updating');
    return;
  }

  await iterateTree(ns, start, args.local ? [] : args.blacklist, async (tree: HostTree) => {
    if (args.force == false && ns.scriptRunning(script, tree.hostname)) {
      args.verbose && ns.tprintf('[%20s] already running', tree.hostname);
      skipped.push({ host: tree.hostname, threads: 0 });
      return;
    }
    // exit if we can't do anything anyway
    if ((tree.server.requiredHackingSkill ?? 0) > ns.getHackingLevel()) {
      skipped.push({ host: tree.hostname, threads: 0 });
      return;
    }
    // copy needed files
    ns.scp([...BASE_FILES, script], tree.hostname, HOME);

    ns.scriptKill(script, tree.hostname);
    let t = Math.min(args.threads, ns.getServer(tree.hostname).cpuCores);

    if (args.fill) {
      const leaveEmpty = 3; // leave 4gb free to run other scripts;
      const neededRam = ns.getScriptRam(script, tree.hostname);
      const { ramUsed, maxRam } = ns.getServer(tree.hostname);
      const toFill = Math.floor(Math.max(maxRam - ramUsed - leaveEmpty, 0) / (neededRam || 1));
      t = toFill || 1;
    }

    let pid;
    if (args.local) {
      pid = ns.exec(script, HOME, t, tree.hostname, ...(scriptArgs ?? []));
      while (ns.isRunning(pid)) {
        await ns.sleep(100);
      }
    } else {
      if (!tree.server.hasAdminRights) {
        skipped.push({ host: tree.hostname, threads: t });
        return;
      }
      ns.scp([...BASE_FILES, script], tree.hostname, HOME);
      try {
        pid = ns.exec(script, tree.hostname, t, ...(scriptArgs ?? []));
      } catch (e) {
        ns.tprintf('cannot execute on %s, %s', tree.hostname, e);
      } finally {
        for (const file of BASE_FILES) {
          ns.rm(file, tree.hostname);
        }
        ns.rm(script, tree.hostname);
      }
    }

    if (pid) {
      args.verbose &&
        ns.tprintf(
          '[%20s] spawned pid %s (file=%s threads= %s mem=%s args=%j)',
          tree.hostname,
          pid,
          script,
          t,
          ns.getScriptRam(script, tree.hostname),
          scriptArgs ?? [],
        );
      success.push({ host: tree.hostname, threads: t });
    } else {
      args.verbose &&
        ns.tprintf(
          '[%20s] failed (file=%s threads=%s mem=%s args=%j)',
          tree.hostname,
          script,
          t,
          ns.getScriptRam(script, 'home'),
          scriptArgs ?? [],
        );
      failed.push({ host: tree.hostname, threads: t });
    }
  });

  !args.silent &&
    ns.tprintf(
      `executed %s on %s hosts (%s skipped, %s failed)`,
      script,
      success.length,
      skipped.length,
      failed.length,
    );
  if (args.fill) {
    const cores = success.map((x) => x.threads).sort((a, b) => a - b);
    !args.silent &&
      ns.tprintf(`using an average core count of %s (min: %s, max: %s)`, avg(cores), cores[0], cores[cores.length - 1]);
  }
}

function avg(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function readTree(ns: NS) {
  return JSON.parse(ns.read('tree.txt'));
}

function writeTree(ns: NS, tree: HostTree) {
  ns.write('tree.txt', JSON.stringify(tree), 'w');
}

async function iterateTree(ns: NS, tree: HostTree, blacklist: string[], fn: (tree: HostTree) => Promise<any>) {
  if (!blacklist.includes(tree.hostname)) {
    try {
      await fn(tree);
      // eslint-disable-next-line no-empty
    } catch (e) {
      ns.tprintf('%j', e);
    }
  }
  for (const child in tree.children) {
    await iterateTree(ns, tree.children[child], blacklist, fn);
  }
}

function findNode(ns: NS, tree: HostTree, hostname: string): HostTree | null {
  if (tree.hostname === hostname) {
    return tree;
  }
  for (const key in tree.children) {
    const res = findNode(ns, tree.children[key], hostname);
    if (res) {
      return res;
    }
  }
  return null;
}
async function buildTree(ns: NS, host: string) {
  async function extendTree(ns: NS, host: string, parent: HostTree, depth = 1) {
    const hosts = ns.scan(host).filter((h) => parent.parents.includes(h) === false);

    hosts.forEach((host: string) => {
      parent.children[host] = {
        root: ns.hasRootAccess(host),
        hostname: host,
        server: ns.getServer(host),
        parents: [...parent.parents, parent.hostname],
        children: {},
      };
    });

    if (depth > 0) {
      for (const host of hosts) {
        await extendTree(ns, host, parent.children[host], depth - 1);
      }
    }
    return;
  }

  const tree: HostTree = {
    root: ns.hasRootAccess(host),
    hostname: host,
    server: ns.getServer(host),
    parents: [],
    children: {},
  };

  await extendTree(ns, host, tree, 10);
  return tree;
}
