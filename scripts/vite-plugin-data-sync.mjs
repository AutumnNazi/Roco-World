// Vite 插件：把「数据同步」能力挂到 dev / preview 服务器上。
//
// 为什么做成插件：站点的同步接口原先只在 scripts/serve-local.mjs 里，
// 用户用 npm run dev / npm run preview 打开站点时就探测不到接口，
// 手动同步按钮被隐藏、定时器也不会跑。挂到 Vite 上后，日常用的两条命令都自带同步。
//
// 提供的能力（dev 与 preview 一致）：
//   GET  /api/sync/status  探测接口是否可用
//   POST /api/sync         立即同步商人数据
//   后台定时轮询 + 请求时陈旧兜底
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const MERCHANT_FILE = ["data", "merchant.json"];
const DEFAULT_INTERVAL_MINUTES = 5;

export function dataSyncPlugin(options = {}) {
    const rootDir = options.root ?? process.cwd();
    const intervalMinutes = Number(
        process.env.SYNC_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES,
    );
    const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
    const syncDisabled = process.env.SYNC_DISABLED === "1";

    let running = false;
    let lastSyncAt = null;
    let timer = null;

    const merchantPath = () => path.join(rootDir, "public", ...MERCHANT_FILE);

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

    function log(...args) {
        console.log(`[data-sync ${beijingTimestamp()}]`, ...args);
    }

    // 抓取脚本写 public/data 并镜像到 dist，dev/preview 都能读到。
    function runScript(scriptName, label) {
        return new Promise((resolve) => {
            const child = spawn(
                process.execPath,
                [path.join(rootDir, "scripts", scriptName)],
                { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] },
            );

            let output = "";
            child.stdout.on("data", (chunk) => (output += chunk.toString()));
            child.stderr.on("data", (chunk) => (output += chunk.toString()));
            child.on("close", (code) => {
                const tail = output.trim().split("\n").slice(-2).join(" | ");
                log(`${label} 结束 (exit ${code}) ${tail}`);
                resolve(code === 0);
            });
            child.on("error", (error) => {
                log(`${label} 启动失败：${error.message}`);
                resolve(false);
            });
        });
    }

    async function syncMerchant(reason) {
        if (syncDisabled) {
            return { ok: false, message: "已在 SYNC_DISABLED=1 下禁用同步" };
        }

        if (running) {
            return { ok: false, message: "同步正在进行中" };
        }

        running = true;
        log(`同步远行商人数据（${reason}）…`);

        try {
            const ok = await runScript("sync-merchant-data.mjs", "商人数据");
            lastSyncAt = beijingTimestamp();
            return {
                ok,
                message: ok ? "同步完成" : "同步失败，请查看终端日志",
                syncedAt: lastSyncAt,
            };
        } finally {
            running = false;
        }
    }

    // 数据超过一个轮询周期就后台补一次：定时器可能因休眠/重启失效，这是兜底。
    function ensureFresh() {
        if (syncDisabled || running) {
            return;
        }

        let generatedAt = null;

        try {
            const payload = JSON.parse(fs.readFileSync(merchantPath(), "utf8"));
            generatedAt = payload?.generated_at ?? null;
        } catch {
            void syncMerchant("数据文件缺失");
            return;
        }

        const generatedMs = generatedAt
            ? Date.parse(String(generatedAt).replace(" ", "T") + "+08:00")
            : NaN;

        if (!Number.isFinite(generatedMs) || Date.now() - generatedMs > intervalMs) {
            void syncMerchant("数据陈旧，自动补同步");
        }
    }

    function attachMiddleware(server) {
        server.middlewares.use(async (req, res, next) => {
            const url = req.url ?? "/";

            if (!url.startsWith("/api/sync")) {
                // 页面每次取商人数据时顺手检查一次新鲜度。
                if (url.startsWith("/data/merchant.json")) {
                    ensureFresh();
                }

                next();
                return;
            }

            const sendJson = (status, payload) => {
                const body = JSON.stringify(payload);
                res.writeHead(status, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-store",
                    "Content-Length": String(Buffer.byteLength(body)),
                });
                res.end(body);
            };

            if (url.startsWith("/api/sync/status")) {
                sendJson(200, {
                    syncEnabled: !syncDisabled,
                    running,
                    intervalMinutes,
                    lastSyncAt,
                    runner: "vite",
                });
                return;
            }

            if (req.method !== "POST") {
                sendJson(405, { ok: false, message: "请使用 POST 触发同步" });
                return;
            }

            const result = await syncMerchant("页面手动触发");
            sendJson(200, result);
        });
    }

    function startTimer() {
        if (syncDisabled || timer) {
            return;
        }

        timer = setInterval(ensureFresh, intervalMs);
        timer.unref?.();
    }

    return {
        name: "roco-data-sync",
        apply: "serve",

        configureServer(server) {
            attachMiddleware(server);
            // dev 启动后先补一次数据，避免打开就是旧数据。
            setTimeout(() => void syncMerchant("dev 启动同步"), 1200);
            startTimer();
        },

        configurePreviewServer(server) {
            attachMiddleware(server);
            setTimeout(() => void syncMerchant("preview 启动同步"), 1200);
            startTimer();
        },
    };
}
