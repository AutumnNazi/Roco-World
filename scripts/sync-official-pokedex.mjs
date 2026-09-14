import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mirrorFileToDist } from "./lib/mirror-to-dist.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const outputDir = path.join(rootDir, "public", "data");
const outputPath = path.join(outputDir, "pokedex-official.json");
const skillsOutputPath = path.join(outputDir, "skills-official.json");
const petsIndexPath = path.join(outputDir, "Pets.json");
const petsDetailDir = path.join(outputDir, "pets");

// 腾讯官方图鉴（洛克王国：世界）公开数据：精灵列表 l 与详情 d，
// 提供图鉴编号、身高/体重、栖息地、昵称与官方描述，随官方版本更新。
const OFFICIAL_DATA_URL =
    "https://static.gamecenter.qq.com/xgame/roco-kingdom/compendium/d.json";

// 官方详情 sk 的三个池与本地解包数据的对应关系（已用迪莫交叉验证）：
// s = 升级学习（move_pool），b = 血脉技能（legacy_moves），t = 技能石（move_stones）。
const SKILL_POOL_LABELS = { s: "升级", b: "血脉", t: "技能石" };

async function main() {
    const response = await fetch(OFFICIAL_DATA_URL, {
        headers: { "User-Agent": "Mozilla/5.0 rocom-aoe-top-pokedex-sync" },
    });

    if (!response.ok) {
        throw new Error(`官方图鉴数据请求失败: ${response.status}`);
    }

    const payload = await response.json();
    const list = Array.isArray(payload?.l) ? payload.l : [];
    const details =
        payload?.d && typeof payload.d === "object" ? payload.d : {};

    if (!list.length) {
        throw new Error("官方图鉴数据为空，请确认 d.json 结构是否变更。");
    }

    // 同名多形态（如「迪莫」不同阶段）按物种级共享一份档案，取首次出现条目。
    const entries = {};

    for (const item of list) {
        const name = typeof item?.nm === "string" ? item.nm.trim() : "";

        if (!name || entries[name]) {
            continue;
        }

        const detail = details[String(item?.i)] ?? {};
        entries[name] = {
            no: typeof item?.n === "string" ? item.n : null,
            form: typeof item?.s === "string" ? item.s : null,
            height: typeof detail?.h === "string" ? detail.h : null,
            weight: typeof detail?.w === "string" ? detail.w : null,
            habitat: typeof detail?.loc === "string" ? detail.loc : null,
            nickname: typeof detail?.nick === "string" ? detail.nick : null,
            description: typeof detail?.desc === "string" ? detail.desc : null,
        };
    }

    const result = {
        schema_version: 1,
        generated_at: buildBeijingTimestamp(),
        source: {
            site: "洛克王国：世界 官方图鉴",
            page: OFFICIAL_DATA_URL,
        },
        entries,
    };

    const pokedexChanged = await writeJsonIfChanged(outputPath, result, [
        "generated_at",
    ]);

    const skills = await buildOfficialSkills(list, details);

    const skillsChanged = await writeJsonIfChanged(skillsOutputPath, skills, [
        "generated_at",
    ]);

    await mirrorFileToDist(rootDir, path.join("data", "pokedex-official.json"));
    await mirrorFileToDist(rootDir, path.join("data", "skills-official.json"));

    if (!pokedexChanged && !skillsChanged) {
        console.log(
            `Official pokedex unchanged (${Object.keys(entries).length} entries / ${Object.keys(skills.entries).length} skills), skip write.`,
        );
        return;
    }

    console.log(
        `Generated ${Object.keys(entries).length} official pokedex entries and ${Object.keys(skills.entries).length} official skills.`,
    );
}

async function writeJsonIfChanged(filePath, value, ignoredKeys = []) {
    try {
        const previous = JSON.parse(await fs.readFile(filePath, "utf8"));
        const left = { ...previous };
        const right = { ...value };

        for (const key of ignoredKeys) {
            delete left[key];
            delete right[key];
        }

        if (JSON.stringify(left) === JSON.stringify(right)) {
            return false;
        }
    } catch {
        // 旧文件缺失或不可解析时直接写入。
    }

    await fs.writeFile(
        filePath,
        `${JSON.stringify(value, null, 4)}\n`,
        "utf8",
    );
    return true;
}

