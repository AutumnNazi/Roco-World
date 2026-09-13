<script setup lang="ts">
import { RadarChart, type RadarSeriesOption } from "echarts/charts";
import {
    RadarComponent,
    TooltipComponent,
    type RadarComponentOption,
    type TooltipComponentOption,
} from "echarts/components";
import { init, use, type ComposeOption, type ECharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import {
    ArrowRight,
    BarChart3,
    BookOpen,
    Check,
    Crown,
    Egg,
    ExternalLink,
    Gift,
    ListTodo,
    MapPin,
    RotateCcw,
    Ruler,
    Search,
    Sparkles,
    Target,
    WandSparkles,
} from "lucide-vue-next";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import Input from "@/components/ui/input/Input.vue";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card";
import FriendPortrait from "@/components/FriendPortrait.vue";
import SkillIcon from "@/components/SkillIcon.vue";
import type {
    IItem,
    IPets,
    IPetsDetail,
    IPetsMove,
    IMonsterTypeDetail,
    IOfficialPokedexPayload,
} from "@/lib/interface";
import {
    formatPetEggGroupSummary,
    isPetImplemented,
} from "@/lib/petImplementation";
import {
    getSpeciesTopicCompletionMap,
    isSpeciesCollected,
    useHandbookProgress,
    ensureHandbookTopicSkillNames,
    formatHandbookTopicRequirementSync,
} from "@/lib/handbookProgress";
import { formatPetHandbookNo } from "@/lib/petHandbook";

use([RadarChart, RadarComponent, TooltipComponent, CanvasRenderer]);

type StatRadarOption = ComposeOption<
    RadarComponentOption | RadarSeriesOption | TooltipComponentOption
>;

interface IPetHandbookTopic {
    topic_Id: number;
    topic_type: number;
    topic_desc: string;
    topic_cnt: number;
    topic_reward: number;
    topic_data_1?: number[];
}

interface IPetHandbookRow {
    id?: number;
    name?: string;
    pet_topic?: IPetHandbookTopic[];
}

interface IPetHandbookResponse {
    RocoDataRows?: Record<string, IPetHandbookRow>;
}

interface IHandbookRewardItem {
    type: number;
    id: number;
    name: string;
    icon_id: string | null;
    count: number;
}

type HandbookRewardsMap = Record<number, IHandbookRewardItem[]>;

let petHandbookTopicMapPromise: Promise<
    Record<string, IPetHandbookTopic[]>
> | null = null;
let handbookRewardsPromise: Promise<HandbookRewardsMap> | null = null;
let itemLookupPromise: Promise<Record<number, IItem>> | null = null;

const route = useRoute();
const { state: handbookProgressState, init: initHandbookProgress } =
    useHandbookProgress();

const routeId = computed(() => {
    const params = route.params as { id?: string | string[] };
    return params.id ?? "";
});

const friend = ref<IPetsDetail | null>(null);
const officialPokedex = ref<IOfficialPokedexPayload["entries"]>({});
const isLoading = ref(false);
const errorMessage = ref("");
const petTopics = ref<IPetHandbookTopic[]>([]);
const isPetTopicLoading = ref(false);
const petTopicErrorMessage = ref("");
const petTopicDialogOpen = ref(false);
const typeNameMap = ref<Record<number, string>>({});
const implementedPetIds = ref<Set<number>>(new Set());
const moveDictionary = ref<Record<number, IPetsMove>>({});
const handbookRewards = ref<HandbookRewardsMap>({});
const itemLookup = ref<Record<number, IItem>>({});
const moveFilterQuery = ref("");
const moveFilterType = ref("all");
const moveFilterCategory = ref("all");
const radarChartRef = ref<HTMLDivElement | null>(null);

let controller: AbortController | null = null;
let petTopicRequestKey = 0;
let statChart: ECharts | null = null;
let statChartResizeObserver: ResizeObserver | null = null;
let statChartObservedElement: HTMLDivElement | null = null;

const STAT_CHART_SPLIT_NUMBER = 4;
const STAT_CHART_STEP = 40;

const attackStyleLabels: Record<string, string> = {
    Both: "双修",
    Magic: "魔攻",
    Magical: "魔攻",
    Physical: "物攻",
};

const categoryLabels: Record<string, string> = {
    Defense: "防御",
    "Magic Attack": "魔法输出",
    "Physical Attack": "物理输出",
    Status: "状态",
};

const statRows = computed(() => {
    if (!friend.value) {
        return [];
    }

    return [
        {
            key: "base_hp",
            label: "生命",
            value: friend.value.base_hp,
        },
        {
            key: "base_phy_atk",
            label: "物攻",
            value: friend.value.base_phy_atk,
        },
        {
            key: "base_mag_atk",
            label: "魔攻",
            value: friend.value.base_mag_atk,
        },
        {
            key: "base_phy_def",
            label: "物防",
            value: friend.value.base_phy_def,
        },
        {
            key: "base_mag_def",
            label: "魔防",
            value: friend.value.base_mag_def,
        },
        {
            key: "base_spd",
            label: "速度",
            value: friend.value.base_spd,
        },
    ];
});

const statMax = computed(() => {
    return Math.max(120, ...statRows.value.map((stat) => stat.value));
});

const statChartMax = computed(() => {
    return Math.max(
        120,
        Math.ceil(statMax.value / STAT_CHART_STEP) * STAT_CHART_STEP,
    );
});

const statChartIndicators = computed(() => {
    return statRows.value.map((stat) => ({
        name: stat.label,
        max: statChartMax.value,
    }));
});

const statChartValues = computed(() => {
    return statRows.value.map((stat) => stat.value);
});

const totalStats = computed(() => {
    return statRows.value.reduce((sum, stat) => sum + stat.value, 0);
});

const highestStat = computed(() => {
    return (
        [...statRows.value].sort(
            (left, right) => right.value - left.value,
        )[0] ?? {
            key: "base_hp",
            label: "生命",
            value: 0,
        }
    );
});

const moveCoverageTypes = computed(() => {
    if (!friend.value) {
        return [];
    }

    const coverage = new Map<number, string>();

    for (const move of [
        ...friend.value.move_pool,
        ...friend.value.move_stones,
    ]) {
        coverage.set(move.move_type.id, move.move_type.localized.zh);
    }

    return Array.from(coverage.entries()).map(([id, label]) => ({
        id,
        label,
    }));
});

const moveSummary = computed(() => {
    if (!friend.value) {
        return [];
    }

    const categoryCount = new Map<string, number>();

    for (const move of [
        ...friend.value.move_pool,
        ...friend.value.move_stones,
    ]) {
        categoryCount.set(
            move.move_category,
            (categoryCount.get(move.move_category) ?? 0) + 1,
        );
    }

    return Array.from(categoryCount.entries())
        .map(([category, count]) => ({
            category,
            count,
            label: categoryLabels[category] ?? category,
        }))
        .sort((left, right) => right.count - left.count);
});

const strongestMoves = computed(() => {
    if (!friend.value) {
        return [];
    }

    return [...friend.value.move_pool, ...friend.value.move_stones]
        .filter((move) => typeof move.power === "number")
        .sort((left, right) => (right.power ?? 0) - (left.power ?? 0))
        .slice(0, 5);
});

const legacyTypeEntries = computed(() => {
    if (!friend.value) {
        return [];
    }

    return friend.value.legacy_moves
        .map((item) => ({
            ...item,
            label: typeNameMap.value[item.type_id] ?? `系别 ${item.type_id}`,
            move: item.move ?? moveDictionary.value[item.move_id] ?? null,
        }))
        .sort((left, right) => left.type_id - right.type_id);
});

function filterMoves(moves: IPetsMove[]): IPetsMove[] {
    const query = moveFilterQuery.value.trim().toLowerCase();
    const type = moveFilterType.value;
    const category = moveFilterCategory.value;

    return moves.filter((move) => {
        if (type !== "all" && move.move_type.localized.zh !== type) {
            return false;
        }

        if (category !== "all" && move.move_category !== category) {
            return false;
        }

        if (query) {
            return (
                move.localized.zh.name.toLowerCase().includes(query) ||
                move.localized.zh.description.toLowerCase().includes(query) ||
                String(move.id).includes(query)
            );
        }

        return true;
    });
}

const filteredMovePool = computed(() => {
    return filterMoves(friend.value?.move_pool ?? []);
});

const filteredMoveStones = computed(() => {
    return filterMoves(friend.value?.move_stones ?? []);
});

function collectMoveFilterOptions(moves: IPetsMove[]) {
    const types = new Set<string>();
    const cats = new Set<string>();

    for (const move of moves) {
        types.add(move.move_type.localized.zh);
        cats.add(move.move_category);
    }

    return {
        types: [...types].sort((a, b) => a.localeCompare(b, "zh-CN")),
        categories: [...cats].sort(),
    };
}

const movePoolFilterOptions = computed(() =>
    collectMoveFilterOptions(friend.value?.move_pool ?? []),
);
const moveStonesFilterOptions = computed(() =>
    collectMoveFilterOptions(friend.value?.move_stones ?? []),
);

const hasActiveMoveFilters = computed(() => {
    return (
        moveFilterQuery.value.trim() !== "" ||
        moveFilterType.value !== "all" ||
        moveFilterCategory.value !== "all"
    );
});

function resetMoveFilters() {
    moveFilterQuery.value = "";
    moveFilterType.value = "all";
    moveFilterCategory.value = "all";
}

const evolutionStages = computed(() => {
    return friend.value?.evolution_tree.stages ?? [];
});

const worldProfile = computed(() => {
    return friend.value?.world_profile ?? null;
});

const breedingInfo = computed(() => {
    return friend.value?.breeding ?? null;
});

const catchInfo = computed(() => {
    return friend.value?.catch_info ?? null;
});

const catchDifficulty = computed(() => {
    const rate = catchInfo.value?.catch_guarant_rate;

    if (rate === null || rate === undefined) {
        return {
            label: "暂无数据",
            stars: 0,
            color: "text-foreground",
            barColor: "bg-slate-600",
        };
    }

    if (rate >= 10000) {
        return {
            label: "必定捕获",
            stars: 5,
            color: "text-emerald-400",
            barColor: "bg-card hover:bg-accent",
        };
    }

    if (rate >= 5000) {
        return {
            label: "非常容易",
            stars: 4,
            color: "text-green-400",
            barColor: "bg-card hover:bg-accent",
        };
    }

    if (rate >= 2000) {
        return {
            label: "容易",
            stars: 3,
            color: "text-sky-400",
            barColor: "bg-sky-400",
        };
    }

    if (rate >= 500) {
        return {
            label: "普通",
            stars: 2,
            color: "text-foreground",
            barColor: "bg-card hover:bg-accent",
        };
    }

    if (rate > 0) {
        return {
            label: "困难",
            stars: 1,
            color: "text-rose-400",
            barColor: "bg-rose-400",
        };
    }

    return {
        label: "无法野外捕获",
        stars: 0,
        color: "text-foreground",
        barColor: "bg-slate-600",
    };
});

const catchGuarantCountLabel = computed(() => {
    const rate = catchInfo.value?.catch_guarant_rate;

    if (!rate || rate <= 0) {
        return "暂无数据";
    }

    if (rate >= 10000) {
        return "1 次";
    }

    return `约 ${Math.ceil(10000 / ((rate * 12000) / 10000))} 次`;
});

const catchGuarantByBall = computed(() => {
    const rate = catchInfo.value?.catch_guarant_rate;

    if (!rate || rate <= 0) {
        return [];
    }

    if (rate >= 10000) {
        return [
            {
                name: "任意球",
                count: "1 次",
                efficiency: "—",
                color: "text-foreground",
            },
        ];
    }

    const normalCount = Math.ceil(10000 / ((rate * 12000) / 10000));
    const advancedCount = Math.ceil(10000 / ((rate * 20000) / 10000));

    return [
        {
            name: "普通咕噜球",
            count: `约 ${normalCount} 次`,
            efficiency: "×1.2",
            color: "text-foreground",
        },
        {
            name: "高级咕噜球",
            count: `约 ${advancedCount} 次`,
            efficiency: "×2.0",
            color: "text-sky-300",
        },
        {
            name: petAttributeBallLabel.value,
            count: `约 ${advancedCount} 次`,
            efficiency: "×2.0",
            color: "text-emerald-300",
        },
        {
            name: "国王球 / 捕光球",
            count: "1 次",
            efficiency: "必捕",
            color: "text-foreground",
        },
    ];
});

const catchRecommendedBall = computed(() => {
    const rate = catchInfo.value?.catch_guarant_rate;

    if (!rate || rate <= 0) {
        return "暂无推荐";
    }

    if (rate >= 10000) {
        return "任意球";
    }

    if (rate >= 5000) {
        return "普通咕噜球";
    }

    if (rate >= 2000) {
        return "普通咕噜球";
    }

    if (rate >= 500) {
        return petAttributeBallLabel.value;
    }

    return "必捕球（国王球等）";
});

const catchRawThreshold = computed(() => {
    const threshold = catchInfo.value?.catch_threshold;

    if (threshold === null || threshold === undefined) {
        return null;
    }

    return threshold;
});

const catchRawGuarantRate = computed(() => {
    const rate = catchInfo.value?.catch_guarant_rate;

    if (rate === null || rate === undefined) {
        return null;
    }

    return rate / 100;
});

const hasCatchInfo = computed(() => {
    if (!catchInfo.value) {
        return false;
    }

    return (
        catchInfo.value.catch_threshold !== null ||
        catchInfo.value.catch_guarant_rate !== null
    );
});

const TYPE_TO_ATTRIBUTE_BALL: Record<number, string> = {
    1: "美妙球",
    2: "光合球",
    3: "调温球",
    4: "网兜球",
    5: "光合球",
    6: "淘沙球",
    7: "调温球",
    8: "好战球",
    9: "绝缘球",
    10: "绝缘球",
    11: "淘沙球",
    12: "好战球",
    13: "网兜球",
    14: "美妙球",
    15: "暗星球",
    16: "暗星球",
    17: "变幻球",
    18: "变幻球",
};

const ATTRIBUTE_BALL_DESCRIPTION: Record<string, string> = {
    光合球: "对草系、光系精灵效果更好",
    网兜球: "对水系、翼系精灵效果更好",
    暗星球: "对幽系、恶系精灵效果更好",
    调温球: "对火系、冰系精灵效果更好",
    绝缘球: "对电系、毒系精灵效果更好",
    淘沙球: "对地系、虫系精灵效果更好",
    变幻球: "对幻系、机械系精灵效果更好",
    美妙球: "对普通系、萌系精灵效果更好",
    好战球: "对龙系、武系精灵效果更好",
};

const petAttributeBalls = computed(() => {
    if (!friend.value) return [];

    const balls: string[] = [];
    const mainBall = TYPE_TO_ATTRIBUTE_BALL[friend.value.main_type.id];

    if (mainBall) balls.push(mainBall);

    if (friend.value.sub_type) {
        const subBall = TYPE_TO_ATTRIBUTE_BALL[friend.value.sub_type.id];

        if (subBall && !balls.includes(subBall)) {
            balls.push(subBall);
        }
    }

    return balls;
});

const petAttributeBallLabel = computed(() => {
    const balls = petAttributeBalls.value;

    if (balls.length === 0) return "属性球";
    return balls.join(" / ");
});

const ballDescriptions = computed(() => {
    const attrBalls = petAttributeBalls.value;
    const attrEntries = attrBalls.map((name) => ({
        name,
        description:
            ATTRIBUTE_BALL_DESCRIPTION[name] ?? "对特定属性精灵效果更好",
        color: "text-emerald-300",
    }));

    return [
        {
            name: "普通咕噜球",
            description: "基础捕捉，需要较多互动",
            color: "text-foreground",
        },
        {
            name: "高级咕噜球",
            description: "互动需求大幅降低，更快进入可捕获状态",
            color: "text-sky-300",
        },
        ...(attrEntries.length > 0
            ? attrEntries
            : [
                  {
                      name: "属性球",
                      description: "对特定属性精灵效果更好，效果同高级球",
                      color: "text-emerald-300",
                  },
              ]),
        {
            name: "必捕球（国王球/捕光球/棱镜球）",
            description: "100% 必定捕获，无需任何互动",
            color: "text-foreground",
        },
    ];
});

const catchTips = [
    { label: "偷袭进战（从背后接近）", value: "×15", color: "text-foreground" },
    { label: "同行精灵在场", value: "×15", color: "text-foreground" },
    { label: "星星魔法标记后投球", value: "×1.2", color: "text-sky-300" },
    {
        label: "等级差加成（等级越高）",
        value: "×1.08",
        color: "text-foreground",
    },
    { label: "3 分钟内未投球", value: "保底清零", color: "text-rose-400" },
];

const eggGroupSummaryLabel = computed(() => {
    if (!friend.value) {
        return "暂无数据";
    }

    return formatPetEggGroupSummary(friend.value);
});

const petTopicCompletionMap = computed(() => {
    if (!friend.value?.species?.id) {
        return {};
    }

    return getSpeciesTopicCompletionMap(
        handbookProgressState.value,
        friend.value.species.id,
    );
});

const completedPetTopicCount = computed(() => {
    return petTopics.value.filter((topic) => {
        return Boolean(petTopicCompletionMap.value[topic.topic_Id]);
    }).length;
});

const petTopicCompletionRate = computed(() => {
    if (!petTopics.value.length) {
        return 0;
    }

    return Math.round(
        (completedPetTopicCount.value / petTopics.value.length) * 100,
    );
});

const petTopicLastRecordedLabel = computed(() => {
    const recordedAt = Object.values(petTopicCompletionMap.value)
        .map((value) => new Date(value).getTime())
        .filter((value) => !Number.isNaN(value));

    if (!recordedAt.length) {
        return "尚未记录";
    }

    return formatRecordDate(new Date(Math.max(...recordedAt)).toISOString());
});

const refreshLocations = computed(() => {
    return worldProfile.value?.refresh_locations ?? [];
});

const worldTypeLabel = computed(() => {
    return (
        worldProfile.value?.type_desc ??
        worldProfile.value?.classis_name ??
        "暂无类型数据"
    );
});

const introductionText = computed(() => {
    const official = officialEntry.value?.description;

    if (official) {
        return official;
    }

    return worldProfile.value?.introduction ?? "暂无图鉴介绍。";
});

const habitatSummary = computed(() => {
    const officialHabitat = officialEntry.value?.habitat;

    if (officialHabitat) {
        return officialHabitat;
    }

    if (worldProfile.value?.description_habitat) {
        return worldProfile.value.description_habitat;
    }

    if (refreshLocations.value.length) {
        return `常见于${refreshLocations.value.join("、")}`;
    }

    return "暂无栖息地信息。";
});

const officialEntry = computed(() => {
    const name = friend.value?.localized?.zh?.name;
    return name ? officialPokedex.value[name] ?? null : null;
});

const officialArchiveBadges = computed(() => {
    const entry = officialEntry.value;
    const badges: string[] = [];

    if (entry?.no) {
        badges.push(`图鉴 ${entry.no}`);
    }
    if (entry?.nickname) {
        badges.push(`昵称 ${entry.nickname}`);
    }
    if (entry?.height) {
        badges.push(`身高 ${entry.height}`);
    }
    if (entry?.weight) {
        badges.push(`体重 ${entry.weight}`);
    }

    return badges;
});

const hatchDurationLabel = computed(() => {
    return formatDuration(breedingInfo.value?.hatch_data ?? null);
});

const heightRangeLabel = computed(() => {
    return formatRange(
        breedingInfo.value?.height_low ?? null,
        breedingInfo.value?.height_high ?? null,
        "cm",
    );
});

const weightRangeLabel = computed(() => {
    return formatRange(
        normalizeWeight(breedingInfo.value?.weight_low),
        normalizeWeight(breedingInfo.value?.weight_high),
        "kg",
    );
});

watch(
    routeId,
    (id) => {
        void getFriendDetail(id);
    },
    { immediate: true },
);

watch([statChartIndicators, statChartValues], async () => {
    await nextTick();
    renderStatChart();
});

watch(
    radarChartRef,
    async (element) => {
        if (!element) {
            disposeStatChart();
            return;
        }

        bindStatChartObserver(element);
        await nextTick();
        renderStatChart();
    },
    { flush: "post" },
);

onBeforeUnmount(() => {
    controller?.abort();
    disposeStatChart();
});

function getAttackStyleLabel(style: string) {
    return attackStyleLabels[style] ?? style;
}

function isEvolutionMonsterImplemented(monsterId: number) {
    return implementedPetIds.value.has(monsterId);
}

function getCategoryLabel(category: string) {
    return categoryLabels[category] ?? category;
}

function getEnergyLabel(move: IPetsMove) {
    return `${move.energy_cost} 能量`;
}

function getPowerLabel(move: IPetsMove) {
    return move.power === null ? "-" : String(move.power);
}

function formatDuration(seconds: number | null) {
    if (seconds === null || seconds <= 0) {
        return "暂无数据";
    }

    if (seconds % 86400 === 0) {
        return `${seconds / 86400} 天`;
    }

    const hours = seconds / 3600;

    if (Number.isInteger(hours)) {
        return `${hours} 小时`;
    }

    return `${hours.toFixed(1)} 小时`;
}

function formatRange(low: number | null, high: number | null, unit: string) {
    if (low === null && high === null) {
        return "暂无数据";
    }

    if (low !== null && high !== null) {
        return low === high ? `${low}${unit}` : `${low}-${high}${unit}`;
    }

    return `${low ?? high}${unit}`;
}

function normalizeWeight(value: number | null | undefined) {
    if (value === null || value === undefined) {
        return null;
    }

    return value / 1000;
}

function parsePetId(idParam: string | string[]) {
    const id = Number(Array.isArray(idParam) ? idParam[0] : idParam);

    return Number.isFinite(id) ? id : null;
}

function formatRecordDate(value: string) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "尚未记录";
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function normalizePetTopicLookupKey(value: string | null | undefined) {
    if (!value) {
        return "";
    }

    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getPetTopicLookupKeys(pet: IPetsDetail) {
    return Array.from(
        new Set(
            [pet.localized.zh.name, pet.species.localized.zh, pet.name]
                .map((value) => normalizePetTopicLookupKey(value))
                .filter(Boolean),
        ),
    );
}

function isPetTopicCompleted(topicId: number) {
    return Boolean(petTopicCompletionMap.value[topicId]);
}

function getPetTopicRecordedLabel(topicId: number) {
    const recordedAt = petTopicCompletionMap.value[topicId];

    return recordedAt ? formatRecordDate(recordedAt) : "";
}

async function ensurePetHandbookTopicMap() {
    if (!petHandbookTopicMapPromise) {
        petHandbookTopicMapPromise = fetch("/data/tables/PET_HANDBOOK.json")
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`请求失败: ${response.status}`);
                }

                return response.json() as Promise<IPetHandbookResponse>;
            })
            .then((data) => {
                const topicMap: Record<string, IPetHandbookTopic[]> = {};

                for (const row of Object.values(data.RocoDataRows ?? {})) {
                    const lookupKey = normalizePetTopicLookupKey(row.name);

                    if (!lookupKey) {
                        continue;
                    }

                    topicMap[lookupKey] = Array.isArray(row.pet_topic)
                        ? row.pet_topic
                        : [];
                }

                return topicMap;
            })
            .catch((error) => {
                petHandbookTopicMapPromise = null;
                throw error;
            });
    }

    return petHandbookTopicMapPromise;
}

