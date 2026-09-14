import fs from "node:fs/promises";
import path from "node:path";

// 同步脚本只写 public/data（开发与 serve-local 的数据源）。
// 若本机已在 dist 上托管站点，则把同一份文件镜像过去，
// 否则「站点读的是构建时那一份、脚本写的是另一份」，页面永远看不到新数据。
export async function mirrorFileToDist(rootDir, relativePath) {
    const distRoot = path.join(rootDir, "dist");

    try {
        // 以 index.html 判断是否真的构建过，避免凭空造出 dist 目录。
        await fs.access(path.join(distRoot, "index.html"));
    } catch {
        return false;
    }

    const source = path.join(rootDir, "public", relativePath);
    const target = path.join(distRoot, relativePath);

    try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(source, target);
        return true;
    } catch {
        return false;
    }
}
