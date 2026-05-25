import { NS } from '@ns';

export async function main(ns: NS) {
  const doc = eval('document');
  const hook0 = doc.getElementById('overview-extra-hook-0');
  const hook1 = doc.getElementById('overview-extra-hook-1');
  while (true) {
    try {
      const headers = [];
      const values = [];
      // Add script income per second
      headers.push('ScrInc');
      values.push(ns.format.number(ns.getTotalScriptIncome()[0]) + '/sec');
      // Add script exp gain rate per second
      headers.push('ScrExp');
      values.push(ns.format.number(ns.getTotalScriptExpGain()) + '/sec');

      // Now drop it into the placeholder elements
      hook0.innerText = headers.join(' \n');
      hook1.innerText = values.join('\n');
    } catch (err) {
      // This might come in handy later
      ns.print('ERROR: Update Skipped: ' + String(err));
    }
    await ns.sleep(1000);
  }
}
