import { NS } from '@ns';

export interface SlaveArgs {
  threads: number;
  delay: number;
  action: string;
  runner: string;
  target: string;
  _?: string[];
}

/**
 * simple slave script that runs the command provided
 */
export async function main(ns: NS) {
  const args: SlaveArgs = ns.flags([
    ['threads', 1],
    ['delay', 0],
    ['action', 'grow'],
    ['runner', ''],
    ['target', ''],
  ]) as any;

  if (!args.action) {
    return;
  }
  if (!args.target) {
    return;
  }

  ns.ramOverride(2);

  switch (args.action) {
    case 'w':
      return await ns.weaken(args.target, { threads: args.threads, additionalMsec: args.delay });
    case 'g':
      return await ns.grow(args.target, { threads: args.threads, additionalMsec: args.delay });
    case 'h':
      return await ns.hack(args.target, { threads: args.threads, additionalMsec: args.delay });
    default:
      ns.printf('unknown cmd: %s', args.action);
      return;
  }
}
