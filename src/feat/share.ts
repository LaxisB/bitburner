import { NS } from '@ns';

export async function main(ns: NS) {
  while (true) {
    ns.share();
    await ns.sleep(9_900);
  }
}
