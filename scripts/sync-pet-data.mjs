import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mirrorFileToDist } from "./lib/mirror-to-dist.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const publicDataDir = path.join(rootDir, "public", "data");
// 解包原始数据不放在 public 下：避免 293MB 进入 dist 构建产物与仓库，
// 客户端只需要 tables 镜像与生成的 JSON。
const binDataDir = path.join(rootDir, "data-source", "BinData");
const tablesDir = path.join(publicDataDir, "tables");
const petsIndexPath = path.join(publicDataDir, "Pets.json");
const petsBreedingPath = path.join(publicDataDir, "PetsBreeding.json");
const petsDetailDir = path.join(publicDataDir, "pets");
const typesPath = path.join(publicDataDir, "types.json");
const bloodlineIndexPath = path.join(publicDataDir, "bloodline_index.json");
const petSkillIndexPath = path.join(publicDataDir, "PetSkillIndex.json");
const itemsIndexPath = path.join(publicDataDir, "items.json");
const moveIconsPath = path.join(publicDataDir, "move-icons.json");
const handbookRewardsPath = path.join(publicDataDir, "handbook-rewards.json");
const handbookTopicSkillNamesPath = path.join(
    publicDataDir,
    "handbook-topic-skill-names.json",
);
const nrcPetsPath = path.join(publicDataDir, "nrc-pets.json");

// 解包手册表（PET_HANDBOOK）的 name / type_desc / description_habitat 三列存在整体错位：
// 例如手册行 302 只包含画间沉铁兽，name 却写成「绒光优优」、habitat 写成「喵喵」。
// 实测 748 只已实装精灵中 408 只对不上，因此这三列一律改用 nrc WIKI 的
// entry_name / title / habitat（字段语义分列、抽样核对全部正确）。
// key 为 PETBASE id（nrc 的 game_id），缺失时回退到本体名，绝不再写入错位文本。
const nrcProfileByPetId = new Map();

const UNKNOWN_TYPE_ID = 20;
// 只有这三张表被前端页面直接 fetch（图鉴进度/属性/配种下蛋率），
// 其余镜像纯浪费 dist 体积，不再复制。
const MIRRORED_TABLE_FILES = [
    "TYPE_DICTIONARY.json",
    "PET_HANDBOOK.json",
    "HOME_PET_LAY_EGG_RATE_CONF.json",
];
const CANONICAL_PETBASE_ID_RANGE = {
    min: 3000,
    maxExclusive: 4000,
};

const RAW_TYPE_TO_NORMALIZED_ID = new Map([
    [2, 1],
    [3, 2],
    [4, 3],
    [5, 4],
    [6, 5],
    [7, 6],
    [8, 6],
    [9, 7],
    [10, 8],
    [11, 9],
    [12, 10],
    [13, 11],
    [14, 12],
    [15, 13],
    [16, 14],
    [17, 15],
    [18, 16],
    [19, 17],
    [20, 18],
]);

const LEGACY_SKILL_TYPE_FIELDS = [
    ["blood_skill_COMMON", 1],
    ["blood_skill_GRASS", 2],
    ["blood_skill_FIRE", 3],
    ["blood_skill_WATER", 4],
    ["blood_skill_LIGHT", 5],
    ["blood_skill_STONE", 6],
    ["blood_skill_ICE", 7],
    ["blood_skill_DRAGON", 8],
    ["blood_skill_ELECTRIC", 9],
    ["blood_skill_TOXIC", 10],
    ["blood_skill_INSECT", 11],
    ["blood_skill_FIGHT", 12],
    ["blood_skill_WING", 13],
    ["blood_skill_MOE", 14],
    ["blood_skill_GHOST", 15],
    ["blood_skill_DEMON", 16],
    ["blood_skill_MECHANIC", 17],
    ["blood_skill_PHANTOM", 18],
];

const PET_LEGACY_MOVE_OVERRIDES = new Map([[3071, new Map([[3, 7040380]])]]);

const EGG_GROUP_LABEL_BY_ID = new Map([
    [1, "未发现"],
    [2, "怪兽"],
    [3, "两栖"],
    [4, "虫"],
    [5, "飞行"],
    [6, "陆上"],
    [7, "妖精"],
    [8, "植物"],
    [9, "人型"],
    [10, "软体"],
    [11, "矿物"],
    [12, "不定形"],
    [13, "鱼"],
    [14, "龙"],
    [15, "机械"],
]);

const UNKNOWN_TYPE = {
    id: UNKNOWN_TYPE_ID,
    name: "Unknown",
    localized: {
        zh: "未知",
    },
};

