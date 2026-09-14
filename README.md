# 洛克王国世界 工具箱

目前有的功能：
- 图鉴
- 配对
- 配种
- 表格
- 查蛋
- 孵蛋
- 星图
- 属性关系
- 远行商人
- 技能图鉴


### 使用

本地重建精灵数据: `npm run sync:pet-data`

同步远行商人每日轮换数据: `npm run sync:merchant-data`（建议每日定时执行）

同步官方图鉴档案: `npm run sync:official-pokedex`（同时生成精灵档案与官方技能表 `skills-official.json`）

一键全量更新: `npm run sync:all`（精灵数据 → 官方图鉴 → 远行商人）

补充缺失精灵立绘: `npm run sync:pet-images`（从 BWIKI 图床拉取，可带精灵 id 只补一只）

### 本地部署（推荐）

站点跑在本机时，用内置运行器一步完成「静态服务 + 数据定时同步 + gzip」：

```bash
npm install --legacy-peer-deps
npm run build     # 生成 dist
npm run serve     # 默认 http://127.0.0.1:4173
```

- 启动即同步一次远行商人数据，之后**开市时段（北京时间 08:00-23:00）每 5 分钟**轮询源站；有新商品才写盘，站点实时读到（`/data`、`/assets` 直接映射到 `public`，无需重新构建）。
- 开着的页面也会更新：远行商人页每分钟拉一次数据，切回标签页时立即刷新。
- 静态响应默认 gzip，配合已瘦身的 JSON（图鉴首屏约 69KB）访问很快。
- 可用环境变量：`PORT`、`HOST`（填 `0.0.0.0` 供局域网访问）、`SYNC_INTERVAL_MINUTES`、`SYNC_DISABLED=1`（只做静态服务）。

用 nginx / IIS 等托管 `dist` 时，把 `npm run sync:merchant-data` 挂到系统计划任务（Windows 任务计划程序或 cron），并让它写入你所托管目录下的 `data/` 即可。

GitHub Actions 工作流（`.github/workflows/daily-data-sync.yml`）保留为手动触发，供仓库侧一次性刷新；若将来改为托管部署，把其中的 `schedule` 打开即可恢复自动同步。

### 结构

- 精灵相关数据在 `public\data` ，数据来源于洛克王国世界的游戏数据包，经过处理后以 JSON 格式存储.
- 远行商人数据在 `public\data\merchant.json` ，由 `scripts\sync-merchant-data.mjs` 抓取好游快爆「每日远行商人查询器」页面解析生成，每日 4 轮商品排期.
- 相关脚本在 `scripts` 
- 前端使用 Vue 3 + Vite 构建，组件库使用 Shadcn UI，样式使用 Tailwind CSS.
- 主要页面在 `src\pages`

