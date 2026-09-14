// 下载时装 / 奖牌 / 徽章 / 系列的图片到本地自托管。
// 为什么不直接用 wiki 直链：Special:FilePath 会 302 跳到 patchwiki 图床，
// 浏览器端受防盗链与 CSP 影响会时好时坏；本地部署把图存下来反而更快更稳。
// 已存在的文件默认跳过，可反复执行补齐。
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const publicDir = path.join(rootDir, "public");
const assetsDir = path.join(publicDir, "assets", "webp");
const fashionsPath = path.join(publicDir, "data", "fashions.json");
const medalsPath = path.join(publicDir, "data", "medals.json");

const NRC_FILE_PATH = "https://wiki.biligame.com/nrc/Special:FilePath/";
// BWIKI 图床对高并发会返回验证页，并发压到 2 并留出间隔才能稳定跑完。
const CONCURRENCY = 2;
const RETRY = 5;
const REQUEST_GAP_MS = 250;

const HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    Referer: "https://wiki.biligame.com/nrc/",
};

async function main() {
    const fashions = JSON.parse(await fs.readFile(fashionsPath, "utf8"));
    const medals = JSON.parse(await fs.readFile(medalsPath, "utf8"));

    // 收集任务：源文件名 -> 本地输出路径（webp）
    const tasks = new Map();

    for (const suit of Object.values(fashions.entries ?? {})) {
        for (const variant of suit.variants ?? []) {
            if (variant.image) {
                const name = toLocalName(variant.image);
                tasks.set(variant.image, {
                    out: path.join(assetsDir, "fashions", name),
                    rel: `/assets/webp/fashions/${name}`,
                });
            }
        }

        for (const bond of suit.bonds ?? []) {
            if (bond.icon) {
                const name = toLocalName(bond.icon);
                tasks.set(bond.icon, {
                    out: path.join(assetsDir, "bonds", name),
                    rel: `/assets/webp/bonds/${name}`,
                });
            }
        }
    }

    for (const medal of Object.values(medals.entries ?? {})) {
        if (medal.image) {
            const name = toLocalName(medal.image);
            tasks.set(medal.image, {
                out: path.join(assetsDir, "medals", name),
                rel: `/assets/webp/medals/${name}`,
            });
        }
    }

    for (const series of fashions.series ?? []) {
        if (series.art) {
            const name = toLocalName(series.art);
            tasks.set(series.art, {
                out: path.join(assetsDir, "series", name),
                rel: `/assets/webp/series/${name}`,
            });
        }
        if (series.icon) {
            const name = toLocalName(series.icon);
            tasks.set(series.icon, {
                out: path.join(assetsDir, "series", name),
                rel: `/assets/webp/series/${name}`,
            });
        }
    }

    const all = [...tasks.entries()];
    console.log(`待处理图片 ${all.length} 张（已存在的会跳过）…`);

    let downloaded = 0;
    let skipped = 0;
    const failed = [];
    // 源站返回 404 的文件：确实不存在，页面应按「无图」处理而不是回退远程死链。
    const notFound = new Set();

    const queue = [...all];

    async function worker() {
        for (;;) {
            const item = queue.shift();

            if (!item) {
                return;
            }

            const [source, target] = item;

            await sleep(REQUEST_GAP_MS);

            try {
                if (await exists(target.out)) {
                    skipped += 1;
                    continue;
                }

                const result = await download(source);

                if (result === "not-found") {
                    notFound.add(source);
                    continue;
                }

                if (!result) {
                    failed.push(source);
                    continue;
                }

                const buffer = result;

                await fs.mkdir(path.dirname(target.out), { recursive: true });
                await sharp(buffer).webp({ quality: 88 }).toFile(target.out);
                downloaded += 1;
                console.log(`OK   ${source} -> ${path.basename(target.out)}`);
            } catch (error) {
                failed.push(source);
                console.log(`FAIL ${source}: ${error.message}`);
            }
        }
    }

    await Promise.all(
        Array.from({ length: CONCURRENCY }, () => worker()),
    );

    // 把本地路径写回数据文件（保持同步脚本可重复运行）。
    applyLocalPaths(fashions, medals, tasks, notFound);

    await fs.writeFile(fashionsPath, `${JSON.stringify(fashions)}\n`, "utf8");
    await fs.writeFile(medalsPath, `${JSON.stringify(medals)}\n`, "utf8");
    await mirrorDir("data/fashions.json");
    await mirrorDir("data/medals.json");
    await mirrorAssets();

    console.log(
        `\n完成：下载 ${downloaded}，跳过 ${skipped}，失败 ${failed.length}。`,
    );

    if (failed.length) {
        console.log(`失败清单（重跑本脚本即可续传）：${failed.join(", ")}`);
        process.exitCode = 1;
    }
}

