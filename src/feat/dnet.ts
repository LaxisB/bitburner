import type { LogEvent } from '@/domain';
import type { DarknetServerDetails, NS } from '@ns';

const WORM_SCRIPT = '/feat/dnet.js';

const PASSWORD_RESOLVERS: Record<string, (ns: NS, details: DarknetServerDetails) => string[]> = {
	ZeroLogon: (_ns, _details) => [''],
	'DeskMemo_3.1': (_ns, details) => {
		return [details.passwordHint.replace(/\D/g, '')];
	},
	'CloudBlare(tm)': (ns, details) => {
		// format is ``
		return [details.data.replace(/\D/g, '')];
	},
	OctantVoxel: (_ns, details) => {
		const [base, val] = details.data.split(',');

		return [Number.parseInt(val, Number.parseInt(base)).toString()];
	},
	// dictionary attacks
	'FreshInstall_1.0': (_ns, details) => DEFAULT_PASSWORDS.filter((x) => x.length === details.passwordLength),
	Laika4: (_ns, details) => DOG_NAMES.filter((x) => x.length === details.passwordLength),
	'EuroZone Free': (_ns, details) => EU_COUNTRIES.filter((x) => x.length === details.passwordLength),
};

export async function main(ns: NS): Promise<void> {
	ns.disableLog('ALL');

	const _h = ns.getHostname();
	const host = _h === 'home' ? 'darkweb' : _h;

	const flags = ns.flags([['version', 0]]);
	const version = flags.version as number;

	//3.7 cost
	await spread(ns, version);

	// stop here if we're on home: we already started the spread, nothing else left to do
	if (_h === 'home') {
		return;
	}

	while (true) {
		ns.ls(host)
			.filter((x) => x.endsWith('.cache'))
			// 2 cost
			.forEach((cache) => ns.dnet.openCache(cache));
		// 2 cost
		await ns.dnet.phishingAttack();
		await spread(ns, version);
	}
}

/** return a list of possible passwords for a given server */
function resolvePassword(ns: NS, details: DarknetServerDetails): string[] {
	const resolved = PASSWORD_RESOLVERS[details.modelId]?.(ns, details) ?? [];
	// if (!resolved.length) {
	// 	ns.writePort(2, {
	// 		type: 'log',
	// 		message: `-DNET: ${details.modelId} format=${details.passwordFormat} hint=${details.passwordHint} length=${details.passwordLength} data=${details.data}`,
	// 	} satisfies LogEvent);
	// }
	return resolved;
}

/** (re)auth */
async function ensureSession(ns: NS, host: string): Promise<boolean> {
	const details = ns.dnet.getServerDetails(host);
	const passwords = resolvePassword(ns, details);
	if (details.hasSession) {
		for (const password of passwords) {
			const result = ns.dnet.connectToSession(host, password);
			if (result.success) {
				return true;
			}
			return false;
		}
	}

	for (const password of passwords) {
		const result = await ns.dnet.authenticate(host, password);
		if (result.success) {
			return true;
		}
	}
	return false;
}

function getRunningVersion(ns: NS, host: string): number {
	for (const proc of ns.ps(host)) {
		if (proc.filename !== WORM_SCRIPT) continue;
		const idx = proc.args.indexOf('--version');
		if (idx !== -1 && idx + 1 < proc.args.length) {
			const v = Number(proc.args[idx + 1]);
			if (!Number.isNaN(v)) return v;
		}
	}
	return -1;
}

/**
 * cost: 3.7
 */
async function spread(ns: NS, version: number): Promise<void> {
	const neighbors = ns.dnet.probe();
	for (const neighbor of neighbors) {
		const running = getRunningVersion(ns, neighbor);
		if (running >= version) continue;
		if (running < version) {
			ns.kill(WORM_SCRIPT, neighbor);
		}
		const ok = await ensureSession(ns, neighbor);
		if (!ok) continue;
		if (ns.dnet.getBlockedRam(neighbor) >= 2) {
			await ns.dnet.memoryReallocation(neighbor);
		}

		ns.scp(WORM_SCRIPT, neighbor, 'home');
		ns.exec(WORM_SCRIPT, neighbor, 1, '--version', version);
	}
}

const DEFAULT_PASSWORDS = ['admin', 'password', '0000', '12345'];
const DOG_NAMES = ['fido', 'spot', 'rover', 'max'];
const KNOWN_PASSWORDS = [
	'123456',
	'password',
	'12345678',
	'qwerty',
	'123456789',
	'12345',
	'1234',
	'111111',
	'1234567',
	'dragon',
	'123123',
	'baseball',
	'abc123',
	'football',
	'monkey',
	'letmein',
	'696969',
	'shadow',
	'master',
	'666666',
	'qwertyuiop',
	'123321',
	'mustang',
	'1234567890',
	'michael',
	'654321',
	'superman',
	'1qaz2wsx',
	'7777777',
	'121212',
	'0',
	'qazwsx',
	'123qwe',
	'trustno1',
	'jordan',
	'jennifer',
	'zxcvbnm',
	'asdfgh',
	'hunter',
	'buster',
	'soccer',
	'harley',
	'batman',
	'andrew',
	'tigger',
	'sunshine',
	'iloveyou',
	'2000',
	'charlie',
	'robert',
	'thomas',
	'hockey',
	'ranger',
	'daniel',
	'starwars',
	'112233',
	'george',
	'computer',
	'michelle',
	'jessica',
	'pepper',
	'1111',
	'zxcvbn',
	'555555',
	'11111111',
	'131313',
	'freedom',
	'777777',
	'pass',
	'maggie',
	'159753',
	'aaaaaa',
	'ginger',
	'princess',
	'joshua',
	'cheese',
	'amanda',
	'summer',
	'love',
	'ashley',
	'6969',
	'nicole',
	'chelsea',
	'biteme',
	'matthew',
	'access',
	'yankees',
	'987654321',
	'dallas',
	'austin',
	'thunder',
	'taylor',
	'matrix',
];
const EU_COUNTRIES = [
	'Austria',
	'Belgium',
	'Bulgaria',
	'Croatia',
	'Republic of Cyprus',
	'Czech Republic',
	'Denmark',
	'Estonia',
	'Finland',
	'France',
	'Germany',
	'Greece',
	'Hungary',
	'Ireland',
	'Italy',
	'Latvia',
	'Lithuania',
	'Luxembourg',
	'Malta',
	'Netherlands',
	'Poland',
	'Portugal',
	'Romania',
	'Slovakia',
	'Slovenia',
	'Spain',
	'Sweden',
];
