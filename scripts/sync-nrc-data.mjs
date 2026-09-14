import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLuaTable } from "./lib/lua-table.mjs";
import { mirrorFileToDist } from "./lib/mirror-to-dist.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const publicDataDir = path.join(rootDir, "public", "data");
const cacheDir = path.join(rootDir, "data-source", "nrc");

// 数据来自哔哩哔哩「洛克王国：世界」WIKI（wiki.biligame.com/nrc）的结构化 Lua 数据模块。
// 该站模块由构建器生成，字段语义清晰（entry_name / title / habitat 分列），
// 比游戏解包手册表的错位文本更可靠，因此作为图鉴文案与时装/奖牌的主数据源。
const WIKI_API_URL = "https://wiki.biligame.com/nrc/api.php";
const HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
};
// BWIKI 的 Special:FilePath 会 302 到真实图床地址且不限频，
// 直接用它作为图片地址，既省掉每张图的 API 查询，也避免触发限频导致整批丢失。
const FILE_PATH_PREFIX = "https://wiki.biligame.com/nrc/Special:FilePath/";
// 模块拉取仍需限频，BWIKI 对连续 API 请求会返回验证页。
const REQUEST_INTERVAL_MS = 2500;

function toImageUrl(fileName) {
    return fileName ? `${FILE_PATH_PREFIX}${encodeURIComponent(fileName)}` : null;
}

const MODULES = [
    "模块:Pets/data/Catalog",
    "模块:Pets/data/Handbooks",
    "模块:Pets/data/Overview",
    "模块:Fashions/data/Catalog",
    "模块:Fashions/data/Items",
    "模块:Fashions/data/Bonds",
    "模块:Fashions/data/Series",
    "模块:Medals/data/Catalog",
];

async function main() {
    const useCacheOnly = process.argv.includes("--cache-only");
    const modules = await loadModules(useCacheOnly);

    const petCatalog = modules["模块:Pets/data/Catalog"];
    const handbooks = modules["模块:Pets/data/Handbooks"];
    const overview = modules["模块:Pets/data/Overview"];
    const fashionCatalog = modules["模块:Fashions/data/Catalog"];
    const fashionItems = modules["模块:Fashions/data/Items"];
    const fashionBonds = modules["模块:Fashions/data/Bonds"];
    const fashionSeries = modules["模块:Fashions/data/Series"];
    const medalCatalog = modules["模块:Medals/data/Catalog"];

    const petEntries = buildPetEntries(petCatalog, handbooks, overview);
    const fashions = buildFashions(fashionCatalog, fashionItems, fashionBonds);
    const fashionSeriesEntries = buildFashionSeries(fashionSeries);
    const medals = buildMedals(medalCatalog);

    const imageNames = [
        ...collectImageNames(fashions, medals),
        ...collectSeriesImageNames(fashionSeriesEntries),
    ];
    const imageUrls = await resolveImageUrls(imageNames);

    applyImageUrls(fashions, medals, fashionSeriesEntries, imageUrls);

    const generatedAt = buildBeijingTimestamp();
    const source = {
        site: "哔哩哔哩「洛克王国：世界」WIKI",
        page: "https://wiki.biligame.com/nrc/",
        note: "数据与图片版权归哔哩哔哩游戏 WIKI 及腾讯所有，本站仅作学习交流转载。",
    };

    const petsChanged = await writeJsonIfChanged(
        path.join(publicDataDir, "nrc-pets.json"),
        {
            schema_version: 1,
            generated_at: generatedAt,
            source,
            entries: petEntries,
        },
        ["generated_at"],
    );

    const fashionsChanged = await writeJsonIfChanged(
        path.join(publicDataDir, "fashions.json"),
        {
            schema_version: 1,
            generated_at: generatedAt,
            source,
            series: fashionSeriesEntries,
            entries: fashions,
        },
        ["generated_at"],
    );

    const medalsChanged = await writeJsonIfChanged(
        path.join(publicDataDir, "medals.json"),
        {
            schema_version: 1,
            generated_at: generatedAt,
            source,
            entries: medals,
        },
        ["generated_at"],
    );

    console.log(
        `nrc 数据同步完成：精灵档案 ${Object.keys(petEntries).length} 条${petsChanged ? "（已更新）" : "（无变化）"}、` +
            `时装 ${fashions.length} 套${fashionsChanged ? "（已更新）" : "（无变化）"}、` +
            `系列 ${fashionSeriesEntries.length} 个、` +
            `奖牌 ${medals.length} 枚${medalsChanged ? "（已更新）" : "（无变化）"}。`,
    );
}

