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
- 时装
- 奖牌


### 使用

本地重建精灵数据: `npm run sync:pet-data`

同步远行商人每日轮换数据: `npm run sync:merchant-data`（建议每日定时执行）

同步官方图鉴档案: `npm run sync:official-pokedex`（同时生成精灵档案与官方技能表 `skills-official.json`）

一键全量更新: `npm run sync:all`（精灵数据 → 官方图鉴 → 远行商人）

补充缺失精灵立绘: `npm run sync:pet-images`（从 BWIKI 图床拉取，可带精灵 id 只补一只）

同步哔哩哔哩 WIKI 结构化数据: `npm run sync:nrc-data`（生成精灵图鉴文案、时装 `fashions.json`、奖牌 `medals.json`；同时作为图鉴物种名/称号/栖息地的主数据源）

### 部署与数据刷新

#### 纯静态托管（nginx / IIS，当前线上方式）

服务器上只放 `dist`、没有 Node 进程时，构建产物里的数据会**冻结在构建那一刻**。数据刷新靠两条链路配合：

1. **仓库侧定时同步**：`.github/workflows/daily-data-sync.yml` 每 30 分钟（开市时段）跑一次抓取并提交到仓库。
2. **页面云端兜底**：远行商人页发现本地数据不是最新，就直接从仓库原始文件（`raw.githubusercontent.com`，带 CORS 头可跨域直取）读取更新的那一份，并标记「云端数据」。页面上的「立即同步」按钮就是手动触发这一步，纯静态托管下同样可用。

所以**服务器不需要重新构建也能看到当天商品**；想让服务器本地那份也更新，重新拉取仓库并部署即可。

#### 本机运行（开发或自用）

```bash
npm install --legacy-peer-deps
npm run build     # 生成 dist
npm run serve     # 默认 http://127.0.0.1:4173
```

- 启动即同步一次远行商人数据，之后**开市时段（北京时间 08:00-23:00）每 5 分钟**轮询源站；有新商品才写盘，站点实时读到（`/data`、`/assets` 直接映射到 `public`，无需重新构建）。
- 开着的页面也会更新：远行商人页每分钟拉一次数据，切回标签页时立即刷新；数据请求都禁用缓存，避免「刷新后本轮商品又消失」。
- 历史留痕：每轮商品首次出现或变化时写入 `public/data/merchant-history.json`，页面「历史记录」卡片可展开查看，不会被次日快照覆盖。
- 同步脚本会把新数据同时镜像到 `dist/data`，站点不会读到构建时的旧副本。
- 静态响应默认 gzip，配合已瘦身的 JSON（图鉴首屏约 69KB）访问很快。
- 可用环境变量：`PORT`、`HOST`（填 `0.0.0.0` 供局域网访问）、`SYNC_INTERVAL_MINUTES`、`SYNC_DISABLED=1`（只做静态服务）。

### 结构

- 精灵相关数据在 `public\data` ，数据来源于洛克王国世界的游戏数据包，经过处理后以 JSON 格式存储.
- 远行商人数据在 `public\data\merchant.json` ，由 `scripts\sync-merchant-data.mjs` 抓取好游快爆「每日远行商人查询器」页面解析生成，每日 4 轮商品排期.
- 相关脚本在 `scripts` 
- 前端使用 Vue 3 + Vite 构建，组件库使用 Shadcn UI，样式使用 Tailwind CSS.
- 主要页面在 `src\pages`


### 数据来源与转载声明

本项目为**非官方、非商业的粉丝向工具站**，仅供学习交流。《洛克王国：世界》相关版权归腾讯所有。

数据来源：

- 精灵图鉴文案（物种名 / 称号 / 栖息地 / 图鉴区域）、时装、奖牌：哔哩哔哩「洛克王国：世界」WIKI（`wiki.biligame.com/nrc`）结构化数据模块，由 `scripts/sync-nrc-data.mjs` 抓取解析，生成 `public/data/{nrc-pets,fashions,medals}.json`；图标直链亦取自该 WIKI 图床。
- 精灵种族值 / 技能 / 配种 / 进化等结构化数据：游戏客户端数据包解包（`data-source/BinData`，不入库），由 `scripts/sync-pet-data.mjs` 处理。
- 官方图鉴档案：《洛克王国：世界》官方图鉴接口，由 `scripts/sync-official-pokedex.mjs` 同步。
- 远行商人每日轮换：好游快爆「每日远行商人查询器」，由 `scripts/sync-merchant-data.mjs` 抓取。

转载与二次分发时请保留本声明，并注明上述原始数据来源。

### 数据同步命令

| 命令 | 作用 |
| --- | --- |
| `npm run sync:nrc-data` | 拉取 B 站 WIKI 结构化数据（精灵档案、时装、徽章、奖牌） |
| `npm run sync:nrc-images` | 下载时装 / 徽章 / 奖牌 / 系列图片到本地（可反复执行续传） |
| `npm run sync:personalities` | 同步性格效果表 |
| `npm run sync:pet-data` | 从解包数据重建精灵索引与详情 |
| `npm run sync:pet-images` | 补齐缺失精灵立绘（nrc 优先，回退 BWIKI） |
| `npm run sync:official-pokedex` | 同步官方图鉴档案与技能表 |
| `npm run sync:merchant-data` | 同步远行商人当日 4 轮商品 |
| `npm run sync:all` | 按依赖顺序跑完以上全部 |

远行商人页始终显示「立即同步」按钮：点击后从仓库原始文件拉取最新那份数据，纯静态托管也能用（不需要服务器上有 Node 进程）。本机 `npm run serve` 时另有服务端每 5 分钟轮询源站并在页面取数据时做陈旧兜底。
