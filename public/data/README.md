# 说明

| 文件名              | 说明     |
| ------------------- | -------- |
| Pets.json           | 精灵列表 |
| PetSkillIndex.json  | 精灵技能筛选索引 |
| magic_items.json    | 血脉魔法 |
| moves.json          | 技能列表 |
| move-icons.json     | 技能名 → 图标 id 映射（技能图鉴页取图用） |
| PetsBreeding.json   | 精灵蛋变体数据（仅配种/孵蛋页加载） |
| personalities.json  | 性格列表 |
| types.json          | 血脉列表 |
| game_terms.json     | 游戏术语 |
| pets/{id}.json      | 精灵详情 |
| tables/{types}.json | 数据列表 |
| items.json          | 道具列表 |
| merchant.json       | 远行商人当日快照（每次轮询覆盖） |
| merchant-history.json | 远行商人历史归档（每轮商品首次出现/变化时记录，不被次日覆盖） |
| pokedex-official.json | 官方图鉴档案：编号/身高/体重/栖息地/昵称/描述（`npm run sync:official-pokedex` 生成） |
| skills-official.json  | 官方技能图鉴：效果/威力/能耗 + 学习精灵反查（同上脚本生成） |
| 解包数据索引          | 见仓库根目录 `data-source\BinData\README.md`（不入库） |
