import { NS } from '@ns';

export async function main(ns: NS) {
  ns.disableLog('sleep');
  const doc = eval('document');
  const hook0 = doc.getElementById('overview-extra-hook-0');
  const hook1 = doc.getElementById('overview-extra-hook-1');
  while (true) {
    try {
      const headers = [];
      const values = [];

      headers.push('ScrInc');
      values.push(ns.format.number(ns.getTotalScriptIncome()[0]) + '/s');

      headers.push('ScrExp');
      values.push(ns.format.number(ns.getTotalScriptExpGain()) + '/s');

      hook0.innerText = headers.join(' \n');
      hook1.innerText = values.join('\n');
    } catch (err) {
      // This might come in handy later
      ns.print('ERROR: Update Skipped: ' + String(err));
    }
    await ns.sleep(1000);
  }
}