async function ensureHandbookRewards() {
    if (!handbookRewardsPromise) {
        handbookRewardsPromise = fetch("/data/handbook-rewards.json")
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`请求失败: ${response.status}`);
                }

                return response.json() as Promise<HandbookRewardsMap>;
            })
            .then((data) => {
                handbookRewards.value = data;
                return data;
            })
            .catch((error) => {
                handbookRewardsPromise = null;
                throw error;
            });
    }

    return handbookRewardsPromise;
}

function getTopicRewards(topic: IPetHandbookTopic): IHandbookRewardItem[] {
    return handbookRewards.value[topic.topic_reward] ?? [];
}

function getTopicRequirementText(topic: IPetHandbookTopic): string {
    const speciesName =
        friend.value?.localized?.zh?.name ??
        friend.value?.species?.localized?.zh ??
        friend.value?.name;

    return formatHandbookTopicRequirementSync(topic, speciesName);
}

function getRewardIconSrc(item: IHandbookRewardItem): string | null {
    if (!item.icon_id) {
        return null;
    }

    return `/assets/webp/items/${item.icon_id}.webp`;
}

function ensureItemLookup(): Promise<Record<number, IItem>> {
    if (!itemLookupPromise) {
        itemLookupPromise = fetch("/data/items.json")
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`请求失败: ${response.status}`);
                }

                return response.json() as Promise<IItem[]>;
            })
            .then((items) => {
                const lookup: Record<number, IItem> = {};

                for (const item of items) {
                    lookup[item.id] = item;
                }

                itemLookup.value = lookup;
                return lookup;
            })
            .catch(() => {
                itemLookupPromise = null;
                return {};
            });
    }

    return itemLookupPromise;
}

