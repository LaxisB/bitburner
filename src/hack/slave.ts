import { NS } from '@ns';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SlaveArgs {
  threads: number;
  cmd: string;
  runner: string;
  target: string;
  _?: string[];
}

export async function main(ns: NS) {
  const args: SlaveArgs = ns.flags([
    ['threads', 1],
    ['cmd', 'grow'],
    ['runner', ''],
    ['target', ''],
  ]) as any;

  if (!args.cmd) {
    return;
  }
  if (!args.target) {
    return;
  }

  switch (args.cmd) {
    case 'weaken':
      return await ns.weaken(args.target, { threads: args.threads });
    case 'grow':
      return await ns.grow(args.target, { threads: args.threads });
    case 'hack':
      return await ns.hack(args.target, { threads: args.threads });
    default:
      ns.printf('uknown cmd: %s', args.cmd);
      return;
  }
}