function toLocalName(fileName) {
    return fileName.replace(/\.png$/i, ".webp").replace(/[^\w.-]/gu, "_");
}

async function exists(p) {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function download(fileName) {
    const url = `${NRC_FILE_PATH}${encodeURIComponent(fileName)}`;

    for (let attempt = 0; attempt < RETRY; attempt += 1) {
        try {
            const response = await fetch(url, { headers: HEADERS });

            if (response.status === 404) {
                return "not-found";
            }

            // 限频时 BWIKI 会以 200 返回验证页/错误页，必须校验 content-type，
            // 否则会把 HTML 当成图片喂给 sharp 而整批失败。
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

        await sleep(1500 * (attempt + 1));
    }

    return null;
}

function applyLocalPaths(fashions, medals, tasks, notFound) {
    // 只在该图确实下载成功时才改写成本地路径；源站缺图（404）时回退远程地址，
    // 避免写出指向不存在文件的死链（页面会一直转圈或显示空白）。
    const relOf = (fileName) => {
        const task = tasks.get(fileName);

        if (!task || !fileExists(task.out)) {
            return null;
        }

        return task.rel;
    };

    const remoteOf = (fileName) => {
        if (!fileName || notFound.has(fileName)) {
            return null;
        }

        return `${NRC_FILE_PATH}${encodeURIComponent(fileName)}`;
    };

    for (const suit of Object.values(fashions.entries ?? {})) {
        for (const variant of suit.variants ?? []) {
            variant.image_url = variant.image
                ? (relOf(variant.image) ?? remoteOf(variant.image))
                : null;
        }

        for (const bond of suit.bonds ?? []) {
            bond.image_url = bond.icon
                ? (relOf(bond.icon) ?? remoteOf(bond.icon))
                : null;
        }
    }

    for (const medal of Object.values(medals.entries ?? {})) {
        medal.image_url = medal.image
            ? (relOf(medal.image) ?? remoteOf(medal.image))
            : null;
    }

    for (const series of fashions.series ?? []) {
        series.art_url = series.art
            ? (relOf(series.art) ?? remoteOf(series.art))
            : null;
        series.icon_url = series.icon
            ? (relOf(series.icon) ?? remoteOf(series.icon))
            : null;
    }
}

function fileExists(filePath) {
    try {
        return fsSync.existsSync(filePath);
    } catch {
        return false;
    }
}

async function mirrorDir(relativePath) {
    const distRoot = path.join(rootDir, "dist");

    try {
        await fs.access(path.join(distRoot, "index.html"));
    } catch {
        return;
    }

    const target = path.join(distRoot, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(publicDir, relativePath), target);
}

// 图片目录整体镜像到 dist（若已构建），否则自建服务器托管的仍是旧副本。
async function mirrorAssets() {
    const distRoot = path.join(rootDir, "dist");

    try {
        await fs.access(path.join(distRoot, "index.html"));
    } catch {
        return;
    }

    for (const sub of ["fashions", "medals", "bonds", "series"]) {
        const from = path.join(assetsDir, sub);
        const to = path.join(distRoot, "assets", "webp", sub);

        try {
            await fs.mkdir(to, { recursive: true });
            const files = await fs.readdir(from);
            await Promise.all(
                files.map((name) => fs.copyFile(path.join(from, name), path.join(to, name))),
            );
        } catch {
            // 该分类没有图片时跳过。
        }
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
