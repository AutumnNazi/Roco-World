// 扫描缺立绘的精灵：先试 BWIKI 的 JL_{name}.png，缺失时回退到
// nrc WIKI 的 PetPortrait_*.png（新精灵往往只有那边收录），
// 两个 WIKI 都没有时再用 rocokingdomworld.org 图鉴兜底。
// 用法：
//   node ./scripts/sync-pet-images.mjs                 // 补全部缺失
//   node ./scripts/sync-pet-images.mjs 3051            // 只补指定精灵 id
// 各站都会限频，脚本内置间隔；被拦截时立即终止，稍后重跑即可。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { mirrorFileToDist } from "./lib/mirror-to-dist.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const petsIndexPath = path.join(rootDir, "public", "data", "Pets.json");
const nrcPetsPath = path.join(rootDir, "public", "data", "nrc-pets.json");
const friendsDir = path.join(rootDir, "public", "assets", "webp", "friends");

// 立绘命名与 Pets.json 的 name 字段（portraitKey）一致；BWIKI 上为 JL_{name}.png。
// 扫描全部带有效 portraitKey 的条目（含未实装的圣火/圣水迪莫等形态），
// 否则新立绘会因 implemented=false 永远漏补。
const WIKI_API_URL = "https://wiki.biligame.com/rocom/api.php";
const NRC_FILE_PATH = "https://wiki.biligame.com/nrc/Special:FilePath/";
const REQUEST_INTERVAL_MS = 2500;

// 末端兜底源：rocokingdomworld.org 图鉴把每只精灵的立绘自托管在 /img/<hash>.webp，
// 且卡片带 data-title（中文名）。少数精灵（如多灵 / 多灵主）两个 WIKI 都没收录，
// 这里按中文名精确匹配取图。整页只抓一次，按名称索引后复用。
const EXTERNAL_DEX_URL = "https://rocokingdomworld.org/zh/pokedex";
const EXTERNAL_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
};

const HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 rocom-pet-images-sync",
    Referer: "https://wiki.biligame.com/rocom/",
};

async function main() {
    const onlyPetId = Number(process.argv[2] ?? "");
    const pets = await readImplementedPets(onlyPetId);
    const nrcIllustrationById = await readNrcIllustrations();
    const existing = new Set(await fs.readdir(friendsDir));

    const missing = pets.filter(
        (pet) => !existing.has(`JL_${pet.name}.webp`) && !existing.has(`JL_${pet.name}.png`),
    );

    if (!missing.length) {
        console.log("所有已实装精灵的立绘均已就绪，无需补图。");
        return;
    }

    console.log(`发现 ${missing.length} 只精灵缺立绘，开始补图…`);

    const ok = [];
    const miss = [];
    const fail = [];
    // 兜底图鉴整页 1.8MB，只有真的两个 WIKI 都缺图时才抓，抓一次后复用。
    let externalPortraits = null;

    for (const [index, pet] of missing.entries()) {
        if (index > 0) {
            await sleep(REQUEST_INTERVAL_MS);
        }

        try {
            const found = await downloadPortrait(pet, nrcIllustrationById, () => {
                externalPortraits ??= loadExternalPortraits();
                return externalPortraits;
            });

            if (!found) {
                miss.push(pet);
                console.log(`MISS  ${pet.id} ${pet.displayName}（各源均无立绘）`);
                continue;
            }

            const outFile = path.join(friendsDir, `JL_${pet.name}.webp`);
            await sharp(found.buffer).webp({ quality: 85 }).toFile(outFile);
            await mirrorFileToDist(
                rootDir,
                path.join("assets", "webp", "friends", `JL_${pet.name}.webp`),
            );
            const stat = await fs.stat(outFile);
            ok.push(pet);
            console.log(
                `OK    ${pet.id} ${pet.displayName} <- [${found.origin}] ${decodeURIComponent(found.url.split("/").pop() ?? "")} (${(stat.size / 1024).toFixed(0)}KB)`,
            );
        } catch (error) {
            fail.push(pet);
            console.log(`FAIL  ${pet.id} ${pet.displayName}: ${error.message}`);
        }
    }

    console.log(
        `\n完成：成功 ${ok.length}，各源均缺失 ${miss.length}，失败 ${fail.length}。`,
    );

    if (miss.length) {
        console.log(`暂无立绘：${miss.map((pet) => `${pet.displayName}(${pet.id})`).join("、")}`);
    }

    if (fail.length) {
        console.log(`失败（可重跑本脚本重试）：${fail.map((pet) => `${pet.displayName}(${pet.id})`).join("、")}`);
        process.exitCode = 1;
    }
}

