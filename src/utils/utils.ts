import { NS } from '@ns';

export const makeLog =
  (ns: NS) =>
  (str: string, ...args: any[]) => {
    if (ns.getHostname() == 'home') {
      ns.tprint(`[${ns.getHostname()}] ${ns.sprintf(str, args)}`);
    }
    ns.print(`[${ns.getHostname()}] ${ns.sprintf(str, args)}`);
  };

export function groupBy<T, R extends string | number>(list: T[], getter: (val: T) => R): Record<R, T[]> {
  return list.reduce((acc, curr) => {
    const key = getter(curr);
    const list = (acc[key] ?? []) as T[];
    list.push(curr);
    acc[key] = list;
    return acc;
  }, {} as Record<R, T[]>);
}
