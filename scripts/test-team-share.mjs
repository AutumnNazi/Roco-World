// 配队分享链接编解码测试。必须导入 src 真实实现，禁止本地复制一份逻辑。
import esbuild from "esbuild";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseQuery } from "vue-router";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const failures = [];

function check(label, condition, detail = "") {
    if (condition) {
        return;
    }

    failures.push(detail ? `${label}（${detail}）` : label);
}

async function loadModule() {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "team-share-test-"));
    const outFile = path.join(outDir, "teamShare.mjs");

    await esbuild.build({
        entryPoints: [path.join(rootDir, "src", "lib", "teamShare.ts")],
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

function encodeLegacyBase64(state) {
    const json = JSON.stringify(state);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

const { encodeTeamSharePayload, decodeTeamSharePayload } = await loadModule();

const sample = {
    name: "圣光迪莫·觉醒",
    magicItemId: 1,
    slots: [
        {
            friendId: 3048,
            personalityId: 11,
            legacyTypeId: 17,
            moveIds: [1, 2, 3, 4],
            roles: ["辅助"],
        },
    ],
};

function sameTeam(actual, expected) {
    if (!actual || typeof actual !== "object") {
        return false;
    }

    return (
        actual.name === expected.name &&
        actual.magicItemId === expected.magicItemId &&
        JSON.stringify(actual.slots?.[0]?.moveIds) === JSON.stringify(expected.slots[0].moveIds) &&
        actual.slots?.[0]?.friendId === expected.slots[0].friendId &&
        actual.slots?.[0]?.personalityId === expected.slots[0].personalityId &&
        actual.slots?.[0]?.legacyTypeId === expected.slots[0].legacyTypeId &&
        JSON.stringify(actual.slots?.[0]?.roles) === JSON.stringify(expected.slots[0].roles)
    );
}

const encoded = encodeTeamSharePayload(sample);
check("新载荷不含查询敏感字符 +/=", !/[+/=]/.test(encoded), encoded);

const parsed = parseQuery(`?team=${encoded}`).team;
check(
    "vue-router 解析后仍能还原",
    sameTeam(decodeTeamSharePayload(parsed), sample),
    `parsed=${JSON.stringify(parsed)} decoded=${JSON.stringify(decodeTeamSharePayload(parsed))}`,
);

const legacy = encodeLegacyBase64({
    name: sample.name,
    magicItemId: sample.magicItemId,
    slots: sample.slots,
});
const legacyParsed = parseQuery(`?team=${legacy}`).team;
check(
    "历史标准 base64 被 parseQuery 打成空格后仍能救回",
    sameTeam(decodeTeamSharePayload(legacyParsed), sample),
    `legacy=${legacy} parsed=${JSON.stringify(legacyParsed)}`,
);

const wrapped = encoded.replace(/(.{40})/g, "$1\n");
check(
    "长链接被折成换行后仍能还原",
    sameTeam(decodeTeamSharePayload(wrapped), sample),
    `wrapped decode=${JSON.stringify(decodeTeamSharePayload(wrapped))}`,
);

const tabbed = encoded.replace(/(.{40})/g, "$1\t");
check(
    "长链接被插入 Tab 后仍能还原",
    sameTeam(decodeTeamSharePayload(tabbed), sample),
    `tabbed decode=${JSON.stringify(decodeTeamSharePayload(tabbed))}`,
);

const legacyWrapped = String(legacyParsed).replace(/(.{40})/g, "$1\n");
check(
    "旧链接既被打成空格又被折行后仍能救回",
    sameTeam(decodeTeamSharePayload(legacyWrapped), sample),
    `legacyWrapped decode=${JSON.stringify(decodeTeamSharePayload(legacyWrapped))}`,
);

check("垃圾输入不抛异常", decodeTeamSharePayload("!!!") === null);

if (failures.length) {
    console.error(`配队分享测试失败 ${failures.length} 项：`);
    for (const failure of failures) {
        console.error(`  - ${failure}`);
    }
    process.exit(1);
}

console.log("配队分享编解码测试全部通过（已导入 src 真实实现）。");
