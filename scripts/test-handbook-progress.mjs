// 图鉴进度的合并 / 覆盖语义测试。
//
// 为什么要用 esbuild 现编译再导入：被测源码是 TS，Node 20 没有 --experimental-strip-types。
// 关键是**必须导入 src 下的真实实现** —— 早先这个文件把 merge 逻辑复制了一份在本地跑，
// 源码把「取较新时间戳」改成「取较旧」它依然全绿，等于没有覆盖。
import esbuild from "esbuild";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const handbookProgressDir = path.join(rootDir, "src", "lib", "handbookProgress");

const failures = [];

function check(label, condition, detail = "") {
    if (condition) {
        return;
    }

    failures.push(detail ? `${label}（${detail}）` : label);
}

async function loadModule(fileName) {
    const outDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "handbook-progress-test-"),
    );
    const outFile = path.join(outDir, `${path.basename(fileName, ".ts")}.mjs`);

    await esbuild.build({
        entryPoints: [path.join(handbookProgressDir, fileName)],
        outfile: outFile,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node20",
        logLevel: "silent",
    });

    const module = await import(pathToFileURL(outFile).href);
    await fs.rm(outDir, { recursive: true, force: true });
    return module;
}

const { mergeHandbookProgressState, replaceHandbookProgressState } =
    await loadModule("merge.ts");

const base = {
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    collected: { 91: "2026-01-01T00:00:00.000Z" },
    topics: { 91: { 1: "2026-01-01T00:00:00.000Z" } },
};

const incoming = {
    version: 1,
    updatedAt: "2026-02-01T00:00:00.000Z",
    collected: { 93: "2026-02-01T00:00:00.000Z" },
    topics: {
        91: { 1: "2026-01-02T00:00:00.000Z", 2: "2026-02-01T00:00:00.000Z" },
    },
};

const merged = mergeHandbookProgressState(base, incoming);

check("合并保留双方已收集物种", Boolean(merged.collected[91] && merged.collected[93]));
// 同一话题两侧都有记录时取较新那个：这是本测试的核心断言，
// 把源码的比较方向写反必须能在这里变红。
check(
    "同一话题取较新时间戳",
    merged.topics[91][1] === "2026-01-02T00:00:00.000Z",
    `实际 ${merged.topics[91][1]}`,
);
check("合并新增话题", Boolean(merged.topics[91][2]));

// 反向合并：把较旧的一份当作 incoming，已有的较新记录不能被覆盖回旧值。
const mergedReversed = mergeHandbookProgressState(incoming, base);
check(
    "反向合并仍保留较新时间戳",
    mergedReversed.topics[91][1] === "2026-01-02T00:00:00.000Z",
    `实际 ${mergedReversed.topics[91][1]}`,
);

// 单侧独有的物种/话题不能在合并中丢失。
check(
    "反向合并不丢失双方物种",
    Boolean(mergedReversed.collected[91] && mergedReversed.collected[93]),
);

// migratedFromCookies 是「一次迁移过就永久为真」的标记，任一侧为真即为真。
check(
    "迁移标记任一侧为真即保留",
    mergeHandbookProgressState(
        { ...base, migratedFromCookies: true },
        { ...incoming, migratedFromCookies: false },
    ).migratedFromCookies === true,
);

// 覆盖语义与合并相反：直接以 incoming 为准，旧记录不保留。
const replaced = replaceHandbookProgressState(incoming);
check("覆盖丢弃旧的已收集记录", !replaced.collected[91]);
check("覆盖保留传入的已收集记录", Boolean(replaced.collected[93]));

// cookie 迁移的物种归属。解包手册表的 name 列整体错位（第 N 行写着第 N-1 只的名字），
// 建索引时若让 handbookRowName 覆盖真实精灵名，用户旧进度会整段记到邻居物种头上。
// 这里用错位数据构造：species 10 的 rowName 是 species 9 的名字。
const migrationCatalog = [
    { speciesId: 9, name: "波波拉", handbookRowName: "妙妙猪", topics: [], representativePet: null },
    { speciesId: 10, name: "水灵", handbookRowName: "波波拉", topics: [], representativePet: null },
    { speciesId: 11, name: "鸭吉吉", handbookRowName: "水灵", topics: [], representativePet: null },
];

const originalDocument = globalThis.document;
globalThis.document = {
    cookie: `rocom_pet_topics_${encodeURIComponent("波波拉")}=${encodeURIComponent(
        JSON.stringify({ 1: "2026-03-01T00:00:00.000Z" }),
    )}`,
};

try {
    const { migrateHandbookProgressFromCookies } = await loadModule("migration.ts");
    const migratedState = migrateHandbookProgressFromCookies(
        {
            version: 1,
            updatedAt: "2026-01-01T00:00:00.000Z",
            collected: {},
            topics: {},
        },
        migrationCatalog,
    );

    check(
        "cookie 迁移按真实精灵名归属物种",
        Boolean(migratedState.topics[9]?.[1]),
        `波波拉的进度应落在 species 9，实际落在 ${Object.keys(migratedState.topics).join("/") || "无"}`,
    );
    check(
        "cookie 迁移不写到错位的邻居物种",
        !migratedState.topics[10],
        "species 10 被错误写入",
    );
    check("cookie 迁移后置迁移标记", migratedState.migratedFromCookies === true);
} finally {
    if (originalDocument === undefined) {
        delete globalThis.document;
    } else {
        globalThis.document = originalDocument;
    }
}

if (failures.length) {
    console.error(`图鉴进度测试失败 ${failures.length} 项：`);
    for (const failure of failures) {
        console.error(`  - ${failure}`);
    }
    process.exit(1);
}

console.log("图鉴进度合并 / 覆盖测试全部通过（已导入 src 真实实现）。");
