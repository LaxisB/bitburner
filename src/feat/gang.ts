import type { NS } from '@ns';

enum GangTask {
	Unassigned = 'Unassigned',
	Ransomware = 'Ransomware',
	Phishing = 'Phishing',
	IdentityTheft = 'Identity Theft',
	DdosAttack = 'DDoS Attacks',
	PlantVirus = 'Plant Virus',
	Fraud = 'Fraud & Counterfeiting',
	MoneyLaundering = 'Money Laundering',
	Cyberterrorism = 'Cyberterrorism',
	EthicalHacking = 'Ethical Hacking',
	MugPeople = 'Mug People',
	DealDrugs = 'Deal Drugs',
	Strongarm = 'Strongarm Civilians',
	Con = 'Run a Con',
	Robbery = 'Armed Robbery',
	TrafficArms = 'Traffick Illegal Arms',
	Blackmail = 'Threaten & Blackmail',
	HumanTrafficing = 'Human Trafficking',
	Terrorism = 'Terrorism',
	VigilanteJustice = 'Vigilante Justice',
	TrainCombat = 'Train Combat',
	TrainHacking = 'Train Hacking',
	TrainCharisma = 'Train Charisma',
	TerritoryWarfare = 'Territory Warfare',
}

const ASCEND_THRESHOLD = 2.0;

export async function main(ns: NS): Promise<void> {
	if (!ns.gang.inGang()) {
		ns.tprint('Not in a gang. Exiting.');
		return;
	}

	// const { isHacking } = ns.gang.getGangInformation();
	const trainingTask = GangTask.TerritoryWarfare; // isHacking ? GangTask.TrainHacking : GangTask.TrainCombat;

	while (true) {
		await ns.gang.nextUpdate();

		for (const name of ns.gang.getMemberNames()) {
			const result = ns.gang.getAscensionResult(name);
			if (!result) continue;
			const { hack, str, def, dex, agi, cha } = result;
			if (Math.max(hack, str, def, dex, agi, cha) >= ASCEND_THRESHOLD) {
				ns.gang.ascendMember(name);
			}
		}

		while (ns.gang.canRecruitMember()) {
			const name = `member-${ns.gang.getMemberNames().length}`;
			if (ns.gang.recruitMember(name)) {
				ns.gang.setMemberTask(name, trainingTask);
			}
		}
	}
}
