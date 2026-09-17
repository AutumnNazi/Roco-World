import fs from "node:fs/promises";
import path from "node:path";

// 跨进程文件锁 + 原子写。
//
// 为什么需要：merchant-history.json 是「读整份 → 内存里合并 → 整份覆盖」的累积型档案，
// 两个写入者同时跑时后写的会把先写的那一轮整轮覆盖掉（实测 8 并发只剩 1 轮）。
// 现实中能撞上的组合：README 方案 A（serve-local 常驻，有进程内锁）与方案 B
// （deploy/sync-cron.sh 直接调脚本，绕过那把锁）同时部署，或手动 npm run 撞上定时器。
//
// 为什么用 'wx' 独占创建而不是 rename 争用：Windows 上并发 rename 到同一目标会
// EPERM 直接失败，不像 POSIX 那样静默替换；而 'wx' 在 8 并发下恰好 1 个成功、
// 其余稳定 EEXIST，正好当互斥量用。拿到锁后写入是串行的，rename 就变安全了。
//
// 锁文件与临时文件都用 `.tmp-` 前缀放在目标同目录：同一文件系统才能保证 rename 原子，
// 且该前缀已被 .gitignore 收掉，CI 的 `git add public/data` 不会把它们提交进去。

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_STALE_MS = 60000;
const RETRY_INTERVAL_MS = 120;

function buildLockPath(targetPath) {
    const dir = path.dirname(targetPath);
    return path.join(dir, `.tmp-${path.basename(targetPath)}.lock`);
}

function buildTempPath(targetPath) {
    const dir = path.dirname(targetPath);
    const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return path.join(dir, `.tmp-${path.basename(targetPath)}.${unique}`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// 持锁进程被 kill 会留下锁文件。按 mtime 判定超龄后强夺，否则后续同步会永久卡死。
async function removeIfStale(lockPath, staleMs) {
    try {
        const stat = await fs.stat(lockPath);

        if (Date.now() - stat.mtimeMs > staleMs) {
            await fs.rm(lockPath, { force: true });
            return true;
        }
    } catch {
        // 锁文件刚被别人释放，交给下一轮重试。
    }

    return false;
}

async function acquireLock(lockPath, timeoutMs, staleMs) {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
        try {
            const handle = await fs.open(lockPath, "wx");
            await handle.writeFile(
                `${process.pid} ${new Date().toISOString()}\n`,
                "utf8",
            );
            await handle.close();
            return;
        } catch (error) {
            if (error.code !== "EEXIST") {
                throw error;
            }
        }

        await removeIfStale(lockPath, staleMs);

        if (Date.now() >= deadline) {
            throw new Error(
                `获取文件锁超时（${timeoutMs}ms）：${lockPath}。若确认没有其他同步在跑，删掉该锁文件即可。`,
            );
        }

        await sleep(RETRY_INTERVAL_MS);
    }
}

export async function withFileLock(targetPath, task, options = {}) {
    const lockPath = buildLockPath(targetPath);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS;

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await acquireLock(lockPath, timeoutMs, staleMs);

    try {
        return await task();
    } finally {
        await fs.rm(lockPath, { force: true }).catch(() => {
            // 释放失败只会让下一次同步走强夺分支，不该盖掉任务本身的结果。
        });
    }
}

// 先写临时文件再 rename：读取方（站点 fetch、mirrorFileToDist 的 copyFile）
// 只会看到替换前或替换后的完整内容，不会读到写一半的 JSON。
//
// Windows 上并发 rename 到同一目标会 EPERM（POSIX 是静默替换），另外杀毒软件与
// 文件索引也会短暂占用刚落地的目标文件。这类争用都是瞬时的，退避重试即可；
// 不重试的话「原子写」反而会把原本只是覆盖丢数据的场景升级成整个同步失败。
const RENAME_RETRY = 5;

export async function writeFileAtomic(targetPath, content) {
    const tempPath = buildTempPath(targetPath);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(tempPath, content, "utf8");

    try {
        for (let attempt = 1; ; attempt += 1) {
            try {
                await fs.rename(tempPath, targetPath);
                return;
            } catch (error) {
                const retryable =
                    error.code === "EPERM" ||
                    error.code === "EACCES" ||
                    error.code === "EBUSY";

                if (!retryable || attempt >= RENAME_RETRY) {
                    throw error;
                }

                await sleep(RETRY_INTERVAL_MS * attempt);
            }
        }
    } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
    }
}
