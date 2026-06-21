const numFormatter = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3, maximumFractionDigits: 5 });

export function formatDuration(millis: number) {
	if (!millis) {
		return '0:00:00';
	}
	const time = Math.floor(millis / 1000);
	const secs = time % 60;
	let mins = Math.floor(time / 60);
	const hours = Math.floor(mins / 60);
	mins = mins - hours * 60;

	const hoursString = hours ? `${hours}:` : '';
	const minutesString = mins.toString().padStart(2, '0');
	const secondsString = secs.toString().padStart(2, '0');

	return `${hoursString}${minutesString}:${secondsString}`;
}

export function formatNum(num: number) {
	return num < 0.00005 ? '0' : num.toExponential(3).replace('e+', 'e');
}
export function formatPercent(num: number) {
	return `${(num * 100).toFixed(2)}%`;
}

export function formatMoneyExp(money: number) {
	return `$${formatNum(money)}`;
}
export function formatMoney(money: number) {
	if (!+money) return '$ 0';

	const k = 1000;
	const sizes = ['K', 'M', 'B', 't', 'q', 'Q', 's', 'S'];

	const i = Math.floor(Math.log(money) / Math.log(k));

	return `$${numFormatter.format(money / k ** i)}${sizes[i]}`;
}

export function formatString(val: string, maxLen = 15) {
	const ellipses = '...';
	return val.length > maxLen ? val.substring(0, maxLen - ellipses.length) + ellipses : val;
}