async function loadModules(useCacheOnly) {
    await fs.mkdir(cacheDir, { recursive: true });
    const result = {};

    for (const moduleTitle of MODULES) {
        const cachePath = path.join(cacheDir, `${toCacheName(moduleTitle)}.lua`);
        let source = await readFileOrNull(cachePath);

        if (!source && useCacheOnly) {
            throw new Error(`缺少缓存：${moduleTitle}，请先联网执行一次同步。`);
        }

        if (!useCacheOnly) {
            const fetched = await fetchModuleSource(moduleTitle).catch(
                (error) => {
                    if (source) {
                        console.warn(
                            `${moduleTitle} 拉取失败（${error.message}），沿用本地缓存。`,
                        );
                        return null;
                    }

                    throw error;
                },
            );

            if (fetched) {
                source = fetched;
                await fs.writeFile(cachePath, fetched, "utf8");
            }

            await sleep(REQUEST_INTERVAL_MS);
        }

        result[moduleTitle] = parseLuaTable(source);
    }

    return result;
}

async function fetchModuleSource(moduleTitle) {
    const params = new URLSearchParams({
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        titles: moduleTitle,
        format: "json",
        formatversion: "2",
    });

    const response = await fetch(`${WIKI_API_URL}?${params}`, {
        headers: HEADERS,
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();

    if (!text.trimStart().startsWith("{")) {
        throw new Error("BWIKI 触发限频验证");
    }

    const payload = JSON.parse(text);
    const page = payload?.query?.pages?.[0];
    const content = page?.revisions?.[0]?.slots?.main?.content;

    if (!content) {
        throw new Error("模块内容为空");
    }

    return content;
}

function buildPetEntries(petCatalog, handbooks, overview) {
    const entries = {};

    for (const [petKey, pet] of Object.entries(petCatalog)) {
        const gameId = pet?.game_id;

        if (!Number.isFinite(gameId)) {
            continue;
        }

        const handbook = pet.handbook_id ? handbooks[pet.handbook_id] : null;
        const petOverview = overview[petKey] ?? null;

        entries[gameId] = {
            wiki_key: petKey,
            name: pet.name ?? null,
            number: pet.number ?? null,
            // nrc 把「物种名 / 称号 / 栖息地」分列存放，不会像解包手册表那样错位。
            entry_name: handbook?.entry_name ?? pet.name ?? null,
            title: handbook?.title ?? pet.title ?? null,
            habitat: handbook?.habitat ?? null,
            areas: toArray(handbook?.areas),
            class: pet.class ?? null,
            description: pet.description ?? null,
            types: toArray(pet.types),
            stats: pet.stats ?? null,
            height: pet.height ?? null,
            weight: pet.weight ?? null,
            egg_group: toArray(pet.egg_group),
            egg_size: pet.egg_size ?? null,
            gender_ratio: pet.gender_ratio ?? null,
            catch_threshold: toArray(pet.catch_threshold),
            can_ride: pet.can_ride ?? null,
            can_double_ride: pet.can_double_ride ?? null,
            move_type: pet.move_type ?? null,
            perception_range: pet.perception_range ?? null,
            starlight: pet.starlight ?? null,
            has_shiny: pet.has_shiny ?? null,
            stage: pet.stage ?? null,
            affinity: pet.affinity ?? null,
            // 立绘图与头像：sync-pet-images 缺图时按此回退到 nrc 图床。
            illustration: pet.image?.illustration ?? null,
            head: pet.image?.head ?? null,
            sources: collectSources(pet, petOverview),
            fruits: collectFruits(pet),
            release: pet.release ?? null,
            handbook_topics: buildHandbookTopics(handbook),
        };
    }

    return entries;
}

function collectSources(pet, petOverview) {
    const sources = new Set();

    for (const value of toArray(pet?.sources)) {
        const text = typeof value === "string" ? value : value?.text;

        if (text) {
            sources.add(text);
        }
    }

    for (const value of toArray(petOverview?.sources)) {
        const text = typeof value === "string" ? value : value?.text;

        if (text) {
            sources.add(text);
        }
    }

    for (const key of ["locations", "obtain", "acquire"]) {
        for (const value of toArray(petOverview?.[key])) {
            const text = typeof value === "string" ? value : value?.name;

            if (text) {
                sources.add(text);
            }
        }
    }

    return [...sources];
}

function collectFruits(pet) {
    return toArray(pet?.ecology?.fruits).map((fruit) => ({
        name: fruit?.name ?? null,
        description: fruit?.description ?? null,
        sources: toArray(fruit?.sources),
        wisdom_tree: fruit?.wisdom_tree ?? null,
    }));
}

function buildHandbookTopics(handbook) {
    return toArray(handbook?.topics).map((topic) => ({
        text: topic?.text ?? null,
        target: topic?.target ?? null,
        rewards: toArray(topic?.rewards).map((reward) => ({
            name: reward?.name ?? null,
            count: reward?.count ?? null,
            kind: reward?.kind ?? null,
        })),
    }));
}

function buildFashions(fashionCatalog, fashionItems, fashionBonds) {
    const pieceById = fashionItems?.fashion ?? {};
    const entries = [];

    // 徽章（Bonds）通过 outfit_ids 关联到时装套，用来在时装页展示搭配奖励。
    const bondsByOutfit = new Map();
    for (const bond of Object.values(fashionBonds ?? {})) {
        for (const outfitId of toArray(bond?.outfit_ids)) {
            const bucket = bondsByOutfit.get(outfitId) ?? [];
            bucket.push({
                id: bond?.id ?? null,
                name: bond?.name ?? null,
                quality_name: bond?.quality_name ?? null,
                style: bond?.style ?? null,
                series_id: bond?.series_id ?? null,
                text: bond?.text ?? null,
                interaction_text: bond?.interaction_text ?? null,
                normal_text: bond?.normal_text ?? null,
                icon: bond?.icon ?? null,
                image_url: null,
                pets: toArray(bond?.pets?.primary).map((pet) => ({
                    name: pet?.name ?? null,
                    form: pet?.form ?? null,
                })),
            });
            bondsByOutfit.set(outfitId, bucket);
        }
    }

    for (const [key, suit] of Object.entries(fashionCatalog)) {
        const variants = [];

        for (const [genderKey, variant] of Object.entries(
            suit?.variants ?? {},
        )) {
            variants.push({
                gender: genderKey,
                gender_label: variant?.gender_label ?? null,
                name: variant?.name ?? suit?.name ?? null,
                description: variant?.description ?? null,
                grade_name: variant?.grade_name ?? null,
                acquire: toArray(variant?.acquire),
                item_count: variant?.item_count ?? null,
                image: variant?.card_image ?? variant?.main_image ?? null,
                image_url: null,
                pieces: toArray(variant?.piece_ids)
                    .map((pieceId) => {
                        const piece = pieceById[pieceId];

                        if (!piece) {
                            return null;
                        }

                        return {
                            id: pieceId,
                            name: piece.name ?? null,
                            slot: piece.slot ?? null,
                            quality: piece.quality ?? null,
                        };
                    })
                    .filter(Boolean),
            });
        }

        variants.sort((left, right) =>
            String(left.gender).localeCompare(String(right.gender)),
        );

        entries.push({
            wiki_key: key,
            name: suit?.name ?? null,
            description: suit?.description ?? null,
            quality: suit?.quality ?? null,
            grade: suit?.grade ?? null,
            grade_name: suit?.grade_name ?? null,
            series_id: suit?.series_id ?? null,
            genders: toArray(suit?.genders),
            bonds: bondsByOutfit.get(key) ?? [],
            variants,
        });
    }

    entries.sort((left, right) =>
        String(left.wiki_key).localeCompare(String(right.wiki_key)),
    );
    return entries;
}

function buildFashionSeries(seriesTable) {
    const entries = [];

    for (const [key, series] of Object.entries(seriesTable ?? {})) {
        entries.push({
            id: Number(key),
            name: series?.name ?? null,
            description: series?.description ?? null,
            tags: series?.tags ?? null,
            art: series?.art ?? null,
            art_url: null,
            icon: series?.icon ?? null,
            icon_url: null,
        });
    }

    entries.sort((left, right) => left.id - right.id);
    return entries;
}

function buildMedals(medalCatalog) {
    const entries = [];

    for (const [key, medal] of Object.entries(medalCatalog)) {
        entries.push({
            wiki_key: key,
            name: medal?.name ?? null,
            description: medal?.description ?? null,
            prefix_text: medal?.prefix_text ?? null,
            quality: medal?.quality ?? null,
            quality_label: medal?.quality_label ?? null,
            type_label: medal?.type_label ?? null,
            image: medal?.icon ?? null,
            image_url: null,
            tasks: toArray(medal?.tasks).map((task) => ({
                description: task?.description ?? null,
                condition_label: task?.condition_label ?? null,
                count: task?.count ?? null,
            })),
        });
    }

    entries.sort((left, right) => {
        return (
            (right.quality ?? 0) - (left.quality ?? 0) ||
            String(left.wiki_key).localeCompare(String(right.wiki_key))
        );
    });
    return entries;
}

function collectImageNames(fashions, medals) {
    const names = new Set();

    for (const suit of fashions) {
        for (const variant of suit.variants) {
            if (variant.image) {
                names.add(variant.image);
            }
        }

        for (const bond of suit.bonds ?? []) {
            if (bond.icon) {
                names.add(bond.icon);
            }
        }
    }

    for (const medal of medals) {
        if (medal.image) {
            names.add(medal.image);
        }
    }

    return [...names];
}

async function resolveImageUrls(imageNames) {
    // 直接用 Special:FilePath 拼地址：不消耗 API 配额、不会限频，
    // 也不需要缓存真实图床 URL（图床地址会随文件版本变化）。
    const map = {};

    for (const name of imageNames) {
        map[name] = toImageUrl(name);
    }

    return map;
}

function collectSeriesImageNames(seriesEntries) {
    const names = new Set();

    for (const series of seriesEntries) {
        if (series.art) {
            names.add(series.art);
        }
        if (series.icon) {
            names.add(series.icon);
        }
    }

    return [...names];
}

function applyImageUrls(fashions, medals, seriesEntries, imageUrls) {
    for (const suit of fashions) {
        for (const variant of suit.variants) {
            variant.image_url = variant.image
                ? (imageUrls[variant.image] ?? null)
                : null;
        }

        for (const bond of suit.bonds ?? []) {
            bond.image_url = bond.icon ? (imageUrls[bond.icon] ?? null) : null;
        }
    }

    for (const medal of medals) {
        medal.image_url = medal.image ? (imageUrls[medal.image] ?? null) : null;
    }

    for (const series of seriesEntries) {
        series.art_url = series.art ? (imageUrls[series.art] ?? null) : null;
        series.icon_url = series.icon ? (imageUrls[series.icon] ?? null) : null;
    }
}

function toArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (value === null || value === undefined) {
        return [];
    }

    if (typeof value === "object") {
        return Object.values(value);
    }

    return [value];
}

function toCacheName(moduleTitle) {
    return moduleTitle.replace(/^模块:/u, "").replace(/\//gu, "__");
}

async function readFileOrNull(filePath) {
    try {
        return await fs.readFile(filePath, "utf8");
    } catch {
        return null;
    }
}

async function writeJsonIfChanged(filePath, payload, ignoredKeys = []) {
    const nextComparable = JSON.stringify(stripKeys(payload, ignoredKeys));
    const previousRaw = await readFileOrNull(filePath);

    if (previousRaw) {
        try {
            const previousComparable = JSON.stringify(
                stripKeys(JSON.parse(previousRaw), ignoredKeys),
            );

            if (previousComparable === nextComparable) {
                return false;
            }
        } catch {
            // 旧文件损坏时直接覆盖。
        }
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
    await mirrorFileToDist(
        rootDir,
        path.relative(path.join(rootDir, "public"), filePath),
    );
    return true;
}

function stripKeys(value, keys) {
    if (!keys.length || value === null || typeof value !== "object") {
        return value;
    }

    const clone = Array.isArray(value) ? [...value] : { ...value };

    for (const key of keys) {
        delete clone[key];
    }

    return clone;
}

function buildBeijingTimestamp() {
    const beijingNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return beijingNow.toISOString().replace("T", " ").slice(0, 19);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
