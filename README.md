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

1. **仓库侧定时同步**：
   - `.github/workflows/merchant-sync.yml`：只抓远行商人，开市时段（北京 08:00-23:55）**每 5 分钟**一次。
   - `.github/workflows/daily-data-sync.yml`：图鉴档案 + 补图等重活，每天北京 04:20 一次（BWIKI 有限频，不适合高频）。
2. **页面云端兜底**：远行商人页发现本地数据不是最新，就直接从仓库原始文件（`raw.githubusercontent.com`，带 CORS 头可跨域直取）读取更新的那一份，并标记「云端数据」。页面上的「立即同步」按钮就是手动触发这一步，纯静态托管下同样可用。

所以**服务器不需要重新构建也能看到当天商品**；想让服务器本地那份也更新，重新拉取仓库并部署即可。

> GitHub 的 `schedule` 是「尽力而为」调度：高峰期会延迟数分钟，偶尔跳过；fork 仓库的定时触发也可能被限制。所以每 5 分钟是**上限而非准点保证**。要准点，用下面的服务器侧定时器。

#### 服务器侧定时器（准点刷新，推荐）

服务器上跑一个常驻 Node 进程，自己按点抓取写盘，不依赖 GitHub。`deploy/` 下已备好配置：

| 文件 | 用途 |
| --- | --- |
| `deploy/roco-world.service` | systemd 单元：常驻运行 `npm run serve`（静态服务 + 定时同步 + `/api/sync` 接口） |
| `deploy/nginx-roco-world.conf` | nginx 配置：静态文件直发，`/data`、`/assets`、`/api` 反代给 Node |
| `deploy/sync-cron.sh` | 不想动 nginx 时的替代方案：cron 只跑同步脚本，产物直接写进托管目录 |

**方案 A：systemd + nginx 反代**（能用上「立即同步」按钮和陈旧兜底）

```bash
git clone https://github.com/AutumnNazi/Roco-World.git /opt/roco-world
cd /opt/roco-world && npm ci --legacy-peer-deps && npm run build

cp deploy/roco-world.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now roco-world

cp deploy/nginx-roco-world.conf /etc/nginx/conf.d/
nginx -t && systemctl reload nginx
```

**方案 B：只挂 cron**（不改 nginx，最小改动）

```bash
cp deploy/sync-cron.sh /opt/roco-world/
crontab -e
# 开市时段每 5 分钟抓一次商人数据
*/5 8-23 * * * /opt/roco-world/sync-cron.sh >> /var/log/roco-sync.log 2>&1
```

两个方案都能做到准点，区别是方案 A 多了页面「立即同步」按钮和过期自动补抓。

#### 排查「最后同步时间不动 / 点了立即同步没反应」

最快的定位方式是在服务器上直接跑一次同步脚本，它的报错就是真因：

```bash
cd /opt/roco-world && node scripts/sync-merchant-data.mjs; echo "exit=$?"
node -v                                  # 需要 20.19+ 或 22.12+
curl -sI --max-time 20 'https://www.onebiji.com/hykb_tools/comm/lkwgmerchant/preview.php?id=1&immgj=0' | head -3
```

正常情况下会打印 `Generated merchant data for …`；失败时按报错对照：

| 报错 | 含义与处置 |
| --- | --- |
| `EACCES: permission denied` | **最常见**。运行用户对部署目录没写权限：抓取其实成功了，卡在写盘那一步，表现成「时间永远不动、点按钮没反应」。用 `ls -l` 看属主，若不是 service 里的 `User=`，执行 `sudo chown -R <运行用户>:<运行用户> /opt/roco-world`。注意用 root 跑 `git pull` / `npm run build` 会把属主改回 root，故障会复发。 |
| `getaddrinfo EAI_AGAIN` / `ENOTFOUND` | 服务器 DNS 不通，检查 `/etc/resolv.conf` 或换内网 DNS。 |
| `ETIMEDOUT` / `fetch failed` | 服务器出网被安全组或防火墙拦，放行 443 出站。 |
| `ECONNREFUSED` / `403` | 源站拒了该服务器 IP（云主机 IP 段常被限），换出口或改用仓库侧定时同步。 |
| `fetch is not defined` | 部署机 Node 低于 18。升级 Node 到 `package.json` 要求的版本即可。 |
| `HTTP 200` 但 `未从…解析到商品` | 源站页面结构变了，需要更新 `scripts/sync-merchant-data.mjs` 的解析规则。 |

部署侧另有自检接口（需用下面的步骤更新到含该接口的版本），一次说清运行时与源站两侧状态：

```bash
curl -s http://<你的域名或IP>/api/sync/diagnose
curl -s http://<你的域名或IP>/api/sync/status
```

| 现象 | 含义与处置 |
| --- | --- |
| `/api/sync/diagnose` 返回 HTML 而不是 JSON | 请求没打到 Node 服务。多半是 systemd 的 `PORT` 与 nginx `proxy_pass` 端口不一致（仓库里两者都用 `4173`），或 nginx 没转发 `/api`。 |
| `runtime.dataWritable` 为 `false` | 同上面的 `EACCES`，运行用户写不了 `public/data`。 |
| `source.reachable` 为 `false` | 服务器出网被拦或源站不通，看 `source.error` 里的错误码。 |
| `source.reachable` 为 `true` 但 `hasGoods` 为 `false` | 源站页面结构变了，需改解析规则。 |
| `status.lastError` 有值 | 上次同步的真实报错，页面上也会以「服务端同步失败」提示出来。 |

一个容易误判的正常情况：**商品没变化时同步脚本按设计不重写文件**（避免仓库侧每 5 分钟产生一次无意义提交），所以 `merchant.json` 的 `generated_at` 会长时间停在旧值。页面因此把两个时间分开显示——「数据生成」是 `generated_at`，「最后校验」是服务端最近一次成功抓取的时间。只有后者也不动，才说明同步真的坏了。

#### 更新已有部署（拉新代码并重启）

```bash
cd /opt/roco-world
git pull
npm ci --legacy-peer-deps && npm run build     # 前端有改动时需要
sudo systemctl restart roco-world && systemctl status roco-world --no-pager
```

只改了同步脚本时，`npm run build` 可跳过，但**必须重启服务**，因为脚本是在服务里按间隔调起的。

> 用 root 执行上面的 `git pull` / `npm run build` 会把文件属主改成 root，而服务以 `User=` 指定的普通用户运行，同步就会因 `EACCES` 全部失败。要么全程用运行用户操作，要么每次部署后补一次 `sudo chown -R <运行用户>:<运行用户> /opt/roco-world`。

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
- 少数两个 WIKI 均未收录立绘的精灵（如多灵、多灵主）：`rocokingdomworld.org` 图鉴页，由 `scripts/sync-pet-images.mjs` 作为末端兜底按中文名精确匹配取图。

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

远行商人页始终显示「立即同步」按钮，点击后按两级顺序取数据：先请求服务端 `/api/sync` 现抓源站（方案 A 部署可用，最及时），失败或纯静态托管时退回仓库原始文件。之所以不只拉云端——云端那份受 GitHub Actions 排期限制，fork 仓库的 `schedule` 可能根本不触发，只拉云端就会出现「点了按钮却什么都没变」。服务端抓取失败时，失败原因会直接显示在页面上，不再只写进服务日志。
