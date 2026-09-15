// 本地部署运行器：静态站点 + 数据定时同步 + gzip。
//
// 为什么需要它：站点部署在本地时，GitHub 定时任务改的是仓库、不是本机这份数据，
// 所以把「按点抓取写盘」放进运行侧：起服务时立即同步一次，之后按间隔轮询源站，
// 有新数据就写入 public/data（本服务把 /data 与 /assets 直接映射到 public，实时生效）。
//
// 用法：
//   npm run build      # 首次准备前端产物
//   npm run serve      # 启动（默认 http://127.0.0.1:4173）
// 环境变量：
//   PORT=4173              监听端口
//   HOST=127.0.0.1         监听地址（填 0.0.0.0 可供局域网访问）
//   SYNC_INTERVAL_MINUTES=5   商人数据轮询间隔（分钟，开市时段生效）
//   SYNC_DISABLED=1        只做静态服务，不抓数据
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const distDir = path.join(rootDir, "dist");
const publicDir = path.join(rootDir, "public");

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "127.0.0.1";
const SYNC_DISABLED = process.env.SYNC_DISABLED === "1";
const MERCHANT_INTERVAL_MS =
    Number(process.env.SYNC_INTERVAL_MINUTES ?? 5) * 60 * 1000;
const POKEDEX_INTERVAL_MS = 6 * 60 * 60 * 1000;
const IMAGES_INTERVAL_MS = 12 * 60 * 60 * 1000;

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
};

const COMPRESSIBLE = new Set([
    ".html",
    ".js",
    ".mjs",
    ".css",
    ".json",
    ".svg",
    ".txt",
    ".md",
]);

function beijingTimestamp() {
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

function beijingHour() {
    return Number(
        new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Shanghai",
            hour: "2-digit",
            hour12: false,
        }).format(new Date()),
    );
}

function log(...args) {
    console.log(`[${beijingTimestamp()}]`, ...args);
}

// ---- 数据同步调度 ----

let merchantRunning = false;
// 尝试时间与成功时间必须分开记：只记尝试时间会让「每次都失败」看起来像健康的定时同步。
let lastMerchantAttemptAt = null;
let lastMerchantSuccessAt = null;
// 判断「数据是否该刷了」只能看最后一次成功校验的时刻，不能看盘上文件的
// generated_at：商品没变化时同步脚本按设计不重写文件，generated_at 会长期不动，
// 拿它当依据会让陈旧兜底每次都成立，页面每分钟取一次数据就抓一次源站。
let lastMerchantCheckMs = 0;
let lastMerchantError = null;

function runScript(scriptName, label) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(rootDir, "scripts", scriptName)], {
            cwd: rootDir,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";
        child.stdout.on("data", (chunk) => {
            output += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            output += chunk.toString();
        });
        child.on("error", (error) => {
            output += `spawn 失败: ${error.message}\n`;
        });
        child.on("close", (code) => {
            const summary = output.trim().split("\n").slice(-3).join(" | ");
            log(`${label} 结束 (exit ${code}) ${summary}`);
            resolve({ ok: code === 0, code, output: output.trim() });
        });
    });
}

// 子进程失败时把真实报错带回调用方：服务器上没法看日志时，
// 「fetch failed」和「页面结构变更」是完全不同的处置方向，不能都糊成一句「详见服务日志」。
function extractFailureMessage(output) {
    const lines = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (!lines.length) {
        return "子进程无输出";
    }

    const errorLine =
        lines.find((line) => /^(Error|TypeError|FetchError|AggregateError)\b/u.test(line)) ??
        lines.find((line) => !line.startsWith("at ")) ??
        lines[0];

    return errorLine.slice(0, 300);
}

async function syncMerchant(reason) {
    if (merchantRunning) {
        return { ok: false, message: "同步已在进行中" };
    }

    merchantRunning = true;
    lastMerchantAttemptAt = beijingTimestamp();

    try {
        log(`同步远行商人数据（${reason}）…`);
        const result = await runScript("sync-merchant-data.mjs", "商人数据");

        if (result.ok) {
            lastMerchantSuccessAt = beijingTimestamp();
            lastMerchantCheckMs = Date.now();
            lastMerchantError = null;
            return { ok: true, message: "同步完成" };
        }

        lastMerchantError = extractFailureMessage(result.output);
        return { ok: false, message: `同步失败：${lastMerchantError}` };
    } finally {
        merchantRunning = false;
    }
}