// 官方技能以名称去重归档；学习关系由官方精灵映射到站内精灵 id，
// 并与本地解包数据（PetSkillIndex / moves.json）关联技能编号与图标。
async function buildOfficialSkills(list, details) {
    const localPetIdsByName = await loadLocalPetIdsByName();
    const localMoveIdsByName = await loadLocalMoveIdsByName();
    const skills = {};

    for (const pet of list) {
        const petName = typeof pet?.nm === "string" ? pet.nm.trim() : "";

        if (!petName) {
            continue;
        }

        const detail = details[String(pet?.i)] ?? {};
        const pools = detail.sk ?? {};

        for (const [poolKey, poolLabel] of Object.entries(SKILL_POOL_LABELS)) {
            for (const entry of Array.isArray(pools[poolKey]) ? pools[poolKey] : []) {
                const skillName = typeof entry?.nm === "string" ? entry.nm.trim() : "";

                if (!skillName) {
                    continue;
                }

                if (!skills[skillName]) {
                    skills[skillName] = {
                        name: skillName,
                        move_id: localMoveIdsByName.get(skillName) ?? null,
                        category: typeof entry?.tp === "string" ? entry.tp : null,
                        element: typeof entry?.el === "string" ? entry.el : null,
                        energy_cost: parseNumber(entry?.ec),
                        power: parseNumber(entry?.pw),
                        effect:
                            typeof entry?.ef === "string"
                                ? entry.ef.replace(/^✦/, "").trim()
                                : null,
                        learn_pets: [],
                    };
                }

                for (const petId of localPetIdsByName.get(petName) ?? []) {
                    const record = skills[skillName];
                    const exists = record.learn_pets.some(
                        (item) => item.id === petId && item.pool === poolLabel,
                    );

                    if (!exists) {
                        record.learn_pets.push({
                            id: petId,
                            name: petName,
                            pool: poolLabel,
                            level: typeof entry?.lv === "string" ? entry.lv : null,
                        });
                    }
                }
            }
        }
    }

    for (const record of Object.values(skills)) {
        record.learn_pets.sort(
            (left, right) =>
                left.id - right.id || left.pool.localeCompare(right.pool, "zh-CN"),
        );
    }

    return {
        schema_version: 1,
        generated_at: buildBeijingTimestamp(),
        source: {
            site: "洛克王国：世界 官方图鉴",
            page: OFFICIAL_DATA_URL,
        },
        pool_labels: Object.values(SKILL_POOL_LABELS),
        entries: skills,
    };
}

async function loadLocalPetIdsByName() {
    const map = new Map();

    try {
        const pets = JSON.parse(await fs.readFile(petsIndexPath, "utf8"));

        for (const pet of Array.isArray(pets) ? pets : []) {
            const name = pet?.localized?.zh?.name;

            if (typeof name === "string" && Number.isFinite(pet?.id)) {
                const bucket = map.get(name) ?? [];
                bucket.push(pet.id);
                map.set(name, bucket);
            }
        }
    } catch {
        // 本地索引缺失时跳过关联，官方技能表仍然完整可用。
    }

    return map;
}

async function loadLocalMoveIdsByName() {
    const map = new Map();

    try {
        const moves = JSON.parse(
            await fs.readFile(path.join(outputDir, "moves.json"), "utf8"),
        );

        for (const move of Array.isArray(moves) ? moves : []) {
            const name = move?.localized?.zh?.name;

            if (typeof name === "string" && Number.isFinite(move?.id)) {
                map.set(name, move.id);
            }
        }
    } catch {
        // 同上，仅影响技能编号关联。
    }

    return map;
}

function parseNumber(value) {
    if (typeof value === "number") {
        return value;
    }

    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function buildBeijingTimestamp() {
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

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
