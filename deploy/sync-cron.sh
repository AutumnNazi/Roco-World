#!/usr/bin/env bash
# 方案 B：保持 nginx 纯静态托管，用系统 cron 定时刷新数据文件。
#
# 与方案 A（Node 服务 + 反代）的区别：
#   - 不需要改 nginx，也不需要常驻进程
#   - 但页面上的「立即同步」按钮走的是云端兜底（无 /api/sync 接口）
#
# 安装：
#   chmod +x deploy/sync-cron.sh
#   crontab -e
#   # 开市时段（北京 08:00-23:55）每 5 分钟刷新商人数据
#   */5 8-23 * * * /srv/roco-world/deploy/sync-cron.sh >> /var/log/roco-sync.log 2>&1
#
# 说明：脚本只抓商人数据（秒级完成、不碰限频源），
# 图鉴/立绘这类重活请另挂一条每日任务执行 `npm run sync:all`。
set -euo pipefail

# 项目根目录：按实际部署路径修改
APP_DIR="${APP_DIR:-/srv/roco-world}"
# nginx 实际托管的目录（通常就是 $APP_DIR/dist）
WEB_ROOT="${WEB_ROOT:-$APP_DIR/dist}"

cd "$APP_DIR"

# 抓取并写入 public/data
npm run --silent sync:merchant-data

# 同步到 nginx 托管目录：站点读的是这一份
mkdir -p "$WEB_ROOT/data"
cp -f public/data/merchant.json "$WEB_ROOT/data/merchant.json"
cp -f public/data/merchant-history.json "$WEB_ROOT/data/merchant-history.json" 2>/dev/null || true

echo "[$(date '+%F %T')] merchant data synced -> $WEB_ROOT/data"