// 源站可达性自检：同一份脚本在开发机能跑通、服务器上失败时，
// 先分清是出网被拦（DNS/超时/封 IP）还是页面结构变了，再决定改代码还是改部署。
async function probeMerchantSource() {
    const started = Date.now();

    try {
        const response = await fetch(
            "https://www.onebiji.com/hykb_tools/comm/lkwgmerchant/preview.php?id=1&immgj=0",
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 rocom-aoe-top-merchant-sync",
                    Referer: "https://www.onebiji.com/",
                },
                signal: AbortSignal.timeout(20000),
            },
        );

        const text = await response.text();

        return {
            reachable: response.ok,
            status: response.status,
            elapsedMs: Date.now() - started,
            bodyLength: text.length,
            hasGoods: text.includes("showShopinfo("),
        };
    } catch (error) {
        return {
            reachable: false,
            status: null,
            elapsedMs: Date.now() - started,
            error: error.message,
        };
    }
}

// 盘上数据的时间戳才是「同步到底有没有生效」的唯一凭据，
// 服务进程内的成功/失败计数只反映本次进程生命周期。
function readMerchantGeneratedAt() {
    try {
        const payload = JSON.parse(
            fs.readFileSync(path.join(publicDir, "data", "merchant.json"), "utf8"),
        );
        return typeof payload?.generated_at === "string" ? payload.generated_at : null;
    } catch {
        return null;
    }
}

// 数据陈旧兜底：定时器可能被休眠/重启打断，页面来取数据时再判一次，
// 只要超过一个轮询周期就后台补一次，保证「打开页面就是新数据」。
//
// 判据是「最后一次成功校验的时刻」，不能用 merchant.json 的 generated_at：
// 商品无变化时脚本按设计不重写文件，generated_at 会长期停在旧值，
// 用它判断会永远为真——页面每分钟拉一次数据就抓一次源站，
// 请求量比设定的间隔高出数倍，还会随在线页面数线性增长。
function isMerchantDataStale() {
    if (!lastMerchantCheckMs) {
        return true;
    }

    return Date.now() - lastMerchantCheckMs > MERCHANT_INTERVAL_MS;
}