async function main() {
    await loadNrcProfiles();

    const [
        typeRows,
        petBaseTable,
        handbookTable,
        evolutionTable,
        levelSkillTable,
        skillTable,
        classisTable,
        petEggTable,
        petRandomEggTable,
        petNameMapTable,
        bagItemTable,
        megaMapGatheringTable,
        monsterTable,
        monsterCatchTable,
        rewardTable,
        visualItemTable,
        exchangeTable,
    ] = await Promise.all([
        readJson(typesPath),
        readTable("PETBASE_CONF.json"),
        readTable("PET_HANDBOOK.json"),
        readTable("PET_EVOLUTION_CONF.json"),
        readTable("LEVEL_SKILL_CONF.json"),
        readTable("SKILL_CONF.json"),
        readTable("PET_CLASSIS_CONF.json"),
        readTable("PET_EGG_CONF.json"),
        readTable("PET_RANDOM_EGG_CONF.json"),
        readTable("PET_NAME_MAP_CONF.json"),
        readTable("BAG_ITEM_CONF.json"),
        readTable("MEGAMAP_GATHERING_CONF.json"),
        readTable("MONSTER_CONF.json"),
        readTable("MONSTER_CATCH_CONF.json"),
        readTable("REWARD_CONF.json"),
        readTable("VISUAL_ITEM_CONF.json"),
        readTable("EXCHANGE_CONF.json"),
    ]);

    const typesById = new Map(
        typeRows.map((row) => [
            row.id,
            {
                id: row.id,
                name: row.name,
                localized: {
                    zh: row.localized?.zh ?? UNKNOWN_TYPE.localized.zh,
                },
            },
        ]),
    );
    const petBaseRows = getRows(petBaseTable)
        .filter((row) => typeof row?.id === "number")
        .sort((left, right) => left.id - right.id);
    const borrowedPortraitKeyIds = buildBorrowedPortraitKeyIds(petBaseRows);
    const templateRaceStatIds = buildTemplateRaceStatIds(petBaseRows);
    const handbookRows = getRows(handbookTable);
    const evolutionRows = getRows(evolutionTable);
    const evolutionById = indexBy(evolutionRows);
    const evolutionRowsByFamily = groupBy(evolutionRows, (row) =>
        getEvolutionFamilyKeyFromRow(row, row?.id ?? "default"),
    );
    const levelSkillById = indexBy(getRows(levelSkillTable));
    const skillById = indexBy(getRows(skillTable));
    const classisByPetClassis = new Map(
        getRows(classisTable)
            .filter((row) => typeof row?.pet_classis === "number")
            .map((row) => [row.pet_classis, row]),
    );
    const petEggRows = getRows(petEggTable);
    const petRandomEggRows = getRows(petRandomEggTable);
    const petNameMapById = indexBy(getRows(petNameMapTable));
    const itemById = indexBy(getRows(bagItemTable));
    const gatheringGenreByParamId = new Map(
        getRows(megaMapGatheringTable)
            .filter((row) => Number.isFinite(row?.param_id))
            .map((row) => [
                row.param_id,
                cleanText(row?.genre) ?? cleanText(row?.editor_name) ?? null,
            ])
            .filter((entry) => Boolean(entry[1])),
    );
    const catchInfoByPetBaseId = buildCatchInfoByPetBaseId(
        getRows(monsterTable),
        getRows(monsterCatchTable),
    );
    const handbookByPetBaseId = buildHandbookByPetBaseId(handbookRows);
    const handbookById = indexBy(handbookRows);

    const contexts = petBaseRows.map((petBase) => {
        const handbookRow = pickHandbookRow(
            petBase,
            handbookByPetBaseId.get(petBase.id) ?? [],
            handbookById,
        );
        const speciesGroupIds = uniqueNumbers(
            flattenHandbookPetBaseIds(handbookRow).length
                ? flattenHandbookPetBaseIds(handbookRow)
                : [petBase.id],
        );
        const evolutionRow = pickEvolutionRow(
            petBase,
            speciesGroupIds,
            evolutionById,
        );
        // 贴图沿用的行（JL_res 指向别的精灵）优先取 nrc 立绘 key，
        // 否则整批精灵会显示成同一张图标。nrc 也没有收录时（尚未上线的精灵）
        // 用 id 兜底，让它显示缺图占位，而不是继续顶着别人的图标。
        const borrowedPortrait = borrowedPortraitKeyIds.has(petBase.id);
        const portraitKey = borrowedPortrait
            ? (resolveNrcPortraitKey(petBase.id) ?? String(petBase.id))
            : (extractPortraitKey(petBase.JL_res) ??
              extractPortraitKey(petBase.JL_small_res) ??
              normalizeFallbackName(petNameMapById.get(petBase.id)?.name) ??
              String(petBase.id));

        return {
            id: petBase.id,
            petBase,
            handbookRow,
            speciesGroupIds,
            groupKey: String(
                handbookRow?.id ?? petBase.pictorial_book_id ?? petBase.id,
            ),
            portraitKey,
            displayName: cleanText(petBase.name) ?? String(petBase.id),
            evolutionRow,
            evolutionFamilyKey: getEvolutionFamilyKeyFromRow(
                evolutionRow,
                handbookRow?.id ?? petBase.pictorial_book_id ?? petBase.id,
            ),
            classisRow:
                typeof petBase.pet_classis_id === "number"
                    ? (classisByPetClassis.get(petBase.pet_classis_id) ?? null)
                    : null,
            typePair: buildTypePair(petBase.unit_type, typesById),
        };
    });

    const contextById = new Map(
        contexts.map((context) => [context.id, context]),
    );
    const contextsByGroup = groupBy(contexts, (context) => context.groupKey);
    const leaderFlagById = new Map(
        contexts.map((context) => [
            context.id,
            isLeaderForm(context.petBase, context.portraitKey),
        ]),
    );
    const groupHasLeaderForm = new Map(
        Array.from(contextsByGroup.entries()).map(
            ([groupKey, groupContexts]) => [
                groupKey,
                groupContexts.some((context) => leaderFlagById.get(context.id)),
            ],
        ),
    );

    const details = contexts.map((context) => {
        const evolutionTree = buildEvolutionTree(
            context,
            contextById,
            contextsByGroup,
            evolutionRowsByFamily,
            leaderFlagById,
            typesById,
            skillById,
            itemById,
            gatheringGenreByParamId,
        );
        const evolvesFromId = findEvolvesFromId(
            evolutionTree,
            context.id,
            context.evolutionRow,
        );
        const movePool = buildMovePool(
            levelSkillById.get(context.petBase.level_skill_conf_id),
            skillById,
            typesById,
        );
        const moveStones = buildMoveStones(
            levelSkillById.get(context.petBase.level_skill_conf_id),
            skillById,
            typesById,
        );
        const legacyMoves = buildLegacyMoves(
            context,
            levelSkillById.get(context.petBase.level_skill_conf_id),
            skillById,
            typesById,
        );
        const leaderForm = leaderFlagById.get(context.id) ?? false;
        const breeding = buildBreedingInfo(
            context,
            petEggRows,
            petRandomEggRows,
        );
        const implemented = isImplementedContext(
            context,
            movePool,
            moveStones,
            legacyMoves,
            templateRaceStatIds,
        );

        return {
            id: context.id,
            name: context.portraitKey,
            form: extractForm(context),
            main_type: context.typePair.mainType,
            sub_type: context.typePair.subType,
            default_legacy_type: context.typePair.mainType,
            leader_potential:
                !leaderForm &&
                (groupHasLeaderForm.get(context.groupKey) ?? false),
            is_leader_form: leaderForm,
            preferred_attack_style: resolveAttackStyle(context.petBase),
            localized: {
                zh: {
                    name: context.displayName,
                },
            },
            implemented,
            ...resolveRaceStats(context, templateRaceStatIds),
            evolves_from_id: evolvesFromId,
            species: buildSpecies(context, contextById),
            trait: buildTrait(context.petBase, skillById),
            move_pool: movePool,
            move_stones: moveStones,
            legacy_moves: legacyMoves,
            evolution_tree: evolutionTree,
            world_profile: buildWorldProfile(context),
            catch_info: catchInfoByPetBaseId.get(context.id) ?? null,
            breeding,
            breeding_profile: buildBreedingProfile(context.petBase),
        };
    });

    const indexEntries = details.map((detail) => {
        // breeding（蛋变体数组）占索引体积约 80%，只有配种/孵蛋两页需要，
        // 拆到 PetsBreeding.json 按需加载；breeding_profile（蛋组）很小且多页使用，保留。
        return {
            id: detail.id,
            species_id: detail.species.id,
            name: detail.name,
            form: detail.form,
            main_type: detail.main_type,
            sub_type: detail.sub_type,
            default_legacy_type: detail.default_legacy_type,
            leader_potential: detail.leader_potential,
            is_leader_form: detail.is_leader_form,
            preferred_attack_style: detail.preferred_attack_style,
            localized: detail.localized,
            implemented: detail.implemented,
            base_hp: detail.base_hp,
            base_phy_atk: detail.base_phy_atk,
            base_mag_atk: detail.base_mag_atk,
            base_phy_def: detail.base_phy_def,
            base_mag_def: detail.base_mag_def,
            base_spd: detail.base_spd,
            evolves_from_id: detail.evolves_from_id,
            breeding_profile: detail.breeding_profile,
        };
    });
    const petsBreedingMap = {};
    for (const detail of details) {
        if (detail.breeding) {
            petsBreedingMap[detail.id] = detail.breeding;
        }
    }
    const bloodlineIndexEntries = details.map((detail) => ({
        // 图鉴的血脉关键词匹配只用 pet_id、pet_name 与技能名/系别标签，
        // 全量 move 摘要（含图标、威力能耗）会让文件膨胀到数 MB。
        pet_id: detail.id,
        pet_name: detail.localized.zh.name,
        implemented: detail.implemented,
        bloodline_moves: detail.legacy_moves
            .map((entry) => {
                const move = buildBloodlineMoveSummary(entry, skillById, typesById);
                if (!move) {
                    return null;
                }
                return {
                    move_id: move.move_id,
                    move_name: move.move_name,
                    type_label: move.type_label,
                };
            })
            .filter(Boolean),
    }));
    const petSkillCatalogById = new Map();
    const petSkillIndexEntries = details.map((detail) => {
        registerPetSkillCatalog(detail.move_pool, petSkillCatalogById);
        registerPetSkillCatalog(detail.move_stones, petSkillCatalogById);

        return {
            pet_id: detail.id,
            move_pool_ids: detail.move_pool.map((move) => move.id),
            move_stone_ids: detail.move_stones.map((move) => move.id),
        };
    });
    const petSkillCatalogEntries = Array.from(
        petSkillCatalogById.values(),
    ).sort(
        (left, right) =>
            left.name.localeCompare(right.name, "zh-CN") || left.id - right.id,
    );

    // 技能图标映射：moves.json 这类技能索引不带图标，技能图鉴页需要按技能名取图；
    // 图标 id 从宠物技能池（升级/技能石/血脉）里收集，与详情页显示口径一致。
    const moveIconByName = {};

    for (const detail of details) {
        const skillPools = [
            ...detail.move_pool,
            ...detail.move_stones,
            ...detail.legacy_moves.map((entry) => entry?.move).filter(Boolean),
        ];

        for (const move of skillPools) {
            if (move?.name && move.icon_id && !moveIconByName[move.name]) {
                moveIconByName[move.name] = move.icon_id;
            }
        }
    }

    // 兜底：技能图鉴页收录的是官方技能表，其中有些技能不出现在任何精灵的技能池里
    // （例如「恶念交换」），只靠上面的技能池收集会漏图。SKILL_CONF 自带 icon 字段，
    // 按技能名补齐即可，已有的映射不覆盖（技能池口径优先）。
    for (const skill of getRows(skillTable)) {
        const name = cleanText(skill?.name);
        const iconId = extractIconId(skill?.icon);

        if (name && iconId && !moveIconByName[name]) {
            moveIconByName[name] = iconId;
        }
    }

    const itemLabelTypeTable = await readTable("ITEM_LABLE_TYPE_CONF.json");
    const itemCategories = buildItemCategories(getRows(itemLabelTypeTable));
    const evolutionItemUsage = buildEvolutionItemUsageFromRaw(
        petBaseRows,
        contexts,
    );
    const alchemyRecipes = buildAlchemyRecipes(
        getRows(exchangeTable),
        itemById,
    );
    const itemEntries = buildItemEntries(
        getRows(bagItemTable),
        itemCategories,
        evolutionItemUsage,
        skillById,
        alchemyRecipes,
    );
    const handbookRewards = buildHandbookRewards(
        handbookRows,
        rewardTable,
        visualItemTable,
        itemById,
    );
    const handbookTopicSkillNames = buildHandbookTopicSkillNames(
        handbookRows,
        skillById,
    );

    await syncMirroredTables();
    await fs.mkdir(petsDetailDir, { recursive: true });
    await cleanGeneratedPetDetails();
    // 索引与查表大文件走紧凑 JSON：缩进对这类机器消费的文件是纯浪费。
    await writeJson(petsIndexPath, indexEntries, { compact: true });
    await writeJson(petsBreedingPath, petsBreedingMap, { compact: true });
    await writeJson(bloodlineIndexPath, bloodlineIndexEntries, { compact: true });
    await writeJson(petSkillIndexPath, {
        entries: petSkillIndexEntries,
        skills: petSkillCatalogEntries,
    }, { compact: true });
    await Promise.all([
        ...details.map((detail) => {
            return writeJson(
                path.join(petsDetailDir, `${detail.id}.json`),
                detail,
                { compact: true },
            );
        }),
        writeJson(itemsIndexPath, itemEntries, { compact: true }),
        writeJson(moveIconsPath, moveIconByName, { compact: true }),
        writeJson(handbookRewardsPath, handbookRewards, { compact: true }),
        writeJson(handbookTopicSkillNamesPath, handbookTopicSkillNames, { compact: true }),
    ]);

    console.log(
        `Generated ${indexEntries.length} pet index entries, ${details.length} pet detail files, and ${itemEntries.length} item entries from BinData.`,
    );
}

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
}

// nrc-pets.json 由 sync:nrc-data 生成；缺失时静默跳过覆盖，
// 保证本脚本在没有 wiki 数据的环境下仍可独立运行。
async function loadNrcProfiles() {
    nrcProfileByPetId.clear();

    let payload;

    try {
        payload = await readJson(nrcPetsPath);
    } catch {
        console.warn(
            "未找到 nrc-pets.json，图鉴文案将回退到解包字段，建议先运行 npm run sync:nrc-data。",
        );
        return;
    }

    for (const [gameId, entry] of Object.entries(payload?.entries ?? {})) {
        const petId = Number(gameId);

        if (!Number.isFinite(petId)) {
            continue;
        }

        nrcProfileByPetId.set(petId, entry);
    }

    console.log(`已载入 nrc 图鉴文案 ${nrcProfileByPetId.size} 条。`);
}

// 物种名优先级：nrc entry_name > 本体名；绝不使用错位的手册 name。
function resolveNrcSpeciesName(context) {
    const own = nrcProfileByPetId.get(context.id);

    if (cleanText(own?.entry_name)) {
        return cleanText(own.entry_name);
    }

    // 同一物种的其他形态（如圣光迪莫 → 迪莫）也能提供物种名。
    for (const petId of context.speciesGroupIds) {
        const entry = nrcProfileByPetId.get(petId);

        if (cleanText(entry?.entry_name)) {
            return cleanText(entry.entry_name);
        }
    }

    return null;
}

