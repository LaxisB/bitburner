import type { NS } from '@ns';

function solveFindLargestPrimeFactor(input: number): number {
	let n = input;
	let factor = 1;
	for (let p = 2; p * p <= n; p++) {
		while (n % p === 0) {
			factor = p;
			n = Math.floor(n / p);
		}
	}
	if (n > 1) factor = n;
	return factor;
}

function solveSubarrayMaxSum(arr: number[]): number {
	let best = Number.NEGATIVE_INFINITY;
	let curr = Number.NEGATIVE_INFINITY;
	for (const el of arr) {
		curr = Math.max(el, curr + el);
		best = Math.max(best, curr);
	}
	return best;
}

function solveTotalWaysToSum(n: number): number {
	const dp = new Array(n + 1).fill(0);
	dp[0] = 1;
	for (let coin = 1; coin < n; coin++) {
		for (let j = coin; j <= n; j++) {
			dp[j] += dp[j - coin];
		}
	}
	return dp[n];
}

function solveTotalWaysToSumII(n: number, coins: number[]): number {
	const dp = new Array(n + 1).fill(0);
	dp[0] = 1;
	for (const coin of coins) {
		for (let j = coin; j <= n; j++) {
			dp[j] += dp[j - coin];
		}
	}
	return dp[n];
}

function solveSpiralizeMatrix(matrix: number[][]): number[] {
	const result: number[] = [];
	let top = 0;
	let bottom = matrix.length - 1;
	let left = 0;
	let right = matrix[0].length - 1;
	while (top <= bottom && left <= right) {
		for (let c = left; c <= right; c++) result.push(matrix[top][c]);
		top++;
		for (let r = top; r <= bottom; r++) result.push(matrix[r][right]);
		right--;
		if (top <= bottom) {
			for (let c = right; c >= left; c--) result.push(matrix[bottom][c]);
			bottom--;
		}
		if (left <= right) {
			for (let r = bottom; r >= top; r--) result.push(matrix[r][left]);
			left++;
		}
	}
	return result;
}

function solveArrayJumpingGame(arr: number[]): 1 | 0 {
	let maxReach = 0;
	for (let i = 0; i <= maxReach && i < arr.length; i++) {
		maxReach = Math.max(maxReach, i + arr[i]);
		if (maxReach >= arr.length - 1) return 1;
	}
	return 0;
}

function solveArrayJumpingGameII(arr: number[]): number {
	if (arr.length <= 1) return 0;
	let jumps = 0;
	let currEnd = 0;
	let farthest = 0;
	for (let i = 0; i < arr.length - 1; i++) {
		farthest = Math.max(farthest, i + arr[i]);
		if (i === currEnd) {
			if (farthest <= currEnd) return 0;
			jumps++;
			currEnd = farthest;
			if (currEnd >= arr.length - 1) break;
		}
	}
	return jumps;
}

function solveMergeIntervals(intervals: [number, number][]): [number, number][] {
	const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
	const result: [number, number][] = [sorted[0]];
	for (const [start, end] of sorted.slice(1)) {
		const last = result[result.length - 1];
		if (start <= last[1]) {
			last[1] = Math.max(last[1], end);
		} else {
			result.push([start, end]);
		}
	}
	return result;
}

function solveGenerateIP(digits: string): string[] {
	const results: string[] = [];
	function backtrack(pos: number, parts: string[]) {
		if (parts.length === 4 && pos === digits.length) {
			results.push(parts.join('.'));
			return;
		}
		if (parts.length === 4) return;
		for (let len = 1; len <= 3 && pos + len <= digits.length; len++) {
			const seg = digits.slice(pos, pos + len);
			if (seg.length > 1 && seg[0] === '0') break;
			if (Number(seg) > 255) break;
			backtrack(pos + len, [...parts, seg]);
		}
	}
	backtrack(0, []);
	return results;
}

function solveStockI(prices: number[]): number {
	let minPrice = Number.POSITIVE_INFINITY;
	let maxProfit = 0;
	for (const p of prices) {
		minPrice = Math.min(minPrice, p);
		maxProfit = Math.max(maxProfit, p - minPrice);
	}
	return maxProfit;
}

