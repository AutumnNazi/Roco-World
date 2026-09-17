import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mirrorFileToDist } from "./lib/mirror-to-dist.mjs";
import { withFileLock, writeFileAtomic } from "./lib/file-lock.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const merchantOutputPath = path.join(rootDir, "public", "data", "merchant.json");
// 历史归档：merchant.json 只保留当天快照，历史轮次在此累积，不被次日覆盖。
const merchantHistoryPath = path.join(
    rootDir,
    "public",
    "data",
    "merchant-history.json",
);

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
    // 部署包可能只带了 dist/，public/data 不存在时写盘会 ENOENT 直接失败。
    await fs.mkdir(path.dirname(merchantOutputPath), { recursive: true });

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

    const changed = await writeJsonIfChanged(merchantOutputPath, payload, [
        "generated_at",
    ]);
    await mirrorFileToDist(rootDir, path.join("data", "merchant.json"));

    const historyChanged = await recordHistory(payload);
    await mirrorFileToDist(rootDir, path.join("data", "merchant-history.json"));

    const goodsTotal = rounds.reduce((sum, round) => sum + round.items.length, 0);

    if (!changed && !historyChanged) {
        console.log(
            `Merchant data for ${payload.date} unchanged, skip write (${goodsTotal} goods).`,
        );
        return;
    }

    console.log(
        `Generated merchant data for ${payload.date} with ${rounds.length} rounds / ${goodsTotal} goods entries.`,
    );
}

// 把当天各轮商品并入历史归档：只记录已上架的轮次，
// 同一轮商品发生变化（源站补货/改价）时覆盖该轮，其余日期原样保留。
// 读-改-写整段必须在锁内：历史档案是「读出全量、内存里改、整体覆盖」的形式，
// 两个写入者交错时后写的那个会拿着陈旧快照覆盖掉先写的轮次（实测 8 并发只剩 1 轮）。
// 现实中能撞上的组合是 README 方案 A 的常驻服务与方案 B 的 cron 同时部署，
// 或有人在服务跑着时手动执行一次 npm run sync:merchant-data。
async function recordHistory(payload) {
    if (!payload.date) {
        return false;
    }

    return withFileLock(merchantHistoryPath, () => recordHistoryLocked(payload));
}

async function recordHistoryLocked(payload) {
    const history = await loadMergedHistory();
    const dayEntry = history.days[payload.date] ?? { date: payload.date, rounds: {} };
    const recordedAt = buildBeijingTimestamp();
    // 合并 dist 侧独有轮次本身就是一次改动，必须落盘，否则本轮无其他变化时
    // 会走 return false 而把刚捞回来的历史又丢掉。
    let changed = history.recovered;

    for (const round of payload.rounds) {
        if (!round.items.length) {
            continue;
        }

        const key = String(round.index);
        const next = {
            index: round.index,
            start_time: round.start_time,
            end_time: round.end_time,
            recorded_at: recordedAt,
            items: round.items,
        };

        if (!isSameRecordedRound(dayEntry.rounds[key], next)) {
            dayEntry.rounds[key] = next;
            changed = true;
        }
    }

    if (!changed) {
        return false;
    }

    history.updated_at = recordedAt;
    history.days[payload.date] = dayEntry;
    // recovered 只是本次合并的过程标记，不写进归档文件。
    const { recovered: _recovered, ...persisted } = history;
    // 已持锁，rename 不会与别的写入者争用；原子写让读取方（站点 fetch、
    // mirrorFileToDist 的 copyFile）不会读到写一半的 JSON。
    await writeFileAtomic(
        merchantHistoryPath,
        `${JSON.stringify(persisted, null, 4)}\n`,
    );
    console.log(
        `Recorded merchant history for ${payload.date} (rounds: ${Object.keys(dayEntry.rounds).sort().join(", ")}).`,
    );
    return true;
}

// 历史归档同时存在两份：public/data（git 跟踪）与 dist/data（gitignore）。
// 高频同步下 dist 那份常比 public 更新，而 public 一旦被 git restore/checkout
// 回滚到某次提交，就会把提交之后抓到的轮次整轮抹掉——本文件的 2026-09-15 第 4 轮
// 就是这么丢的（只剩 dist 里有）。这里按轮次取 recorded_at 较新的一份合并，
// 让任一侧被回滚都能从另一侧补回来。
async function loadMergedHistory() {
    const base = { schema_version: 1, updated_at: null, days: {}, recovered: false };
    const publicHistory = await readHistoryOrNull(merchantHistoryPath);
    const distHistory = await readHistoryOrNull(
        path.join(rootDir, "dist", "data", "merchant-history.json"),
    );

    if (publicHistory) {
        base.updated_at = publicHistory.updated_at ?? null;
        base.days = publicHistory.days;
    }

    if (!distHistory) {
        return base;
    }

    for (const [date, distDay] of Object.entries(distHistory.days)) {
        const day = base.days[date] ?? { date, rounds: {} };

        for (const [roundKey, distRound] of Object.entries(distDay?.rounds ?? {})) {
            const current = day.rounds[roundKey];

            if (!current || isNewerRecord(distRound, current)) {
                day.rounds[roundKey] = distRound;
                base.recovered = true;
            }
        }

        base.days[date] = day;
    }

    if (base.recovered) {
        console.log("已从 dist 侧历史补回被回滚的轮次。");
    }

    return base;
}

