import { NS } from '@ns';
import type { SlaveArgs } from './slave';

export async function main(ns: NS) {
  const args: SlaveArgs = ns.flags([
    ['threads', 1],
    ['target', ''],
  ]) as any;

  if (!args.target) {
    return;
  }

  return await ns.hack(args.target, { threads: args.threads });
}