function getItemDetail(id: number): IItem | null {
    if (Object.keys(itemLookup.value).length === 0) {
        ensureItemLookup();
    }

    return itemLookup.value[id] ?? null;
}

function getQualityColor(quality: number): string {
    switch (quality) {
        case 5:
            return "text-orange-300";
        case 4:
            return "text-violet-300";
        case 3:
            return "text-sky-300";
        case 2:
            return "text-emerald-300";
        default:
            return "text-foreground";
    }
}

function resetPetTopics() {
    petTopicRequestKey += 1;
    petTopics.value = [];
    petTopicDialogOpen.value = false;
    petTopicErrorMessage.value = "";
    isPetTopicLoading.value = false;
}

async function getPetTopics(pet: IPetsDetail) {
    const requestKey = ++petTopicRequestKey;
    isPetTopicLoading.value = true;
    petTopicErrorMessage.value = "";

    try {
        await initHandbookProgress();

        const [topicMap] = await Promise.all([
            ensurePetHandbookTopicMap(),
            ensureHandbookRewards(),
            ensureItemLookup(),
            ensureHandbookTopicSkillNames(),
        ]);
        const lookupKeys = getPetTopicLookupKeys(pet);

        if (requestKey !== petTopicRequestKey) {
            return;
        }

        const matchedLookupKey =
            lookupKeys.find((lookupKey) => lookupKey in topicMap) ?? "";

        petTopics.value = matchedLookupKey
            ? (topicMap[matchedLookupKey] ?? [])
            : [];
    } catch {
        if (requestKey !== petTopicRequestKey) {
            return;
        }

        resetPetTopics();
        petTopicErrorMessage.value = "图鉴任务加载失败，请稍后重试。";
    } finally {
        if (requestKey === petTopicRequestKey) {
            isPetTopicLoading.value = false;
        }
    }
}

function bindStatChartObserver(element: HTMLDivElement) {
    if (typeof ResizeObserver === "undefined") {
        return;
    }

    if (!statChartResizeObserver) {
        statChartResizeObserver = new ResizeObserver(() => {
            statChart?.resize();
        });
    }

    if (statChartObservedElement === element) {
        return;
    }

    statChartResizeObserver.disconnect();
    statChartResizeObserver.observe(element);
    statChartObservedElement = element;
}

function disposeStatChart() {
    statChartResizeObserver?.disconnect();
    statChartObservedElement = null;
    statChart?.dispose();
    statChart = null;
}

function ensureStatChart() {
    const chartElement = radarChartRef.value;

    if (!chartElement) {
        return null;
    }

    if (statChart && statChart.getDom() !== chartElement) {
        statChart.dispose();
        statChart = null;
    }

    if (!statChart) {
        statChart = init(chartElement, undefined, {
            renderer: "canvas",
        });
    }

    return statChart;
}

function getStatChartOption(): StatRadarOption {
    return {
        animationDuration: 280,
        tooltip: {
            trigger: "item",
            backgroundColor: "rgba(2, 6, 23, 0.96)",
            borderColor: "rgba(148, 163, 184, 0.16)",
            textStyle: {
                color: "#e2e8f0",
                fontSize: 12,
            },
            formatter: () => {
                return statRows.value
                    .map((stat) => `${stat.label}: ${stat.value}`)
                    .join("<br />");
            },
        },
        radar: {
            center: ["50%", "52%"],
            radius: "64%",
            shape: "polygon",
            splitNumber: STAT_CHART_SPLIT_NUMBER,
            indicator: statChartIndicators.value,
            axisName: {
                color: "#cbd5e1",
                fontSize: 11,
                formatter(name?: string) {
                    if (!name) {
                        return "";
                    }

                    const stat = statRows.value.find(
                        (item) => item.label === name,
                    );

                    if (!stat) {
                        return name;
                    }

                    return `{label|${name}}\n{value|${stat.value}}`;
                },
                rich: {
                    label: {
                        color: "#e2e8f0",
                        fontSize: 11,
                        fontWeight: 600,
                        lineHeight: 14,
                    },
                    value: {
                        color: "#64748b",
                        fontSize: 10,
                        fontWeight: 500,
                        lineHeight: 12,
                    },
                },
            },
            splitArea: {
                areaStyle: {
                    color: [
                        "rgba(15, 23, 42, 0.18)",
                        "rgba(15, 23, 42, 0.28)",
                        "rgba(15, 23, 42, 0.38)",
                        "rgba(15, 23, 42, 0.5)",
                    ],
                },
            },
            splitLine: {
                lineStyle: {
                    color: "rgba(148, 163, 184, 0.18)",
                },
            },
            axisLine: {
                lineStyle: {
                    color: "rgba(148, 163, 184, 0.16)",
                },
            },
        },
        series: [
            {
                type: "radar",
                symbol: "circle",
                symbolSize: 6,
                emphasis: {
                    lineStyle: {
                        width: 2,
                    },
                },
                itemStyle: {
                    color: "#fbbf24",
                    borderColor: "rgba(255,255,255,0.86)",
                    borderWidth: 1,
                },
                lineStyle: {
                    color: "#fbbf24",
                    width: 2,
                },
                areaStyle: {
                    color: "rgba(251, 191, 36, 0.18)",
                },
                data: [
                    {
                        value: statChartValues.value,
                    },
                ],
            },
        ],
    };
}

function renderStatChart() {
    if (!statRows.value.length) {
        statChart?.clear();
        return;
    }

    const chart = ensureStatChart();

    if (!chart) {
        return;
    }

    chart.setOption(getStatChartOption(), true);
    chart.resize();
}

async function ensureTypeMap(signal: AbortSignal) {
    if (Object.keys(typeNameMap.value).length > 0) {
        return;
    }

    const response = await fetch("/data/types.json", { signal });

    if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
    }

    const types = (await response.json()) as IMonsterTypeDetail[];
    typeNameMap.value = Object.fromEntries(
        types.map((type) => [type.id, type.localized.zh]),
    );
}

async function ensureOfficialPokedex(signal: AbortSignal) {
    if (Object.keys(officialPokedex.value).length > 0) {
        return;
    }

    try {
        const response = await fetch("/data/pokedex-official.json", { signal });

        if (!response.ok) {
            return;
        }

        const payload = (await response.json()) as IOfficialPokedexPayload;
        officialPokedex.value = payload?.entries ?? {};
    } catch {
        // 官方图鉴为增强数据，加载失败时静默降级到游戏解包字段。
        officialPokedex.value = {};
    }
}

async function ensureImplementedPetIds(signal: AbortSignal) {
    if (implementedPetIds.value.size > 0) {
        return;
    }

    const response = await fetch("/data/Pets.json", { signal });

    if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
    }

    const pets = (await response.json()) as IPets[];
    implementedPetIds.value = new Set(
        pets.filter((pet) => isPetImplemented(pet)).map((pet) => pet.id),
    );
}

async function ensureMoveDictionary(signal: AbortSignal) {
    if (Object.keys(moveDictionary.value).length > 0) {
        return;
    }

    const response = await fetch("/data/moves.json", { signal });

    if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
    }

    const moves = (await response.json()) as IPetsMove[];
    moveDictionary.value = Object.fromEntries(
        moves.map((move) => [move.id, move]),
    );
}

async function getFriendDetail(idParam: string | string[]) {
    const id = parsePetId(idParam);

    if (id === null) {
        errorMessage.value = "精灵编号无效。";
        friend.value = null;
        resetPetTopics();
        return;
    }

    controller?.abort();
    controller = new AbortController();
    isLoading.value = true;
    errorMessage.value = "";
    resetMoveFilters();

    try {
        await Promise.all([
            ensureTypeMap(controller.signal),
            ensureImplementedPetIds(controller.signal),
            ensureMoveDictionary(controller.signal),
            ensureOfficialPokedex(controller.signal),
        ]);

        const response = await fetch(`/data/pets/${id}.json`, {
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }

        const nextFriend = (await response.json()) as IPetsDetail;
        friend.value = nextFriend;
        void getPetTopics(nextFriend);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            return;
        }

        errorMessage.value = "精灵详情加载失败，请稍后重试。";
        friend.value = null;
        resetPetTopics();
    } finally {
        isLoading.value = false;
    }
}
</script>

