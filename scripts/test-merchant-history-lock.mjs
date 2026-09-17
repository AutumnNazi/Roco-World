// 商人历史归档的并发安全测试。
//
// 背景：recordHistory 是「读整个文件 -> 内存改 -> 整体覆盖」。无锁时两个写入者
// 各记一轮，后写的会把先写的整轮抹掉（实测 8 并发只剩 1 轮）。方案 A（systemd
// 常驻服务）与方案 B（系统 cron）同时部署时，cron 直接调脚本、绕过服务内的
// merchantRunning 锁，就会踩到这个窗口。
//
// 必须导入 src 真实实现：这里测的是 scripts/lib/file-lock.mjs 本身。
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withFileLock, writeFileAtomic } from "./lib/file-lock.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const failures = [];

function check(label, condition, detail = "") {
    if (condition) {
        return;
    }

    failures.push(detail ? `${label}（${detail}）` : label);
}

const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "merchant-lock-test-"));
const targetPath = path.join(workDir, "merchant-history.json");

// 模拟 recordHistory 的读-改-写：读整份、加一轮、整体写回。
// 中间插入 await 让并发窗口真实存在（真实实现里是 JSON.parse 与 fetch 的间隙）。
async function appendRound(roundKey, { locked }) {
    const run = async () => {
        let history = { schema_version: 1, updated_at: null, days: {} };

        try {
            history = JSON.parse(await fs.readFile(targetPath, "utf8"));
        } catch {
            // 首次运行没有文件。
        }

        const day = history.days["2026-09-16"] ?? { date: "2026-09-16", rounds: {} };
        await new Promise((resolve) => setTimeout(resolve, 15));

        day.rounds[roundKey] = {
            index: Number(roundKey),
            recorded_at: new Date().toISOString(),
            items: [{ name: `货物${roundKey}` }],
        };
        history.days["2026-09-16"] = day;

        await writeFileAtomic(targetPath, `${JSON.stringify(history, null, 4)}\n`);
    };

    return locked ? withFileLock(targetPath, run) : run();
}

async function readRoundKeys() {
    const payload = JSON.parse(await fs.readFile(targetPath, "utf8"));
    return Object.keys(payload.days["2026-09-16"].rounds).sort();
}

// 1. 无锁对照：证明这个测试真的能捕获问题（否则加锁通过也说明不了什么）。
await fs.writeFile(
    targetPath,
    `${JSON.stringify({ schema_version: 1, updated_at: null, days: {} }, null, 4)}\n`,
    "utf8",
);
await Promise.all(
    ["1", "2", "3", "4"].map((key) => appendRound(key, { locked: false })),
);
const unlockedKeys = await readRoundKeys();
check(
    "无锁时确实会丢轮次（对照组，用于证明测试有效）",
    unlockedKeys.length < 4,
    `无锁却保住了 ${unlockedKeys.length} 轮，并发窗口没被触发，测试失去意义`,
);

// 2. 加锁：四个写入者各记一轮，必须全部保留。
await fs.writeFile(
    targetPath,
    `${JSON.stringify({ schema_version: 1, updated_at: null, days: {} }, null, 4)}\n`,
    "utf8",
);
await Promise.all(
    ["1", "2", "3", "4"].map((key) => appendRound(key, { locked: true })),
);
const lockedKeys = await readRoundKeys();
check(
    "加锁后四轮并发写入全部保留",
    lockedKeys.join(",") === "1,2,3,4",
    `实际保留 ${lockedKeys.join(",") || "无"}`,
);

// 3. 锁必须释放干净，否则后续同步会一直等到超时强夺。
const leftovers = (await fs.readdir(workDir)).filter((name) => name.endsWith(".lock"));
check("锁文件用后不残留", leftovers.length === 0, `残留 ${leftovers.join(", ")}`);

// 4. 原子写：写坏的中间态不能被读到。这里验证写入后立刻可解析。
await writeFileAtomic(targetPath, `${JSON.stringify({ ok: true })}\n`);
let parsedAfterAtomic = null;
try {
    parsedAfterAtomic = JSON.parse(await fs.readFile(targetPath, "utf8"));
} catch {
    parsedAfterAtomic = null;
}
check("原子写后文件立即可解析", parsedAfterAtomic?.ok === true);

// 5. 临时文件不能留在数据目录里（会被 git status 当成新文件）。
const tmpLeftovers = (await fs.readdir(workDir)).filter((name) =>
    name.includes(".tmp"),
);
check("原子写不留临时文件", tmpLeftovers.length === 0, `残留 ${tmpLeftovers.join(", ")}`);

// 6. 陈旧锁必须能被强夺，否则进程崩溃后留下的锁会永久卡死同步。
const stalePath = path.join(workDir, "stale.json");
await fs.writeFile(`${stalePath}.lock`, "99999", "utf8");
const staleTime = new Date(Date.now() - 60_000);
await fs.utimes(`${stalePath}.lock`, staleTime, staleTime);

let staleBroken = false;
await withFileLock(
    stalePath,
    async () => {
        staleBroken = true;
    },
    { staleMs: 5_000, timeoutMs: 3_000 },
);
check("陈旧锁可被强夺，不会永久死锁", staleBroken);

// 7. 回调抛错时锁也要释放，否则一次失败会卡死后续所有同步。
const throwPath = path.join(workDir, "throw.json");
let thrown = false;
try {
    await withFileLock(throwPath, async () => {
        throw new Error("boom");
    });
} catch {
    thrown = true;
}
const throwLockLeft = await fs
    .access(`${throwPath}.lock`)
    .then(() => true)
    .catch(() => false);
check("回调抛错时仍释放锁", thrown && !throwLockLeft);

await fs.rm(workDir, { recursive: true, force: true });

if (failures.length) {
    console.error(`商人历史并发测试失败 ${failures.length} 项：`);
    for (const failure of failures) {
        console.error(`  - ${failure}`);
    }
    process.exit(1);
}

console.log(
    `商人历史并发安全测试全部通过（无锁对照仅保住 ${unlockedKeys.length}/4 轮，加锁后 4/4）。`,
);
