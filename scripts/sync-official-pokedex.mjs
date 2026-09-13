import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const outputDir = path.join(rootDir, "public", "data");
const outputPath = path.join(outputDir, "pokedex-official.json");

// 腾讯官方图鉴（洛克王国：世界）公开数据：精灵列表 l 与详情 d，
// 提供图鉴编号、身高/体重、栖息地、昵称与官方描述，随官方版本更新。
const OFFICIAL_DATA_URL =
    "https://static.gamecenter.qq.com/xgame/roco-kingdom/compendium/d.json";

async function main() {
    const response = await fetch(OFFICIAL_DATA_URL, {
        headers: { "User-Agent": "Mozilla/5.0 rocom-aoe-top-pokedex-sync" },
    });

    if (!response.ok) {
        throw new Error(`官方图鉴数据请求失败: ${response.status}`);
    }

    const payload = await response.json();
    const list = Array.isArray(payload?.l) ? payload.l : [];
    const details =
        payload?.d && typeof payload.d === "object" ? payload.d : {};

    if (!list.length) {
        throw new Error("官方图鉴数据为空，请确认 d.json 结构是否变更。");
    }

    // 同名多形态（如「迪莫」不同阶段）按物种级共享一份档案，取首次出现条目。
    const entries = {};

    for (const item of list) {
        const name = typeof item?.nm === "string" ? item.nm.trim() : "";

        if (!name || entries[name]) {
            continue;
        }

        const detail = details[String(item?.i)] ?? {};
        entries[name] = {
            no: typeof item?.n === "string" ? item.n : null,
            form: typeof item?.s === "string" ? item.s : null,
            height: typeof detail?.h === "string" ? detail.h : null,
            weight: typeof detail?.w === "string" ? detail.w : null,
            habitat: typeof detail?.loc === "string" ? detail.loc : null,
            nickname: typeof detail?.nick === "string" ? detail.nick : null,
            description: typeof detail?.desc === "string" ? detail.desc : null,
        };
    }

    const result = {
        schema_version: 1,
        generated_at: buildBeijingTimestamp(),
        source: {
            site: "洛克王国：世界 官方图鉴",
            page: OFFICIAL_DATA_URL,
        },
        entries,
    };

    await fs.writeFile(
        outputPath,
        `${JSON.stringify(result, null, 4)}\n`,
        "utf8",
    );

    console.log(`Generated ${Object.keys(entries).length} official pokedex entries.`);
}

function buildBeijingTimestamp() {
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    })
        .format(new Date())
        .replace("T", " ");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