function solveStockII(prices: number[]): number {
	let profit = 0;
	for (let i = 1; i < prices.length; i++) {
		if (prices[i] > prices[i - 1]) profit += prices[i] - prices[i - 1];
	}
	return profit;
}

function solveStockIII(prices: number[]): number {
	let buy1 = Number.NEGATIVE_INFINITY;
	let sell1 = 0;
	let buy2 = Number.NEGATIVE_INFINITY;
	let sell2 = 0;
	for (const p of prices) {
		buy1 = Math.max(buy1, -p);
		sell1 = Math.max(sell1, buy1 + p);
		buy2 = Math.max(buy2, sell1 - p);
		sell2 = Math.max(sell2, buy2 + p);
	}
	return sell2;
}

function solveStockIV(k: number, prices: number[]): number {
	if (k >= Math.floor(prices.length / 2)) return solveStockII(prices);
	const dp: number[][] = Array.from({ length: k + 1 }, () => new Array(prices.length).fill(0));
	for (let t = 1; t <= k; t++) {
		let maxSoFar = -prices[0];
		for (let d = 1; d < prices.length; d++) {
			dp[t][d] = Math.max(dp[t][d - 1], prices[d] + maxSoFar);
			maxSoFar = Math.max(maxSoFar, dp[t - 1][d] - prices[d]);
		}
	}
	return dp[k][prices.length - 1];
}

function solveTriangle(triangle: number[][]): number {
	const tri = triangle.map((row) => [...row]);
	for (let r = tri.length - 2; r >= 0; r--) {
		for (let c = 0; c < tri[r].length; c++) {
			tri[r][c] += Math.min(tri[r + 1][c], tri[r + 1][c + 1]);
		}
	}
	return tri[0][0];
}

function solveUniquePathsI(rows: number, cols: number): number {
	const n = rows + cols - 2;
	let k = rows - 1;
	if (k > n - k) k = n - k;
	let result = 1;
	for (let i = 0; i < k; i++) {
		result = (result * (n - i)) / (i + 1);
	}
	return Math.round(result);
}

function solveUniquePathsII(grid: (1 | 0)[][]): number {
	const rows = grid.length;
	const cols = grid[0].length;
	const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
	dp[0][0] = grid[0][0] === 0 ? 1 : 0;
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			if (r === 0 && c === 0) continue;
			if (grid[r][c] === 1) {
				dp[r][c] = 0;
				continue;
			}
			const above = r > 0 ? dp[r - 1][c] : 0;
			const left = c > 0 ? dp[r][c - 1] : 0;
			dp[r][c] = above + left;
		}
	}
	return dp[rows - 1][cols - 1];
}

function solveShortestPath(grid: (1 | 0)[][]): string {
	const rows = grid.length;
	const cols = grid[0].length;
	if (grid[0][0] === 1 || grid[rows - 1][cols - 1] === 1) return '';
	const dirs: [number, number, string][] = [
		[1, 0, 'D'],
		[-1, 0, 'U'],
		[0, 1, 'R'],
		[0, -1, 'L'],
	];
	const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
	const queue: [number, number, string][] = [[0, 0, '']];
	visited[0][0] = true;
	while (queue.length > 0) {
		const item = queue.shift();
		if (!item) break;
		const [r, c, path] = item;
		if (r === rows - 1 && c === cols - 1) return path;
		for (const [dr, dc, d] of dirs) {
			const nr = r + dr;
			const nc = c + dc;
			if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc] && grid[nr][nc] === 0) {
				visited[nr][nc] = true;
				queue.push([nr, nc, path + d]);
			}
		}
	}
	return '';
}

function solveSanitizeParens(s: string): string[] {
	let current = new Set<string>([s]);
	while (true) {
		const valid = [...current].filter(isValidParens);
		if (valid.length > 0) return valid.sort();
		const next = new Set<string>();
		for (const str of current) {
			for (let i = 0; i < str.length; i++) {
				if (str[i] !== '(' && str[i] !== ')') continue;
				next.add(str.slice(0, i) + str.slice(i + 1));
			}
		}
		if (next.size === 0) return [''];
		current = next;
	}
}

function isValidParens(s: string): boolean {
	let count = 0;
	for (const c of s) {
		if (c === '(') count++;
		else if (c === ')') {
			count--;
			if (count < 0) return false;
		}
	}
	return count === 0;
}

