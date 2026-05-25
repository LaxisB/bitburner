import { NS, Stock } from '@ns';

/** @param {NS} ns */
export async function main(ns: NS) {
  const logsToDisable = ['sleep', 'getServerMoneyAvailable', 'stock.buyStock'];
  logsToDisable.forEach((l) => ns.disableLog(l));
  let is4SigmaAvailable = true;
  try {
    ns.stock.getForecast('FNS');
  } catch (error) {
    is4SigmaAvailable = false;
  }

  if (!is4SigmaAvailable) {
    ns.tprint('ERROR Purchase the 4Sigma API access, otherwise this script is not doing anything');
    ns.exit();
  }

  readLogs(ns);
  ns.ui.openTail();
  while (true) {
    ns.clearLog();
    // loop(ns)
    printLogs(ns);
    await trader(ns);
    for (let i = 0; i < 20; i++) await ns.sleep(99);
  }
}

////////////
// Trading

// Parameters:
const OPERATION_COST = 100000; // do not change this is fixed in the game

const MAX_STOCK_OWNED_PERCENT = 0.52; // maximum percentages of stock that can be owned at a time. (the more percent you own the more change you make on the market)
const MIN_FORECAST_PERCENT = 0.1; // min forecast percent from 0.5
const MIN_EXIT_FORECAST_PERCENT = 0.05; // in case the forecast turn under this value than exit.
const KEEP_MONEY_ON_HOME_MILLION = 1; // how many million you want to keep out from trading (like for use it for something else)

// Implementation:
/** @param {NS} ns */
async function trader(ns: NS) {
  const stock = ns.stock;

  ns.print('\nINFO\tEXISTING POSITIONS');

  const debugHeader = () => {
    ns.print('SYM \tFCAST  VOLA RANK  INVESTMNT INCOME');
  };
  const debugPrint = (sym: string, isLong?: boolean) => {
    const income = getPossibleIncome(stock, sym);
    const investment = getInvestmentCost(stock, sym);
    let endStr = '';
    let symStr = ' ' + sym;
    if (isLong != undefined) {
      symStr = (isLong ? '📈' : '📉') + sym;
      endStr = ` 💲${ns.format.number(investment, 2)} 💲${ns.format.number(income, 2)} ${income > 0 ? '👍' : '👎'}`;
    }
    ns.print(
      `${symStr}\t${stock.getForecast(sym).toFixed(2)} - ${(stock.getVolatility(sym) * 100).toFixed(
        2,
      )} ${ns.format.number(getSymbolPoint(stock, sym), 2)}` + endStr,
    );
  };
  // sell if not good anymore
  const ownedSmybols = getOwnedSymbols(stock);
  debugHeader();
  for (let sym of ownedSmybols) {
    if (!shouldExit(stock, sym.sym)) {
      debugPrint(sym.sym, sym.long > 0);
    } else if (sym.long > 0) {
      await logSell(ns, sym);
      stock.sellStock(sym.sym, sym.long);
    } else if (sym.short > 0) {
      await logSell(ns, sym);
      stock.sellShort(sym.sym, sym.short);
    }
  }

  ns.print('\nINFO \tPOSSIBLE POSITIONS');
  // buy if has some great stock option
  debugHeader();
  const symbols = sortAndFilterSymbols(stock);
  for (let sym of symbols) {
    const money = availableMoney(ns) - OPERATION_COST;
    const [shares, avgPx, sharesShort, avgPxShort] = stock.getPosition(sym);
    const isLong = stock.getForecast(sym) > 0.5;
    const amountToBuy = stock.getMaxShares(sym) * MAX_STOCK_OWNED_PERCENT - shares - sharesShort;
    if (isLong) {
      const amountToAfford = Math.min(amountToBuy, Math.floor(money / stock.getAskPrice(sym)));
      if (amountToAfford > 0) {
        await logBuy(ns, { sym, long: amountToAfford });
        stock.buyStock(sym, amountToAfford);
      }
      /*} else {
      const amountToAfford = Math.min(amountToBuy, Math.floor(money / stock.getBidPrice(sym)));
      if (amountToAfford > 0) {
        await logBuy(ns, { sym, short: amountToAfford });
        stock.buyShort(sym, amountToAfford);
      }
      */
    }
    if (shares > 0 || sharesShort > 0) continue;
    debugPrint(sym);
  }
}

/** @param {NS} ns */
function availableMoney(ns: NS) {
  const money = ns.getServerMoneyAvailable('home') - KEEP_MONEY_ON_HOME_MILLION * 1000000;
  return money;
}

/** @param {TIX} stock */
function getPossibleIncome(stock: Stock, sym: string) {
  const [shares, avgPx, sharesShort, avgPxShort] = stock.getPosition(sym);
  let income = -OPERATION_COST;
  if (shares > 0) income += (stock.getBidPrice(sym) - avgPx) * shares;
  else income += (avgPxShort - stock.getAskPrice(sym)) * sharesShort;
  return income;
}

/** @param {TIX} stock */
function getInvestmentCost(stock: Stock, sym: string) {
  const [shares, avgPx, sharesShort, avgPxShort] = stock.getPosition(sym);
  let income = OPERATION_COST;
  if (shares > 0) income += avgPx * shares;
  else income += avgPxShort * sharesShort;
  return income;
}

/** @param {TIX} stock */
function getExitGain(stock: Stock, sym: string) {
  const [shares, avgPx, sharesShort, avgPxShort] = stock.getPosition(sym);
  if (shares > 0) return stock.getBidPrice(sym) * shares;
  else return stock.getAskPrice(sym) * sharesShort;
}

