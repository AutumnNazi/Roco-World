import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const merchantOutputPath = path.join(rootDir, "public", "data", "merchant.json");

// 远行商人每日轮换数据来自好游快爆「每日远行商人查询器」工具页：
// 服务端渲染 HTML，每个商品的 class 带 show_1~show_4 标记所属轮次，
// data-time 为该轮结束时刻（unix 秒），商品图片由快爆使用 BWIKI 图床。
const MERCHANT_PAGE_URL =
    "https://www.onebiji.com/hykb_tools/comm/lkwgmerchant/preview.php?id=1&immgj=0";
const ROUND_DURATION_SECONDS = 4 * 60 * 60;
const ROUND_COUNT = 4;
// 参考社区工具的稀有货物口径：国王球 / 棱镜球 / 炫彩精灵蛋。
const RARE_ITEM_NAMES = new Set(["国王球", "棱镜球", "炫彩精灵蛋"]);

async function main() {
    const html = await fetchMerchantPage();
    const items = parseMerchantItems(html);

    if (!items.length) {
        throw new Error("未从好游快爆页面解析到远行商人商品，页面结构可能已变更。");
    }

    const rounds = buildRounds(items);
    const payload = {
        schema_version: 1,
        generated_at: buildBeijingTimestamp(),
        source: {
            site: "好游快爆 每日远行商人查询器",
            page: MERCHANT_PAGE_URL,
            image_source: "哔哩哔哩洛克王国 BWIKI 图床",
        },
        date: resolveMerchantDate(rounds),
        rounds,
    };

    await writeJson(merchantOutputPath, payload);

    const goodsTotal = rounds.reduce((sum, round) => sum + round.items.length, 0);
    console.log(
        `Generated merchant data for ${payload.date} with ${rounds.length} rounds / ${goodsTotal} goods entries.`,
    );
}

async function fetchMerchantPage() {
    const response = await fetch(MERCHANT_PAGE_URL, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 rocom-aoe-top-merchant-sync",
            Referer: "https://www.onebiji.com/",
        },
    });

    if (!response.ok) {
        throw new Error(`好游快爆工具页请求失败: ${response.status}`);
    }

    return response.text();
}

// 页面按商品条目渲染 <li>，同一商品可属于多轮（class 含多个 show_N）。
function parseMerchantItems(html) {
    const liPattern =
        /<li class="([^"]*)"[^>]*?data-time="(\d+)"[^>]*?onclick="showShopinfo\('([^']*)','([^']*)','([^']*)','((?:[^'\\]|\\.)*)'\)"/g;
    const seen = new Set();
    const items = [];

    let match;

    while ((match = liPattern.exec(html)) !== null) {
        const [, className, endTimeSeconds, image, name, category, description] = match;
        const key = `${name}|${endTimeSeconds}`;

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);

        const roundIndexes = [];
        for (let index = 1; index <= ROUND_COUNT; index++) {
            if (className.split(/\s+/).includes(`show_${index}`)) {
                roundIndexes.push(index);
            }
        }

        const liBlock = findLiBlock(html, match.index);
        const price = parsePrice(liBlock);
        const limit = parseLimit(liBlock);

        items.push({
            name: decodeHtmlText(name),
            category: decodeHtmlText(category),
            description: decodeHtmlText(description),
            image: image || null,
            price,
            limit,
            rare: RARE_ITEM_NAMES.has(name),
            round_indexes: roundIndexes,
            round_end_ts: Number(endTimeSeconds),
        });
    }

    return items;
}

function findLiBlock(html, startIndex) {
    const nextIndex = html.indexOf("<li ", startIndex + 4);
    return html.slice(
        startIndex,
        nextIndex === -1 ? Math.min(startIndex + 4000, html.length) : nextIndex,
    );
}

function parsePrice(liBlock) {
    const match = liBlock.match(/<em class="shop_price">价格：([\d,，.]+)\s*</);

    if (!match) {
        return null;
    }

    const value = Number(match[1].replace(/[,,]/g, ""));
    return Number.isFinite(value) ? value : null;
}

function parseLimit(liBlock) {
    const match = liBlock.match(/<em>限购(\d+)<\/em>/);

    if (!match) {
        return null;
    }

    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
}

function buildRounds(items) {
    // 页面会把过往时段的商品一并渲染（s-tit2 折叠区）。
    // data-time 是商品最后一轮的结束时刻，取最大值锚定「数据日」，
    // 再按每日 8/12/16/20 点开市、每轮 4 小时的固定规则推算各轮窗口。
    const anchorEndTs = Math.max(...items.map((item) => item.round_end_ts));
    const dateBaseTs = anchorEndTs - 24 * 60 * 60;
    const dayItems = items.filter(
        (item) => item.round_end_ts > dateBaseTs && item.round_end_ts <= anchorEndTs,
    );

    if (!dayItems.length) {
        throw new Error("锚定数据日后没有剩余商品，请人工核对页面数据。");
    }

    const rounds = [];

    for (let index = 1; index <= ROUND_COUNT; index++) {
        const endTs = dateBaseTs + (8 + index * 4) * 60 * 60;
        const roundItems = dayItems
            .filter((item) => item.round_indexes.includes(index))
            .map(({ round_indexes: _roundIndexes, round_end_ts: _roundEndTs, ...item }) => item);

        rounds.push({
            index,
            start_ts: endTs - ROUND_DURATION_SECONDS,
            end_ts: endTs,
            start_time: formatBeijingTime(endTs - ROUND_DURATION_SECONDS),
            end_time: formatBeijingTime(endTs),
            items: roundItems,
        });
    }

    return rounds;
}

function resolveMerchantDate(rounds) {
    const firstRound = rounds[0];

    if (!firstRound) {
        return null;
    }

    return formatBeijingDate(firstRound.start_ts);
}

function decodeHtmlText(value) {
    return value
        .replace(/\\'/g, "'")
        .replace(/\\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function formatBeijingTime(unixSeconds) {
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
        .format(new Date(unixSeconds * 1000))
        .replace("T", " ");
}

function formatBeijingDate(unixSeconds) {
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(unixSeconds * 1000));
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

async function writeJson(filePath, value) {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 4)}\n`, "utf8");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
