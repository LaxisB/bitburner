import type { HostTree } from "./scriptd";

const border = ["┌", "┬", "┐", "│", "│", "│", "└", "┴", "┘", "─"];

interface StatusArgs {
    org: string;
    all: boolean;
    cols: string[];
}
interface ColumnDef {
    key: string;
    title: string;
    length: number;
    value: (t: HostTree) => string;
}
export async function main(ns: NS) {
    const args: StatusArgs = ns.flags([
        ["org", ""],
        ["all", false],
        ["cols", ["hostname", "root", "cpu", "mem_free", "mem_max", "money"]],
    ]) as any;

    const tree: HostTree = JSON.parse(ns.read("tree.txt"));
    if (!tree) {
        ns.tprintf("no tree. try rebuilding it (scriptd)");
        return;
    }

    const columnDefs: ColumnDef[] = [
        {
            key: "hostname",
            title: "Host",
            length: 40,
            value: (t) => t.hostname.padEnd(40, " "),
        },
        {
            key: "root",
            title: "Root",
            length: 5,
            value: (t) => (t.server.hasAdminRights ? "yes" : "no"),
        },
        {
            key: "org",
            title: "Organisation",
            length: 30,
            value: (t) => t.server.organizationName,
        },
        {
            key: "cpu",
            title: "Cores",
            length: 5,
            value: (t) => t.server.cpuCores.toString(),
        },
        {
            key: "mem_max",
            title: "Mem max",
            length: 8,
            value: (t) => `${t.server.maxRam}GB`,
        },
        {
            key: "mem_free",
            title: "Free",
            length: 8,
            value: (t) =>
                `${(t.server.maxRam - t.server.ramUsed).toFixed(1)}GB`,
        },
        {
            key: "money",
            title: "Money",
            length: 25,
            value: (t) => {
                const perc =
                    (t.server.moneyAvailable / t.server.moneyMax) * 100;

                return `${ns.format.number(t.server.moneyAvailable)} (${(
                    perc ?? 0
                ).toFixed(2)}%%)`.padStart(26, " "); // pad by 26, because the %% will be replaced by sprintf later
            },
        },
        {
            key: "skill",
            title: "Skill",
            length: 8,
            value: (t) => t.server.requiredHackingSkill?.toString() ?? '',
        },
        {
            key: "backdoor",
            title: "Backdoor",
            length: 8,
            value: (t) => (t.server.backdoorInstalled ? "yes" : "no"),
        },
    ];

    const servers = getItems(tree);
    const mapped = servers
        .map((s) => ({
            ...s,
            hostname: s.hostname,
            fullname: [...s.parents, s.hostname].join("_"),
        }))
        .sort((a: any, b: any) => {
            return b.fullname.localeCompare(a.fullname);
        });

    const headers = args.cols.map((c) => {
        const def = columnDefs.find((def) => def.key === c);
        if (!def) {
            return "";
        }
        return def.title.padEnd(def.length, border[9]);
    });

    ns.tprintf(`${border[0]}${headers.join(border[1])}${border[2]}`);

    mapped
        .filter((s) => args.all || s.server.hasAdminRights)
        .forEach((server) => {
            const values = args.cols.map((c) => {
                const def = columnDefs.find((def) => def.key === c);
                if (!def) {
                    return "";
                }
                return def.value(server).padStart(def.length, " ");
            });

            ns.tprintf(`${border[3]}${values.join(border[3])}${border[5]}`);
        });

    const footers = args.cols
        .map((c) => {
            const def = columnDefs.find((def) => def.key === c);
            if (!def) {
                return "";
            }
            return border[9].repeat(def.length);
        })
        .join(border[7]);
    ns.tprintf(`${border[6]}${footers}${border[8]}`);
}

function getItems(tree: HostTree): HostTree[] {
    return [tree, ...Object.values(tree.children).map((i) => getItems(i))].flat(
        10
    );
}