// 解包表里有一批尚未完工的行：JL_res 直接沿用了上一只精灵的贴图路径，
// 种族值也整批共用同一组模板值（3747 之后那批即如此，表现为「同图标、同种族值」）。
// 这些精灵在 nrc WIKI 上已有正式立绘与种族值，因此按 PETBASE id 用 nrc 覆盖。
function resolveNrcPortraitKey(petId) {
    const illustration = nrcProfileByPetId.get(petId)?.illustration;

    if (typeof illustration !== "string") {
        return null;
    }

    const match = illustration.match(/^PetPortrait_(.+)\.png$/u);
    return match ? match[1] : null;
}

// nrc 的 stats 字段语义：spa=魔攻、spd=魔防、spe=速度（已用 completeness=1 的样本核对）。
function resolveNrcRaceStats(petId) {
    const stats = nrcProfileByPetId.get(petId)?.stats;

    if (!stats || typeof stats !== "object") {
        return null;
    }

    const mapped = {
        base_hp: stats.hp,
        base_phy_atk: stats.atk,
        base_mag_atk: stats.spa,
        base_phy_def: stats.def,
        base_mag_def: stats.spd,
        base_spd: stats.spe,
    };

    return Object.values(mapped).every((value) => typeof value === "number")
        ? mapped
        : null;
}

// 种族值优先级：解包值可信时直接用；命中模板值（整批共用同一组）时改用 nrc。
function resolveRaceStats(context, templateRaceStatIds) {
    if (templateRaceStatIds.has(context.id)) {
        const fromNrc = resolveNrcRaceStats(context.id);

        if (fromNrc) {
            return fromNrc;
        }
    }

    return {
        base_hp: normalizeStat(context.petBase.hp_max_race),
        base_phy_atk: normalizeStat(context.petBase.phy_attack_race),
        base_mag_atk: normalizeStat(context.petBase.spe_attack_race),
        base_phy_def: normalizeStat(context.petBase.phy_defence_race),
        base_mag_def: normalizeStat(context.petBase.spe_defence_race),
        base_spd: normalizeStat(context.petBase.speed_race),
    };
}

// 判断某个立绘 key 是否被「另一只不同名的精灵」占用：这正是贴图沿用的特征。
// 首领形态之间共用 key（多行同名）属正常，不算冲突。
function buildBorrowedPortraitKeyIds(petBaseRows) {
    const namesByKey = new Map();

    for (const petBase of petBaseRows) {
        const key =
            extractPortraitKey(petBase.JL_res) ??
            extractPortraitKey(petBase.JL_small_res);

        if (!key) {
            continue;
        }

        if (!namesByKey.has(key)) {
            namesByKey.set(key, new Set());
        }

        namesByKey.get(key).add(cleanText(petBase.name) ?? String(petBase.id));
    }

    const borrowedIds = new Set();

    for (const petBase of petBaseRows) {
        // 只判图鉴号段：首领 / 副本形态本来就与「首领-魔力猫」「卡图斯」等
        // 不同名的行共用一张贴图，那是正常复用，不是未完工的沿用。
        if (!isCanonicalCollectiblePetBaseId(petBase.id)) {
            continue;
        }

        const key =
            extractPortraitKey(petBase.JL_res) ??
            extractPortraitKey(petBase.JL_small_res);

        if (key && (namesByKey.get(key)?.size ?? 0) > 1) {
            borrowedIds.add(petBase.id);
        }
    }

    return borrowedIds;
}

// 未完工行的另一特征：种族值整批共用同一组模板值（3747 之后那批共用 108 行）。
// 阈值取 5：正式精灵之间偶有重复（如迪莫的多个形态共 5 行），但不会成批出现。
const TEMPLATE_RACE_STAT_MIN_SHARE = 5;

function buildRaceStatSignature(petBase) {
    return [
        petBase?.hp_max_race,
        petBase?.phy_attack_race,
        petBase?.spe_attack_race,
        petBase?.phy_defence_race,
        petBase?.spe_defence_race,
        petBase?.speed_race,
    ]
        .map((value) => value ?? "")
        .join("/");
}

function buildTemplateRaceStatIds(petBaseRows) {
    const shareCount = new Map();

    for (const petBase of petBaseRows) {
        const signature = buildRaceStatSignature(petBase);
        shareCount.set(signature, (shareCount.get(signature) ?? 0) + 1);
    }

    const templateIds = new Set();

    for (const petBase of petBaseRows) {
        const signature = buildRaceStatSignature(petBase);

        // 全空签名是首领形态那类数据，种族值本就不在这张表里，不做覆盖。
        if (!/\d/u.test(signature)) {
            continue;
        }

        if ((shareCount.get(signature) ?? 0) >= TEMPLATE_RACE_STAT_MIN_SHARE) {
            templateIds.add(petBase.id);
        }
    }

    return templateIds;
}

async function readTable(fileName) {
    return readJson(path.join(binDataDir, fileName));
}

function getRows(tablePayload) {
    return Object.values(tablePayload?.RocoDataRows ?? {});
}

function indexBy(rows, key = "id") {
    const map = new Map();

    for (const row of rows) {
        const value = row?.[key];

        if (value !== null && value !== undefined) {
            map.set(value, row);
        }
    }

    return map;
}

function groupBy(items, getKey) {
    const groups = new Map();

    for (const item of items) {
        const key = getKey(item);
        const bucket = groups.get(key) ?? [];
        bucket.push(item);
        groups.set(key, bucket);
    }

    return groups;
}

function normalizeArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (value === null || value === undefined) {
        return [];
    }

    return [value];
}

function uniqueNumbers(values) {
    return [...new Set(values.filter((value) => Number.isFinite(value)))].sort(
        (left, right) => left - right,
    );
}

