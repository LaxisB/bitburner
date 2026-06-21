import type { LogEvent } from '@/domain';
import { Ports } from '@/lib/constants';
import { formatMoneyExp, formatNum } from '@/lib/format';
import { ensureSingleton } from '@/lib/utils';
import type { NS } from '@ns';

// Fixed commission charged per transaction by the game engine.
const COMMISSION = 100_000;

// Cap per-stock exposure at 50% of outstanding shares. Buying more triggers influenceForecast()
// on the server, dragging the forecast toward 0.5 and corrupting our own signal.
const MAX_POSITION_FRACTION = 0.5;

// How many price ticks ahead we project when checking break-even.
// A position must earn more than the $200k round-trip commission over this window to be worth opening.
const BREAKEVEN_TICKS = 10;

interface Flags {
	liquidity: number;
	'no-auto-purchase': boolean;
}

interface SymbolState {
	sym: string;
	forecast: number;
	volatility: number;
	score: number;
	isLong: boolean;
	price: number;
	maxShares: number;
	ownedLong: number;
	avgLongPx: number;
	ownedShort: number;
	avgShortPx: number;
}

// In-memory trade log shown in the tail window (not persisted to disk)
const recentTrades: string[] = [];
// Accumulated realized P&L since the script started
let realizedPnl = 0;

export async function main(ns: NS) {
	ensureSingleton(ns);
	ns.disableLog('ALL');

	const flags = ns.flags([
		['liquidity', 0.25],
		['no-auto-purchase', false],
	]) as unknown as Flags;

	const stock = ns.stock;

	// TIX API is required for all ns.stock calls — auto-buy if affordable, exit otherwise.
	if (!stock.hasTixApiAccess()) {
		if (flags['no-auto-purchase'] || !stock.purchaseTixApi()) {
			ns.tprint('ERROR stocks: cannot afford TIX API access yet. Exiting.');
			ns.exit();
		}
		log(ns, 'STOCK auto-purchased TIX API access', true);
	}

	// Without 4S forecast data the entire strategy is blind --getForecast() drives every decision.
	// Auto-buy makes the script self-activating the moment the player can afford it.
	if (!stock.has4SDataTixApi()) {
		if (flags['no-auto-purchase']) {
			ns.tprint('ERROR stocks: 4S Market Data TIX API required. Run without --no-auto-purchase to auto-buy.');
			ns.exit();
		}
		const bought = stock.purchase4SMarketDataTixApi();
		if (!bought) {
			ns.tprint('ERROR stocks: cannot afford 4S Market Data TIX API yet. Exiting.');
			ns.exit();
		}
		log(ns, 'STOCK auto-purchased 4S Market Data TIX API', true);
	}

	// Detect short-selling availability once at startup.
	// buyShort throws if the player hasn't unlocked the feature — no direct API check exists.
	let canShort = false;
	try {
		stock.buyShort(stock.getSymbols()[0], 0);
		canShort = true;
	} catch {
		canShort = false;
	}

	while (true) {
		// nextUpdate() syncs to the exact moment prices change at 0 GB RAM cost.
		await stock.nextUpdate();
		ns.clearLog();

		const syms = stock.getSymbols();
		const states = syms.map((sym) => getSymbolState(ns, sym));

		// --- Compute capital ---
		const cash = ns.getServerMoneyAvailable('home');
		const portfolioValue = computePortfolioValue(states);
		const netWorth = cash + portfolioValue;
		const liquidityReserve = netWorth * flags.liquidity;

		// --- Exit stale positions before buying ---
		// Selling first frees capital that can immediately be redeployed.
		exitStalePositions(ns, states);

		// Re-read states after sells since positions changed
		const freshStates = syms.map((sym) => getSymbolState(ns, sym));
		const freshCash = ns.getServerMoneyAvailable('home');
		const freshInvestable = Math.max(0, freshCash - liquidityReserve);

		// --- Buy qualifying positions ---
		const qualifying = filterQualifying(freshStates, freshInvestable, canShort);
		allocateAndBuy(ns, qualifying, freshInvestable);

		// --- Render tail ---
		renderTail(ns, freshStates, freshCash, portfolioValue, netWorth, freshInvestable, realizedPnl);
	}
}