function solveMathExpressions(digits: string, target: number): string[] {
	const results: string[] = [];
	function backtrack(pos: number, path: string, evaluated: number, multiplied: number) {
		if (pos === digits.length) {
			if (evaluated === target) results.push(path);
			return;
		}
		for (let len = 1; len <= digits.length - pos; len++) {
			const numStr = digits.slice(pos, pos + len);
			if (numStr.length > 1 && numStr[0] === '0') break;
			const num = Number(numStr);
			if (pos === 0) {
				backtrack(len, numStr, num, num);
			} else {
				backtrack(pos + len, `${path}+${numStr}`, evaluated + num, num);
				backtrack(pos + len, `${path}-${numStr}`, evaluated - num, -num);
				backtrack(pos + len, `${path}*${numStr}`, evaluated - multiplied + multiplied * num, multiplied * num);
			}
		}
	}
	backtrack(0, '', 0, 0);
	return results;
}

function isPow2(n: number): boolean {
	return n > 0 && (n & (n - 1)) === 0;
}

function solveHammingEncode(n: number): string {
	const data = n.toString(2);
	const dataLen = data.length;
	let r = 0;
	while (2 ** r < dataLen + r + 1) r++;
	const totalLen = dataLen + r;
	const bits = new Array(totalLen + 1).fill(0);
	let di = 0;
	for (let pos = 1; pos <= totalLen; pos++) {
		if (!isPow2(pos)) bits[pos] = Number(data[di++]);
	}
	for (let i = 0; 2 ** i <= totalLen; i++) {
		const p = 2 ** i;
		let xorVal = 0;
		for (let pos = p; pos <= totalLen; pos++) {
			if (pos & p) xorVal ^= bits[pos];
		}
		bits[p] = xorVal;
	}
	bits[0] = bits.slice(1).reduce((a, b) => a ^ b, 0);
	return bits.join('');
}

function solveHammingDecode(encoded: string): number {
	const bits = encoded.split('').map(Number);
	let syndrome = 0;
	for (let i = 1; i < bits.length; i++) {
		if (bits[i] === 1) syndrome ^= i;
	}
	if (syndrome !== 0 && syndrome < bits.length) bits[syndrome] ^= 1;
	let data = '';
	for (let i = 1; i < bits.length; i++) {
		if (!isPow2(i)) data += bits[i];
	}
	return Number.parseInt(data, 2);
}

function solveBipartite(input: [number, [number, number][]]): (1 | 0)[] {
	const [n, edges] = input;
	const adj: number[][] = Array.from({ length: n }, () => []);
	for (const [a, b] of edges) {
		adj[a].push(b);
		adj[b].push(a);
	}
	const color: number[] = new Array(n).fill(-1);
	for (let start = 0; start < n; start++) {
		if (color[start] !== -1) continue;
		color[start] = 0;
		const queue = [start];
		while (queue.length > 0) {
			const node = queue.shift();
			if (node === undefined) break;
			for (const neighbor of adj[node]) {
				if (color[neighbor] === -1) {
					color[neighbor] = 1 - color[node];
					queue.push(neighbor);
				} else if (color[neighbor] === color[node]) {
					return [];
				}
			}
		}
	}
	return color as (1 | 0)[];
}

function solveRLE(s: string): string {
	if (s.length === 0) return '';
	let result = '';
	let count = 1;
	for (let i = 1; i < s.length; i++) {
		if (s[i] === s[i - 1] && count < 9) {
			count++;
		} else {
			result += count + s[i - 1];
			count = 1;
		}
	}
	result += count + s[s.length - 1];
	return result;
}

function solveLZDecompress(compressed: string): string {
	let result = '';
	let i = 0;
	let type = 1;
	while (i < compressed.length) {
		const len = Number(compressed[i]);
		i++;
		if (type === 1) {
			result += compressed.slice(i, i + len);
			i += len;
		} else {
			if (len > 0) {
				const ref = Number(compressed[i]);
				i++;
				for (let j = 0; j < len; j++) {
					result += result[result.length - ref];
				}
			}
		}
		type = type === 1 ? 2 : 1;
	}
	return result;
}

