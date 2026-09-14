import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLuaTable } from "./lib/lua-table.mjs";
import { mirrorFileToDist } from "./lib/mirror-to-dist.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const publicDataDir = path.join(rootDir, "public", "data");
const cacheDir = path.join(rootDir, "data-source", "nrc");
const outputPath = path.join(publicDataDir, "personalities.json");

const WIKI_API_URL = "https://wiki.biligame.com/nrc/api.php";
const MODULE_TITLE = "模块:Pets/data/TrainingReference";
const HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

// nrc 的 detail 文本（如「物攻↑ / 物防↓」）是站内编辑整理的权威性格效果，
// 比上游仓库里那套英文名 + 猜测数值可靠，因此性格表改由这里生成。
const STAT_BY_LABEL = {
    物攻: "phy_atk_mod_pct",
    魔攻: "mag_atk_mod_pct",
    物防: "phy_def_mod_pct",
    魔防: "mag_def_mod_pct",
    速度: "spd_mod_pct",
    生命: "hp_mod_pct",
};

// 游戏内性格固定 +20% / -10%（与解包 NATURE_CONF 的 proportion 一致）。
const UP_VALUE = 0.2;
const DOWN_VALUE = -0.1;

async function main() {
    const table = await loadTrainingReference();
    // 性格表嵌在 labels.nature 下（labels 里还有 blood/skill/talent）。
    const natures = table?.labels?.nature ?? {};

    const entries = [];

    for (const [key, value] of Object.entries(natures)) {
        const id = Number(key);
        const name = typeof value?.name === "string" ? value.name.trim() : "";
        const detail = typeof value?.detail === "string" ? value.detail : "";

        if (!Number.isFinite(id) || !name || !detail) {
            continue;
        }

        const parsed = parseDetail(detail);

        if (!parsed) {
            console.warn(`性格「${name}」的效果文本无法解析：${detail}`);
            continue;
        }

        entries.push({
            id,
            name,
            hp_mod_pct: 0,
            phy_atk_mod_pct: 0,
            mag_atk_mod_pct: 0,
            phy_def_mod_pct: 0,
            mag_def_mod_pct: 0,
            spd_mod_pct: 0,
            localized: { zh: name },
            effect_detail: detail,
        });
    }

    if (entries.length < 20) {
        throw new Error(`性格条目过少（${entries.length}），数据源结构可能已变更。`);
    }

    for (const entry of entries) {
        const parsed = parseDetail(entry.effect_detail);
        entry[STAT_BY_LABEL[parsed.up]] = UP_VALUE;
        entry[STAT_BY_LABEL[parsed.down]] = DOWN_VALUE;
    }

    entries.sort((left, right) => left.id - right.id);

    await fs.writeFile(outputPath, `${JSON.stringify(entries)}\n`, "utf8");
    await mirrorFileToDist(rootDir, path.join("data", "personalities.json"));

    console.log(`性格表已更新：${entries.length} 条（+20% / -10%）。`);
    for (const entry of entries) {
        console.log(`  ${entry.id} ${entry.name} ${entry.effect_detail}`);
    }
}

function parseDetail(detail) {
    const up = detail.match(/([物魔]?[攻防]|速度|生命)\s*↑/u);
    const down = detail.match(/([物魔]?[攻防]|速度|生命)\s*↓/u);

    if (!up || !down) {
        return null;
    }

    return { up: up[1], down: down[1] };
}

async function loadTrainingReference() {
    const cachePath = path.join(cacheDir, "Pets__data__TrainingReference.lua");

    try {
        const cached = await fs.readFile(cachePath, "utf8");

        if (cached.length > 1000) {
            return parseLuaTable(cached);
        }
    } catch {
        // 无缓存则联网拉取。
    }

    const params = new URLSearchParams({
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        titles: MODULE_TITLE,
        format: "json",
        formatversion: "2",
    });
    const response = await fetch(`${WIKI_API_URL}?${params}`, { headers: HEADERS });
    const text = await response.text();

    if (!text.trimStart().startsWith("{")) {
        throw new Error("BWIKI 触发限频验证，请稍后重试。");
    }

    const content = JSON.parse(text)?.query?.pages?.[0]?.revisions?.[0]?.slots?.main
        ?.content;

    if (!content) {
        throw new Error("TrainingReference 模块内容为空。");
    }

    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cachePath, content, "utf8");

    return parseLuaTable(content);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