// 按顺序试各来源，**任一步失败都继续往下试**：
// 某个源收录了条目但图已失效（404）时，只判空不再降级就永远补不上图。
// 返回 null 表示各源都没有；返回 {buffer,url,origin} 表示拿到可用图片。
async function downloadPortrait(pet, nrcIllustrationById, getExternalMap) {
    const sources = [
        {
            origin: "nrc",
            getUrl: () => {
                const illustration = nrcIllustrationById.get(pet.displayName);
                return illustration
                    ? `${NRC_FILE_PATH}${encodeURIComponent(illustration)}`
                    : null;
            },
        },
        { origin: "BWIKI", getUrl: () => findImageUrl(pet.name) },
        {
            origin: "图鉴兜底",
            getUrl: async () => (await getExternalMap()).get(pet.displayName) ?? null,
        },
    ];

    const reasons = [];

    for (const source of sources) {
        let url = null;

        try {
            url = await source.getUrl();
        } catch (error) {
            reasons.push(`${source.origin} 查询失败(${error.message})`);
            continue;
        }

        if (!url) {
            reasons.push(`${source.origin} 无收录`);
            continue;
        }

        try {
            const response = await fetch(url, {
                headers: url.includes("rocokingdomworld.org") ? EXTERNAL_HEADERS : HEADERS,
                signal: AbortSignal.timeout(30000),
            });

            if (!response.ok) {
                reasons.push(`${source.origin} HTTP ${response.status}`);
                continue;
            }

            const buffer = Buffer.from(await response.arrayBuffer());

            // 限频/防盗链会以 200 返回 HTML，交给 sharp 只会得到一堆解码错误。
            if (!isImageBuffer(buffer)) {
                reasons.push(`${source.origin} 返回内容不是图片`);
                continue;
            }

            return { buffer, url, origin: source.origin };
        } catch (error) {
            reasons.push(`${source.origin} 下载失败(${error.message})`);
        }
    }

    if (reasons.every((reason) => reason.endsWith("无收录"))) {
        return null;
    }

    throw new Error(reasons.join("；"));
}

// 兜底图鉴页把立绘自托管为 /img/<hash>.webp，卡片形如：
//   <div class="spirit-cell" data-title="多灵" ...><a href="/zh/pokedex/duoling">…<img src="/img/xxx.webp" alt="多灵 (Duoling)">
// 只收「中文名唯一」的条目：重名（不同形态共用译名）时宁可缺图，也不能配错立绘。
async function loadExternalPortraits() {
    const map = new Map();

    try {
        const response = await fetch(EXTERNAL_DEX_URL, {
            headers: EXTERNAL_HEADERS,
            signal: AbortSignal.timeout(60000),
        });

        if (!response.ok) {
            console.warn(`兜底图鉴不可用 HTTP ${response.status}，跳过。`);
            return map;
        }

        const html = await response.text();
        const seen = new Map();

        for (const chunk of html.split('<div class="spirit-cell"').slice(1)) {
            const title = chunk.match(/data-title="([^"]*)"/)?.[1];
            const img = chunk.match(/<img[^>]*src="(\/img\/[^"]+\.webp)"/)?.[1];

            if (!title || !img) {
                continue;
            }

            // 出现第二次即标记为多义，后续不再采信。
            seen.set(title, seen.has(title) ? null : img);
        }

        for (const [title, img] of seen) {
            if (img) {
                map.set(title, `https://rocokingdomworld.org${img}`);
            }
        }

        console.log(`兜底图鉴可用：按中文名索引到 ${map.size} 只精灵立绘。`);
    } catch (error) {
        console.warn(`兜底图鉴抓取失败（${error.message}），本轮跳过。`);
    }

    return map;
}

// 限频/防盗链常用「200 + HTML」冒充成功，必须校验二进制头再交给 sharp。
function isImageBuffer(buffer) {
    if (buffer.length < 16) {
        return false;
    }

    const riff = buffer.slice(0, 4).toString("ascii");
    const webp = buffer.slice(8, 12).toString("ascii");
    const isWebp = riff === "RIFF" && webp === "WEBP";
    const isPng = buffer.slice(1, 4).toString("ascii") === "PNG";
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;

    return isWebp || isPng || isJpeg;
}

async function readNrcIllustrations() {
    const map = new Map();

    try {
        const payload = JSON.parse(await fs.readFile(nrcPetsPath, "utf8"));

        for (const entry of Object.values(payload?.entries ?? {})) {
            if (entry?.name && entry?.illustration) {
                map.set(entry.name, entry.illustration);
            }
        }
    } catch {
        // 没有 nrc 数据时只走 BWIKI。
    }

    return map;
}

async function readImplementedPets(onlyPetId) {
    const payload = JSON.parse(await fs.readFile(petsIndexPath, "utf8"));
    const targeted = Number.isFinite(onlyPetId) && onlyPetId > 0;
    const pets = (Array.isArray(payload) ? payload : [])
        .filter(
            (pet) =>
                typeof pet?.id === "number" &&
                typeof pet?.name === "string" &&
                pet.name.length > 0 &&
                !/^\d+$/.test(pet.name) &&
                // 默认扫已实装 + 图鉴号段（3000-3999）的未实装精灵：
                // 新精灵常先有数据后有图，不扫就会长期缺图；
                // NPC/战斗镜像（4xxx 以上、百万段）不在号段内，天然排除。
                (targeted ||
                    pet?.implemented === true ||
                    (pet.id >= 3000 && pet.id < 4000)),
        )
        .map((pet) => ({
            id: pet.id,
            name: pet.name,
            displayName: pet?.localized?.zh?.name ?? pet.name,
        }));

    if (Number.isFinite(onlyPetId) && onlyPetId > 0) {
        return pets.filter((pet) => pet.id === onlyPetId);
    }

    return pets;
}

async function findImageUrl(name) {
    const params = new URLSearchParams({
        action: "query",
        list: "allimages",
        aiprefix: `JL_${name}`,
        ailimit: "5",
        format: "json",
        formatversion: "2",
    });

    const response = await fetch(`${WIKI_API_URL}?${params}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
        throw new Error(`BWIKI API HTTP ${response.status}`);
    }

    const text = await response.text();

    if (!text.trimStart().startsWith("{")) {
        throw new Error("BWIKI 触发限频验证，请稍后重跑本脚本");
    }

    const payload = JSON.parse(text);
    const images = payload?.query?.allimages ?? [];
    const hit = images.find((image) => image.name === `JL_${name}.png`) ?? images[0];
    return hit?.url ?? null;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