function solveLZCompress(s: string): string {
	const n = s.length;
	const dp: (string | null)[][] = Array.from({ length: n + 1 }, () => [null, null, null]);
	dp[0][1] = '';

	for (let pos = 0; pos <= n; pos++) {
		for (let type = 1; type <= 2; type++) {
			const cur = dp[pos][type];
			if (cur === null) continue;

			if (type === 1) {
				for (let l = 1; l <= 9 && pos + l <= n; l++) {
					const next = dp[pos + l][2];
					const candidate = cur + l + s.slice(pos, pos + l);
					if (next === null || candidate.length < next.length) {
						dp[pos + l][2] = candidate;
					}
				}
			} else {
				const candidate0 = `${cur}0`;
				if (dp[pos][1] === null || candidate0.length < dp[pos][1].length) {
					dp[pos][1] = candidate0;
				}
				for (let l = 1; l <= 9 && pos + l <= n; l++) {
					for (let ref = 1; ref <= 9 && ref <= pos; ref++) {
						let match = true;
						for (let j = 0; j < l; j++) {
							const srcIdx = pos - ref + (j % ref);
							if (s[srcIdx] !== s[pos + j]) {
								match = false;
								break;
							}
						}
						if (match) {
							const candidate = cur + l + ref;
							const next = dp[pos + l][1];
							if (next === null || candidate.length < next.length) {
								dp[pos + l][1] = candidate;
							}
						}
					}
				}
			}
		}
	}

	const r1 = dp[n][1];
	const r2 = dp[n][2] !== null ? `${dp[n][2]}0` : null;
	if (r1 === null && r2 === null) return '';
	if (r1 === null) return r2 ?? '';
	if (r2 === null) return r1;
	return r1.length <= r2.length ? r1 : r2;
}

function solveCaesar(text: string, shift: number): string {
	return text
		.split('')
		.map((c) => {
			if (c === ' ') return ' ';
			return String.fromCharCode(((c.charCodeAt(0) - 65 - shift + 26) % 26) + 65);
		})
		.join('');
}

function solveVigenere(text: string, key: string): string {
	let ki = 0;
	return text
		.split('')
		.map((c) => {
			if (c === ' ') return ' ';
			const shift = key[ki % key.length].charCodeAt(0) - 65;
			ki++;
			return String.fromCharCode(((c.charCodeAt(0) - 65 + shift) % 26) + 65);
		})
		.join('');
}

function solveSquareRoot(n: bigint): bigint {
	if (n < 0n) throw new Error('negative input');
	if (n < 2n) return n;
	let x = n;
	let y = (x + 1n) / 2n;
	while (y < x) {
		x = y;
		y = (x + n / x) / 2n;
	}
	return x;
}

function solveTotalPrimes(range: number[]): number {
	const [low, high] = range;
	if (high < 2) return 0;
	const lo = Math.max(low, 2);
	const limit = Math.ceil(Math.sqrt(high)) + 1;
	const smallSieve = new Array(limit + 1).fill(true);
	smallSieve[0] = smallSieve[1] = false;
	const smallPrimes: number[] = [];
	for (let i = 2; i <= limit; i++) {
		if (!smallSieve[i]) continue;
		smallPrimes.push(i);
		for (let j = i * i; j <= limit; j += i) smallSieve[j] = false;
	}
	const size = high - lo + 1;
	const segment = new Array(size).fill(true);
	for (const p of smallPrimes) {
		const start = Math.max(p * p, Math.ceil(lo / p) * p);
		for (let j = start; j <= high; j += p) segment[j - lo] = false;
	}
	return segment.filter(Boolean).length;
}

function solveLargestRectangle(grid: (1 | 0)[][]): [[number, number], [number, number]] {
	const rows = grid.length;
	const cols = grid[0].length;
	const heights = new Array(cols).fill(0);
	let best = { area: 0, r1: 0, c1: 0, r2: 0, c2: 0 };

	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			heights[c] = grid[r][c] === 0 ? 0 : heights[c] + 1;
		}
		const stack: { colIndex: number; height: number }[] = [];
		for (let c = 0; c <= cols; c++) {
			const h = c < cols ? heights[c] : 0;
			let start = c;
			while (stack.length > 0 && stack[stack.length - 1].height >= h) {
				const top = stack.pop();
				if (!top) break;
				const width = c - top.colIndex;
				const area = top.height * width;
				if (area > best.area) {
					best = {
						area,
						r1: r - top.height + 1,
						c1: top.colIndex,
						r2: r,
						c2: c - 1,
					};
				}
				start = top.colIndex;
			}
			stack.push({ colIndex: start, height: h });
		}
	}

	return [
		[best.r1, best.c1],
		[best.r2, best.c2],
	];
}