function cleanText(value) {
    if (typeof value !== "string") {
        return null;
    }

    const cleaned = value
        .replace(/<[^>]*>/g, "")
        .replace(/\r\n/g, "\n")
        // 解包文案里混有零宽字符（如霹雳迪迪名字前的两个 U+200B）。JS 的 \s
        // 不匹配 U+200B/200C/200D/2060，留着它们名字看着正常但按名匹配全落空：
        // 精灵详情页用中文名去 pokedex-official.json 取官方描述/栖息地，会取不到。
        .replace(/[\u200B-\u200D\u2060]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    return cleaned || null;
}

function normalizeFallbackName(value) {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.replace(/[^A-Za-z0-9_]/g, "").toLowerCase();
    return normalized || null;
}

function extractPortraitKey(resourcePath) {
    if (typeof resourcePath !== "string") {
        return null;
    }

    const match = resourcePath.match(/(JL_[^./']+)\.(?:JL_[^']+)'/u);

    if (!match) {
        return null;
    }

    return match[1].replace(/^JL_/, "");
}

function flattenHandbookPetBaseIds(handbookRow) {
    const ids = [];

    for (const item of normalizeArray(handbookRow?.include_petbase_id)) {
        for (const petBaseId of normalizeArray(item?.petbase_id)) {
            if (Number.isFinite(petBaseId)) {
                ids.push(petBaseId);
            }
        }
    }

    return uniqueNumbers(ids);
}

function buildHandbookByPetBaseId(handbookRows) {
    const map = new Map();

    for (const row of handbookRows) {
        for (const petBaseId of flattenHandbookPetBaseIds(row)) {
            const bucket = map.get(petBaseId) ?? [];
            bucket.push(row);
            map.set(petBaseId, bucket);
        }
    }

    return map;
}

function buildCatchInfoByPetBaseId(monsterRows, monsterCatchRows) {
    const catchById = indexBy(monsterCatchRows);

    const candidatesByBaseId = new Map();

    for (const monster of monsterRows) {
        const baseId = monster?.base_id;

        if (!Number.isFinite(baseId) || !Number.isFinite(monster?.id)) {
            continue;
        }

        const catchRow = catchById.get(monster.id);

        if (!catchRow) {
            continue;
        }

        const bucket = candidatesByBaseId.get(baseId) ?? [];
        bucket.push(catchRow);
        candidatesByBaseId.set(baseId, bucket);
    }

    const result = new Map();

    for (const [baseId, candidates] of candidatesByBaseId) {
        const best =
            candidates.find((row) => Number.isFinite(row.Catch_Threshold)) ??
            candidates[0];

        result.set(baseId, {
            catch_threshold:
                typeof best.Catch_Threshold === "number"
                    ? best.Catch_Threshold
                    : null,
            catch_guarant_rate:
                typeof best.catch_guarant_rate === "number"
                    ? best.catch_guarant_rate
                    : null,
            catch_ball_level:
                typeof best.Catch_Ball_level === "number"
                    ? best.Catch_Ball_level
                    : null,
        });
    }

    return result;
}

function pickHandbookRow(petBase, candidates, handbookById) {
    if (candidates.length === 1) {
        return candidates[0];
    }

    if (candidates.length > 1) {
        const exactMatch = candidates.find((candidate) => {
            return cleanText(candidate.name) === cleanText(petBase.name);
        });

        return exactMatch ?? candidates[0];
    }

    if (typeof petBase.pictorial_book_id === "number") {
        return handbookById.get(petBase.pictorial_book_id) ?? null;
    }

    return null;
}

function pickEvolutionRow(petBase, speciesGroupIds, evolutionById) {
    for (const evolutionId of normalizeArray(petBase.pet_evolution_id)) {
        const row = evolutionById.get(evolutionId);

        if (row) {
            return row;
        }
    }

    const speciesGroupIdSet = new Set(speciesGroupIds);

    for (const row of evolutionById.values()) {
        const chainIds = normalizeArray(row?.evolution_chain)
            .map((item) => item?.petbase_id)
            .filter((value) => Number.isFinite(value));

        if (chainIds.includes(petBase.id)) {
            return row;
        }

        if (chainIds.some((chainId) => speciesGroupIdSet.has(chainId))) {
            return row;
        }
    }

    return null;
}

function getEvolutionFamilyKeyFromRow(evolutionRow, fallbackKey) {
    const familyKey =
        evolutionRow?.evolution_group ??
        evolutionRow?.handbook_evolution_group ??
        evolutionRow?.statistics_evolution_group;

    if (Number.isFinite(familyKey)) {
        return `family:${familyKey}`;
    }

    if (Number.isFinite(evolutionRow?.id)) {
        return `row:${evolutionRow.id}`;
    }

    return `fallback:${String(fallbackKey)}`;
}

function buildTypePair(rawTypes, typesById) {
    const normalizedTypeIds = [];

    for (const rawType of uniqueNumbers(normalizeArray(rawTypes))) {
        const normalizedId =
            RAW_TYPE_TO_NORMALIZED_ID.get(rawType) ?? UNKNOWN_TYPE_ID;

        if (!normalizedTypeIds.includes(normalizedId)) {
            normalizedTypeIds.push(normalizedId);
        }
    }

    const mainType = cloneType(
        typesById.get(normalizedTypeIds[0]) ?? UNKNOWN_TYPE,
    );
    const subType = normalizedTypeIds[1]
        ? cloneType(typesById.get(normalizedTypeIds[1]) ?? UNKNOWN_TYPE)
        : null;

    return {
        mainType,
        subType,
    };
}

function cloneType(type) {
    return {
        id: type.id,
        name: type.name,
        localized: {
            zh: type.localized.zh,
        },
    };
}

function isLeaderForm(petBase, portraitKey) {
    return (
        Boolean(petBase?.is_boss) || /(?:_shouling|_boss)$/u.test(portraitKey)
    );
}

function extractForm(context) {
    const handbookName = cleanText(context.handbookRow?.name);
    const displayName = context.displayName;
    const wrapped = displayName.match(/[（(]([^）)]+)[）)]/u);

    if (wrapped?.[1]) {
        return wrapped[1].trim();
    }

    if (!handbookName || handbookName === displayName) {
        return "default";
    }

    if (displayName.endsWith(handbookName)) {
        const prefix = displayName
            .slice(0, displayName.length - handbookName.length)
            .trim();

        if (prefix) {
            return prefix;
        }
    }

    if (displayName.startsWith(handbookName)) {
        const suffix = displayName.slice(handbookName.length).trim();

        if (suffix) {
            return suffix;
        }
    }

    return displayName;
}

function normalizeStat(value) {
    return typeof value === "number" ? value : 0;
}

function resolveAttackStyle(petBase) {
    const physicalAttack = normalizeStat(petBase.phy_attack_race);
    const magicalAttack = normalizeStat(petBase.spe_attack_race);
    const delta = physicalAttack - magicalAttack;

    if (Math.abs(delta) <= 10) {
        return "Both";
    }

    return delta > 0 ? "Physical" : "Magic";
}

function isCanonicalCollectiblePetBaseId(id) {
    return (
        typeof id === "number" &&
        id >= CANONICAL_PETBASE_ID_RANGE.min &&
        id < CANONICAL_PETBASE_ID_RANGE.maxExclusive
    );
}

function hasBattleContent(movePool, moveStones, legacyMoves) {
    return (
        movePool.length > 0 || moveStones.length > 0 || legacyMoves.length > 0
    );
}

function hasHandbookPresentationAssets(petBase) {
    return (
        typeof petBase?.handbook_standpaint_bg === "string" ||
        typeof petBase?.handbook_unknown_bg === "string"
    );
}

function hasCanonicalHandbookPresentation(context) {
    return (
        isCanonicalCollectiblePetBaseId(context.id) &&
        typeof context.petBase?.pictorial_book_id === "number" &&
        hasHandbookPresentationAssets(context.petBase)
    );
}

function hasCanonicalBreedingSignals(context) {
    return (
        isCanonicalCollectiblePetBaseId(context.id) &&
        uniqueNumbers(normalizeArray(context.petBase?.egg_group)).length > 0
    );
}

// 解包表里残留的未完工行：种族值是整批共用的模板值，nrc WIKI 上也查不到条目
// （既没有正式立绘，也没有种族值）。这类行没有任何可展示内容，
// 留在图鉴里只会显示成「借用别人图标 + 假面板」，因此不计入已实装。
function isUnreleasedTemplateRow(context, templateRaceStatIds) {
    return (
        templateRaceStatIds.has(context.id) &&
        !nrcProfileByPetId.has(context.id) &&
        !resolveNrcRaceStats(context.id)
    );
}

function isImplementedContext(
    context,
    movePool,
    moveStones,
    legacyMoves,
    templateRaceStatIds,
) {
    if (isUnreleasedTemplateRow(context, templateRaceStatIds)) {
        return false;
    }

    // BinData does not expose one stable `is_released` flag. The most reliable
    // rule is a split by content type:
    // - canonical collectible pets: battle-ready and backed by either
    //   completeness, handbook mapping, handbook presentation assets, or egg-group
    //   breeding signals;
    // - released leader/boss forms: boss entries with a base-species pictorial
    //   link and handbook presentation assets.
    const canonicalCollectibleImplemented =
        isCanonicalCollectiblePetBaseId(context.id) &&
        hasBattleContent(movePool, moveStones, legacyMoves) &&
        (context.petBase?.completeness === 1 ||
            context.handbookRow !== null ||
            hasCanonicalHandbookPresentation(context) ||
            hasCanonicalBreedingSignals(context));

    const releasedBossFormImplemented =
        context.petBase?.is_boss === 1 &&
        typeof context.petBase?.pictorial_book_id === "number" &&
        hasHandbookPresentationAssets(context.petBase);

    return canonicalCollectibleImplemented || releasedBossFormImplemented;
}

function buildSpecies(context, contextById) {
    const speciesPetId =
        context.speciesGroupIds.find((petId) => contextById.has(petId)) ??
        context.id;
    const speciesContext = contextById.get(speciesPetId) ?? context;

    return {
        id:
            context.handbookRow?.id ??
            context.petBase.pictorial_book_id ??
            context.id,
        name: speciesContext.portraitKey,
        localized: {
            zh: resolveNrcSpeciesName(context) ?? speciesContext.displayName,
        },
    };
}

function buildTrait(petBase, skillById) {
    const skillId =
        petBase.pet_feature ??
        petBase.pet_glass_feature ??
        petBase.pet_chaos_feature;
    const skill = skillById.get(skillId);

    if (!skill) {
        return null;
    }

    const name = cleanText(skill.name) ?? `特性 ${skillId}`;
    const description = cleanText(skill.desc) ?? "";

    return {
        id: skill.id,
        name,
        description,
        icon_id: extractIconId(skill.icon) ?? null,
        localized: {
            zh: {
                name,
                description,
            },
        },
    };
}

function buildMovePool(levelSkillRow, skillById, typesById) {
    const entries = normalizeArray(levelSkillRow?.level)
        .filter((entry) => Number.isFinite(entry?.param))
        .sort((left, right) => {
            return (
                normalizeStat(left.level_point) -
                    normalizeStat(right.level_point) || left.param - right.param
            );
        });
    const seenSkillIds = new Set();
    const moves = [];

    for (const entry of entries) {
        if (seenSkillIds.has(entry.param)) {
            continue;
        }

        const move = buildMove(
            skillById.get(entry.param),
            typesById,
            entry.param,
        );

        if (!move) {
            continue;
        }

        seenSkillIds.add(entry.param);
        moves.push(move);
    }

    return moves;
}

function buildMoveStones(levelSkillRow, skillById, typesById) {
    const seenSkillIds = new Set();
    const moves = [];

    for (const entry of normalizeArray(levelSkillRow?.machine_skill_group)) {
        const skillId = entry?.machine_skill_id;

        if (!Number.isFinite(skillId) || seenSkillIds.has(skillId)) {
            continue;
        }

        const move = buildMove(skillById.get(skillId), typesById, skillId, {
            fallbackName: cleanText(entry.machine_skill_name) ?? null,
        });

        if (!move) {
            continue;
        }

        seenSkillIds.add(skillId);
        moves.push(move);
    }

    return moves;
}

function buildLegacyMoves(context, levelSkillRow, skillById, typesById) {
    const entries = [];

    for (const [fieldName, typeId] of LEGACY_SKILL_TYPE_FIELDS) {
        const skillId = levelSkillRow?.[fieldName];

        if (!Number.isFinite(skillId) || !skillById.get(skillId)) {
            continue;
        }

        entries.push({
            monster_id: context.id,
            type_id: typeId,
            move_id: skillId,
            move: buildMove(skillById.get(skillId), typesById, skillId) ?? null,
        });
    }

    const overrides = PET_LEGACY_MOVE_OVERRIDES.get(context.id);

    if (!overrides) {
        return entries;
    }

    const entryByTypeId = new Map(
        entries.map((entry) => [entry.type_id, entry]),
    );

    for (const [typeId, moveId] of overrides.entries()) {
        const skill = skillById.get(moveId);

        if (!skill) {
            continue;
        }

        const nextEntry = {
            monster_id: context.id,
            type_id: typeId,
            move_id: moveId,
            move: buildMove(skill, typesById, moveId) ?? null,
        };

        if (entryByTypeId.has(typeId)) {
            entries[entries.findIndex((entry) => entry.type_id === typeId)] =
                nextEntry;
            entryByTypeId.set(typeId, nextEntry);
            continue;
        }

        entries.push(nextEntry);
        entryByTypeId.set(typeId, nextEntry);
    }

    entries.sort((left, right) => left.type_id - right.type_id);
    return entries;
}

function buildBloodlineMoveSummary(entry, skillById, typesById) {
    const move = buildMove(
        skillById.get(entry.move_id),
        typesById,
        entry.move_id,
    );

    if (!move) {
        return null;
    }

    const legacyType = typesById.get(entry.type_id) ?? UNKNOWN_TYPE;

    return {
        type_id: entry.type_id,
        type_name: legacyType.name,
        type_label: legacyType.localized.zh,
        move_id: move.id,
        move_name: move.localized.zh.name,
        move_category: move.move_category,
        energy_cost: move.energy_cost,
        power: move.power,
    };
}

function registerPetSkillCatalog(moves, catalogById) {
    for (const move of moves) {
        if (!Number.isFinite(move?.id) || catalogById.has(move.id)) {
            continue;
        }

        catalogById.set(move.id, {
            id: move.id,
            name: move.localized?.zh?.name ?? move.name ?? `技能 ${move.id}`,
            type_label:
                move.move_type?.localized?.zh ?? UNKNOWN_TYPE.localized.zh,
            move_category: move.move_category,
        });
    }
}

function buildHandbookRewards(
    handbookRows,
    rewardTable,
    visualItemTable,
    bagItemById,
) {
    const rewardById = rewardTable?.RocoDataRows ?? {};
    const visualItemById = visualItemTable?.RocoDataRows ?? {};
    const rewardIds = new Set();

    for (const row of handbookRows) {
        for (const topic of normalizeArray(row.pet_topic)) {
            if (Number.isFinite(topic?.topic_reward)) {
                rewardIds.add(topic.topic_reward);
            }
        }
    }

    const result = {};

    for (const rewardId of rewardIds) {
        const rewardRow = rewardById[String(rewardId)];

        if (!rewardRow) {
            continue;
        }

        const items = [];

        for (const entry of normalizeArray(rewardRow.RewardItem)) {
            const type = entry?.Type;
            const id = entry?.Id;
            const count = entry?.Count ?? 1;

            if (!Number.isFinite(type) || !Number.isFinite(id)) {
                continue;
            }

            if (type === 1) {
                const bagItem = bagItemById.get(id);
                const name = cleanText(bagItem?.name) ?? `道具 ${id}`;
                const iconId = extractIconId(bagItem?.icon);

                items.push({ type, id, name, icon_id: iconId, count });
            } else if (type === 2) {
                const visualItem = visualItemById[String(id)];
                const name = cleanText(visualItem?.displayName) ?? `资源 ${id}`;
                const iconId =
                    extractIconId(visualItem?.bigIcon) ??
                    extractIconId(visualItem?.iconPath);

                items.push({ type, id, name, icon_id: iconId, count });
            }
        }

        if (items.length > 0) {
            result[rewardId] = items;
        }
    }

    return result;
}

function buildHandbookTopicSkillNames(handbookRows, skillById) {
    const skillIds = new Set();

    for (const row of handbookRows) {
        for (const topic of normalizeArray(row.pet_topic)) {
            if (topic?.topic_type !== 4) {
                continue;
            }

            for (const skillId of normalizeArray(topic.topic_data_1)) {
                if (Number.isFinite(skillId)) {
                    skillIds.add(skillId);
                }
            }
        }
    }

    const result = {};

    for (const skillId of skillIds) {
        const skill = skillById.get(skillId);
        result[skillId] = cleanText(skill?.name) ?? `技能 ${skillId}`;
    }

    return result;
}

const MOVE_EFFECT_TEXT_PATTERN =
    /(造成|对敌方|敌方|自己|回复|恢复|获得|减伤|连击|本技能|魔法伤害|物理伤害|物伤|魔伤|消耗|能量|速度|物攻|魔攻|物防|魔防|威力|命中|应对|印记|萌化|睡眠|中毒|烧伤|暴击|先手|后手|生命|回合|下次|本次|永久|打断|蓄力|吸血|脱离|交换|失去|赋予|翻倍|冷却|眩晕|冻结|变成|无法更换)/;

function looksLikeMoveEffectText(text) {
    return typeof text === "string" && MOVE_EFFECT_TEXT_PATTERN.test(text);
}

function resolveMoveText(skill, fallbackSkillId, options = {}) {
    const skillId = skill?.id ?? fallbackSkillId;
    const rawName = cleanText(skill?.name);
    const rawDescription = cleanText(skill?.desc);
    const flavorText = cleanText(skill?.flavor_text);
    const fallbackName = cleanText(options.fallbackName);

    if (
        rawName &&
        flavorText &&
        looksLikeMoveEffectText(rawName) &&
        !looksLikeMoveEffectText(rawDescription)
    ) {
        return {
            name: flavorText,
            description: rawName,
        };
    }

    return {
        name: rawName ?? fallbackName ?? `技能 ${skillId}`,
        description: rawDescription ?? "",
    };
}

function buildMove(skill, typesById, fallbackSkillId, options = {}) {
    const skillId = skill?.id ?? fallbackSkillId;

    if (!Number.isFinite(skillId)) {
        return null;
    }

    const { name, description } = resolveMoveText(
        skill,
        fallbackSkillId,
        options,
    );
    const moveType = buildMoveType(skill?.skill_dam_type, typesById);

    return {
        id: skillId,
        name,
        icon_id: extractIconId(skill?.icon) ?? null,
        move_type: moveType,
        localized: {
            zh: {
                name,
                description,
            },
        },
        move_category: resolveMoveCategory(skill),
        energy_cost: firstNumericValue(skill?.energy_cost) ?? 0,
        power: resolveMovePower(skill),
        description,
    };
}

function buildMoveType(rawTypeId, typesById) {
    const normalizedId =
        RAW_TYPE_TO_NORMALIZED_ID.get(rawTypeId) ?? UNKNOWN_TYPE_ID;
    return cloneType(typesById.get(normalizedId) ?? UNKNOWN_TYPE);
}

function resolveMoveCategory(skill) {
    if (skill?.Skill_Type === 3) {
        return "Defense";
    }

    if (skill?.Skill_Type === 2) {
        return "Status";
    }

    if (skill?.damage_type === 3) {
        return "Magic Attack";
    }

    if (skill?.damage_type === 2) {
        return "Physical Attack";
    }

    return "Status";
}

function resolveMovePower(skill) {
    const power = firstNumericValue(skill?.dam_para);
    return typeof power === "number" && power > 0 ? power : null;
}

function firstNumericValue(value) {
    if (Array.isArray(value)) {
        return value.find((entry) => typeof entry === "number") ?? null;
    }

    return typeof value === "number" ? value : null;
}

// pet_track_fail_desc 是游戏内追踪失败时的提示语（「由于昼夜或者天气的原因…」），
// 不是刷新地点。实测 532 只已实装精灵全部只有这句提示，写进 refresh_locations
// 会让页面把提示语当产地展示，因此这类文案一律丢弃。
const REFRESH_HINT_NOISE = /(还没有出现|昼夜|天气的原因|暂未|未开放)/;

function buildWorldProfile(context) {
    const refreshHint = cleanText(context.petBase.pet_track_fail_desc);
    const refreshLocations =
        refreshHint && !REFRESH_HINT_NOISE.test(refreshHint)
            ? [refreshHint]
            : [];

    const nrcProfile = nrcProfileByPetId.get(context.id) ?? null;

    return {
        // 手册表这两列存在整体错位，一律取 nrc WIKI 的 title / habitat。
        type_desc: cleanText(nrcProfile?.title) ?? null,
        description_habitat: cleanText(nrcProfile?.habitat) ?? null,
        handbook_areas: Array.isArray(nrcProfile?.areas)
            ? nrcProfile.areas.filter((area) => typeof area === "string")
            : [],
        introduction:
            cleanText(nrcProfile?.description) ??
            cleanText(context.petBase.description),
        refresh_locations: refreshLocations,
        movement_type: cleanText(context.petBase.move_type),
        classis_id:
            typeof context.petBase.pet_classis_id === "number"
                ? context.petBase.pet_classis_id
                : null,
        classis_name: cleanText(context.classisRow?.name),
        handbook_area_ids: uniqueNumbers(
            normalizeArray(context.handbookRow?.belong_area_handbook),
        ),
    };
}

function buildBreedingProfile(petBase) {
    const eggGroups = uniqueNumbers(normalizeArray(petBase.egg_group));
    const proportionMale =
        typeof petBase.proportion_male === "number"
            ? petBase.proportion_male
            : null;
    const maleRate = normalizeGenderRate(proportionMale);

    return {
        pet_base_id: typeof petBase.id === "number" ? petBase.id : null,
        egg_groups: eggGroups,
        proportion_male: proportionMale,
        male_rate: maleRate,
        female_rate: maleRate === null ? null : Math.max(0, 100 - maleRate),
    };
}

function normalizeGenderRate(proportionMale) {
    if (typeof proportionMale !== "number") {
        return null;
    }

    if (proportionMale >= 0 && proportionMale <= 10) {
        return Math.round(proportionMale * 10);
    }

    if (proportionMale >= 0 && proportionMale <= 100) {
        return Math.round(proportionMale);
    }

    return null;
}

function buildBreedingInfo(context, petEggRows, petRandomEggRows) {
    const eggVariants = collectEggVariants(
        context,
        petEggRows,
        petRandomEggRows,
    );

    if (!eggVariants.length) {
        return null;
    }

    return {
        ...eggVariants[0],
        variants: eggVariants,
    };
}

function collectEggVariants(context, petEggRows, petRandomEggRows) {
    const primaryVariants = collectEggVariantsFromSource(context, petEggRows);

    if (primaryVariants.length) {
        return primaryVariants;
    }

    return collectEggVariantsFromSource(context, petRandomEggRows);
}

function collectEggVariantsFromSource(context, rows) {
    const prefix = String(context.id);
    const seenVariantIds = new Set();
    const variants = [];

    for (const row of rows) {
        if (
            !isEggVariantForPet(
                row,
                prefix,
                context.displayName,
                context.handbookRow?.name,
            )
        ) {
            continue;
        }

        const variant = buildEggVariant(row);

        if (!variant || seenVariantIds.has(variant.id ?? variant.pet_id)) {
            continue;
        }

        seenVariantIds.add(variant.id ?? variant.pet_id);
        variants.push(variant);
    }

    return variants.sort((left, right) => {
        return (left.id ?? left.pet_id ?? 0) - (right.id ?? right.pet_id ?? 0);
    });
}

function isEggVariantForPet(row, petBaseIdPrefix, displayName, handbookName) {
    const idValues = [row?.id, row?.pet_id, row?.model_id]
        .filter((value) => value !== null && value !== undefined)
        .map((value) => String(value));

    if (idValues.some((value) => value.startsWith(petBaseIdPrefix))) {
        return true;
    }

    const rowName = cleanText(row?.name);
    const names = [cleanText(displayName), cleanText(handbookName)].filter(
        Boolean,
    );

    return rowName !== null && names.includes(rowName);
}

function buildEggVariant(row) {
    if (!row || (row.id === undefined && row.pet_id === undefined)) {
        return null;
    }

    return {
        id: typeof row.id === "number" ? row.id : null,
        pet_id: typeof row.pet_id === "number" ? row.pet_id : null,
        name: cleanText(row.name),
        model_id: typeof row.model_id === "number" ? row.model_id : null,
        hatch_data: typeof row.hatch_data === "number" ? row.hatch_data : null,
        weight_low: typeof row.weight_low === "number" ? row.weight_low : null,
        weight_high:
            typeof row.weight_high === "number" ? row.weight_high : null,
        height_low: typeof row.height_low === "number" ? row.height_low : null,
        height_high:
            typeof row.height_high === "number" ? row.height_high : null,
        precious_egg_type:
            typeof row.precious_egg_type === "number"
                ? row.precious_egg_type
                : null,
        egg_base_glass_prob_array: Array.isArray(row.egg_base_glass_prob_array)
            ? row.egg_base_glass_prob_array
            : null,
        egg_add_glass_prob_array: Array.isArray(row.egg_add_glass_prob_array)
            ? row.egg_add_glass_prob_array
            : null,
        is_contact_add_glass_prob:
            typeof row.is_contact_add_glass_prob === "boolean"
                ? row.is_contact_add_glass_prob
                : null,
        is_contact_add_shining_prob:
            typeof row.is_contact_add_shining_prob === "boolean"
                ? row.is_contact_add_shining_prob
                : null,
    };
}

function buildEvolutionTree(
    context,
    contextById,
    contextsByGroup,
    evolutionRowsByFamily,
    leaderFlagById,
    typesById,
    skillById,
    itemById,
    gatheringGenreByParamId,
) {
    const evolutionRequirementContext = {
        contextById,
        typesById,
        skillById,
        itemById,
        gatheringGenreByParamId,
    };
    const stages = [];
    const seenIds = new Set();
    const stageBuckets = new Map();
    const familyRows = (
        evolutionRowsByFamily.get(context.evolutionFamilyKey) ?? []
    )
        .filter(Boolean)
        .sort((left, right) => {
            return (left?.id ?? 0) - (right?.id ?? 0);
        });

    for (const evolutionRow of familyRows.length
        ? familyRows
        : normalizeArray(context.evolutionRow)) {
        for (const node of normalizeArray(evolutionRow?.evolution_chain)) {
            const petBaseId = node?.petbase_id;
            const stageNumber =
                typeof node?.stage === "number" ? node.stage : 1;

            if (!Number.isFinite(petBaseId) || !contextById.has(petBaseId)) {
                continue;
            }

            const bucket = stageBuckets.get(stageNumber) ?? [];

            if (!bucket.includes(petBaseId)) {
                bucket.push(petBaseId);
                seenIds.add(petBaseId);
            }

            stageBuckets.set(stageNumber, bucket);
        }
    }

    const orderedStageNumbers = [...stageBuckets.keys()].sort((left, right) => {
        return left - right;
    });

    orderedStageNumbers.forEach((stageNumber, depth) => {
        const petBaseIds = stageBuckets.get(stageNumber) ?? [];
        stages.push({
            depth,
            monsters: petBaseIds
                .map((petBaseId) => {
                    return buildEvolutionNode(
                        contextById.get(petBaseId),
                        leaderFlagById,
                        typesById,
                        evolutionRequirementContext,
                    );
                })
                .filter(Boolean),
        });
    });

    const groupContexts = contextsByGroup.get(context.groupKey) ?? [context];
    // 同组里游离于进化链外的条目，只认图鉴号段（3000-3999）的可收集形态；
    // NPC/首领镜像（如 16000004、103004 这类重复立绘）不应混入一阶列表。
    const extraBaseIds = groupContexts
        .filter(
            (item) =>
                !seenIds.has(item.id) &&
                isCanonicalCollectiblePetBaseId(item.id) &&
                !(leaderFlagById.get(item.id) ?? false),
        )
        .map((item) => item.id);
    const extraLeaderIds = groupContexts
        .filter(
            (item) =>
                !seenIds.has(item.id) && (leaderFlagById.get(item.id) ?? false),
        )
        .map((item) => item.id);

    if (!stages.length) {
        const initialIds = extraBaseIds.length ? extraBaseIds : [context.id];
        stages.push({
            depth: 0,
            monsters: initialIds
                .map((petBaseId) => {
                    return buildEvolutionNode(
                        contextById.get(petBaseId),
                        leaderFlagById,
                        typesById,
                        evolutionRequirementContext,
                    );
                })
                .filter(Boolean),
        });
        initialIds.forEach((id) => seenIds.add(id));
    } else if (extraBaseIds.length) {
        stages[0].monsters.push(
            ...extraBaseIds
                .map((petBaseId) => {
                    return buildEvolutionNode(
                        contextById.get(petBaseId),
                        leaderFlagById,
                        typesById,
                        evolutionRequirementContext,
                    );
                })
                .filter(Boolean),
        );
        extraBaseIds.forEach((id) => seenIds.add(id));
    }

    if (
        !seenIds.has(context.id) &&
        !(leaderFlagById.get(context.id) ?? false) &&
        stages[0]
    ) {
        stages[0].monsters.push(
            buildEvolutionNode(
                context,
                leaderFlagById,
                typesById,
                evolutionRequirementContext,
            ),
        );
        seenIds.add(context.id);
    }

    if (
        !extraLeaderIds.length &&
        (leaderFlagById.get(context.id) ?? false) &&
        !seenIds.has(context.id)
    ) {
        extraLeaderIds.push(context.id);
    }

    if (extraLeaderIds.length) {
        stages.push({
            depth: stages.length,
            is_leader_stage: true,
            monsters: extraLeaderIds
                .map((petBaseId) => {
                    return buildEvolutionNode(
                        contextById.get(petBaseId),
                        leaderFlagById,
                        typesById,
                        evolutionRequirementContext,
                    );
                })
                .filter(Boolean),
        });
        extraLeaderIds.forEach((id) => seenIds.add(id));
    }

    const normalizedStages = stages
        .map((stage) => ({
            ...stage,
            monsters: dedupeEvolutionNodes(stage.monsters).sort(
                (left, right) => {
                    return left.id - right.id;
                },
            ),
        }))
        .filter((stage) => stage.monsters.length > 0)
        .map((stage, depth) => ({
            ...stage,
            depth,
            is_leader_stage:
                stage.is_leader_stage ||
                stage.monsters.some((monster) => monster.is_leader_form),
        }));

    const allMonsterIds = normalizedStages.flatMap((stage) => {
        return stage.monsters.map((monster) => monster.id);
    });

    return {
        stages: normalizedStages,
        max_depth: normalizedStages.length ? normalizedStages.length - 1 : 0,
        total_unique_monsters: new Set(allMonsterIds).size,
        species_id:
            context.handbookRow?.id ??
            context.petBase.pictorial_book_id ??
            context.id,
        current_monster_id: context.id,
    };
}

function buildEvolutionNode(
    context,
    leaderFlagById,
    typesById,
    evolutionRequirementContext,
) {
    if (!context) {
        return null;
    }

    return {
        id: context.id,
        species_id:
            context.handbookRow?.id ??
            context.petBase.pictorial_book_id ??
            context.id,
        name: context.portraitKey,
        form: extractForm(context),
        localized: {
            zh: {
                name: context.displayName,
            },
        },
        is_leader_form: leaderFlagById.get(context.id) ?? false,
        main_type: cloneType(context.typePair.mainType ?? UNKNOWN_TYPE),
        sub_type: context.typePair.subType
            ? cloneType(context.typePair.subType)
            : null,
        evolution_conditions: buildEvolutionConditions(
            context,
            evolutionRequirementContext,
        ),
    };
}

function buildEvolutionConditions(context, evolutionRequirementContext) {
    const petBase = context?.petBase;

    if (!petBase) {
        return [];
    }

    const { skillById, itemById } = evolutionRequirementContext;

    const conditions = [];

    if (
        typeof petBase.evolution_need_level === "number" &&
        petBase.evolution_need_level > 1
    ) {
        conditions.push(`等级达到 ${petBase.evolution_need_level} 级`);
    }

    if (
        typeof petBase.evolution_need_money === "number" &&
        petBase.evolution_need_money > 0
    ) {
        conditions.push(
            `消耗 ${formatEvolutionNumber(petBase.evolution_need_money)} 洛克贝`,
        );
    }

    for (const itemRequirement of normalizeArray(
        petBase.evolution_need_items,
    )) {
        const itemId = itemRequirement?.evolution_need_item;
        const itemCount = itemRequirement?.number;

        if (
            !Number.isFinite(itemId) ||
            !Number.isFinite(itemCount) ||
            itemCount <= 0
        ) {
            continue;
        }

        const itemName = resolveEvolutionItemName(itemId, itemById);
        conditions.push(`消耗 ${itemName} ×${itemCount}`);
    }

    for (const requirement of normalizeArray(petBase.evolution_need)) {
        const type = requirement?.evolution_need_type;

        if (!Number.isFinite(type) || type === 1) {
            continue;
        }

        const data1 = normalizeArray(requirement?.evolution_need_data1).filter(
            (value) => {
                return Number.isFinite(value);
            },
        );
        const data2 = normalizeArray(requirement?.evolution_need_data2).filter(
            (value) => {
                return Number.isFinite(value);
            },
        );

        const description = describeSpecialEvolutionRequirement(
            type,
            data1,
            data2,
            context,
            evolutionRequirementContext,
        );

        if (description) {
            conditions.push(description);
        }
    }

    return [...new Set(conditions)];
}

function describeSpecialEvolutionRequirement(
    type,
    data1,
    data2,
    context,
    evolutionRequirementContext,
) {
    const {
        contextById,
        gatheringGenreByParamId,
        itemById,
        skillById,
        typesById,
    } = evolutionRequirementContext;

    switch (type) {
        case 2: {
            const genderName = resolveGenderName(data1[0]);

            return genderName ? `需为${genderName}` : "需满足性别条件";
        }
        case 4: {
            const routeLabel = resolveEvolutionRouteLabel(context);
            const branchRequirement =
                formatEvolutionBranchRequirement(routeLabel);

            if (branchRequirement) {
                return branchRequirement;
            }

            return formatRawEvolutionRequirement(type, data1, data2);
        }
        case 5: {
            const eggGroupLabels = data1
                .map((groupId) => resolveEggGroupLabel(groupId))
                .filter(Boolean);

            if (eggGroupLabels.length === 1) {
                return `需满足蛋组搭配条件（${eggGroupLabels[0]}）`;
            }

            if (eggGroupLabels.length > 1) {
                return `需满足蛋组搭配条件（${eggGroupLabels.join(" / ")}）`;
            }

            return formatRawEvolutionRequirement(type, data1, data2);
        }
        case 11: {
            const bondValue = data1[1] ?? data2[0];

            return Number.isFinite(bondValue)
                ? `羁绊值达到 ${bondValue}`
                : "需满足羁绊条件";
        }
        case 12: {
            const branchId = data1[0];

            return Number.isFinite(branchId)
                ? `需激活第 ${branchId} 条进化分支`
                : "需激活指定进化分支";
        }
        case 13: {
            const typeName =
                cleanText(typesById.get(data1[0])?.localized?.zh) ?? null;

            return typeName ? `需激活${typeName}系血脉` : "需激活指定血脉";
        }
        case 16: {
            const skillId = data1[0];
            const skillName = resolveSkillName(skillId, skillById);
            const targetCount = data2[0];

            if (skillName && Number.isFinite(targetCount) && targetCount > 0) {
                return `完成技能「${skillName}」相关试炼（参数 ${targetCount}）`;
            }

            if (skillName) {
                return `完成技能「${skillName}」相关试炼`;
            }

            return `完成技能相关试炼（类型 ${type}）`;
        }
        case 18: {
            const chessVariantLabel = resolveChessVariantBranchLabel(context);
            const relatedPetName = resolvePetBaseName(data1[0], contextById);
            const targetCount = data2[0];

            if (chessVariantLabel) {
                return `需激活${chessVariantLabel}形态分支`;
            }

            if (
                relatedPetName &&
                Number.isFinite(targetCount) &&
                targetCount > 0
            ) {
                return `需满足与对应形态「${relatedPetName}」关联的联动条件（参数 ${targetCount}）`;
            }

            if (relatedPetName) {
                return `需满足与对应形态「${relatedPetName}」关联的联动条件`;
            }

            return "需满足形态联动条件";
        }
        case 14: {
            const minimum = data1[0];
            const maximum = data1[1];
            const routeLabel = resolveEvolutionRouteLabel(context);
            const branchRequirement =
                formatEvolutionBranchRequirement(routeLabel);

            if (
                Number.isFinite(minimum) &&
                Number.isFinite(maximum) &&
                branchRequirement
            ) {
                return `${branchRequirement}，并满足区间条件（${formatEvolutionNumber(minimum)}-${formatEvolutionNumber(maximum)}）`;
            }

            if (Number.isFinite(minimum) && Number.isFinite(maximum)) {
                return `需满足区间条件（${formatEvolutionNumber(minimum)}-${formatEvolutionNumber(maximum)}）`;
            }

            return formatRawEvolutionRequirement(type, data1, data2);
        }
        case 21: {
            const energyValue = data1[0] ?? data2[0];

            if (
                Number.isFinite(energyValue) &&
                isStarlightEvolutionContext(context)
            ) {
                return `需积累 ${formatEvolutionNumber(energyValue)} 点星光能量`;
            }

            if (Number.isFinite(energyValue)) {
                return `需积累 ${formatEvolutionNumber(energyValue)} 点特殊能量`;
            }

            return "需满足特殊能量条件";
        }
        case 20: {
            const genres = [
                ...new Set(
                    data1
                        .map((materialId) => {
                            return resolveEvolutionMaterialName(
                                materialId,
                                gatheringGenreByParamId,
                                itemById,
                            );
                        })
                        .filter(Boolean),
                ),
            ];
            const targetCount = data2[0];

            if (
                genres.length === 1 &&
                Number.isFinite(targetCount) &&
                targetCount > 0
            ) {
                return `需准备${genres[0]}系列材料共 ${targetCount} 份`;
            }

            if (
                genres.length > 1 &&
                Number.isFinite(targetCount) &&
                targetCount > 0
            ) {
                return `需准备以下晶石系列材料共 ${targetCount} 份：${genres.join("、")}`;
            }

            if (genres.length === 1) {
                return `需准备${genres[0]}系列材料`;
            }

            if (genres.length > 1) {
                return `需准备以下晶石系列材料：${genres.join("、")}`;
            }

            return "需准备指定晶石材料";
        }
        case 7: {
            const targetCount = data1[0];
            const typeName = resolveTypeName(data2[0], typesById);
            const predecessorName = resolvePreviousEvolutionStageName(
                context,
                contextById,
            );
            const routeLabel = resolveEvolutionRouteLabel(context);
            const branchRequirement =
                formatEvolutionBranchRequirement(routeLabel);

            if (
                predecessorName &&
                typeName &&
                Number.isFinite(targetCount) &&
                targetCount > 0
            ) {
                return `需与${predecessorName}一起击败 ${targetCount} 只${typeName}系精灵`;
            }

            if (typeName && Number.isFinite(targetCount) && targetCount > 0) {
                return `需击败 ${targetCount} 只${typeName}系精灵`;
            }

            if (branchRequirement) {
                return branchRequirement;
            }

            return `需满足特化分支条件${formatEvolutionParameterSuffix(data1, data2)}`;
        }
        default:
            return formatRawEvolutionRequirement(type, data1, data2);
    }
}

function resolveGenderName(genderId) {
    switch (genderId) {
        case 1:
            return "雄性";
        case 2:
            return "雌性";
        default:
            return null;
    }
}

function resolveSkillName(skillId, skillById) {
    if (!Number.isFinite(skillId)) {
        return null;
    }

    const skill = skillById.get(skillId);

    if (!skill) {
        return null;
    }

    return resolveMoveText(skill, skillId).name;
}

function resolveTypeName(typeId, typesById) {
    if (!Number.isFinite(typeId)) {
        return null;
    }

    const normalizedTypeId = RAW_TYPE_TO_NORMALIZED_ID.get(typeId) ?? typeId;

    return cleanText(typesById.get(normalizedTypeId)?.localized?.zh) ?? null;
}

function resolveEggGroupLabel(groupId) {
    if (!Number.isFinite(groupId)) {
        return null;
    }

    return EGG_GROUP_LABEL_BY_ID.get(groupId) ?? `蛋组 ${groupId}`;
}

function resolvePetBaseName(petBaseId, contextById) {
    if (!Number.isFinite(petBaseId)) {
        return null;
    }

    const context = contextById.get(petBaseId);

    return (
        cleanText(context?.displayName) ??
        cleanText(context?.petBase?.name) ??
        null
    );
}

function resolvePreviousEvolutionStageName(context, contextById) {
    const evolutionChain = normalizeArray(
        context?.evolutionRow?.evolution_chain,
    );
    const currentIndex = evolutionChain.findIndex((entry) => {
        return entry?.petbase_id === context?.id;
    });

    if (currentIndex <= 0) {
        return null;
    }

    return resolvePetBaseName(
        evolutionChain[currentIndex - 1]?.petbase_id,
        contextById,
    );
}

function resolveEvolutionRouteLabel(context) {
    const evolutionName = cleanText(context?.evolutionRow?.name) ?? "";
    const wrapped = evolutionName.match(/[（(]([^）)]+)[）)]/u);

    return wrapped?.[1]?.trim() ?? null;
}