function getSymbolState(ns: NS, sym: string): SymbolState {
	const stock = ns.stock;
	const forecast = stock.getForecast(sym);
	const volatility = stock.getVolatility(sym);
	const score = Math.abs(forecast - 0.5) * volatility;
	const isLong = forecast >= 0.5;
	const price = isLong ? stock.getAskPrice(sym) : stock.getBidPrice(sym);
	const maxShares = stock.getMaxShares(sym);
	const [ownedLong, avgLongPx, ownedShort, avgShortPx] = stock.getPosition(sym);
	return { sym, forecast, volatility, score, isLong, price, maxShares, ownedLong, avgLongPx, ownedShort, avgShortPx };
}

function computePortfolioValue(states: SymbolState[]): number {
	let total = 0;
	for (const s of states) {
		// Long mark-to-market: shares × current bid (what we'd receive if selling now)
		total += s.ownedLong * s.price;
		// Short mark-to-market: collateral + unrealized profit
		// Value = avgShortPx × shares + (avgShortPx - currentAsk) × shares = (2×avg - ask) × shares
		if (s.ownedShort > 0) {
			total += s.ownedShort * (2 * s.avgShortPx - s.price);
		}
	}
	return total;
}

function exitStalePositions(ns: NS, states: SymbolState[]): void {
	const stock = ns.stock;

	for (const s of states) {
		// Exit long when forecast drops back to or below 0.5.
		// We exit on forecast alone, not on P&L or elapsed time.
		// Rationale: with 4S data, getForecast() is the true probability of an up-move.
		// A position losing money but holding a strong forecast still has positive EV --selling
		// it would be giving up on a bet right before it pays. Alternatives rejected:
		//   - Stop-loss by P&L: punishes correct positions during noise, keeps wrong ones
		//   - Time-limit exit: arbitrary, ignores signal strength entirely
		if (s.ownedLong > 0 && s.forecast < 0.5) {
			const gain = stock.getSaleGain(s.sym, s.ownedLong, 'L');
			const pnl = gain - s.avgLongPx * s.ownedLong - COMMISSION;
			realizedPnl += pnl;
			stock.sellStock(s.sym, s.ownedLong);
			log(ns, `-STOCK LONG  ${s.sym.padEnd(4)}  ${fmtShares(s.ownedLong)} shares — P&L: ${fmtPnl(pnl)}`, true);
		}

		if (s.ownedShort > 0 && s.forecast > 0.5) {
			const gain = stock.getSaleGain(s.sym, s.ownedShort, 'S');
			const pnl = gain - s.avgShortPx * s.ownedShort - COMMISSION;
			realizedPnl += pnl;
			stock.sellShort(s.sym, s.ownedShort);
			log(ns, `-STOCK SHORT ${s.sym.padEnd(4)}  ${fmtShares(s.ownedShort)} shares — P&L: ${fmtPnl(pnl)}`, true);
		}
	}
}

function filterQualifying(states: SymbolState[], investable: number, canShort: boolean): SymbolState[] {
	if (investable <= 0) return [];

	const totalScore = states.reduce((acc, s) => acc + s.score, 0);
	if (totalScore === 0) return [];

	return states.filter((s) => {
		if (s.score <= 0) return false;
		if (!s.isLong && !canShort) return false;

		// Check if there's room to add shares in the correct direction
		const cap = s.maxShares * MAX_POSITION_FRACTION;
		const held = s.isLong ? s.ownedLong : s.ownedShort;
		if (held >= cap) return false;

		// Break-even check: opening + closing costs $200k in commissions.
		// The position must earn more than that over BREAKEVEN_TICKS ticks to be worth entering.
		const allocation = investable * (s.score / totalScore);
		const affordable = Math.floor(allocation / s.price);
		if (affordable <= 0) return false;

		const evPerTickPerShare = s.price * Math.abs(s.forecast - 0.5) * s.volatility;
		const minShares = (2 * COMMISSION) / (evPerTickPerShare * BREAKEVEN_TICKS);

		return affordable >= minShares;
	});
}

