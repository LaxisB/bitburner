const numFormatter = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3, maximumFractionDigits: 5 });

export function formatDuration(millis: number) {
  const time = Math.floor(millis / 1000);
  const secs = time % 60;
  const mins = Math.floor(time / 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
export function formatNum(num: number) {
  return num < 0.00005 ? '0' : numFormatter.format(num);
}

export function formatMoney(money: number) {
  if (!+money) return '$ 0';

  const k = 1000;
  const sizes = ['K', 'M', 'B', 't', 'q', 'Q', 's', 'S'];

  const i = Math.floor(Math.log(money) / Math.log(k));

  return `$ ${numFormatter.format(money / Math.pow(k, i))}${sizes[i]}`;
}

export function formatRam(gigs: number, decimals = 2) {
  if (!gigs) return '0GB';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(gigs) / Math.log(k));

  return `${parseFloat((gigs / Math.pow(k, i)).toFixed(dm))}${sizes[i] ?? 'MB'}`;
}

export function formatString(val: string, maxLen = 15) {
  const ellipses = '...';
  return val.length > maxLen ? val.substring(0, maxLen - ellipses.length) + ellipses : val;
}