const SOLVERS: Partial<Record<string, (data: unknown) => unknown>> = {
	'Find Largest Prime Factor': (d) => solveFindLargestPrimeFactor(d as number),
	'Subarray with Maximum Sum': (d) => solveSubarrayMaxSum(d as number[]),
	'Total Ways to Sum': (d) => solveTotalWaysToSum(d as number),
	'Total Ways to Sum II': (d) => {
		const [n, coins] = d as [number, number[]];
		return solveTotalWaysToSumII(n, coins);
	},
	'Spiralize Matrix': (d) => solveSpiralizeMatrix(d as number[][]),
	'Array Jumping Game': (d) => solveArrayJumpingGame(d as number[]),
	'Array Jumping Game II': (d) => solveArrayJumpingGameII(d as number[]),
	'Merge Overlapping Intervals': (d) => solveMergeIntervals(d as [number, number][]),
	'Generate IP Addresses': (d) => solveGenerateIP(d as string),
	'Algorithmic Stock Trader I': (d) => solveStockI(d as number[]),
	'Algorithmic Stock Trader II': (d) => solveStockII(d as number[]),
	'Algorithmic Stock Trader III': (d) => solveStockIII(d as number[]),
	'Algorithmic Stock Trader IV': (d) => {
		const [k, prices] = d as [number, number[]];
		return solveStockIV(k, prices);
	},
	'Minimum Path Sum in a Triangle': (d) => solveTriangle(d as number[][]),
	'Unique Paths in a Grid I': (d) => {
		const [rows, cols] = d as [number, number];
		return solveUniquePathsI(rows, cols);
	},
	'Unique Paths in a Grid II': (d) => solveUniquePathsII(d as (1 | 0)[][]),
	'Shortest Path in a Grid': (d) => solveShortestPath(d as (1 | 0)[][]),
	'Sanitize Parentheses in Expression': (d) => solveSanitizeParens(d as string),
	'Find All Valid Math Expressions': (d) => {
		const [digits, target] = d as [string, number];
		return solveMathExpressions(digits, target);
	},
	'HammingCodes: Integer to Encoded Binary': (d) => solveHammingEncode(d as number),
	'HammingCodes: Encoded Binary to Integer': (d) => solveHammingDecode(d as string),
	'Proper 2-Coloring of a Graph': (d) => solveBipartite(d as [number, [number, number][]]),
	'Compression I: RLE Compression': (d) => solveRLE(d as string),
	'Compression II: LZ Decompression': (d) => solveLZDecompress(d as string),
	'Compression III: LZ Compression': (d) => solveLZCompress(d as string),
	'Encryption I: Caesar Cipher': (d) => {
		const [text, shift] = d as [string, number];
		return solveCaesar(text, shift);
	},
	'Encryption II: Vigenère Cipher': (d) => {
		const [text, key] = d as [string, string];
		return solveVigenere(text, key);
	},
	'Square Root': (d) => solveSquareRoot(d as bigint),
	'Total Number of Primes': (d) => solveTotalPrimes(d as number[]),
	'Largest Rectangle in a Matrix': (d) => solveLargestRectangle(d as (1 | 0)[][]),
};

export type SolveResult =
	| { success: true; reward: string }
	| { success: false; reason: 'no_solver' | 'no_answer' | 'wrong_answer'; type: string; data?: unknown; answer?: unknown };

export function solveContract(ns: NS, file: string, host: string): SolveResult {
	const type = ns.codingcontract.getContractType(file, host);
	const solver = SOLVERS[type];
	if (!solver) return { success: false, reason: 'no_solver', type };

	const data = ns.codingcontract.getData(file, host);
	const answer = solver(data);
	if (answer === undefined || answer === null) return { success: false, reason: 'no_answer', type };

	const reward = ns.codingcontract.attempt(answer, file, host);
	if (reward) return { success: true, reward };
	return { success: false, reason: 'wrong_answer', type, data, answer };
}