function allocateAndBuy(ns: NS, qualifying: SymbolState[], investable: number): void {
	const stock = ns.stock;
	if (qualifying.length === 0) return;

	// Proportional (Kelly-like) allocation: each stock gets capital proportional to its EV score.
	// Higher-confidence signals naturally attract more capital without hardcoding per-stock percentages.
	const totalScore = qualifying.reduce((acc, s) => acc + s.score, 0);

	for (const s of qualifying) {
		const allocation = investable * (s.score / totalScore);
		const cap = s.maxShares * MAX_POSITION_FRACTION - (s.isLong ? s.ownedLong : s.ownedShort);
		const shares = Math.min(Math.floor(allocation / s.price), Math.floor(cap));

		if (shares <= 0) continue;

		if (s.isLong) {
			const filled = stock.buyStock(s.sym, shares);
			if (filled > 0) {
				log(
					ns,
					`+STOCK LONG  ${s.sym.padEnd(4)}  ${fmtShares(shares)} shares @ ${formatMoneyExp(filled)} (score: ${s.score.toFixed(4)})`,
				);
			}
		} else {
			const filled = stock.buyShort(s.sym, shares);
			if (filled > 0) {
				log(
					ns,
					`+STOCK SHORT ${s.sym.padEnd(4)}  ${fmtShares(shares)} shares @ ${formatMoneyExp(filled)} (score: ${s.score.toFixed(4)})`,
				);
			}
		}
	}
}

function renderTail(
	ns: NS,
	states: SymbolState[],
	cash: number,
	portfolioValue: number,
	netWorth: number,
	investable: number,
	realizedPnl: number,
): void {
	const stock = ns.stock;

	const owned = states.filter((s) => s.ownedLong > 0 || s.ownedShort > 0);
	const unrealizedPnl = owned.reduce((acc, s) => {
		if (s.ownedLong > 0) return acc + (stock.getBidPrice(s.sym) - s.avgLongPx) * s.ownedLong - 2 * COMMISSION;
		return acc + (s.avgShortPx - stock.getAskPrice(s.sym)) * s.ownedShort - 2 * COMMISSION;
	}, 0);

	ns.print(`Net worth:  ${formatMoneyExp(netWorth)}`);
	ns.print(`Cash:       ${formatMoneyExp(cash)}  (investable: ${formatMoneyExp(investable)})`);
	ns.print(`Invested:   ${formatMoneyExp(portfolioValue)}`);
	ns.print(
		`P&L:        ${fmtPnl(realizedPnl)} realized  ${fmtPnl(unrealizedPnl)} unrealized  ${fmtPnl(realizedPnl + unrealizedPnl)} total`,
	);
	ns.print('');
	ns.print('SYM   DIR    SHARES    AVG COST   CURRENT   FCST  UNREALIZED P&L');

	for (const s of owned) {
		if (s.ownedLong > 0) {
			const bid = stock.getBidPrice(s.sym);
			const unrealized = (bid - s.avgLongPx) * s.ownedLong - 2 * COMMISSION;
			ns.print(
				`${s.sym.padEnd(4)}  LONG   ${fmtShares(s.ownedLong).padStart(7)}  ${formatMoneyExp(s.avgLongPx).padStart(9)}  ${formatMoneyExp(bid).padStart(9)}  ${s.forecast.toFixed(2)}  ${fmtPnl(unrealized)}`,
			);
		}
		if (s.ownedShort > 0) {
			const ask = stock.getAskPrice(s.sym);
			const unrealized = (s.avgShortPx - ask) * s.ownedShort - 2 * COMMISSION;
			ns.print(
				`${s.sym.padEnd(4)}  SHORT  ${fmtShares(s.ownedShort).padStart(7)}  ${formatMoneyExp(s.avgShortPx).padStart(9)}  ${formatMoneyExp(ask).padStart(9)}  ${s.forecast.toFixed(2)}  ${fmtPnl(unrealized)}`,
			);
		}
	}

	if (owned.length === 0) ns.print('  (no open positions)');

	if (recentTrades.length > 0) {
		ns.print('');
		ns.print('--- recent trades ---');
		for (const entry of recentTrades) ns.print(entry);
	}
}

function log(ns: NS, message: string, emitToPort = false): void {
	if (emitToPort) ns.writePort(Ports.Metrics, { type: 'log', message } as LogEvent);
	recentTrades.push(message);
	if (recentTrades.length > 10) recentTrades.shift();
}

function fmtShares(n: number): string {
	return formatNum(n);
}

function fmtPnl(n: number): string {
	return (n >= 0 ? '+' : '-') + formatMoneyExp(Math.abs(n));
}