function formatEvolutionBranchRequirement(routeLabel) {
    const normalizedLabel = cleanText(routeLabel)?.trim();

    if (!normalizedLabel) {
        return null;
    }

    const branchName = normalizedLabel.endsWith("分支")
        ? normalizedLabel.slice(0, -2).trim()
        : normalizedLabel;

    if (!branchName) {
        return null;
    }

    return `需激活「${branchName}」分支`;
}

function resolveChessVariantBranchLabel(context) {
    const evolutionName = cleanText(context?.evolutionRow?.name) ?? "";

    if (evolutionName.includes("白棋")) {
        return "白子";
    }

    if (evolutionName.includes("黑棋")) {
        return "黑子";
    }

    return null;
}

function isStarlightEvolutionContext(context) {
    const typeDescription = cleanText(context?.handbookRow?.type_desc) ?? "";
    const petDescription = cleanText(context?.petBase?.description) ?? "";

    return /星光/.test(typeDescription) || /(星光|光能)/.test(petDescription);
}

function formatRawEvolutionRequirement(type, data1, data2) {
    return `需满足特殊条件（类型 ${type}${formatEvolutionParameterSuffix(data1, data2)}）`;
}

function formatEvolutionParameterSuffix(data1, data2) {
    const segments = [];

    if (data1.length) {
        segments.push(`参数 ${data1.map(formatEvolutionNumber).join("、")}`);
    }

    if (data2.length) {
        segments.push(`附参 ${data2.map(formatEvolutionNumber).join("、")}`);
    }

    return segments.length ? `，${segments.join("；")}` : "";
}

