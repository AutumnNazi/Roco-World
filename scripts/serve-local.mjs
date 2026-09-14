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
let lastMerchantSyncAt = 0;

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
        child.on("close", (code) => {
            const summary = output.trim().split("\n").slice(-3).join(" | ");
            log(`${label} 结束 (exit ${code}) ${summary}`);
            resolve(code === 0);
        });
    });
}

async function syncMerchant(reason) {
    if (merchantRunning) {
        return { ok: false, message: "同步已在进行中" };
    }

    merchantRunning = true;
    lastMerchantSyncAt = Date.now();

    try {
        log(`同步远行商人数据（${reason}）…`);
        const ok = await runScript("sync-merchant-data.mjs", "商人数据");
        return { ok, message: ok ? "同步完成" : "同步失败，详见服务日志" };
    } finally {
        merchantRunning = false;
    }
}

// 数据陈旧兜底：定时器可能被休眠/重启打断，页面来取数据时再判一次，
// 只要超过一个轮询周期就后台补一次，保证「打开页面就是新数据」。
function isMerchantDataStale() {
    try {
        const payload = JSON.parse(
            fs.readFileSync(path.join(publicDir, "data", "merchant.json"), "utf8"),
        );
        const generatedAt = payload?.generated_at;

        if (typeof generatedAt !== "string") {
            return true;
        }

        const generatedMs = Date.parse(generatedAt.replace(" ", "T") + "+08:00");

        if (!Number.isFinite(generatedMs)) {
            return true;
        }

        return Date.now() - generatedMs > MERCHANT_INTERVAL_MS;
    } catch {
        return true;
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

    // 只读探测：页面加载时用它判断服务端是否支持手动同步。
    if (urlPath.startsWith("/api/sync/status")) {
        sendJson(200, {
            syncEnabled: !SYNC_DISABLED,
            running: merchantRunning,
            intervalMinutes: MERCHANT_INTERVAL_MS / 60000,
            lastSyncAt: lastMerchantSyncAt ? beijingTimestamp() : null,
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
