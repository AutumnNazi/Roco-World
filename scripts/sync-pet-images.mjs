// 扫描已实装但缺立绘的精灵，从 BWIKI 图床拉取 JL_{name}.png 并转 WebP。
// 用法：
//   node ./scripts/sync-pet-images.mjs                 // 补全部缺失
//   node ./scripts/sync-pet-images.mjs 3051            // 只补指定精灵 id
// BWIKI 对连续请求限频，脚本内置 2.5s 间隔；被拦截（HTML 响应）时立即终止，稍后重跑即可。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const petsIndexPath = path.join(rootDir, "public", "data", "Pets.json");
const friendsDir = path.join(rootDir, "public", "assets", "webp", "friends");

// 立绘命名与 Pets.json 的 name 字段（portraitKey）一致；BWIKI 上为 JL_{name}.png。
// 扫描全部带有效 portraitKey 的条目（含未实装的圣火/圣水迪莫等形态），
// 否则新立绘会因 implemented=false 永远漏补。
const WIKI_API_URL = "https://wiki.biligame.com/rocom/api.php";
const REQUEST_INTERVAL_MS = 2500;

const HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 rocom-pet-images-sync",
    Referer: "https://wiki.biligame.com/rocom/",
};

async function main() {
    const onlyPetId = Number(process.argv[2] ?? "");
    const pets = await readImplementedPets(onlyPetId);
    const existing = new Set(await fs.readdir(friendsDir));

    const missing = pets.filter(
        (pet) => !existing.has(`JL_${pet.name}.webp`) && !existing.has(`JL_${pet.name}.png`),
    );

    if (!missing.length) {
        console.log("所有已实装精灵的立绘均已就绪，无需补图。");
        return;
    }

    console.log(`发现 ${missing.length} 只精灵缺立绘，开始从 BWIKI 补图…`);

    const ok = [];
    const miss = [];
    const fail = [];

    for (const [index, pet] of missing.entries()) {
        if (index > 0) {
            await sleep(REQUEST_INTERVAL_MS);
        }

        try {
            const url = await findImageUrl(pet.name);

            if (!url) {
                miss.push(pet);
                console.log(`MISS  ${pet.id} ${pet.displayName}（BWIKI 无 JL_${pet.name}.png）`);
                continue;
            }

            await sleep(REQUEST_INTERVAL_MS);
            const response = await fetch(url, { headers: HEADERS });

            if (!response.ok) {
                throw new Error(`下载失败 HTTP ${response.status}`);
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            const outFile = path.join(friendsDir, `JL_${pet.name}.webp`);
            await sharp(buffer).webp({ quality: 85 }).toFile(outFile);
            const stat = await fs.stat(outFile);
            ok.push(pet);
            console.log(
                `OK    ${pet.id} ${pet.displayName} <- ${url.split("/").pop()} (${(stat.size / 1024).toFixed(0)}KB)`,
            );
        } catch (error) {
            fail.push(pet);
            console.log(`FAIL  ${pet.id} ${pet.displayName}: ${error.message}`);
        }
    }

    console.log(
        `\n完成：成功 ${ok.length}，BWIKI 缺失 ${miss.length}，失败 ${fail.length}。`,
    );

    if (miss.length) {
        console.log(`BWIKI 暂无图：${miss.map((pet) => `${pet.displayName}(${pet.id})`).join("、")}`);
    }

    if (fail.length) {
        console.log(`失败（可重跑本脚本重试）：${fail.map((pet) => `${pet.displayName}(${pet.id})`).join("、")}`);
        process.exitCode = 1;
    }
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
                // 默认只扫已实装（有界，CI 可承受）；显式传精灵 id 时放开，
                // 便于补圣火/圣水迪莫这类 implemented=false 的新形态立绘。
                (targeted || pet?.implemented === true),
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