// 写盘权限自检：服务以非 root 用户跑、部署目录属主是别人时，抓取成功也会在写盘那步失败。
function isMerchantDataWritable() {
    try {
        fs.accessSync(path.join(publicDir, "data"), fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function ensureFreshMerchantData() {
    if (SYNC_DISABLED || merchantRunning) {
        return;
    }

    if (isMerchantDataStale()) {
        void syncMerchant("数据陈旧自动补同步");
    }
}

// 开市时段（北京 08:00-23:00）按间隔轮询，其余时段降频，避免无意义请求。
function nextMerchantDelay() {
    const hour = beijingHour();
    const inBusinessHours = hour >= 8 && hour < 23;
    return inBusinessHours ? MERCHANT_INTERVAL_MS : Math.max(MERCHANT_INTERVAL_MS, 60 * 60 * 1000);
}

function scheduleMerchant() {
    setTimeout(async () => {
        await syncMerchant("定时轮询");
        scheduleMerchant();
    }, nextMerchantDelay());
}

function scheduleOthers() {
    setTimeout(async () => {
        await runScript("sync-official-pokedex.mjs", "官方图鉴");
        scheduleOthers();
    }, POKEDEX_INTERVAL_MS);

    setTimeout(async () => {
        await runScript("sync-pet-images.mjs", "精灵立绘");
    }, IMAGES_INTERVAL_MS);
}

// ---- 静态服务 ----

function resolveFile(urlPath) {
    const decoded = decodeURIComponent(urlPath.split("?")[0]);

    // /data 与 /assets 走 public：同步脚本写盘后站点立即可见，无需重建。
    if (decoded.startsWith("/data/") || decoded.startsWith("/assets/")) {
        return path.join(publicDir, decoded);
    }

    return path.join(distDir, decoded);
}

async function sendFile(request, response, filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const type = MIME_TYPES[extension] ?? "application/octet-stream";

    // 页面来取商人数据时顺手判断是否过期，过期就后台补同步（不阻塞本次响应）。
    if (filePath.endsWith(`${path.sep}data${path.sep}merchant.json`)) {
        ensureFreshMerchantData();
    }

    let content;
    try {
        content = await fsp.readFile(filePath);
    } catch {
        return false;
    }

    // 数据文件必须每次校验，其余静态资源用哈希文件名或短缓存即可。
    const isData = filePath.includes(`${path.sep}data${path.sep}`) || filePath.includes(`${path.sep}public${path.sep}`);
    const headers = {
        "Content-Type": type,
        "Cache-Control": isData ? "no-cache" : "public, max-age=3600",
        Vary: "Accept-Encoding",
    };

    const acceptsGzip = String(request.headers["accept-encoding"] ?? "").includes("gzip");

    if (acceptsGzip && COMPRESSIBLE.has(extension)) {
        headers["Content-Encoding"] = "gzip";
        content = zlib.gzipSync(content);
    }

    headers["Content-Length"] = String(content.length);
    response.writeHead(200, headers);
    response.end(content);
    return true;
}

const server = http.createServer(async (request, response) => {
    const urlPath = request.url ?? "/";

    // 手动同步接口：页面上的「立即同步」按钮调用它。
    // 只允许本机/同源调用，避免暴露成公网可触发的写操作。
    if (urlPath.startsWith("/api/sync")) {
        await handleSyncRequest(request, response, urlPath);
        return;
    }

    const filePath = resolveFile(urlPath);

    if (await sendFile(request, response, filePath)) {
        return;
    }

    // SPA 回退：非资源请求交给 index.html，深链接（/merchant、/pets/3004）才能直达。
    if (!path.extname(urlPath.split("?")[0])) {
        if (await sendFile(request, response, path.join(distDir, "index.html"))) {
            return;
        }
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("404 Not Found");
});

async function handleSyncRequest(request, response, urlPath) {
    const sendJson = (status, payload) => {
        const body = JSON.stringify(payload);
        response.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Length": String(Buffer.byteLength(body)),
        });
        response.end(body);
    };

    // 源站自检：定位「服务器抓不到数据」是出网问题还是页面结构问题。
    // 一并报运行时信息：抓取成功却写不进盘（部署目录属主与运行用户不一致）
    // 这类环境差异从日志外面看不出来，必须让接口直接说清楚。
    if (urlPath.startsWith("/api/sync/diagnose")) {
        sendJson(200, {
            checkedAt: beijingTimestamp(),
            runtime: {
                node: process.version,
                platform: `${process.platform} ${process.arch}`,
                cwd: rootDir,
                scriptsPresent: fs.existsSync(
                    path.join(rootDir, "scripts", "sync-merchant-data.mjs"),
                ),
                dataWritable: isMerchantDataWritable(),
            },
            source: await probeMerchantSource(),
            lastError: lastMerchantError,
        });
        return;
    }

    // 只读探测：页面加载时用它判断服务端是否支持手动同步。
    if (urlPath.startsWith("/api/sync/status")) {
        sendJson(200, {
            syncEnabled: !SYNC_DISABLED,
            running: merchantRunning,
            intervalMinutes: MERCHANT_INTERVAL_MS / 60000,
            // lastSyncAt 保留字段名给旧前端，但语义改成「最后成功」，失败不再顶包。
            lastSyncAt: lastMerchantSuccessAt,
            lastAttemptAt: lastMerchantAttemptAt,
            lastError: lastMerchantError,
            dataGeneratedAt: readMerchantGeneratedAt(),
        });
        return;
    }

    if (request.method !== "POST") {
        sendJson(405, { ok: false, message: "请使用 POST 触发同步" });
        return;
    }

    if (SYNC_DISABLED) {
        sendJson(200, { ok: false, message: "服务端已禁用数据同步（SYNC_DISABLED=1）" });
        return;
    }

    const result = await syncMerchant("页面手动触发");
    sendJson(200, result);
}

async function main() {
    if (!fs.existsSync(path.join(distDir, "index.html"))) {
        console.error("未找到 dist/index.html，请先运行 npm run build 生成前端产物。");
        process.exitCode = 1;
        return;
    }

    server.listen(PORT, HOST, () => {
        log(`站点已启动: http://${HOST}:${PORT}`);
        log(`Node ${process.version}（${process.platform} ${process.arch}）`);
        log(`/data 与 /assets 映射到 public（同步脚本写盘后即时生效）`);
    });

    if (SYNC_DISABLED) {
        log("SYNC_DISABLED=1，仅提供静态服务，不抓取数据。");
        return;
    }

    // 启动即同步一次，之后按间隔轮询；页面取数据时还有陈旧兜底。
    await syncMerchant("启动同步");
    void runScript("sync-official-pokedex.mjs", "官方图鉴");
    void runScript("sync-pet-images.mjs", "精灵立绘");
    scheduleMerchant();
    scheduleOthers();
}

main();
