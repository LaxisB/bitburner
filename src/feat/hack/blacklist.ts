import { Ports } from '@/utils/constants';
import { queueRead } from '@/utils/utils';
import { NS } from '@ns';

export const BLACKLIST = new Set<string>();

export function updateBlacklist(ns: NS) {
  queueRead(ns, Ports.Servers, (msg) => {
    const { added, host } = msg;
    ns.printf('Blacklist change %j', msg);
    if (added) {
      BLACKLIST.add(host);
      ns.printf('+BLACKLIST %s', host);
    } else {
      BLACKLIST.delete(host);
      ns.printf('-BLACKLIST %s', host);
    }
  });
}