<template>
    <section class="space-y-4">
        <div v-if="isLoading" class="grid gap-4 xl:grid-cols-[260px_1fr]">
            <div class="space-y-4">
                <Skeleton
                    class="aspect-square rounded-[10px] border border-border bg-muted"
                />
                <Skeleton
                    class="min-h-64 rounded-[10px] border border-border bg-muted"
                />
            </div>
            <Skeleton
                class="min-h-72 rounded-[10px] border border-border bg-muted"
            />
        </div>

        <div
            v-else-if="errorMessage"
            class="rounded-[10px] border border-destructive/20 bg-destructive/8 px-4 py-8 text-center text-sm text-destructive"
        >
            {{ errorMessage }}
        </div>

        <template v-else-if="friend">
            <Card class="overflow-hidden border-border bg-card py-0 shadow-md">
                <div class="grid gap-4 p-4 xl:grid-cols-[260px_1fr]">
                    <div class="space-y-4">
                        <FriendPortrait
                            :name="friend.name"
                            :alt="friend.localized.zh.name"
                            class="aspect-square w-full rounded-[10px]"
                            img-class="object-contain p-4"
                            eager
                        />

                        <div
                            class="rounded-[10px] border border-border bg-card p-4"
                        >
                            <p
                                class="flex items-center gap-2 text-[11px] tracking-[0.18em] text-foreground uppercase"
                            >
                                <ListTodo class="h-3.5 w-3.5 text-foreground" />
                                图鉴任务
                                <Badge
                                    v-if="
                                        isSpeciesCollected(
                                            handbookProgressState,
                                            friend.species.id,
                                        )
                                    "
                                    variant="outline"
                                    class="rounded-[10px] border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 normal-case tracking-normal text-emerald-100"
                                >
                                    已收集
                                </Badge>
                            </p>

                            <div
                                v-if="isPetTopicLoading"
                                class="mt-3 space-y-2.5"
                            >
                                <Skeleton
                                    class="h-20 rounded-[10px] border border-border bg-muted"
                                />
                                <Skeleton
                                    class="h-16 rounded-[10px] border border-border bg-muted"
                                />
                                <Skeleton
                                    class="h-16 rounded-[10px] border border-border bg-muted"
                                />
                            </div>

                            <div
                                v-else-if="petTopicErrorMessage"
                                class="mt-3 rounded-[10px] border border-destructive/20 bg-destructive/8 px-3 py-4 text-sm text-destructive"
                            >
                                {{ petTopicErrorMessage }}
                            </div>

                            <template v-else-if="petTopics.length">
                                <div
                                    class="mt-3 rounded-[10px] border border-border bg-muted p-3"
                                >
                                    <div
                                        class="flex items-end justify-between gap-3"
                                    >
                                        <div>
                                            <p
                                                class="text-[11px] tracking-[0.14em] text-foreground uppercase"
                                            >
                                                完成进度
                                            </p>
                                            <p
                                                class="mt-1 text-lg font-semibold text-foreground"
                                            >
                                                {{ completedPetTopicCount }}/{{
                                                    petTopics.length
                                                }}
                                            </p>
                                        </div>
                                        <p
                                            class="text-2xl font-semibold text-emerald-200"
                                        >
                                            {{ petTopicCompletionRate }}%
                                        </p>
                                    </div>

                                    <div
                                        class="mt-3 h-2 overflow-hidden rounded-[10px] bg-muted"
                                    >
                                        <div
                                            class="h-full rounded-[10px] bg-card transition-[width] duration-300"
                                            :style="{
                                                width: `${petTopicCompletionRate}%`,
                                            }"
                                        />
                                    </div>

                                    <p
                                        class="mt-2 text-xs leading-5 text-foreground"
                                    >
                                        最近记录：{{
                                            petTopicLastRecordedLabel
                                        }}
                                    </p>
                                </div>

                                <p
                                    class="mt-3 text-sm leading-6 text-foreground text-center"
                                >
                                    共
                                    {{ petTopics.length }}
                                    项任务.
                                </p>

                                <Button
                                    variant="outline"
                                    class="mt-3 w-full rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                                    @click="petTopicDialogOpen = true"
                                >
                                    <ListTodo class="h-4 w-4" />
                                    查看图鉴任务
                                </Button>

                                <Button
                                    variant="outline"
                                    class="mt-3 w-full rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                                    as-child
                                >
                                    <RouterLink
                                        :to="`/handbook-progress?species=${friend.species.id}`"
                                    >
                                        前往图鉴进度管理
                                    </RouterLink>
                                </Button>

                                <p
                                    class="mt-3 text-xs leading-5 text-foreground text-center"
                                >
                                    任务进度请在图鉴进度页管理，不会同步到其他设备。
                                </p>
                            </template>

                            <p
                                v-else
                                class="mt-3 text-sm leading-6 text-foreground"
                            >
                                暂无图鉴任务。
                            </p>
                        </div>
                    </div>

                    <div class="space-y-4">
                        <div
                            class="flex flex-wrap items-start justify-between gap-3"
                        >
                            <div class="space-y-2.5">
                                <div class="flex flex-wrap gap-2">
                                    <Badge
                                        variant="outline"
                                        class="rounded-[10px] border-border bg-white/5 px-2.5 py-0.5 text-foreground"
                                    >
                                        No.{{ formatPetHandbookNo(friend) }}
                                    </Badge>
                                    <Badge
                                        class="rounded-[10px] bg-white/10 text-foreground"
                                    >
                                        {{ friend.main_type.localized.zh }}
                                    </Badge>
                                    <Badge
                                        v-if="friend.sub_type"
                                        variant="secondary"
                                        class="rounded-[10px] bg-slate-700/60 text-foreground"
                                    >
                                        {{ friend.sub_type.localized.zh }}
                                    </Badge>
                                    <Badge
                                        variant="outline"
                                        class="rounded-[10px] border-sky-400/20 bg-sky-400/10 text-sky-200"
                                    >
                                        {{
                                            friend.default_legacy_type.localized
                                                .zh
                                        }}遗传
                                    </Badge>
                                    <Badge
                                        v-if="friend.is_leader_form"
                                        class="rounded-[10px] border-0 bg-card hover:bg-accent/15 text-foreground"
                                    >
                                        首领形态
                                    </Badge>
                                    <Badge
                                        v-if="!isPetImplemented(friend)"
                                        variant="outline"
                                        class="rounded-[10px] border-border/20 bg-card hover:bg-accent/10 text-foreground"
                                    >
                                        未实装
                                    </Badge>
                                    <Badge
                                        v-if="worldProfile?.classis_name"
                                        variant="outline"
                                        class="rounded-[10px] border-emerald-400/20 bg-card hover:bg-accent/10 text-emerald-200"
                                    >
                                        {{ worldProfile.classis_name }}
                                    </Badge>
                                </div>

                                <div class="space-y-1.5">
                                    <h1
                                        class="text-2xl font-semibold tracking-tight text-foreground md:text-3xl"
                                    >
                                        {{ friend.localized.zh.name }}
                                    </h1>
                                    <p class="text-sm text-foreground">
                                        {{ friend.species.localized.zh }} ·
                                        {{
                                            getAttackStyleLabel(
                                                friend.preferred_attack_style,
                                            )
                                        }}
                                        <span v-if="worldProfile?.type_desc">
                                            · {{ worldProfile.type_desc }}
                                        </span>
                                    </p>
                                </div>
                            </div>

                            <Button
                                variant="outline"
                                class="rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                                as-child
                            >
                                <RouterLink to="/encyclopedia"
                                    >返回图鉴</RouterLink
                                >
                            </Button>
                        </div>

                        <Separator class="bg-white/10" />

                        <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                            <div
                                class="rounded-[10px] border border-border bg-muted px-3 py-2.5"
                            >
                                <p
                                    class="text-[11px] tracking-[0.18em] text-foreground uppercase"
                                >
                                    总种族值
                                </p>
                                <p
                                    class="mt-1.5 text-xl font-semibold text-foreground"
                                >
                                    {{ totalStats }}
                                </p>
                            </div>

                            <div
                                class="rounded-[10px] border border-border bg-muted px-3 py-2.5"
                            >
                                <p
                                    class="text-[11px] tracking-[0.18em] text-foreground uppercase"
                                >
                                    最高单项
                                </p>
                                <p
                                    class="mt-1.5 text-xl font-semibold text-foreground"
                                >
                                    {{ highestStat.label }}
                                    {{ highestStat.value }}
                                </p>
                            </div>

                            <div
                                class="rounded-[10px] border border-border bg-muted px-3 py-2.5"
                            >
                                <p
                                    class="text-[11px] tracking-[0.18em] text-foreground uppercase"
                                >
                                    自有技能
                                </p>
                                <p
                                    class="mt-1.5 text-xl font-semibold text-foreground"
                                >
                                    {{ friend.move_pool.length }}
                                </p>
                            </div>

                            <div
                                class="rounded-[10px] border border-border bg-muted px-3 py-2.5"
                            >
                                <p
                                    class="text-[11px] tracking-[0.18em] text-foreground uppercase"
                                >
                                    覆盖属性
                                </p>
                                <p
                                    class="mt-1.5 text-xl font-semibold text-foreground"
                                >
                                    {{ moveCoverageTypes.length }}
                                </p>
                            </div>
                        </div>

                        <div class="grid gap-3 xl:grid-cols-[1.08fr_0.92fr]">
                            <div
                                class="rounded-[10px] border border-border bg-card p-4"
                            >
                                <p
                                    class="flex items-center gap-2 text-[11px] tracking-[0.18em] text-foreground uppercase"
                                >
                                    <BookOpen
                                        class="h-3.5 w-3.5 text-sky-300"
                                    />
                                    图鉴档案
                                </p>
                                <div class="mt-3 flex flex-wrap gap-2">
                                    <Badge
                                        class="rounded-[10px] bg-white/10 text-foreground"
                                    >
                                        {{ worldTypeLabel }}
                                    </Badge>
                                    <Badge
                                        v-if="worldProfile?.classis_name"
                                        variant="outline"
                                        class="rounded-[10px] border-border bg-card text-foreground"
                                    >
                                        {{ worldProfile.classis_name }}
                                    </Badge>
                                    <Badge
                                        v-if="worldProfile?.movement_type"
                                        variant="outline"
                                        class="rounded-[10px] border-border bg-card text-foreground"
                                    >
                                        {{ worldProfile.movement_type }}
                                    </Badge>
                                    <Badge
                                        v-for="badge in officialArchiveBadges"
                                        :key="badge"
                                        variant="outline"
                                        class="rounded-[10px] border-amber-400/20 bg-amber-400/10 text-amber-200"
                                    >
                                        {{ badge }}
                                    </Badge>
                                </div>
                                <p
                                    class="mt-3 text-sm leading-6 text-foreground"
                                >
                                    {{ introductionText }}
                                </p>
                                <p
                                    class="mt-3 text-xs leading-6 text-foreground"
                                >
                                    {{ habitatSummary }}
                                </p>
                            </div>

                            <div
                                class="rounded-[10px] border border-border bg-card p-4"
                            >
                                <p
                                    class="flex items-center gap-2 text-[11px] tracking-[0.18em] text-foreground uppercase"
                                >
                                    <MapPin
                                        class="h-3.5 w-3.5 text-emerald-300"
                                    />
                                    刷新与培育
                                </p>
                                <div class="mt-3 flex flex-wrap gap-2">
                                    <Badge
                                        variant="outline"
                                        class="rounded-[10px] border-border bg-card text-foreground"
                                    >
                                        蛋组 {{ eggGroupSummaryLabel }}
                                    </Badge>
                                    <Badge
                                        v-if="!isPetImplemented(friend)"
                                        variant="outline"
                                        class="rounded-[10px] border-border/20 bg-card hover:bg-accent/10 text-foreground"
                                    >
                                        未实装
                                    </Badge>
                                    <Badge
                                        v-if="!refreshLocations.length"
                                        variant="outline"
                                        class="rounded-[10px] border-border bg-card text-foreground"
                                    >
                                        暂无刷新位置数据
                                    </Badge>
                                </div>

                                <div class="mt-4 grid gap-2 sm:grid-cols-3">
                                    <div
                                        class="rounded-[10px] border border-border bg-muted px-3 py-2.5"
                                    >
                                        <p
                                            class="flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-foreground uppercase"
                                        >
                                            <Egg
                                                class="h-3.5 w-3.5 text-foreground"
                                            />
                                            孵化时长
                                        </p>
                                        <p
                                            class="mt-1.5 text-sm font-semibold text-foreground"
                                        >
                                            {{ hatchDurationLabel }}
                                        </p>
                                    </div>
                                    <div
                                        class="rounded-[10px] border border-border bg-muted px-3 py-2.5"
                                    >
                                        <p
                                            class="flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-foreground uppercase"
                                        >
                                            <Ruler
                                                class="h-3.5 w-3.5 text-sky-300"
                                            />
                                            身高范围
                                        </p>
                                        <p
                                            class="mt-1.5 text-sm font-semibold text-foreground"
                                        >
                                            {{ heightRangeLabel }}
                                        </p>
                                    </div>
                                    <div
                                        class="rounded-[10px] border border-border bg-muted px-3 py-2.5"
                                    >
                                        <p
                                            class="text-[11px] tracking-[0.14em] text-foreground uppercase"
                                        >
                                            体重范围
                                        </p>
                                        <p
                                            class="mt-1.5 text-sm font-semibold text-foreground"
                                        >
                                            {{ weightRangeLabel }}
                                        </p>
                                    </div>
                                </div>

                                <div v-if="hasCatchInfo" class="mt-4">
                                    <p
                                        class="flex items-center gap-2 text-[11px] tracking-[0.18em] text-foreground uppercase"
                                    >
                                        <Target
                                            class="h-3.5 w-3.5 text-rose-300"
                                        />
                                        捕捉信息
                                    </p>
                                    <div class="mt-2 grid gap-2 sm:grid-cols-3">
                                        <HoverCard :open-delay="200">
                                            <HoverCardTrigger as-child>
                                                <div
                                                    class="cursor-help rounded-[10px] border border-border bg-muted px-3 py-2.5 transition-colors hover:border-border hover:bg-accent"
                                                >
                                                    <p
                                                        class="text-[11px] tracking-[0.14em] text-foreground uppercase"
                                                    >
                                                        捕捉难度
                                                    </p>
                                                    <p
                                                        class="mt-1.5 text-sm font-semibold"
                                                        :class="
                                                            catchDifficulty.color
                                                        "
                                                    >
                                                        {{
                                                            catchDifficulty.label
                                                        }}
                                                    </p>
                                                    <div
                                                        class="mt-1.5 flex gap-1"
                                                    >
                                                        <span
                                                            v-for="i in 5"
                                                            :key="i"
                                                            class="h-1.5 w-4 rounded-[10px]"
                                                            :class="
                                                                i <=
                                                                catchDifficulty.stars
                                                                    ? catchDifficulty.barColor
                                                                    : 'bg-white/10'
                                                            "
                                                        />
                                                    </div>
                                                </div>
                                            </HoverCardTrigger>
                                            <HoverCardContent
                                                side="top"
                                                :side-offset="8"
                                                class="w-72 rounded-[10px] border border-white/15 bg-slate-900 p-4 text-sm shadow-xl"
                                            >
                                                <p
                                                    class="font-semibold text-foreground"
                                                >
                                                    关于捕捉难度
                                                </p>
                                                <p
                                                    class="mt-2 leading-relaxed text-foreground"
                                                >
                                                    难度越高，需要更多互动才能让精灵进入可捕获状态。以下技巧可以提升捕捉概率：
                                                </p>
                                                <div class="mt-2.5 space-y-1.5">
                                                    <div
                                                        v-for="tip in catchTips"
                                                        :key="tip.label"
                                                        class="flex items-baseline justify-between gap-2"
                                                    >
                                                        <p
                                                            class="text-xs"
                                                            :class="tip.color"
                                                        >
                                                            {{ tip.label }}
                                                        </p>
                                                        <p
                                                            class="shrink-0 text-xs text-foreground"
                                                        >
                                                            {{ tip.value }}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div
                                                    class="mt-3 border-t border-border pt-3"
                                                >
                                                    <p
                                                        class="text-[10px] tracking-wider text-foreground uppercase"
                                                    >
                                                        原始数据
                                                    </p>
                                                    <div
                                                        class="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
                                                    >
                                                        <p
                                                            class="text-foreground"
                                                        >
                                                            捕捉阈值
                                                        </p>
                                                        <p
                                                            class="text-foreground"
                                                        >
                                                            {{
                                                                catchRawThreshold ??
                                                                "—"
                                                            }}
                                                        </p>
                                                        <p
                                                            class="text-foreground"
                                                        >
                                                            保底捕获率
                                                        </p>
                                                        <p
                                                            class="text-foreground"
                                                        >
                                                            {{
                                                                catchRawGuarantRate !==
                                                                null
                                                                    ? `${catchRawGuarantRate}%`
                                                                    : "—"
                                                            }}
                                                        </p>
                                                    </div>
                                                </div>
                                            </HoverCardContent>
                                        </HoverCard>
                                        <HoverCard :open-delay="200">
                                            <HoverCardTrigger as-child>
                                                <div
                                                    class="cursor-help rounded-[10px] border border-border bg-muted px-3 py-2.5 transition-colors hover:border-border hover:bg-accent"
                                                >
                                                    <p
                                                        class="text-[11px] tracking-[0.14em] text-foreground uppercase"
                                                    >
                                                        普通球保底
                                                    </p>
                                                    <p
                                                        class="mt-1.5 text-sm font-semibold text-foreground"
                                                    >
                                                        {{
                                                            catchGuarantCountLabel
                                                        }}
                                                    </p>
                                                </div>
                                            </HoverCardTrigger>
                                            <HoverCardContent
                                                side="top"
                                                :side-offset="8"
                                                class="w-64 rounded-[10px] border border-white/15 bg-slate-900 p-4 text-sm shadow-xl"
                                            >
                                                <p
                                                    class="font-semibold text-foreground"
                                                >
                                                    各球保底次数
                                                </p>
                                                <p
                                                    class="mt-1.5 text-xs leading-relaxed text-foreground"
                                                >
                                                    使用不同球时，大约需要多少次保底捕获
                                                </p>
                                                <div
                                                    class="mt-3 grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-2"
                                                >
                                                    <p
                                                        class="text-[10px] text-foreground"
                                                    >
                                                        球
                                                    </p>
                                                    <p
                                                        class="text-[10px] text-foreground"
                                                    >
                                                        效率
                                                    </p>
                                                    <p
                                                        class="text-right text-[10px] text-foreground"
                                                    >
                                                        保底
                                                    </p>
                                                    <template
                                                        v-for="ball in catchGuarantByBall"
                                                        :key="ball.name"
                                                    >
                                                        <p
                                                            class="text-xs font-medium"
                                                            :class="ball.color"
                                                        >
                                                            {{ ball.name }}
                                                        </p>
                                                        <p
                                                            class="text-xs text-foreground"
                                                        >
                                                            {{
                                                                ball.efficiency
                                                            }}
                                                        </p>
                                                        <p
                                                            class="text-right text-xs font-semibold text-foreground"
                                                        >
                                                            {{ ball.count }}
                                                        </p>
                                                    </template>
                                                </div>
                                                <div
                                                    class="mt-3 border-t border-border pt-3"
                                                >
                                                    <p
                                                        class="text-[10px] tracking-wider text-foreground uppercase"
                                                    >
                                                        原始数据
                                                    </p>
                                                    <div
                                                        class="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
                                                    >
                                                        <p
                                                            class="text-foreground"
                                                        >
                                                            保底捕获率
                                                        </p>
                                                        <p
                                                            class="text-foreground"
                                                        >
                                                            {{
                                                                catchRawGuarantRate !==
                                                                null
                                                                    ? `${catchRawGuarantRate}%`
                                                                    : "—"
                                                            }}
                                                        </p>
                                                        <p
                                                            class="text-foreground"
                                                        >
                                                            普通球效率
                                                        </p>
                                                        <p
                                                            class="text-foreground"
                                                        >
                                                            12000
                                                        </p>
                                                        <p
                                                            class="text-foreground"
                                                        >
                                                            高级/属性球效率
                                                        </p>
                                                        <p
                                                            class="text-foreground"
                                                        >
                                                            20000
                                                        </p>
                                                    </div>
                                                </div>
                                                <p
                                                    class="mt-2 text-xs text-foreground"
                                                >
                                                    注：3
                                                    分钟内未投球，保底进度会清零。
                                                </p>
                                            </HoverCardContent>
                                        </HoverCard>
                                        <HoverCard :open-delay="200">
                                            <HoverCardTrigger as-child>
                                                <div
                                                    class="cursor-help rounded-[10px] border border-border bg-muted px-3 py-2.5 transition-colors hover:border-border hover:bg-accent"
                                                >
                                                    <p
                                                        class="text-[11px] tracking-[0.14em] text-foreground uppercase"
                                                    >
                                                        推荐用球
                                                    </p>
                                                    <p
                                                        class="mt-1.5 text-sm font-semibold text-foreground"
                                                    >
                                                        {{
                                                            catchRecommendedBall
                                                        }}
                                                    </p>
                                                </div>
                                            </HoverCardTrigger>
                                            <HoverCardContent
                                                side="top"
                                                :side-offset="8"
                                                class="w-72 rounded-[10px] border border-white/15 bg-slate-900 p-4 text-sm shadow-xl"
                                            >
                                                <p
                                                    class="font-semibold text-foreground"
                                                >
                                                    不同精灵球效果
                                                </p>
                                                <div class="mt-3 space-y-2.5">
                                                    <div
                                                        v-for="ball in ballDescriptions"
                                                        :key="ball.name"
                                                    >
                                                        <p
                                                            class="text-xs font-medium"
                                                            :class="ball.color"
                                                        >
                                                            {{ ball.name }}
                                                        </p>
                                                        <p
                                                            class="mt-0.5 text-xs leading-relaxed text-foreground"
                                                        >
                                                            {{
                                                                ball.description
                                                            }}
                                                        </p>
                                                    </div>
                                                </div>
                                                <p
                                                    class="mt-3 text-xs text-foreground"
                                                >
                                                    注：3
                                                    分钟内未投球，保底进度会清零。
                                                </p>
                                            </HoverCardContent>
                                        </HoverCard>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
                            <div
                                class="rounded-[10px] border border-border bg-card p-4"
                            >
                                <p
                                    class="text-[11px] tracking-[0.18em] text-foreground uppercase"
                                >
                                    特性
                                </p>
                                <div class="mt-2 flex gap-3">
                                    <SkillIcon
                                        v-if="friend.trait"
                                        :icon-id="friend.trait.icon_id"
                                        :alt="friend.trait.localized.zh.name"
                                        size="lg"
                                    />
                                    <div class="min-w-0 flex-1">
                                        <h2
                                            class="text-lg font-semibold tracking-tight text-foreground"
                                        >
                                            {{
                                                friend.trait?.localized.zh
                                                    .name ?? "暂无特性数据"
                                            }}
                                        </h2>
                                        <p
                                            class="mt-1 text-sm leading-6 text-foreground"
                                        >
                                            {{
                                                friend.trait?.localized.zh
                                                    .description ??
                                                "当前接口没有返回特性说明。"
                                            }}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div
                                class="rounded-[10px] border border-border bg-card p-4"
                            >
                                <p
                                    class="flex items-center gap-2 text-[11px] tracking-[0.18em] text-foreground uppercase"
                                >
                                    <BarChart3
                                        class="h-3.5 w-3.5 text-primary"
                                    />
                                    技能摘要
                                </p>
                                <div class="mt-3 flex flex-wrap gap-2">
                                    <Badge
                                        v-for="item in moveSummary"
                                        :key="item.category"
                                        variant="outline"
                                        class="rounded-[10px] border-border bg-white/5 text-foreground"
                                    >
                                        {{ item.label }} {{ item.count }}
                                    </Badge>
                                </div>
                                <p
                                    class="mt-3 text-sm leading-6 text-foreground"
                                >
                                    最高属性为
                                    {{ highestStat.label }}，当前技能覆盖
                                    {{ moveCoverageTypes.length }} 个系别。
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>

            <Tabs default-value="overview" class="space-y-3">
                <TabsList
                    class="h-auto w-full flex-wrap justify-start rounded-[10px] bg-muted p-1"
                >
                    <TabsTrigger
                        value="overview"
                        class="rounded-[10px] px-3 py-1.5"
                    >
                        概览
                    </TabsTrigger>
                    <TabsTrigger
                        value="moves"
                        class="rounded-[10px] px-3 py-1.5"
                    >
                        自有技能
                    </TabsTrigger>
                    <TabsTrigger
                        value="stones"
                        class="rounded-[10px] px-3 py-1.5"
                    >
                        学习技能
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" class="space-y-4">
                    <Card class="border-border bg-card shadow-sm">
                        <CardHeader class="pb-3">
                            <CardTitle class="text-foreground"
                                >进化链</CardTitle
                            >
                            <CardDescription class="text-foreground">
                                按阶段横向展示，点击节点可跳转到对应详情页。
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div class="overflow-x-auto pb-1">
                                <div class="flex min-w-max items-center gap-3">
                                    <template
                                        v-for="(
                                            stage, stageIndex
                                        ) in evolutionStages"
                                        :key="stage.depth"
                                    >
                                        <div
                                            class="min-w-48 rounded-[10px] border border-border bg-muted p-3"
                                        >
                                            <div
                                                class="mb-3 flex items-center justify-between gap-2"
                                            >
                                                <p
                                                    class="text-sm font-medium text-foreground"
                                                >
                                                    第
                                                    {{ stage.depth + 1 }} 阶段
                                                </p>
                                                <Badge
                                                    v-if="stage.is_leader_stage"
                                                    class="rounded-[10px] border-0 bg-card hover:bg-accent/15 text-foreground"
                                                >
                                                    <Crown
                                                        class="h-3.5 w-3.5"
                                                    />
                                                    首领
                                                </Badge>
                                            </div>

                                            <div class="grid gap-2.5">
                                                <RouterLink
                                                    v-for="monster in stage.monsters"
                                                    :key="monster.id"
                                                    :to="`/pets/${monster.id}`"
                                                    :class="[
                                                        monster.id === friend.id
                                                            ? 'border-primary/40 bg-primary/10 shadow-md'
                                                            : 'border-border bg-card hover:border-sky-400/30 hover:bg-muted',
                                                        !isEvolutionMonsterImplemented(
                                                            monster.id,
                                                        )
                                                            ? 'opacity-60'
                                                            : '',
                                                    ]"
                                                    class="group block rounded-[10px] border p-2.5 transition-colors"
                                                >
                                                    <div
                                                        class="flex items-center gap-2.5"
                                                    >
                                                        <FriendPortrait
                                                            :name="monster.name"
                                                            :alt="
                                                                monster
                                                                    .localized
                                                                    .zh.name
                                                            "
                                                            class="h-16 w-16 shrink-0 rounded-[10px]"
                                                            img-class="object-contain p-2"
                                                        />

                                                        <div
                                                            class="min-w-0 flex-1"
                                                        >
                                                            <div
                                                                class="flex flex-wrap items-center gap-2"
                                                            >
                                                                <p
                                                                    class="text-[11px] tracking-[0.14em] text-foreground uppercase"
                                                                >
                                                                    No.{{
                                                                        formatPetHandbookNo(
                                                                            monster,
                                                                        )
                                                                    }}
                                                                </p>
                                                                <Badge
                                                                    v-if="
                                                                        monster.id ===
                                                                        friend.id
                                                                    "
                                                                    variant="outline"
                                                                    class="rounded-[10px] border-primary/30 bg-primary/10 text-primary"
                                                                >
                                                                    当前
                                                                </Badge>
                                                            </div>
                                                            <p
                                                                class="mt-1 truncate text-sm font-semibold text-foreground"
                                                            >
                                                                {{
                                                                    monster
                                                                        .localized
                                                                        .zh.name
                                                                }}
                                                            </p>
                                                            <p
                                                                class="mt-1 truncate text-xs text-foreground"
                                                            >
                                                                {{
                                                                    monster
                                                                        .main_type
                                                                        .localized
                                                                        .zh
                                                                }}
                                                                <span
                                                                    v-if="
                                                                        monster.sub_type
                                                                    "
                                                                >
                                                                    /
                                                                    {{
                                                                        monster
                                                                            .sub_type
                                                                            .localized
                                                                            .zh
                                                                    }}
                                                                </span>
                                                            </p>

                                                            <div
                                                                v-if="
                                                                    monster
                                                                        .evolution_conditions
                                                                        .length
                                                                "
                                                                class="mt-2 space-y-1"
                                                            >
                                                                <p
                                                                    class="text-[10px] tracking-[0.14em] text-foreground uppercase"
                                                                >
                                                                    进化条件
                                                                </p>
                                                                <p
                                                                    v-for="condition in monster.evolution_conditions"
                                                                    :key="
                                                                        condition
                                                                    "
                                                                    class="text-xs leading-5 text-foreground"
                                                                >
                                                                    {{
                                                                        condition
                                                                    }}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </RouterLink>
                                            </div>
                                        </div>

                                        <div
                                            v-if="
                                                stageIndex <
                                                evolutionStages.length - 1
                                            "
                                            class="flex items-center justify-center px-1 text-foreground"
                                        >
                                            <ArrowRight class="h-4 w-4" />
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div class="grid gap-4 2xl:grid-cols-[1.08fr_0.92fr]">
                        <Card class="border-border bg-card shadow-sm">
                            <CardHeader class="pb-3">
                                <CardTitle class="text-foreground"
                                    >基础面板</CardTitle
                                >
                                <CardDescription class="text-foreground">
                                    使用 ECharts 雷达图展示六维属性。
                                </CardDescription>
                            </CardHeader>
                            <CardContent class="space-y-4">
                                <div
                                    class="stat-radar-panel relative rounded-[10px] border border-border bg-slate-950/70 p-3"
                                >
                                    <div
                                        ref="radarChartRef"
                                        class="stat-radar-chart h-72 w-full md:h-80"
                                    />
                                    <div
                                        class="pointer-events-none absolute inset-0 flex items-center justify-center"
                                    >
                                        <div
                                            class="rounded-[10px] border border-border bg-slate-950/82 px-4 py-3 text-center shadow-md"
                                        >
                                            <p
                                                class="text-[10px] tracking-[0.2em] text-foreground uppercase"
                                            >
                                                Total
                                            </p>
                                            <p
                                                class="mt-1 text-2xl font-semibold text-foreground"
                                            >
                                                {{ totalStats }}
                                            </p>
                                            <p
                                                class="mt-1 text-[11px] text-foreground"
                                            >
                                                {{ highestStat.label }}领先
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div
                                    class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
                                >
                                    <div
                                        v-for="stat in statRows"
                                        :key="stat.key"
                                        class="rounded-[10px] border border-border bg-muted px-3 py-2.5"
                                    >
                                        <div
                                            class="flex items-center justify-between gap-2"
                                        >
                                            <span
                                                class="text-sm text-foreground"
                                                >{{ stat.label }}</span
                                            >
                                            <span
                                                class="text-sm font-semibold text-foreground"
                                                >{{ stat.value }}</span
                                            >
                                        </div>
                                        <div
                                            class="mt-2 h-1.5 overflow-hidden rounded-[10px] bg-muted"
                                        >
                                            <div
                                                class="h-full rounded-[10px] bg-sky-500"
                                                :style="{
                                                    width: `${(stat.value / statChartMax) * 100}%`,
                                                }"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card class="border-border bg-card shadow-sm">
                            <CardHeader class="pb-3">
                                <CardTitle
                                    class="flex items-center gap-2 text-foreground"
                                >
                                    <Sparkles class="h-4 w-4 text-primary" />
                                    战斗概况
                                </CardTitle>
                                <CardDescription class="text-foreground">
                                    倾向、覆盖与遗传技能的快速摘要。
                                </CardDescription>
                            </CardHeader>
                            <CardContent class="space-y-4">
                                <div class="grid gap-2 sm:grid-cols-2">
                                    <div
                                        class="rounded-[10px] border border-border bg-muted px-3 py-2.5"
                                    >
                                        <p class="text-xs text-foreground">
                                            攻击倾向
                                        </p>
                                        <p
                                            class="mt-1.5 text-sm font-semibold text-foreground"
                                        >
                                            {{
                                                getAttackStyleLabel(
                                                    friend.preferred_attack_style,
                                                )
                                            }}
                                        </p>
                                    </div>
                                    <div
                                        class="rounded-[10px] border border-border bg-muted px-3 py-2.5"
                                    >
                                        <p class="text-xs text-foreground">
                                            遗传技能
                                        </p>
                                        <p
                                            class="mt-1.5 text-sm font-semibold text-foreground"
                                        >
                                            {{ friend.legacy_moves.length }} 项
                                        </p>
                                    </div>
                                </div>

                                <Separator class="bg-white/10" />

                                <div class="space-y-2.5">
                                    <p
                                        class="text-sm font-medium text-foreground"
                                    >
                                        技能覆盖属性
                                    </p>
                                    <div class="flex flex-wrap gap-2">
                                        <Badge
                                            v-for="type in moveCoverageTypes"
                                            :key="type.id"
                                            variant="outline"
                                            class="rounded-[10px] border-sky-400/20 bg-sky-400/10 text-sky-200"
                                        >
                                            {{ type.label }}
                                        </Badge>
                                    </div>
                                </div>

                                <div class="space-y-2.5">
                                    <p
                                        class="text-sm font-medium text-foreground"
                                    >
                                        高威力技能
                                    </p>
                                    <div class="space-y-2">
                                        <div
                                            v-for="move in strongestMoves"
                                            :key="move.id"
                                            class="flex items-center gap-3 rounded-[10px] border border-border bg-muted px-3 py-2.5 text-sm"
                                        >
                                            <SkillIcon
                                                :icon-id="move.icon_id"
                                                :alt="move.localized.zh.name"
                                            />
                                            <div class="min-w-0 flex-1">
                                                <p
                                                    class="truncate font-medium text-foreground"
                                                >
                                                    {{ move.localized.zh.name }}
                                                </p>
                                                <div
                                                    class="mt-1 flex flex-wrap items-center gap-1.5"
                                                >
                                                    <Badge
                                                        class="rounded-[10px] bg-white/10 px-2 py-0 text-[11px] text-foreground"
                                                    >
                                                        {{
                                                            move.move_type
                                                                .localized.zh
                                                        }}
                                                    </Badge>
                                                    <Badge
                                                        variant="outline"
                                                        class="rounded-[10px] border-border bg-card px-2 py-0 text-[11px] text-foreground"
                                                    >
                                                        {{
                                                            getCategoryLabel(
                                                                move.move_category,
                                                            )
                                                        }}
                                                    </Badge>
                                                    <Badge
                                                        variant="outline"
                                                        class="rounded-[10px] border-border bg-card px-2 py-0 text-[11px] text-foreground"
                                                    >
                                                        {{ move.energy_cost }}
                                                        能量
                                                    </Badge>
                                                </div>
                                            </div>
                                            <span
                                                class="shrink-0 text-lg font-semibold text-foreground"
                                            >
                                                {{ move.power }}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div class="grid gap-4">
                        <Card class="border-border bg-card shadow-sm">
                            <CardHeader class="pb-3">
                                <CardTitle
                                    class="flex items-center gap-2 text-foreground"
                                >
                                    <WandSparkles
                                        class="h-4 w-4 text-sky-300"
                                    />
                                    遗传技能索引
                                </CardTitle>
                                <CardDescription class="text-foreground">
                                    展示当前精灵可继承的全部血脉技能。
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div
                                    class="grid gap-2 md:grid-cols-2 lg:grid-cols-4"
                                >
                                    <div
                                        v-for="item in legacyTypeEntries"
                                        :key="`${item.type_id}-${item.move_id}`"
                                        class="rounded-[10px] border border-border bg-muted px-3 py-3"
                                    >
                                        <div
                                            class="flex flex-wrap items-center gap-2"
                                        >
                                            <Badge
                                                variant="outline"
                                                class="rounded-[10px] border-sky-400/20 bg-sky-400/10 text-sky-200"
                                            >
                                                {{ item.label }}血脉
                                            </Badge>
                                            <Badge
                                                v-if="item.move"
                                                variant="outline"
                                                class="rounded-[10px] border-border bg-card text-foreground"
                                            >
                                                {{
                                                    getCategoryLabel(
                                                        item.move.move_category,
                                                    )
                                                }}
                                            </Badge>
                                        </div>

                                        <div class="mt-2 flex gap-2.5">
                                            <SkillIcon
                                                v-if="item.move"
                                                :icon-id="item.move.icon_id"
                                                :alt="
                                                    item.move.localized.zh.name
                                                "
                                            />
                                            <div
                                                class="min-w-0 flex-1 space-y-1.5"
                                            >
                                                <p
                                                    class="text-sm font-semibold text-foreground"
                                                >
                                                    {{
                                                        item.move?.localized.zh
                                                            .name ??
                                                        `技能 #${item.move_id}`
                                                    }}
                                                </p>
                                                <p
                                                    class="text-xs leading-5 text-foreground"
                                                >
                                                    {{
                                                        item.move?.localized.zh
                                                            .description ??
                                                        "当前索引暂未解析到技能说明。"
                                                    }}
                                                </p>
                                            </div>
                                        </div>

                                        <div
                                            class="mt-3 flex flex-wrap gap-2 text-xs text-foreground"
                                        >
                                            <span
                                                class="rounded-[10px] border border-border bg-card px-2 py-0.5"
                                            >
                                                #{{ item.move_id }}
                                            </span>
                                            <span
                                                v-if="item.move"
                                                class="rounded-[10px] border border-border bg-card px-2 py-0.5"
                                            >
                                                能耗 {{ item.move.energy_cost }}
                                            </span>
                                            <span
                                                v-if="
                                                    item.move &&
                                                    item.move.power !== null
                                                "
                                                class="rounded-[10px] border border-border bg-card px-2 py-0.5"
                                            >
                                                威力 {{ item.move.power }}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="moves">
                    <Card class="border-border bg-card shadow-sm">
                        <CardHeader class="pb-3">
                            <CardTitle class="text-foreground"
                                >自有技能</CardTitle
                            >
                            <div
                                class="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
                            >
                                <div class="relative">
                                    <Search
                                        class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground"
                                    />
                                    <Input
                                        v-model="moveFilterQuery"
                                        type="search"
                                        placeholder="搜索技能名称或描述"
                                        class="h-8 rounded-[10px] border-border bg-card pl-9 text-xs text-foreground placeholder:text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20"
                                    />
                                </div>
                                <Select v-model="moveFilterType">
                                    <SelectTrigger
                                        class="h-8 w-auto min-w-24 rounded-[10px] border-border bg-card text-xs text-foreground"
                                    >
                                        <SelectValue placeholder="全部属性" />
                                    </SelectTrigger>
                                    <SelectContent
                                        class="border-border bg-slate-950/95 text-foreground"
                                    >
                                        <SelectItem value="all"
                                            >全部属性</SelectItem
                                        >
                                        <SelectItem
                                            v-for="t in movePoolFilterOptions.types"
                                            :key="t"
                                            :value="t"
                                            >{{ t }}</SelectItem
                                        >
                                    </SelectContent>
                                </Select>
                                <Select v-model="moveFilterCategory">
                                    <SelectTrigger
                                        class="h-8 w-auto min-w-24 rounded-[10px] border-border bg-card text-xs text-foreground"
                                    >
                                        <SelectValue placeholder="全部分类" />
                                    </SelectTrigger>
                                    <SelectContent
                                        class="border-border bg-slate-950/95 text-foreground"
                                    >
                                        <SelectItem value="all"
                                            >全部分类</SelectItem
                                        >
                                        <SelectItem
                                            v-for="c in movePoolFilterOptions.categories"
                                            :key="c"
                                            :value="c"
                                            >{{
                                                getCategoryLabel(c)
                                            }}</SelectItem
                                        >
                                    </SelectContent>
                                </Select>
                                <button
                                    v-if="hasActiveMoveFilters"
                                    class="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-xs text-foreground transition hover:bg-muted hover:text-foreground"
                                    @click="resetMoveFilters"
                                >
                                    <RotateCcw class="h-3 w-3" />
                                    重置
                                </button>
                            </div>
                            <p
                                v-if="hasActiveMoveFilters"
                                class="mt-1.5 text-xs text-foreground"
                            >
                                {{ filteredMovePool.length }} /
                                {{ friend.move_pool.length }} 项技能
                            </p>
                        </CardHeader>
                        <CardContent class="space-y-2.5">
                            <div
                                class="hidden grid-cols-[72px_minmax(0,2.1fr)_minmax(0,1.15fr)_96px_76px] items-center gap-3 rounded-[10px] border border-border bg-white/5 px-3 py-2.5 text-[11px] tracking-[0.14em] text-foreground uppercase md:grid"
                            >
                                <span></span>
                                <span>技能</span>
                                <span>类型与分类</span>
                                <span>能耗</span>
                                <span>威力</span>
                            </div>

                            <p
                                v-if="
                                    filteredMovePool.length === 0 &&
                                    hasActiveMoveFilters
                                "
                                class="rounded-[10px] border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-foreground"
                            >
                                当前筛选条件下没有匹配的技能。
                            </p>

                            <article
                                v-for="move in filteredMovePool"
                                :key="move.id"
                                class="rounded-[10px] border border-border bg-muted px-3 py-3 transition-colors hover:border-white/15 hover:bg-muted"
                            >
                                <div
                                    class="flex gap-3 md:grid md:grid-cols-[72px_minmax(0,2.1fr)_minmax(0,1.15fr)_96px_76px] md:items-start"
                                >
                                    <SkillIcon
                                        :icon-id="move.icon_id"
                                        :alt="move.localized.zh.name"
                                        size="md"
                                        class="mt-0.5 shrink-0"
                                    />

                                    <div class="min-w-0">
                                        <div class="flex items-center gap-2">
                                            <h3
                                                class="truncate text-sm font-semibold text-foreground"
                                            >
                                                {{ move.localized.zh.name }}
                                            </h3>
                                            <Badge
                                                variant="outline"
                                                class="shrink-0 rounded-[10px] border-border bg-card text-foreground"
                                            >
                                                #{{ move.id }}
                                            </Badge>
                                        </div>
                                        <p
                                            class="mt-0.5 text-[11px] text-foreground"
                                        >
                                            {{ move.name }}
                                        </p>
                                        <p
                                            class="mt-1.5 text-sm leading-6 text-foreground"
                                        >
                                            {{ move.localized.zh.description }}
                                        </p>
                                    </div>

                                    <div
                                        class="hidden flex-wrap gap-2 md:flex md:pt-0.5"
                                    >
                                        <Badge
                                            class="rounded-[10px] bg-white/10 text-foreground"
                                        >
                                            {{ move.move_type.localized.zh }}
                                        </Badge>
                                        <Badge
                                            variant="outline"
                                            class="rounded-[10px] border-border bg-card text-foreground"
                                        >
                                            {{
                                                getCategoryLabel(
                                                    move.move_category,
                                                )
                                            }}
                                        </Badge>
                                    </div>

                                    <div
                                        class="hidden text-sm font-medium text-foreground md:block md:pt-0.5"
                                    >
                                        {{ getEnergyLabel(move) }}
                                    </div>

                                    <div
                                        class="hidden text-sm font-semibold text-foreground md:block md:pt-0.5"
                                    >
                                        {{ getPowerLabel(move) }}
                                    </div>
                                </div>

                                <div
                                    class="mt-2 flex flex-wrap items-center gap-2 md:hidden"
                                >
                                    <Badge
                                        class="rounded-[10px] bg-white/10 text-foreground"
                                    >
                                        {{ move.move_type.localized.zh }}
                                    </Badge>
                                    <Badge
                                        variant="outline"
                                        class="rounded-[10px] border-border bg-card text-foreground"
                                    >
                                        {{
                                            getCategoryLabel(move.move_category)
                                        }}
                                    </Badge>
                                    <span class="text-xs text-foreground">{{
                                        getEnergyLabel(move)
                                    }}</span>
                                    <span
                                        class="text-xs font-semibold text-foreground"
                                        >威力 {{ getPowerLabel(move) }}</span
                                    >
                                </div>
                            </article>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="stones">
                    <Card class="border-border bg-card shadow-sm">
                        <CardHeader class="pb-3">
                            <CardTitle class="text-foreground"
                                >学习技能</CardTitle
                            >
                            <div
                                class="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
                            >
                                <div class="relative">
                                    <Search
                                        class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground"
                                    />
                                    <Input
                                        v-model="moveFilterQuery"
                                        type="search"
                                        placeholder="搜索技能名称或描述"
                                        class="h-8 rounded-[10px] border-border bg-card pl-9 text-xs text-foreground placeholder:text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20"
                                    />
                                </div>
                                <Select v-model="moveFilterType">
                                    <SelectTrigger
                                        class="h-8 w-auto min-w-24 rounded-[10px] border-border bg-card text-xs text-foreground"
                                    >
                                        <SelectValue placeholder="全部属性" />
                                    </SelectTrigger>
                                    <SelectContent
                                        class="border-border bg-slate-950/95 text-foreground"
                                    >
                                        <SelectItem value="all"
                                            >全部属性</SelectItem
                                        >
                                        <SelectItem
                                            v-for="t in moveStonesFilterOptions.types"
                                            :key="t"
                                            :value="t"
                                            >{{ t }}</SelectItem
                                        >
                                    </SelectContent>
                                </Select>
                                <Select v-model="moveFilterCategory">
                                    <SelectTrigger
                                        class="h-8 w-auto min-w-24 rounded-[10px] border-border bg-card text-xs text-foreground"
                                    >
                                        <SelectValue placeholder="全部分类" />
                                    </SelectTrigger>
                                    <SelectContent
                                        class="border-border bg-slate-950/95 text-foreground"
                                    >
                                        <SelectItem value="all"
                                            >全部分类</SelectItem
                                        >
                                        <SelectItem
                                            v-for="c in moveStonesFilterOptions.categories"
                                            :key="c"
                                            :value="c"
                                            >{{
                                                getCategoryLabel(c)
                                            }}</SelectItem
                                        >
                                    </SelectContent>
                                </Select>
                                <button
                                    v-if="hasActiveMoveFilters"
                                    class="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-xs text-foreground transition hover:bg-muted hover:text-foreground"
                                    @click="resetMoveFilters"
                                >
                                    <RotateCcw class="h-3 w-3" />
                                    重置
                                </button>
                            </div>
                            <p
                                v-if="hasActiveMoveFilters"
                                class="mt-1.5 text-xs text-foreground"
                            >
                                {{ filteredMoveStones.length }} /
                                {{ friend.move_stones.length }} 项技能
                            </p>
                        </CardHeader>
                        <CardContent class="space-y-2.5">
                            <div
                                class="hidden grid-cols-[72px_minmax(0,2.1fr)_minmax(0,1.15fr)_96px_76px] items-center gap-3 rounded-[10px] border border-border bg-white/5 px-3 py-2.5 text-[11px] tracking-[0.14em] text-foreground uppercase md:grid"
                            >
                                <span></span>
                                <span>技能</span>
                                <span>类型与分类</span>
                                <span>能耗</span>
                                <span>威力</span>
                            </div>

                            <p
                                v-if="
                                    filteredMoveStones.length === 0 &&
                                    hasActiveMoveFilters
                                "
                                class="rounded-[10px] border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-foreground"
                            >
                                当前筛选条件下没有匹配的技能。
                            </p>

                            <article
                                v-for="move in filteredMoveStones"
                                :key="move.id"
                                class="rounded-[10px] border border-border bg-muted px-3 py-3 transition-colors hover:border-white/15 hover:bg-muted"
                            >
                                <div
                                    class="flex gap-3 md:grid md:grid-cols-[72px_minmax(0,2.1fr)_minmax(0,1.15fr)_96px_76px] md:items-start"
                                >
                                    <SkillIcon
                                        :icon-id="move.icon_id"
                                        :alt="move.localized.zh.name"
                                        size="md"
                                        class="mt-0.5 shrink-0"
                                    />

                                    <div class="min-w-0">
                                        <div class="flex items-center gap-2">
                                            <h3
                                                class="truncate text-sm font-semibold text-foreground"
                                            >
                                                {{ move.localized.zh.name }}
                                            </h3>
                                            <Badge
                                                variant="outline"
                                                class="shrink-0 rounded-[10px] border-border bg-card text-foreground"
                                            >
                                                #{{ move.id }}
                                            </Badge>
                                        </div>
                                        <p
                                            class="mt-0.5 text-[11px] text-foreground"
                                        >
                                            {{ move.name }}
                                        </p>
                                        <p
                                            class="mt-1.5 text-sm leading-6 text-foreground"
                                        >
                                            {{ move.localized.zh.description }}
                                        </p>
                                    </div>

                                    <div
                                        class="hidden flex-wrap gap-2 md:flex md:pt-0.5"
                                    >
                                        <Badge
                                            class="rounded-[10px] bg-white/10 text-foreground"
                                        >
                                            {{ move.move_type.localized.zh }}
                                        </Badge>
                                        <Badge
                                            variant="outline"
                                            class="rounded-[10px] border-border bg-card text-foreground"
                                        >
                                            {{
                                                getCategoryLabel(
                                                    move.move_category,
                                                )
                                            }}
                                        </Badge>
                                    </div>

                                    <div
                                        class="hidden text-sm font-medium text-foreground md:block md:pt-0.5"
                                    >
                                        {{ getEnergyLabel(move) }}
                                    </div>

                                    <div
                                        class="hidden text-sm font-semibold text-foreground md:block md:pt-0.5"
                                    >
                                        {{ getPowerLabel(move) }}
                                    </div>
                                </div>

                                <div
                                    class="mt-2 flex flex-wrap items-center gap-2 md:hidden"
                                >
                                    <Badge
                                        class="rounded-[10px] bg-white/10 text-foreground"
                                    >
                                        {{ move.move_type.localized.zh }}
                                    </Badge>
                                    <Badge
                                        variant="outline"
                                        class="rounded-[10px] border-border bg-card text-foreground"
                                    >
                                        {{
                                            getCategoryLabel(move.move_category)
                                        }}
                                    </Badge>
                                    <span class="text-xs text-foreground">{{
                                        getEnergyLabel(move)
                                    }}</span>
                                    <span
                                        class="text-xs font-semibold text-foreground"
                                        >威力 {{ getPowerLabel(move) }}</span
                                    >
                                </div>
                            </article>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <Dialog v-model:open="petTopicDialogOpen">
                <DialogContent
                    class="border-border bg-slate-950 text-foreground sm:max-w-2xl"
                >
                    <DialogHeader>
                        <DialogTitle class="text-foreground">
                            {{ friend.localized.zh.name }} 图鉴任务
                        </DialogTitle>
                        <DialogDescription class="text-foreground">
                            任务进度请在图鉴进度页管理，不会同步到其他设备。
                        </DialogDescription>
                    </DialogHeader>

                    <div v-if="isPetTopicLoading" class="space-y-2.5">
                        <Skeleton
                            class="h-20 rounded-[10px] border border-border bg-muted"
                        />
                        <Skeleton
                            class="h-16 rounded-[10px] border border-border bg-muted"
                        />
                        <Skeleton
                            class="h-16 rounded-[10px] border border-border bg-muted"
                        />
                    </div>

                    <div
                        v-else-if="petTopicErrorMessage"
                        class="rounded-[10px] border border-destructive/20 bg-destructive/8 px-3 py-4 text-sm text-destructive"
                    >
                        {{ petTopicErrorMessage }}
                    </div>

                    <template v-else-if="petTopics.length">
                        <div
                            class="rounded-[10px] border border-border bg-muted p-3"
                        >
                            <div class="flex items-end justify-between gap-3">
                                <div>
                                    <p
                                        class="text-[11px] tracking-[0.14em] text-foreground uppercase"
                                    >
                                        完成进度
                                    </p>
                                    <p
                                        class="mt-1 text-lg font-semibold text-foreground"
                                    >
                                        {{ completedPetTopicCount }}/{{
                                            petTopics.length
                                        }}
                                    </p>
                                </div>
                                <p
                                    class="text-2xl font-semibold text-emerald-200"
                                >
                                    {{ petTopicCompletionRate }}%
                                </p>
                            </div>

                            <div
                                class="mt-3 h-2 overflow-hidden rounded-[10px] bg-muted"
                            >
                                <div
                                    class="h-full rounded-[10px] bg-card transition-[width] duration-300"
                                    :style="{
                                        width: `${petTopicCompletionRate}%`,
                                    }"
                                />
                            </div>

                            <p class="mt-2 text-xs leading-5 text-foreground">
                                最近记录：{{ petTopicLastRecordedLabel }}
                            </p>
                        </div>

                        <div
                            class="max-h-[60vh] space-y-3 overflow-y-auto pr-1"
                        >
                            <label
                                v-for="topic in petTopics"
                                :key="topic.topic_Id"
                                class="group flex items-start gap-3 rounded-[10px] border px-3 py-3"
                                :class="
                                    isPetTopicCompleted(topic.topic_Id)
                                        ? 'border-emerald-400/25 bg-card'
                                        : 'border-border bg-white/5'
                                "
                            >
                                <input
                                    class="sr-only"
                                    type="checkbox"
                                    disabled
                                    :checked="
                                        isPetTopicCompleted(topic.topic_Id)
                                    "
                                />

                                <span
                                    class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[10px] border transition-colors"
                                    :class="
                                        isPetTopicCompleted(topic.topic_Id)
                                            ? 'border-emerald-400/50 bg-card hover:bg-accent/20 text-emerald-200'
                                            : 'border-border bg-card text-transparent group-hover:text-foreground'
                                    "
                                >
                                    <Check class="h-3.5 w-3.5" />
                                </span>

                                <span class="min-w-0 flex-1">
                                    <span
                                        class="block text-sm leading-6"
                                        :class="
                                            isPetTopicCompleted(topic.topic_Id)
                                                ? 'text-foreground line-through decoration-slate-500/70'
                                                : 'text-foreground'
                                        "
                                    >
                                        {{ getTopicRequirementText(topic) }}
                                    </span>
                                    <span
                                        v-if="getTopicRewards(topic).length > 0"
                                        class="mt-1.5 flex flex-wrap items-center gap-1.5"
                                    >
                                        <Gift
                                            class="h-3 w-3 shrink-0 text-foreground/70"
                                        />
                                        <template
                                            v-for="(
                                                reward, rIdx
                                            ) in getTopicRewards(topic)"
                                            :key="`${topic.topic_Id}-r${rIdx}`"
                                        >
                                            <HoverCard
                                                v-if="reward.type === 1"
                                                :open-delay="200"
                                                :close-delay="100"
                                            >
                                                <HoverCardTrigger as-child>
                                                    <a
                                                        :href="`/items?highlight=${reward.id}`"
                                                        target="_blank"
                                                        rel="noopener"
                                                        class="inline-flex items-center gap-1 rounded-[10px] border border-border/15 bg-card hover:bg-accent/8 px-2 py-0.5 text-[11px] text-foreground transition hover:border-border/30 hover:bg-card hover:bg-accent/15"
                                                        @click.stop
                                                    >
                                                        <img
                                                            v-if="
                                                                getRewardIconSrc(
                                                                    reward,
                                                                )
                                                            "
                                                            :src="
                                                                getRewardIconSrc(
                                                                    reward,
                                                                )!
                                                            "
                                                            class="h-3.5 w-3.5 object-contain"
                                                            loading="lazy"
                                                        />
                                                        {{ reward.name }} ×{{
                                                            reward.count
                                                        }}
                                                        <ExternalLink
                                                            class="h-2.5 w-2.5 opacity-50"
                                                        />
                                                    </a>
                                                </HoverCardTrigger>
                                                <HoverCardContent
                                                    side="top"
                                                    :side-offset="6"
                                                    class="w-72 border-border bg-slate-950/95 p-0 shadow-xl"
                                                >
                                                    <div class="flex gap-3 p-3">
                                                        <div
                                                            class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-border bg-slate-900/80"
                                                        >
                                                            <img
                                                                v-if="
                                                                    getRewardIconSrc(
                                                                        reward,
                                                                    )
                                                                "
                                                                :src="
                                                                    getRewardIconSrc(
                                                                        reward,
                                                                    )!
                                                                "
                                                                class="h-full w-full object-contain p-1.5"
                                                            />
                                                            <span
                                                                v-else
                                                                class="text-lg font-bold text-foreground"
                                                                >{{
                                                                    reward.name.slice(
                                                                        0,
                                                                        1,
                                                                    )
                                                                }}</span
                                                            >
                                                        </div>
                                                        <div
                                                            class="min-w-0 flex-1"
                                                        >
                                                            <p
                                                                class="text-[10px] tracking-wider text-foreground uppercase"
                                                            >
                                                                #{{ reward.id }}
                                                            </p>
                                                            <p
                                                                class="truncate text-sm font-semibold text-foreground"
                                                            >
                                                                {{
                                                                    reward.name
                                                                }}
                                                            </p>
                                                            <p
                                                                v-if="
                                                                    getItemDetail(
                                                                        reward.id,
                                                                    )
                                                                        ?.quality_label
                                                                "
                                                                :class="[
                                                                    'text-xs',
                                                                    getQualityColor(
                                                                        getItemDetail(
                                                                            reward.id,
                                                                        )!
                                                                            .quality,
                                                                    ),
                                                                ]"
                                                            >
                                                                {{
                                                                    getItemDetail(
                                                                        reward.id,
                                                                    )!
                                                                        .quality_label
                                                                }}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div
                                                        v-if="
                                                            getItemDetail(
                                                                reward.id,
                                                            )?.description
                                                        "
                                                        class="border-t border-white/8 px-3 py-2"
                                                    >
                                                        <p
                                                            class="text-xs leading-5 text-foreground"
                                                        >
                                                            {{
                                                                getItemDetail(
                                                                    reward.id,
                                                                )!.description
                                                            }}
                                                        </p>
                                                    </div>
                                                    <div
                                                        v-if="
                                                            getItemDetail(
                                                                reward.id,
                                                            )?.category ||
                                                            getItemDetail(
                                                                reward.id,
                                                            )?.type_desc
                                                        "
                                                        class="flex flex-wrap gap-1.5 border-t border-white/8 px-3 py-2"
                                                    >
                                                        <Badge
                                                            v-if="
                                                                getItemDetail(
                                                                    reward.id,
                                                                )?.category
                                                            "
                                                            variant="outline"
                                                            class="rounded-[10px] border-border bg-white/5 px-2 py-0.5 text-[10px] text-foreground"
                                                        >
                                                            {{
                                                                getItemDetail(
                                                                    reward.id,
                                                                )!.category
                                                            }}
                                                        </Badge>
                                                        <Badge
                                                            v-if="
                                                                getItemDetail(
                                                                    reward.id,
                                                                )?.type_desc
                                                            "
                                                            variant="outline"
                                                            class="rounded-[10px] border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-[10px] text-sky-200"
                                                        >
                                                            {{
                                                                getItemDetail(
                                                                    reward.id,
                                                                )!.type_desc
                                                            }}
                                                        </Badge>
                                                    </div>
                                                    <div
                                                        class="border-t border-white/8 px-3 py-1.5"
                                                    >
                                                        <p
                                                            class="text-center text-[10px] text-foreground"
                                                        >
                                                            ×{{ reward.count }}
                                                            · 点击查看详情
                                                        </p>
                                                    </div>
                                                </HoverCardContent>
                                            </HoverCard>
                                            <HoverCard
                                                v-else
                                                :open-delay="200"
                                                :close-delay="100"
                                            >
                                                <HoverCardTrigger as-child>
                                                    <span
                                                        class="inline-flex items-center gap-1 rounded-[10px] border border-sky-400/15 bg-sky-400/8 px-2 py-0.5 text-[11px] text-sky-200"
                                                    >
                                                        <img
                                                            v-if="
                                                                getRewardIconSrc(
                                                                    reward,
                                                                )
                                                            "
                                                            :src="
                                                                getRewardIconSrc(
                                                                    reward,
                                                                )!
                                                            "
                                                            class="h-3.5 w-3.5 object-contain"
                                                            loading="lazy"
                                                        />
                                                        {{ reward.name }} ×{{
                                                            reward.count
                                                        }}
                                                    </span>
                                                </HoverCardTrigger>
                                                <HoverCardContent
                                                    side="top"
                                                    :side-offset="6"
                                                    class="w-56 border-border bg-slate-950/95 p-3 shadow-xl"
                                                >
                                                    <div
                                                        class="flex items-center gap-2.5"
                                                    >
                                                        <div
                                                            class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-border bg-slate-900/80"
                                                        >
                                                            <img
                                                                v-if="
                                                                    getRewardIconSrc(
                                                                        reward,
                                                                    )
                                                                "
                                                                :src="
                                                                    getRewardIconSrc(
                                                                        reward,
                                                                    )!
                                                                "
                                                                class="h-full w-full object-contain p-1"
                                                            />
                                                            <span
                                                                v-else
                                                                class="text-sm font-bold text-foreground"
                                                                >{{
                                                                    reward.name.slice(
                                                                        0,
                                                                        1,
                                                                    )
                                                                }}</span
                                                            >
                                                        </div>
                                                        <div>
                                                            <p
                                                                class="text-sm font-semibold text-foreground"
                                                            >
                                                                {{
                                                                    reward.name
                                                                }}
                                                            </p>
                                                            <p
                                                                class="text-xs text-sky-300"
                                                            >
                                                                ×{{
                                                                    reward.count
                                                                }}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </HoverCardContent>
                                            </HoverCard>
                                        </template>
                                    </span>
                                    <span
                                        class="mt-1 block text-[11px] text-foreground"
                                    >
                                        任务 {{ topic.topic_Id }}
                                        <span
                                            v-if="
                                                getPetTopicRecordedLabel(
                                                    topic.topic_Id,
                                                )
                                            "
                                        >
                                            · 已记录
                                            {{
                                                getPetTopicRecordedLabel(
                                                    topic.topic_Id,
                                                )
                                            }}
                                        </span>
                                    </span>
                                </span>
                            </label>
                        </div>

                        <div class="flex flex-col gap-3 sm:flex-row">
                            <Button
                                variant="outline"
                                class="flex-1 rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                                as-child
                            >
                                <RouterLink
                                    :to="`/handbook-progress?species=${friend.species.id}`"
                                >
                                    前往图鉴进度管理
                                </RouterLink>
                            </Button>
                        </div>

                        <p class="text-xs leading-5 text-foreground">
                            任务进度请在图鉴进度页管理，不会同步到其他设备。
                        </p>
                    </template>

                    <p v-else class="text-sm leading-6 text-foreground">
                        暂无图鉴任务。
                    </p>
                </DialogContent>
            </Dialog>
        </template>
    </section>
</template>

<style scoped>
.stat-radar-panel {
    background:
        radial-gradient(
            circle at center,
            rgba(14, 165, 233, 0.1),
            transparent 42%
        ),
        linear-gradient(180deg, rgba(15, 23, 42, 0.86), rgba(2, 6, 23, 0.94));
}

.stat-radar-chart :deep(canvas) {
    outline: none;
}
</style>