/** @param {TIX} stock */
function getOwnedSymbols(stock: Stock) {
  const symbols = stock
    .getSymbols()
    .map((sym) => {
      const [shares, avgPx, sharesShort, avgPxShort] = stock.getPosition(sym);
      return { sym, short: sharesShort, long: shares };
    })
    .filter((sym) => sym.short > 0 || sym.long > 0);
  return symbols.sort((a, b) => getPossibleIncome(stock, a.sym) - getPossibleIncome(stock, b.sym));
}

/** @param {TIX} stock */
function sortAndFilterSymbols(stock: Stock) {
  const filteredSymbols = stock
    .getSymbols()
    .filter((a) => getSymbolPoint(stock, a) > 0) // check if it's even good for us to trade
    .filter((sym) => {
      // check if we didn't over buy this symbol
      const [shares, avgPx, sharesShort, avgPxShort] = stock.getPosition(sym);
      return stock.getMaxShares(sym) * MAX_STOCK_OWNED_PERCENT > Math.max(shares, sharesShort);
    });
  return filteredSymbols.sort((a, b) => getSymbolPoint(stock, b) - getSymbolPoint(stock, a));
}

/** @param {TIX} stock */
function getSymbolPoint(stock: Stock, sym: string) {
  const forecast = Math.abs(stock.getForecast(sym) - 0.5);
  const adjustedForecast = forecast * (1 / MIN_FORECAST_PERCENT); // * Math.E
  if (forecast < MIN_FORECAST_PERCENT) return 0;
  else return adjustedForecast * stock.getVolatility(sym) * 100;
}

/** @param {TIX} stock */
function shouldExit(stock: Stock, sym: string) {
  const [shares, avgPx, sharesShort, avgPxShort] = stock.getPosition(sym);
  if (sharesShort == 0 && shares == 0) return false;
  const forecast = stock.getForecast(sym);
  if (sharesShort > 0) {
    return forecast + MIN_EXIT_FORECAST_PERCENT >= 0.5;
  } else {
    return forecast - MIN_EXIT_FORECAST_PERCENT <= 0.5;
  }
}

////////////
// LOGGING

// Paramters:
const LOG_FILE_PREFIX = '/tmp/stock/logs';
const INCOME_FILE_PREFIX = '/tmp/stock/income';
const NUM_LOG_ROWS = 8; // the maximum number of buy/sell logs to display

let logs: any[] = [];
let earnedMoney = 0;

const dateSuffix = (ns: NS) =>
  `${ns.format.number(new Date().getMonth(), 0)}-${ns.format.number(new Date().getDate(), 0)}`;
/** @param {NS} ns */
function readLogs(ns) {
  const logFile = `${LOG_FILE_PREFIX}_${dateSuffix(ns)}.txt`;
  const incomeFile = `${INCOME_FILE_PREFIX}_${dateSuffix(ns)}.txt`;
  if (ns.fileExists(logFile)) logs = JSON.parse(ns.read(logFile));
  if (ns.fileExists(incomeFile)) earnedMoney = JSON.parse(ns.read(incomeFile)).income;
}

/** @param {NS} ns */
async function writeLogs(ns) {
  const logFile = `${LOG_FILE_PREFIX}_${dateSuffix(ns)}.txt`;
  const incomeFile = `${INCOME_FILE_PREFIX}_${dateSuffix(ns)}.txt`;
  await ns.write(logFile, JSON.stringify(logs), 'w');
  await ns.write(incomeFile, JSON.stringify({ income: earnedMoney }), 'w');
}

/** @param {NS} ns */
async function logSell(ns: NS, symObj: any) {
  const profit = getPossibleIncome(ns.stock, symObj.sym);
  earnedMoney += profit;
  await logBuySell(ns, { ...symObj, profit }, false);
}

/** @param {NS} ns */
async function logBuy(ns: NS, symObj: any) {
  await logBuySell(ns, symObj, true);
}

/** @param {NS} ns */
async function logBuySell(ns: NS, symObj: any, isBuy: boolean) {
  const { sym, long, short, profit } = symObj;
  const dateObj = new Date();
  const date = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '00')}`;
  logs.push({ sym, long, short, profit, isBuy, date });
  if (logs.length > NUM_LOG_ROWS) {
    logs.shift();
  }
  await writeLogs(ns);
}

/** @param {NS} ns */
function printLogs(ns: NS) {
  const onMarketValueChange = getOwnedSymbols(ns.stock)
    .map((s) => getPossibleIncome(ns.stock, s.sym))
    .reduce((a, b) => a + b, 0);
  const onMarketValue = getOwnedSymbols(ns.stock)
    .map((s) => getExitGain(ns.stock, s.sym))
    .reduce((a, b) => a + b, 0);

  ns.print(`On Market:     💲${ns.format.number(onMarketValue)}(+💲${ns.format.number(onMarketValueChange)})`);
  ns.print(`Earned(today): 💲${ns.format.number(earnedMoney)}`);
  ns.print('INFO\tBUY/SELL LOG');
  // const date = new Date()
  for (let log of logs) {
    const { sym, long, short, isBuy, profit, date } = log;
    const operation = isBuy ? 'BUY ' : 'SELL';
    const amount = short > 0 ? `SHORT ${ns.format.number(short)}` : `LONG  ${ns.format.number(long)}`;
    const profitStr = profit ? `💲${ns.format.number(profit)}` : '';
    const symStr = sym.length == 3 ? sym + ' ' : sym;
    ns.print(`[${date}] ${operation} ${symStr} - ${amount} ${profitStr}`);
  }
}