function resolveEvolutionMaterialName(
    materialId,
    gatheringGenreByParamId,
    itemById,
) {
    if (!Number.isFinite(materialId)) {
        return null;
    }

    return (
        cleanText(gatheringGenreByParamId.get(materialId)) ??
        resolveEvolutionItemName(materialId, itemById)
    );
}

function resolveEvolutionItemName(itemId, itemById) {
    const row = itemById.get(itemId);

    return (
        cleanText(row?.editor_name) ?? cleanText(row?.name) ?? `道具 ${itemId}`
    );
}

function formatEvolutionNumber(value) {
    return new Intl.NumberFormat("zh-CN").format(value);
}

function dedupeEvolutionNodes(nodes) {
    const seenIds = new Set();

    return nodes.filter((node) => {
        if (!node || seenIds.has(node.id)) {
            return false;
        }

        seenIds.add(node.id);
        return true;
    });
}

function findEvolvesFromId(evolutionTree, currentPetId, evolutionRow) {
    const directChain = normalizeArray(evolutionRow?.evolution_chain);
    const directIndex = directChain.findIndex((node) => {
        return node?.petbase_id === currentPetId;
    });

    if (directIndex > 0) {
        const previousPetId = directChain[directIndex - 1]?.petbase_id;

        if (Number.isFinite(previousPetId)) {
            return previousPetId;
        }
    }

    const stageIndex = evolutionTree.stages.findIndex((stage) => {
        return stage.monsters.some((monster) => monster.id === currentPetId);
    });

    if (stageIndex <= 0) {
        return null;
    }

    return evolutionTree.stages[stageIndex - 1]?.monsters[0]?.id ?? null;
}

