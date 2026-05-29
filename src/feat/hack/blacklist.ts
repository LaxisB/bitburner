import { Ports } from '@/lib/constants';
import { queueRead } from '@/lib/utils';
import type { NS } from '@ns';

export const BLACKLIST = new Set<string>();

export function updateBlacklist(ns: NS) {
	queueRead(ns, Ports.Servers, (m) => {
		const msg = m as { added: boolean; host: string };
		const { added, host } = msg;
		if (added) {
			BLACKLIST.add(host);
			ns.printf('+BLACKLIST %s', host);
		} else {
			BLACKLIST.delete(host);
			ns.printf('-BLACKLIST %s', host);
		}
	});
}
