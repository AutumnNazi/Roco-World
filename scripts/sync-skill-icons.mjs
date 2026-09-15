// 补齐技能 / 特性图标：解包资源包里缺失的图标（如大雪球、撞鬼、冰封），
// 在 BWIKI 上以 Skill_{id}.png / Feature_{id}.png 命名存在，按需下载转 webp。
//
// 图标落到 public/assets/webp/items/{id}.webp —— 与 SkillIcon 组件的取图路径一致
// （技能、特性、技能石共用同一套 icon_id 命名空间）。
//
// 用法：node ./scripts/sync-skill-icons.mjs
// 已存在的文件跳过，可反复执行续传；BWIKI 限频时降速重试。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(publicDir, "data");
const petsDetailDir = path.join(dataDir, "pets");
const iconsDir = path.join(publicDir, "assets", "webp", "items");

// 两个 WIKI 都托管同一批图标，nrc（洛克王国：世界）更全，rocom 作为回退。
const FILE_PATH_ENDPOINTS = [
    {
        site: "nrc",
        base: "https://wiki.biligame.com/nrc/Special:FilePath/",
        referer: "https://wiki.biligame.com/nrc/",
    },
    {
        site: "rocom",
        base: "https://wiki.biligame.com/rocom/Special:FilePath/",
        referer: "https://wiki.biligame.com/rocom/",
    },
];

// 同一个 id 可能是技能图标也可能是特性图标，两种命名都试。
const NAME_PATTERNS = ["Skill_%s.png", "Feature_%s.png"];

const CONCURRENCY = 2;
const RETRY = 4;
const REQUEST_GAP_MS = 300;

async function main() {
    const existing = new Set(
        (await readDirOrEmpty(iconsDir))
            .filter((name) => name.endsWith(".webp"))
            .map((name) => name.replace(/\.webp$/u, "")),
    );

    const referenced = await collectReferencedIconIds();
    // 只处理纯数字 id：技能与特性图标都是数字命名，
    // egg_xxx / img_xxx 那批属于道具贴图，命名规则不同，不在本脚本范围。
    const missing = [...referenced]
        .filter((id) => /^\d+$/u.test(id) && !existing.has(id))
        .sort();

    if (!missing.length) {
        console.log("技能 / 特性图标均已就绪，无需补图。");
        return;
    }

    console.log(`发现 ${missing.length} 个缺失图标，开始从 BWIKI 补图…`);

    await fs.mkdir(iconsDir, { recursive: true });

    const ok = [];
    const miss = [];
    const fail = [];
    const queue = [...missing];

    async function worker() {
        for (;;) {
            const iconId = queue.shift();

            if (!iconId) {
                return;
            }

            await sleep(REQUEST_GAP_MS);

            try {
                const found = await downloadIcon(iconId);

                if (!found) {
                    miss.push(iconId);
                    console.log(`MISS  ${iconId}（两站均无 Skill_/Feature_ 图标）`);
                    continue;
                }

                const outFile = path.join(iconsDir, `${iconId}.webp`);
                await sharp(found.buffer).webp({ quality: 88 }).toFile(outFile);
                ok.push(iconId);
                console.log(`OK    ${iconId} <- ${found.site}/${found.fileName}`);
            } catch (error) {
                fail.push(iconId);
                console.log(`FAIL  ${iconId}: ${error.message}`);
            }
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    await mirrorIconsToDist();

    console.log(
        `\n完成：成功 ${ok.length}，两站均缺失 ${miss.length}，失败 ${fail.length}。`,
    );

    if (miss.length) {
        console.log(`WIKI 暂无图：${miss.join("、")}`);
    }

    if (fail.length) {
        console.log(`失败（重跑本脚本即可续传）：${fail.join("、")}`);
        process.exitCode = 1;
    }
}

// 页面会用到 icon_id 的位置：精灵特性、技能池、技能石、官方技能表、道具表。
async function collectReferencedIconIds() {
    const ids = new Set();

    const add = (value) => {
        if (typeof value === "string" && value.length > 0) {
            ids.add(value);
        }
    };

    const detailFiles = (await readDirOrEmpty(petsDetailDir)).filter((name) =>
        name.endsWith(".json"),
    );

    for (const fileName of detailFiles) {
        const detail = await readJsonOrNull(path.join(petsDetailDir, fileName));

        if (!detail) {
            continue;
        }

        add(detail.trait?.icon_id);

        for (const move of detail.move_pool ?? []) {
            add(move?.icon_id);
        }

        for (const stone of detail.move_stones ?? []) {
            add(stone?.icon_id);
            add(stone?.move?.icon_id);
        }
    }

    const moveIcons = await readJsonOrNull(path.join(dataDir, "move-icons.json"));

    for (const iconId of Object.values(moveIcons ?? {})) {
        add(iconId);
    }

    const items = await readJsonOrNull(path.join(dataDir, "items.json"));

    for (const item of Array.isArray(items) ? items : (items?.entries ?? [])) {
        add(item?.icon_id);
    }

    return ids;
}

async function downloadIcon(iconId) {
    for (const endpoint of FILE_PATH_ENDPOINTS) {
        for (const pattern of NAME_PATTERNS) {
            const fileName = pattern.replace("%s", iconId);
            const buffer = await fetchImage(endpoint, fileName);

            if (buffer) {
                return { buffer, fileName, site: endpoint.site };
            }
        }
    }

    return null;
}

async function fetchImage(endpoint, fileName) {
    const url = `${endpoint.base}${encodeURIComponent(fileName)}`;
    const headers = {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: endpoint.referer,
    };

    for (let attempt = 0; attempt < RETRY; attempt += 1) {
        try {
            const response = await fetch(url, { headers });

            // 该文件不存在：换下一种命名，不必重试。
            if (response.status === 404) {
                return null;
            }

            // 限频时 BWIKI 以 200 返回验证页，必须校验 content-type，
            // 否则会把 HTML 当图片喂给 sharp。
            const contentType = response.headers.get("content-type") ?? "";

            if (response.ok && contentType.startsWith("image/")) {
                const buffer = Buffer.from(await response.arrayBuffer());

                if (buffer.length > 0) {
                    return buffer;
                }
            }
        } catch {
            // 网络抖动，重试。
        }

        await sleep(1200 * (attempt + 1));
    }

    return null;
}

// 若本机已构建过 dist，把新图标镜像过去，否则自建服务器托管的仍是旧副本。
async function mirrorIconsToDist() {
    const distIconsDir = path.join(rootDir, "dist", "assets", "webp", "items");

    try {
        await fs.access(path.join(rootDir, "dist", "index.html"));
    } catch {
        return;
    }

    await fs.mkdir(distIconsDir, { recursive: true });

    const files = await readDirOrEmpty(iconsDir);

    await Promise.all(
        files.map((name) =>
            fs.copyFile(path.join(iconsDir, name), path.join(distIconsDir, name)),
        ),
    );
}

async function readDirOrEmpty(dirPath) {
    try {
        return await fs.readdir(dirPath);
    } catch {
        return [];
    }
}

async function readJsonOrNull(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
        return null;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
