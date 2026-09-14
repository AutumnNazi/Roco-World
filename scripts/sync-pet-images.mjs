// 扫描缺立绘的精灵：先试 BWIKI 的 JL_{name}.png，缺失时回退到
// nrc WIKI 的 PetPortrait_*.png（新精灵往往只有那边收录）。
// 用法：
//   node ./scripts/sync-pet-images.mjs                 // 补全部缺失
//   node ./scripts/sync-pet-images.mjs 3051            // 只补指定精灵 id
// 两个 WIKI 都会限频，脚本内置间隔；被拦截时立即终止，稍后重跑即可。
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

    for (const [index, pet] of missing.entries()) {
        if (index > 0) {
            await sleep(REQUEST_INTERVAL_MS);
        }

        try {
            const url = await resolvePortraitUrl(pet, nrcIllustrationById);

            if (!url) {
                miss.push(pet);
                console.log(`MISS  ${pet.id} ${pet.displayName}（两个 WIKI 均无立绘）`);
                continue;
            }

            const response = await fetch(url, { headers: HEADERS });

            if (!response.ok) {
                throw new Error(`下载失败 HTTP ${response.status}`);
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            const outFile = path.join(friendsDir, `JL_${pet.name}.webp`);
            await sharp(buffer).webp({ quality: 85 }).toFile(outFile);
            await mirrorFileToDist(
                rootDir,
                path.join("assets", "webp", "friends", `JL_${pet.name}.webp`),
            );
            const stat = await fs.stat(outFile);
            ok.push(pet);
            console.log(
                `OK    ${pet.id} ${pet.displayName} <- ${decodeURIComponent(url.split("/").pop() ?? "")} (${(stat.size / 1024).toFixed(0)}KB)`,
            );
        } catch (error) {
            fail.push(pet);
            console.log(`FAIL  ${pet.id} ${pet.displayName}: ${error.message}`);
        }
    }

    console.log(
        `\n完成：成功 ${ok.length}，两站均缺失 ${miss.length}，失败 ${fail.length}。`,
    );

    if (miss.length) {
        console.log(`暂无立绘：${miss.map((pet) => `${pet.displayName}(${pet.id})`).join("、")}`);
    }

    if (fail.length) {
        console.log(`失败（可重跑本脚本重试）：${fail.map((pet) => `${pet.displayName}(${pet.id})`).join("、")}`);
        process.exitCode = 1;
    }
}

// 优先用 nrc 的官方立绘（直接拼 URL，不走 API、不消耗配额），
// 没有收录时再回退 BWIKI 的 JL_{name}.png 查询。
async function resolvePortraitUrl(pet, nrcIllustrationById) {
    const illustration = nrcIllustrationById.get(pet.displayName);

    if (illustration) {
        return `${NRC_FILE_PATH}${encodeURIComponent(illustration)}`;
    }

    return findImageUrl(pet.name);
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

    const response = await fetch(`${WIKI_API_URL}?${params}`, { headers: HEADERS });

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