async function readHistoryOrNull(filePath) {
    try {
        const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));

        if (parsed && typeof parsed === "object" && parsed.days) {
            return parsed;
        }
    } catch {
        // 缺失或损坏都按「没有这份」处理。
    }

    return null;
}

function isNewerRecord(candidate, current) {
    return String(candidate?.recorded_at ?? "") > String(current?.recorded_at ?? "");
}

function isSameRecordedRound(current, next) {
    if (!current) {
        return false;
    }

    return (
        current.start_time === next.start_time &&
        current.end_time === next.end_time &&
        JSON.stringify(current.items) === JSON.stringify(next.items)
    );
}

async function fetchMerchantPage() {
    let response;

    try {
        response = await fetch(MERCHANT_PAGE_URL, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 rocom-aoe-top-merchant-sync",
                Referer: "https://www.onebiji.com/",
            },
            signal: AbortSignal.timeout(20000),
        });
    } catch (error) {
        // 出网失败（DNS/超时/被拦）时带上原始错误码，否则只看到一句
        // 「同步失败」，分不清是服务器不通还是源站结构变了。
        throw new Error(
            `好游快爆工具页请求失败: ${error.message}，请确认部署环境能否出网访问 www.onebiji.com`,
        );
    }

    if (!response.ok) {
        throw new Error(`好游快爆工具页请求失败: HTTP ${response.status}`);
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

        const decodedName = decodeHtmlText(name);

        items.push({
            name: decodedName,
            category: decodeHtmlText(category),
            description: decodeHtmlText(description),
            image: image || null,
            price,
            limit,
            // 用解码后的名字比对：raw 里带首尾空白或零宽字符时，
            // 稀有标记会静默失配，页面上国王球一类就不再高亮。
            rare: RARE_ITEM_NAMES.has(decodedName),
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
    const match = liBlock.match(
        /<em class="shop_price">价格：([\d,，.]+)\s*([wW万]?)/,
    );

    if (!match) {
        return null;
    }

    // 源站价格带千分位，半角/全角逗号都出现过（如 36,000 / 36，000），
    // 只去掉其中一种会让 Number() 得到 NaN，价格就白白显示成「未知」。
    const value = Number(match[1].replace(/[,，]/g, ""));

    if (!Number.isFinite(value)) {
        return null;
    }

    // 贵价商品（血脉秘药一类）源站直接写成「16w」「16万」，
    // 不把万单位展开成整数，价格会当成解析失败显示「未知」，排序也会错位。
    return match[2] ? Math.round(value * 10000) : value;
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
    // 页面会把过往时段的商品一并渲染（s-tit2 折叠区），且商品是渐进上架的：
    // 早上抓取时可能只有第 1 轮。data-time 是商品最后一轮的结束时刻（北京时间
    // 12:00/16:00/20:00/24:00），回退 1 秒再向下取整到北京日零点即数据日，
    // 然后按每日 8/12/16/20 点开市、每轮 4 小时的固定规则推算四轮窗口。
    const anchorEndTs = Math.max(...items.map((item) => item.round_end_ts));
    const dateBaseTs = floorToBeijingDayStart(anchorEndTs - 1);
    const dayItems = items.filter(
        (item) => item.round_end_ts > dateBaseTs && item.round_end_ts <= dateBaseTs + 24 * 60 * 60,
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

function floorToBeijingDayStart(unixSeconds) {
    const beijingShift = 8 * 60 * 60;
    const daySeconds = 24 * 60 * 60;
    return (
        Math.floor((unixSeconds + beijingShift) / daySeconds) * daySeconds - beijingShift
    );
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
        // 源站商品名混入过零宽字符，而 JS 的 \s 不匹配 U+200B/200C/200D/2060。
        // 留着它们名字看着正常，但与 RARE_ITEM_NAMES 这类按名比对全都落空。
        .replace(/[\u200B-\u200D\u2060]/g, "")
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
    // 站点会在同步进行中 fetch /data/merchant.json，mirrorFileToDist 也会 copyFile 它。
    // 直接覆盖写有中间态，读到一半就是 JSON.parse 失败（页面表现为「数据加载失败」）。
    await writeFileAtomic(filePath, `${JSON.stringify(value, null, 4)}\n`);
}

// 轮询式同步下，仅时间戳变化的内容不应产生提交；
// 除 ignoredKeys 外内容一致时保留旧文件，返回 false 表示未写入。
async function writeJsonIfChanged(filePath, value, ignoredKeys = []) {
    try {
        const previous = JSON.parse(await fs.readFile(filePath, "utf8"));
        const left = { ...previous };
        const right = { ...value };

        for (const key of ignoredKeys) {
            delete left[key];
            delete right[key];
        }

        if (JSON.stringify(left) === JSON.stringify(right)) {
            return false;
        }
    } catch {
        // 旧文件缺失或不可解析时直接写入。
    }

    await writeJson(filePath, value);
    return true;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