async function syncMirroredTables() {
    await fs.mkdir(tablesDir, { recursive: true });

    await Promise.all(
        MIRRORED_TABLE_FILES.map(async (fileName) => {
            const sourcePath = path.join(binDataDir, fileName);

            try {
                const content = await fs.readFile(sourcePath, "utf8");
                await fs.writeFile(
                    path.join(tablesDir, fileName),
                    content,
                    "utf8",
                );
                await mirrorFileToDist(
                    rootDir,
                    path.join("data", "tables", fileName),
                );
            } catch {
                // Ignore table mirrors that do not have a BinData source.
            }
        }),
    );

    // 清理历史全量镜像：白名单之外的旧表不再被任何页面使用。
    let existingFiles = [];

    try {
        existingFiles = await fs.readdir(tablesDir);
    } catch {
        existingFiles = [];
    }

    await Promise.all(
        existingFiles
            .filter(
                (fileName) =>
                    fileName.endsWith(".json") && !MIRRORED_TABLE_FILES.includes(fileName),
            )
            .map((fileName) => fs.unlink(path.join(tablesDir, fileName))),
    );
}

// 以 index.html 判断 dist 是否真的构建过，与 mirrorFileToDist 的判据保持一致。
async function isDistBuilt() {
    try {
        await fs.access(path.join(rootDir, "dist", "index.html"));
        return true;
    } catch {
        return false;
    }
}

