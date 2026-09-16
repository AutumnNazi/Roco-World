import type { HandbookProgressCatalogEntry, HandbookProgressState } from "./types";
import { normalizeHandbookLookupKey } from "./helpers";
import { mergeHandbookProgressState } from "./merge";

const PET_TOPIC_COOKIE_PREFIX = "rocom_pet_topics_";

// 旧 cookie 以精灵名作键，这里把名字映射回 speciesId。
// 解包手册表的 name 列整体错位（species 10 的 name 写着 species 9 的「波波拉」），
// 实测 347 行里有 125 行指向别的物种。因此两类键必须分两轮写入：
// 先让权威的显示名占位，错位的 handbookRowName 只填补空缺、不得覆盖，
// 否则用户的旧图鉴进度会整段记到相邻物种头上。
function buildLookupKeyToSpeciesIdMap(catalog: HandbookProgressCatalogEntry[]) {
    const map = new Map<string, number>();

    for (const entry of catalog) {
        const key = normalizeHandbookLookupKey(entry.name);
        if (key) {
            map.set(key, entry.speciesId);
        }
    }

    for (const entry of catalog) {
        const key = normalizeHandbookLookupKey(entry.handbookRowName);
        if (key && !map.has(key)) {
            map.set(key, entry.speciesId);
        }
    }

    return map;
}

export function migrateHandbookProgressFromCookies(
    state: HandbookProgressState,
    catalog: HandbookProgressCatalogEntry[],
): HandbookProgressState {
    if (state.migratedFromCookies || typeof document === "undefined") {
        return state;
    }

    const lookupMap = buildLookupKeyToSpeciesIdMap(catalog);
    let migrated: HandbookProgressState = {
        ...state,
        topics: { ...state.topics },
    };

    for (const cookie of document.cookie.split("; ")) {
        const [rawName, rawValue] = cookie.split("=");
        if (!rawName?.startsWith(PET_TOPIC_COOKIE_PREFIX) || !rawValue) {
            continue;
        }

        const lookupKey = decodeURIComponent(
            rawName.slice(PET_TOPIC_COOKIE_PREFIX.length),
        );
        const speciesId = lookupMap.get(normalizeHandbookLookupKey(lookupKey));
        if (!speciesId) {
            continue;
        }

        try {
            const parsed = JSON.parse(decodeURIComponent(rawValue)) as Record<string, string>;
            const incomingTopics: Record<string, string> = {};
            for (const [topicId, timestamp] of Object.entries(parsed)) {
                if (typeof timestamp === "string") {
                    incomingTopics[topicId] = timestamp;
                }
            }

            migrated = mergeHandbookProgressState(migrated, {
                ...state,
                collected: {},
                topics: { [String(speciesId)]: incomingTopics },
            });
        } catch {
            continue;
        }
    }

    return {
        ...migrated,
        migratedFromCookies: true,
    };
}
