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


### 使用

本地重建精灵数据: `npm run sync:pet-data`

同步远行商人每日轮换数据: `npm run sync:merchant-data`（建议每日定时执行）

### 结构

- 精灵相关数据在 `public\data` ，数据来源于洛克王国世界的游戏数据包，经过处理后以 JSON 格式存储.
- 远行商人数据在 `public\data\merchant.json` ，由 `scripts\sync-merchant-data.mjs` 抓取好游快爆「每日远行商人查询器」页面解析生成，每日 4 轮商品排期.
- 相关脚本在 `scripts` 
- 前端使用 Vue 3 + Vite 构建，组件库使用 Shadcn UI，样式使用 Tailwind CSS.
- 主要页面在 `src\pages`