async function cleanGeneratedPetDetails() {
    // dist 侧一并清空：某个精灵 id 不再产出时，只删 public 会让 dist 留下
    // 一份永不更新的孤儿档案，纯静态部署下仍会被访问到。
    // 仅在 dist 已构建（有 index.html）时才清，否则删了也没有镜像步骤补回来。
    const dirs = [petsDetailDir];

    if (await isDistBuilt()) {
        dirs.push(path.join(rootDir, "dist", "data", "pets"));
    }

    for (const dir of dirs) {
        let fileNames = [];

        try {
            fileNames = await fs.readdir(dir);
        } catch {
            continue;
        }

        await Promise.all(
            fileNames
                .filter((fileName) => fileName.endsWith(".json"))
                .map((fileName) => fs.unlink(path.join(dir, fileName))),
        );
    }
}

async function writeJson(filePath, value, options = {}) {
    const indent = options.compact ? 0 : 4;
    await fs.writeFile(filePath, `${JSON.stringify(value, null, indent)}\n`, "utf8");
    // 纯静态部署（deploy/sync-cron.sh、npm run preview）由 nginx 直接托管 dist，
    // 只写 public 会让站点一直读构建那一刻的旧数据。其余同步脚本都做了镜像，
    // 这里漏掉会让本脚本的修复在这类部署上完全看不到。
    await mirrorFileToDist(
        rootDir,
        path.relative(path.join(rootDir, "public"), filePath),
    );
}

function resolveItemIconId(row, labelType, skillById) {
    if (labelType === 5) {
        const skillId = normalizeArray(row.item_behavior)?.[0]?.ratio?.[0];
        const skill = Number.isFinite(skillId) ? skillById.get(skillId) : null;

        if (skill?.icon) {
            return extractIconId(skill.icon);
        }
    }

    return extractIconId(row.icon);
}

function extractIconId(iconPath) {
    if (typeof iconPath !== "string") {
        return null;
    }

    const match = iconPath.match(/\/([^/.]+)\.[^/']+'/);

    return match?.[1] ?? null;
}

const ITEM_QUALITY_LABELS = new Map([
    [1, "普通"],
    [2, "优秀"],
    [3, "精良"],
    [4, "史诗"],
    [5, "传说"],
]);

function buildItemCategories(labelTypeRows) {
    const categories = new Map();

    for (const row of labelTypeRows) {
        if (typeof row?.id !== "number") {
            continue;
        }

        const labelType = row.lable_type ?? 0;
        categories.set(
            labelType,
            cleanText(row.type_name) ?? `分类${labelType}`,
        );
    }

    return categories;
}

function buildEvolutionItemUsageFromRaw(petBaseRows, contexts) {
    const usage = new Map();
    const contextById = new Map(contexts.map((c) => [c.id, c]));

    for (const petBase of petBaseRows) {
        if (typeof petBase?.id !== "number") {
            continue;
        }

        const context = contextById.get(petBase.id);
        const displayName =
            context?.displayName ??
            cleanText(petBase.name) ??
            String(petBase.id);

        for (const itemRequirement of normalizeArray(
            petBase.evolution_need_items,
        )) {
            const itemId = itemRequirement?.evolution_need_item;

            if (!Number.isFinite(itemId)) {
                continue;
            }

            if (!usage.has(itemId)) {
                usage.set(itemId, []);
            }

            const existing = usage.get(itemId);
            const petEntry = { id: petBase.id, name: displayName };

            if (!existing.some((entry) => entry.id === petEntry.id)) {
                existing.push(petEntry);
            }
        }
    }

    return usage;
}

function buildAlchemyRecipes(exchangeRows, bagItemById) {
    const recipesByProductId = new Map();

    for (const row of exchangeRows) {
        if (row?.use_type !== 8) continue;

        const getItems = normalizeArray(row.get_item);
        if (getItems.length === 0) continue;

        const productId = getItems[0]?.get_goods_id;
        if (typeof productId !== "number") continue;

        const costGroups = normalizeArray(row.cost_item)
            .map((cost) => {
                const ids = normalizeArray(cost?.cost_goods_id).filter(
                    (id) => typeof id === "number",
                );
                return {
                    options: ids.map((id) => {
                        const item = bagItemById.get(id);
                        return {
                            id,
                            name: cleanText(item?.name) ?? `道具 ${id}`,
                            icon_id: extractIconId(item?.icon),
                        };
                    }),
                    count:
                        typeof cost?.cost_goods_num === "number"
                            ? cost.cost_goods_num
                            : 1,
                };
            })
            .filter((group) => group.options.length > 0);

        if (costGroups.length === 0) continue;

        const editorNames = normalizeArray(row.editor_name)
            .map((n) => cleanText(n))
            .filter(Boolean);
        const canCraft = !editorNames.some((n) => n.includes("不能合成"));

        const recipe = {
            cost: costGroups,
            can_craft: canCraft,
        };

        if (!recipesByProductId.has(productId)) {
            recipesByProductId.set(productId, []);
        }
        recipesByProductId.get(productId).push(recipe);
    }

    return recipesByProductId;
}

function buildItemEntries(
    bagItemRows,
    itemCategories,
    evolutionItemUsage,
    skillById,
    alchemyRecipes,
) {
    const entries = [];

    for (const row of bagItemRows) {
        if (typeof row?.id !== "number") {
            continue;
        }

        const rawName = cleanText(row.name);

        if (!rawName) {
            continue;
        }

        const isRelease = row.is_release === true;
        const canSee = row.can_see === 1;

        if (!isRelease && !canSee) {
            continue;
        }

        const description = cleanText(row.description);

        if (!description || description.startsWith("（没投放")) {
            continue;
        }

        const labelType = row.lable_type ?? 0;
        const categoryName = itemCategories.get(labelType) ?? null;
        const editorName = cleanText(row.editor_name);
        const name = labelType === 9 && editorName ? editorName : rawName;
        const typeDesc = cleanText(row.type_desc) ?? null;
        const flavorText = cleanText(row.flavor_text) ?? null;
        const quality =
            typeof row.item_quality === "number" ? row.item_quality : 1;
        const qualityLabel = ITEM_QUALITY_LABELS.get(quality) ?? "普通";

        const acquireWays = normalizeArray(row.acquire_struct)
            .map((entry) => cleanText(entry?.acquire_way_text))
            .filter(Boolean);

        const relatedPets = evolutionItemUsage.get(row.id) ?? [];

        const iconId = resolveItemIconId(row, labelType, skillById);

        const recipes = alchemyRecipes?.get(row.id) ?? [];

        const entry = {
            id: row.id,
            name,
            icon_id: iconId,
            description,
            flavor_text: flavorText,
            category: categoryName,
            type_desc: typeDesc,
            quality,
            quality_label: qualityLabel,
            acquire_ways: acquireWays,
            related_pets: relatedPets,
        };

        if (recipes.length > 0) {
            entry.recipes = recipes;
        }

        entries.push(entry);
    }

    entries.sort((left, right) => left.id - right.id);
    return entries;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
