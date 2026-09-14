<script setup lang="ts">
import {
    ArrowRightLeft,
    ChevronDown,
    CircleAlert,
    Clock3,
    Egg,
    Link2,
    Search,
    Sparkles,
} from "lucide-vue-next";
import FriendPortrait from "@/components/FriendPortrait.vue";
import {
    formatEggGroup,
    formatEggGroupSummary,
    getEggGroupMeta,
} from "@/lib/eggGroups";
import type { IPets, IPetsBreedingInfo } from "@/lib/interface";
import {
    getPetImplementationLabel,
    isPetImplemented,
    matchesPetImplementationFilter,
    type PetImplementationFilter,
} from "@/lib/petImplementation";
import { formatPetHandbookNo, matchesPetKeyword } from "@/lib/petHandbook";

type SlotRole = "mother" | "father";

interface ICandidateOption {
    pet: IPets;
    compatible: boolean;
    reason: string | null;
    overlapEggGroups: number[];
}

interface IPairEvaluation {
    compatible: boolean;
    reasons: string[];
    overlapEggGroups: number[];
}

interface ILayEggRateRow {
    nest_num?: number;
    egg_laying_nest_num?: number;
    pet_lay_egg_rate?: number;
}

interface ILayEggRateResponse {
    RocoDataRows?: Record<string, ILayEggRateRow>;
}

const pets = ref<IPets[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");
const selectedMotherId = ref<number | null>(null);
const selectedFatherId = ref<number | null>(null);
const motherPopoverOpen = ref(false);
const fatherPopoverOpen = ref(false);
const motherSearchQuery = ref("");
const fatherSearchQuery = ref("");
const implementationFilter = ref<PetImplementationFilter>("implemented");
const layEggRates = ref<ILayEggRateRow[]>([]);

const VIRTUAL_OPTION_HEIGHT = 92;

let petsController: AbortController | null = null;
let layEggRateController: AbortController | null = null;

const petsById = computed(() => {
    return new Map(pets.value.map((pet) => [pet.id, pet]));
});

const selectedMother = computed(() => {
    if (selectedMotherId.value === null) {
        return null;
    }

    return petsById.value.get(selectedMotherId.value) ?? null;
});

const selectedFather = computed(() => {
    if (selectedFatherId.value === null) {
        return null;
    }

    return petsById.value.get(selectedFatherId.value) ?? null;
});

const pairEvaluation = computed(() => {
    return evaluatePair(selectedMother.value, selectedFather.value);
});

const motherOptions = computed(() => {
    return buildCandidateOptions("mother", selectedFather.value);
});

const fatherOptions = computed(() => {
    return buildCandidateOptions("father", selectedMother.value);
});

const filteredMotherOptions = computed(() => {
    return filterCandidateOptions(
        motherOptions.value.filter((option) => {
            return matchesPetImplementationFilter(
                option.pet,
                implementationFilter.value,
            );
        }),
        motherSearchQuery.value,
    );
});

const filteredFatherOptions = computed(() => {
    return filterCandidateOptions(
        fatherOptions.value.filter((option) => {
            return matchesPetImplementationFilter(
                option.pet,
                implementationFilter.value,
            );
        }),
        fatherSearchQuery.value,
    );
});

const {
    list: motherVirtualOptions,
    containerProps: motherVirtualContainerProps,
    wrapperProps: motherVirtualWrapperProps,
} = useVirtualList(filteredMotherOptions, {
    itemHeight: VIRTUAL_OPTION_HEIGHT,
    overscan: 8,
});

const {
    list: fatherVirtualOptions,
    containerProps: fatherVirtualContainerProps,
    wrapperProps: fatherVirtualWrapperProps,
} = useVirtualList(filteredFatherOptions, {
    itemHeight: VIRTUAL_OPTION_HEIGHT,
    overscan: 8,
});

const motherEligibleCount = computed(() => {
    return filteredMotherOptions.value.filter((option) => option.compatible)
        .length;
});

const fatherEligibleCount = computed(() => {
    return filteredFatherOptions.value.filter((option) => option.compatible)
        .length;
});

const layEggRateSummary = computed(() => {
    const rows = layEggRates.value.filter((row) => {
        return typeof row.pet_lay_egg_rate === "number";
    });

    if (!rows.length) {
        return null;
    }

    const rates = rows.map((row) => row.pet_lay_egg_rate as number);
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);
    const defaultRate =
        rows.find((row) => row.nest_num === 2 && row.egg_laying_nest_num === 1)
            ?.pet_lay_egg_rate ?? minRate;
    const highestNestCount = Math.max(...rows.map((row) => row.nest_num ?? 0));

    return {
        minRate,
        maxRate,
        defaultRate,
        highestNestCount,
    };
});

const hatchDurationLabel = computed(() => {
    return formatDuration(selectedMother.value?.breeding?.hatch_data ?? null);
});

const weightRangeLabel = computed(() => {
    return formatRange(
        normalizeWeight(selectedMother.value?.breeding?.weight_low ?? null),
        normalizeWeight(selectedMother.value?.breeding?.weight_high ?? null),
        "kg",
    );
});

const heightRangeLabel = computed(() => {
    return formatRange(
        selectedMother.value?.breeding?.height_low ?? null,
        selectedMother.value?.breeding?.height_high ?? null,
        "cm",
    );
});

const inheritedTypeLabel = computed(() => {
    if (!selectedMother.value) {
        return "未选择母体";
    }

    return getTypeLabel(selectedMother.value);
});

const totalStatsLabel = computed(() => {
    if (!selectedMother.value) {
        return "-";
    }

    return String(getTotalStats(selectedMother.value));
});

const cooldownReferenceLabel = computed(() => {
    if (!layEggRateSummary.value) {
        return "暂无公开秒级冷却配置";
    }

    return `${layEggRateSummary.value.minRate}-${layEggRateSummary.value.maxRate}`;
});

const cooldownDescription = computed(() => {
    if (!layEggRateSummary.value) {
        return "当前仓库仅能确认孵化时长，无法给出固定冷却秒数。";
    }

    return `默认参考速率 ${layEggRateSummary.value.defaultRate}，最高支持 ${layEggRateSummary.value.highestNestCount} 巢位布局。`;
});

onMounted(() => {
    void Promise.all([getPets(), getLayEggRates()]);
});

onBeforeUnmount(() => {
    petsController?.abort();
    layEggRateController?.abort();
});

watch(motherPopoverOpen, (open) => {
    if (!open) {
        motherSearchQuery.value = "";
    }
});

watch(fatherPopoverOpen, (open) => {
    if (!open) {
        fatherSearchQuery.value = "";
    }
});

function buildCandidateOptions(role: SlotRole, counterpart: IPets | null) {
    const options = pets.value.map((pet) => {
        if (!counterpart) {
            const roleCheck = evaluateRoleAvailability(pet, role);

            return {
                pet,
                compatible: roleCheck.compatible,
                reason: roleCheck.reason,
                overlapEggGroups: [],
            } satisfies ICandidateOption;
        }

        const evaluation =
            role === "mother"
                ? evaluatePair(pet, counterpart)
                : evaluatePair(counterpart, pet);

        return {
            pet,
            compatible: evaluation.compatible,
            reason: evaluation.compatible
                ? null
                : (evaluation.reasons[0] ?? "无法与当前精灵配对"),
            overlapEggGroups: evaluation.overlapEggGroups,
        } satisfies ICandidateOption;
    });

    return options.sort((left, right) => {
        if (left.compatible !== right.compatible) {
            return left.compatible ? -1 : 1;
        }

        return left.pet.localized.zh.name.localeCompare(
            right.pet.localized.zh.name,
            "zh-CN",
        );
    });
}

function evaluateRoleAvailability(pet: IPets | null, role: SlotRole) {
    if (!pet) {
        return {
            compatible: false,
            reason: "尚未选择精灵",
        };
    }

    const profile = pet.breeding_profile;

    if (!profile) {
        return {
            compatible: false,
            reason: "缺少配种规则数据",
        };
    }

    if (!profile.egg_groups.length) {
        return {
            compatible: false,
            reason: "暂无蛋组数据",
        };
    }

    // if (role === "mother" && (profile.female_rate ?? 0) <= 0) {
    //     return {
    //         compatible: false,
    //         reason: "当前精灵无法担任母体",
    //     };
    // }

    // if (role === "father" && (profile.male_rate ?? 0) <= 0) {
    //     return {
    //         compatible: false,
    //         reason: "当前精灵无法担任父体",
    //     };
    // }

    return {
        compatible: true,
        reason: null,
    };
}

function evaluatePair(
    mother: IPets | null,
    father: IPets | null,
): IPairEvaluation {
    const reasons: string[] = [];
    const motherRole = evaluateRoleAvailability(mother, "mother");
    const fatherRole = evaluateRoleAvailability(father, "father");
    const overlapEggGroups = getSharedEggGroups(mother, father);

    if (!mother || !father) {
        return {
            compatible: false,
            reasons: ["请选择母体与父体精灵"],
            overlapEggGroups,
        };
    }

    if (!motherRole.compatible && motherRole.reason) {
        reasons.push(motherRole.reason);
    }

    if (!fatherRole.compatible && fatherRole.reason) {
        reasons.push(fatherRole.reason);
    }

    if (!overlapEggGroups.length) {
        reasons.push("蛋组不相同");
    }

    return {
        compatible: reasons.length === 0,
        reasons,
        overlapEggGroups,
    };
}

function getSharedEggGroups(mother: IPets | null, father: IPets | null) {
    const motherEggGroups = mother?.breeding_profile?.egg_groups ?? [];
    const fatherEggGroups = father?.breeding_profile?.egg_groups ?? [];
    const fatherEggGroupSet = new Set(fatherEggGroups);

    return motherEggGroups.filter((groupId) => fatherEggGroupSet.has(groupId));
}

function filterCandidateOptions(options: ICandidateOption[], query: string) {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");

    if (!normalizedQuery) {
        return options;
    }

    return options.filter((option) => {
        return matchesPetKeyword(option.pet, normalizedQuery, [
            getPetImplementationLabel(option.pet),
            ...(option.pet.breeding_profile?.egg_groups ?? []).map((groupId) =>
                formatEggGroup(groupId),
            ),
        ]);
    });
}

function selectPet(role: SlotRole, petId: number, compatible: boolean) {
    if (!compatible) {
        return;
    }

    if (role === "mother") {
        selectedMotherId.value = petId;
        motherPopoverOpen.value = false;
        return;
    }

    selectedFatherId.value = petId;
    fatherPopoverOpen.value = false;
}

function clearPet(role: SlotRole) {
    if (role === "mother") {
        selectedMotherId.value = null;
        return;
    }

    selectedFatherId.value = null;
}

function getTypeLabel(pet: IPets) {
    const typeLabels = [pet.main_type.localized.zh];

    if (pet.sub_type) {
        typeLabels.push(pet.sub_type.localized.zh);
    }

    return typeLabels.join(" / ");
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

function getCandidateStatusLabel(option: ICandidateOption, role: SlotRole) {
    if (!option.compatible) {
        return option.reason ?? "无法与当前精灵配对";
    }

    if (option.overlapEggGroups.length) {
        return `共享 ${formatEggGroupSummary(option.overlapEggGroups)}`;
    }

    return role === "mother"
        ? formatGenderChance(option.pet.breeding_profile?.female_rate, "母体")
        : formatGenderChance(option.pet.breeding_profile?.male_rate, "父体");
}

function formatGenderChance(
    value: number | null | undefined,
    roleLabel: string,
) {
    if (value === null || value === undefined) {
        return `${roleLabel}概率未知`;
    }

    return `${roleLabel}概率 ${value}%`;
}

function getTotalStats(pet: IPets) {
    return (
        pet.base_hp +
        pet.base_phy_atk +
        pet.base_mag_atk +
        pet.base_phy_def +
        pet.base_mag_def +
        pet.base_spd
    );
}

function normalizeWeight(value: number | null) {
    if (value === null) {
        return null;
    }

    return Number((value / 1000).toFixed(1));
}

async function getPets() {
    petsController?.abort();
    petsController = new AbortController();
    isLoading.value = true;
    errorMessage.value = "";

    try {
        const [response, breedingResponse] = await Promise.all([
            fetch("/data/Pets.json", {
                signal: petsController.signal,
            }),
            fetch("/data/PetsBreeding.json", {
                signal: petsController.signal,
            }).catch(() => null),
        ]);

        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }

        const petsPayload = await response.json();
        const breedingMap = breedingResponse?.ok
            ? ((await breedingResponse.json()) as Record<string, IPetsBreedingInfo>)
            : {};
        pets.value = (petsPayload as IPets[]).map((pet) => ({
            ...pet,
            breeding: breedingMap[String(pet.id)] ?? null,
        }));
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            return;
        }

        errorMessage.value = "配种数据加载失败，请稍后重试。";
        pets.value = [];
    } finally {
        isLoading.value = false;
    }
}

async function getLayEggRates() {
    layEggRateController?.abort();
    layEggRateController = new AbortController();

    try {
        const response = await fetch(
            "/data/tables/HOME_PET_LAY_EGG_RATE_CONF.json",
            {
                signal: layEggRateController.signal,
            },
        );

        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }

        const payload = (await response.json()) as
            | ILayEggRateRow[]
            | ILayEggRateResponse;

        layEggRates.value = normalizeLayEggRateRows(payload);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            return;
        }

        layEggRates.value = [];
    }
}

function normalizeLayEggRateRows(
    payload: ILayEggRateRow[] | ILayEggRateResponse,
) {
    if (Array.isArray(payload)) {
        return payload;
    }

    return Object.values(payload?.RocoDataRows ?? {});
}

document.title = "精灵配种 - 洛克王国工具箱";
</script>

<template>
    <section class="space-y-3">
        <Card>
            <CardHeader>
                <div
                    class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"
                >
                    <div class="max-w-3xl space-y-3">
                        <CardTitle
                            class="text-2xl tracking-tight text-foreground md:text-3xl"
                        >
                            精灵配种
                        </CardTitle>
                    </div>

                    <div class="grid gap-3 sm:grid-cols-3">
                        <div
                            class="rounded-[10px] border border-border bg-muted px-4 py-3 "
                        >
                            <p
                                class="text-xs tracking-[0.18em] text-foreground uppercase"
                            >
                                母体候选
                            </p>
                            <p class="mt-2 text-2xl font-semibold text-foreground">
                                {{ motherEligibleCount }}
                            </p>
                        </div>
                        <div
                            class="rounded-[10px] border border-border bg-muted px-4 py-3 "
                        >
                            <p
                                class="text-xs tracking-[0.18em] text-foreground uppercase"
                            >
                                父体候选
                            </p>
                            <p class="mt-2 text-2xl font-semibold text-foreground">
                                {{ fatherEligibleCount }}
                            </p>
                        </div>
                    </div>
                </div>
            </CardHeader>

            <CardContent class="space-y-3 px-4 pb-6">
                <Separator class="bg-white/10" />

                <div
                    v-if="errorMessage"
                    class="rounded-[10px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
                >
                    {{ errorMessage }}
                </div>

                <div
                    v-else-if="isLoading"
                    class="grid gap-4 xl:grid-cols-[1fr_auto_1fr]"
                >
                    <Skeleton class="h-72 rounded-[10px] bg-muted" />
                    <div class="hidden xl:block" />
                    <Skeleton class="h-72 rounded-[10px] bg-muted" />
                </div>

                <div v-else class="grid gap-4 xl:grid-cols-[1fr_auto_1fr]">
                    <Card
                        class="overflow-hidden border-border bg-card shadow-none"
                    >
                        <CardHeader class="space-y-4 px-5 py-5">
                            <div
                                class="flex items-center justify-between gap-3"
                            >
                                <div>
                                    <p
                                        class="text-xs tracking-[0.18em] text-foreground uppercase"
                                    >
                                        精灵 A
                                    </p>
                                    <h2
                                        class="mt-2 text-xl font-semibold tracking-tight text-foreground"
                                    >
                                        母体
                                    </h2>
                                </div>

                                <Badge
                                    variant="outline"
                                    class="rounded-[10px] border-border/20 bg-card hover:bg-accent/10 text-foreground"
                                >
                                    出生结果跟随她
                                </Badge>
                            </div>

                            <Popover v-model:open="motherPopoverOpen">
                                <PopoverTrigger as-child>
                                    <Button
                                        variant="outline"
                                        class="h-auto w-full justify-between rounded-[10px] border-border bg-muted px-4 py-3 text-left text-foreground hover:bg-accent"
                                    >
                                        <div class="min-w-0">
                                            <p class="text-xs text-foreground">
                                                搜索并选择母体
                                            </p>
                                            <p
                                                class="mt-1 truncate text-sm font-medium text-foreground"
                                            >
                                                {{
                                                    selectedMother?.localized.zh
                                                        .name ?? "选择母体精灵"
                                                }}
                                            </p>
                                        </div>
                                        <ChevronDown
                                            class="h-4 w-4 shrink-0 text-foreground"
                                        />
                                    </Button>
                                </PopoverTrigger>

                                <PopoverContent
                                    v-if="motherPopoverOpen"
                                    align="start"
                                    class="w-[min(28rem,calc(100vw-2rem))] border-border bg-slate-950/95 p-0 text-foreground"
                                >
                                    <div
                                        class="rounded-[10px] border-0 bg-transparent"
                                    >
                                        <div
                                            class="border-b border-border p-3"
                                        >
                                            <div class="relative">
                                                <Search
                                                    class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-foreground"
                                                />
                                                <Input
                                                    v-model="motherSearchQuery"
                                                    placeholder="搜索母体名称、编号、属性"
                                                    class="h-11 rounded-[10px] border-border bg-card pl-9 text-foreground placeholder:text-foreground"
                                                />
                                            </div>
                                            <p
                                                class="mt-2 text-xs text-foreground"
                                            >
                                                已匹配
                                                {{
                                                    filteredMotherOptions.length
                                                }}
                                                项
                                            </p>
                                        </div>

                                        <div
                                            v-if="!filteredMotherOptions.length"
                                            class="px-3 py-8 text-sm text-foreground"
                                        >
                                            没有符合条件的母体精灵。
                                        </div>

                                        <div
                                            v-else
                                            v-bind="motherVirtualContainerProps"
                                            class="max-h-96 overflow-y-auto px-2 py-2"
                                        >
                                            <div
                                                v-bind="
                                                    motherVirtualWrapperProps
                                                "
                                            >
                                                <button
                                                    v-for="row in motherVirtualOptions"
                                                    :key="row.data.pet.id"
                                                    :title="
                                                        row.data.compatible
                                                            ? undefined
                                                            : (row.data
                                                                  .reason ??
                                                              '无法与当前精灵配对')
                                                    "
                                                    :disabled="
                                                        !row.data.compatible
                                                    "
                                                    type="button"
                                                    :class="[
                                                        'mb-2 flex h-21 w-full items-center gap-3 rounded-[10px] border border-transparent px-3 py-3 text-left text-foreground transition-colors',
                                                        row.data.pet.id ===
                                                        selectedMotherId
                                                            ? 'border-border/30 bg-card hover:bg-accent/10'
                                                            : '',
                                                        row.data.compatible
                                                            ? 'bg-white/4 hover:bg-muted'
                                                            : 'bg-black/30 opacity-45',
                                                    ]"
                                                    @click="
                                                        selectPet(
                                                            'mother',
                                                            row.data.pet.id,
                                                            row.data.compatible,
                                                        )
                                                    "
                                                >
                                                    <FriendPortrait
                                                        :name="
                                                            row.data.pet.name
                                                        "
                                                        :alt="
                                                            row.data.pet
                                                                .localized.zh
                                                                .name
                                                        "
                                                        class="h-10 w-12 shrink-0 rounded-[10px] border-border"
                                                        img-class="object-cover object-top"
                                                    />
                                                    <div
                                                        class="min-w-0 flex-1 space-y-1"
                                                    >
                                                        <div
                                                            class="flex items-center justify-between gap-3"
                                                        >
                                                            <div
                                                                class="min-w-0"
                                                            >
                                                                <div
                                                                    class="flex items-center gap-2"
                                                                >
                                                                    <p
                                                                        class="truncate font-medium text-foreground"
                                                                    >
                                                                        {{
                                                                            row
                                                                                .data
                                                                                .pet
                                                                                .localized
                                                                                .zh
                                                                                .name
                                                                        }}
                                                                    </p>
                                                                    <Badge
                                                                        v-if="
                                                                            !isPetImplemented(
                                                                                row
                                                                                    .data
                                                                                    .pet,
                                                                            )
                                                                        "
                                                                        variant="outline"
                                                                        class="rounded-[10px] border-border/20 bg-card hover:bg-accent/10 px-1.5 py-0 text-[10px] text-foreground"
                                                                    >
                                                                        未实装
                                                                    </Badge>
                                                                </div>
                                                                <p
                                                                    class="text-xs text-foreground"
                                                                >
                                                                    #{{
                                                                        formatPetHandbookNo(
                                                                            row
                                                                                .data
                                                                                .pet,
                                                                        )
                                                                    }}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <p
                                                            class="truncate text-xs text-foreground"
                                                        >
                                                            {{
                                                                getTypeLabel(
                                                                    row.data
                                                                        .pet,
                                                                )
                                                            }}
                                                        </p>
                                                        <p
                                                            :class="[
                                                                'truncate text-xs',
                                                                row.data
                                                                    .compatible
                                                                    ? 'text-emerald-200'
                                                                    : 'text-rose-200',
                                                            ]"
                                                        >
                                                            {{
                                                                getCandidateStatusLabel(
                                                                    row.data,
                                                                    "mother",
                                                                )
                                                            }}
                                                        </p>
                                                    </div>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </CardHeader>

                        <CardContent class="px-5 pb-5 pt-0">
                            <div
                                class="rounded-[10px] border border-border bg-white/5 p-4"
                            >
                                <div class="flex items-start gap-4">
                                    <FriendPortrait
                                        :name="selectedMother?.name"
                                        :alt="
                                            selectedMother?.localized.zh.name ??
                                            '母体'
                                        "
                                        class="h-24 w-24 rounded-[1.4rem] border-border"
                                        img-class="object-cover object-top"
                                        eager
                                    />

                                    <div class="min-w-0 flex-1 space-y-3">
                                        <div>
                                            <p class="text-xs text-foreground">
                                                当前母体
                                            </p>
                                            <h3
                                                class="mt-1 text-xl font-semibold text-foreground"
                                            >
                                                {{
                                                    selectedMother?.localized.zh
                                                        .name ?? "尚未选择"
                                                }}
                                            </h3>
                                        </div>

                                        <div
                                            v-if="selectedMother"
                                            class="flex flex-wrap gap-2"
                                        >
                                            <Badge
                                                variant="outline"
                                                class="rounded-[10px] border-border/20 bg-card hover:bg-accent/10 text-foreground"
                                            >
                                                {{
                                                    getTypeLabel(selectedMother)
                                                }}
                                            </Badge>
                                            <Badge
                                                v-if="
                                                    !isPetImplemented(
                                                        selectedMother,
                                                    )
                                                "
                                                variant="outline"
                                                class="rounded-[10px] border-border/20 bg-card hover:bg-accent/10 text-foreground"
                                            >
                                                未实装
                                            </Badge>
                                        </div>

                                        <p
                                            v-if="!selectedMother"
                                            class="text-sm leading-6 text-foreground"
                                        >
                                            未选择母体时，只会展示能够担任母体的候选精灵。
                                        </p>
                                    </div>
                                </div>

                                <div class="mt-4 flex gap-2">
                                    <Button
                                        variant="outline"
                                        class="rounded-[10px] border-border bg-card text-foreground hover:bg-accent"
                                        @click="motherPopoverOpen = true"
                                    >
                                        重新选择
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        class="rounded-[10px] text-foreground hover:bg-muted hover:text-foreground"
                                        @click="clearPet('mother')"
                                    >
                                        清空
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div class="hidden items-center justify-center xl:flex">
                        <div
                            class="flex h-16 w-16 items-center justify-center rounded-[10px] border border-border bg-muted shadow-md"
                        >
                            <ArrowRightLeft class="h-5 w-5 text-foreground" />
                        </div>
                    </div>

                    <Card
                        class="overflow-hidden border-border bg-card shadow-none"
                    >
                        <CardHeader class="space-y-4 px-5 py-5">
                            <div
                                class="flex items-center justify-between gap-3"
                            >
                                <div>
                                    <p
                                        class="text-xs tracking-[0.18em] text-foreground uppercase"
                                    >
                                        精灵 B
                                    </p>
                                    <h2
                                        class="mt-2 text-xl font-semibold tracking-tight text-foreground"
                                    >
                                        父体
                                    </h2>
                                </div>

                                <Badge
                                    variant="outline"
                                    class="rounded-[10px] border-sky-300/20 bg-sky-300/10 text-sky-100"
                                >
                                    负责配对条件
                                </Badge>
                            </div>

                            <Popover v-model:open="fatherPopoverOpen">
                                <PopoverTrigger as-child>
                                    <Button
                                        variant="outline"
                                        class="h-auto w-full justify-between rounded-[10px] border-border bg-muted px-4 py-3 text-left text-foreground hover:bg-accent"
                                    >
                                        <div class="min-w-0">
                                            <p class="text-xs text-foreground">
                                                搜索并选择父体
                                            </p>
                                            <p
                                                class="mt-1 truncate text-sm font-medium text-foreground"
                                            >
                                                {{
                                                    selectedFather?.localized.zh
                                                        .name ?? "选择父体精灵"
                                                }}
                                            </p>
                                        </div>
                                        <ChevronDown
                                            class="h-4 w-4 shrink-0 text-foreground"
                                        />
                                    </Button>
                                </PopoverTrigger>

                                <PopoverContent
                                    v-if="fatherPopoverOpen"
                                    align="start"
                                    class="w-[min(28rem,calc(100vw-2rem))] border-border bg-slate-950/95 p-0 text-foreground"
                                >
                                    <div
                                        class="rounded-[10px] border-0 bg-transparent"
                                    >
                                        <div
                                            class="border-b border-border p-3"
                                        >
                                            <div class="relative">
                                                <Search
                                                    class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-foreground"
                                                />
                                                <Input
                                                    v-model="fatherSearchQuery"
                                                    placeholder="搜索父体名称、编号、属性"
                                                    class="h-11 rounded-[10px] border-border bg-card pl-9 text-foreground placeholder:text-foreground"
                                                />
                                            </div>
                                            <p
                                                class="mt-2 text-xs text-foreground"
                                            >
                                                已匹配
                                                {{
                                                    filteredFatherOptions.length
                                                }}
                                                项
                                            </p>
                                        </div>

                                        <div
                                            v-if="!filteredFatherOptions.length"
                                            class="px-3 py-8 text-sm text-foreground"
                                        >
                                            没有符合条件的父体精灵。
                                        </div>

                                        <div
                                            v-else
                                            v-bind="fatherVirtualContainerProps"
                                            class="max-h-96 overflow-y-auto px-2 py-2"
                                        >
                                            <div
                                                v-bind="
                                                    fatherVirtualWrapperProps
                                                "
                                            >
                                                <button
                                                    v-for="row in fatherVirtualOptions"
                                                    :key="row.data.pet.id"
                                                    :title="
                                                        row.data.compatible
                                                            ? undefined
                                                            : (row.data
                                                                  .reason ??
                                                              '无法与当前精灵配对')
                                                    "
                                                    :disabled="
                                                        !row.data.compatible
                                                    "
                                                    type="button"
                                                    :class="[
                                                        'mb-2 flex h-21 w-full items-center gap-3 rounded-[10px] border border-transparent px-3 py-3 text-left text-foreground transition-colors',
                                                        row.data.pet.id ===
                                                        selectedFatherId
                                                            ? 'border-sky-300/30 bg-sky-300/10'
                                                            : '',
                                                        row.data.compatible
                                                            ? 'bg-white/4 hover:bg-muted'
                                                            : 'bg-black/30 opacity-45',
                                                    ]"
                                                    @click="
                                                        selectPet(
                                                            'father',
                                                            row.data.pet.id,
                                                            row.data.compatible,
                                                        )
                                                    "
                                                >
                                                    <FriendPortrait
                                                        :name="
                                                            row.data.pet.name
                                                        "
                                                        :alt="
                                                            row.data.pet
                                                                .localized.zh
                                                                .name
                                                        "
                                                        class="h-10 w-12 shrink-0 rounded-[10px] border-border"
                                                        img-class="object-cover object-top"
                                                    />
                                                    <div
                                                        class="min-w-0 flex-1 space-y-1"
                                                    >
                                                        <div
                                                            class="flex items-center justify-between gap-3"
                                                        >
                                                            <div
                                                                class="min-w-0"
                                                            >
                                                                <div
                                                                    class="flex items-center gap-2"
                                                                >
                                                                    <p
                                                                        class="truncate font-medium text-foreground"
                                                                    >
                                                                        {{
                                                                            row
                                                                                .data
                                                                                .pet
                                                                                .localized
                                                                                .zh
                                                                                .name
                                                                        }}
                                                                    </p>
                                                                    <Badge
                                                                        v-if="
                                                                            !isPetImplemented(
                                                                                row
                                                                                    .data
                                                                                    .pet,
                                                                            )
                                                                        "
                                                                        variant="outline"
                                                                        class="rounded-[10px] border-border/20 bg-card hover:bg-accent/10 px-1.5 py-0 text-[10px] text-foreground"
                                                                    >
                                                                        未实装
                                                                    </Badge>
                                                                </div>
                                                                <p
                                                                    class="text-xs text-foreground"
                                                                >
                                                                    #{{
                                                                        formatPetHandbookNo(
                                                                            row
                                                                                .data
                                                                                .pet,
                                                                        )
                                                                    }}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <p
                                                            class="truncate text-xs text-foreground"
                                                        >
                                                            {{
                                                                getTypeLabel(
                                                                    row.data
                                                                        .pet,
                                                                )
                                                            }}
                                                        </p>
                                                        <p
                                                            :class="[
                                                                'truncate text-xs',
                                                                row.data
                                                                    .compatible
                                                                    ? 'text-emerald-200'
                                                                    : 'text-rose-200',
                                                            ]"
                                                        >
                                                            {{
                                                                getCandidateStatusLabel(
                                                                    row.data,
                                                                    "father",
                                                                )
                                                            }}
                                                        </p>
                                                    </div>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </CardHeader>

                        <CardContent class="px-5 pb-5 pt-0">
                            <div
                                class="rounded-[10px] border border-border bg-white/5 p-4"
                            >
                                <div class="flex items-start gap-4">
                                    <FriendPortrait
                                        :name="selectedFather?.name"
                                        :alt="
                                            selectedFather?.localized.zh.name ??
                                            '父体'
                                        "
                                        class="h-24 w-24 rounded-[1.4rem] border-border"
                                        img-class="object-cover object-top"
                                        eager
                                    />

                                    <div class="min-w-0 flex-1 space-y-3">
                                        <div>
                                            <p class="text-xs text-foreground">
                                                当前父体
                                            </p>
                                            <h3
                                                class="mt-1 text-xl font-semibold text-foreground"
                                            >
                                                {{
                                                    selectedFather?.localized.zh
                                                        .name ?? "尚未选择"
                                                }}
                                            </h3>
                                        </div>

                                        <div
                                            v-if="selectedFather"
                                            class="flex flex-wrap gap-2"
                                        >
                                            <Badge
                                                variant="outline"
                                                class="rounded-[10px] border-sky-300/20 bg-sky-300/10 text-sky-100"
                                            >
                                                {{
                                                    getTypeLabel(selectedFather)
                                                }}
                                            </Badge>
                                            <Badge
                                                v-if="
                                                    !isPetImplemented(
                                                        selectedFather,
                                                    )
                                                "
                                                variant="outline"
                                                class="rounded-[10px] border-border/20 bg-card hover:bg-accent/10 text-foreground"
                                            >
                                                未实装
                                            </Badge>
                                        </div>

                                        <p
                                            v-if="!selectedFather"
                                            class="text-sm leading-6 text-foreground"
                                        >
                                            已选母体后，父体候选会按蛋组与雄性条件自动高亮排序。
                                        </p>
                                    </div>
                                </div>

                                <div class="mt-4 flex gap-2">
                                    <Button
                                        variant="outline"
                                        class="rounded-[10px] border-border bg-card text-foreground hover:bg-accent"
                                        @click="fatherPopoverOpen = true"
                                    >
                                        重新选择
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        class="rounded-[10px] text-foreground hover:bg-muted hover:text-foreground"
                                        @click="clearPet('father')"
                                    >
                                        清空
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </CardContent>
        </Card>
        <Income />
        <Card
            class="overflow-hidden border-border bg-card py-0 shadow-md"
        >
            <CardHeader class="gap-4 px-4 py-4">
                <div
                    class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
                >
                    <div>
                        <p
                            class="inline-flex items-center gap-2 text-xs tracking-[0.18em] text-foreground uppercase"
                        >
                            <Sparkles class="h-3.5 w-3.5 text-foreground" />
                            精灵蛋信息
                        </p>
                        <CardTitle
                            class="mt-2 text-2xl tracking-tight text-foreground"
                        >
                            配种结果预览
                        </CardTitle>
                    </div>

                    <div
                        class="inline-flex items-center gap-2 rounded-[10px] border border-border bg-muted px-3 py-1.5 text-sm text-foreground"
                    >
                        <Link2 class="h-4 w-4 text-emerald-300" />
                        共享蛋组：
                        <span class="font-medium text-foreground">
                            {{
                                pairEvaluation.overlapEggGroups.length
                                    ? pairEvaluation.overlapEggGroups
                                          .map((groupId) =>
                                              formatEggGroup(groupId),
                                          )
                                          .join(" / ")
                                    : "暂无重叠"
                            }}
                        </span>
                    </div>
                </div>
            </CardHeader>

            <CardContent class="space-y-5 px-4 pb-6">
                <div
                    v-if="!selectedMother || !selectedFather"
                    class="rounded-[10px] border border-dashed border-border bg-white/4 px-5 py-8 text-center text-sm leading-7 text-foreground"
                >
                    先在上方分别选择母体与父体，底部会显示孵化时长、可继承结果、共享蛋组与配种参考信息。
                </div>

                <template v-else>
                    <div
                        v-if="!pairEvaluation.compatible"
                        class="rounded-[10px] border border-rose-400/20 bg-rose-500/10 p-3"
                    >
                        <div class="flex items-start gap-3">
                            <div
                                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-rose-400/20 bg-rose-500/10"
                            >
                                <CircleAlert class="h-5 w-5 text-rose-200" />
                            </div>
                            <div class="space-y-2">
                                <h3 class="text-lg font-semibold text-foreground">
                                    当前组合无法配种
                                </h3>
                                <p class="text-sm leading-6 text-rose-100/90">
                                    {{ pairEvaluation.reasons.join("，") }}。
                                </p>
                                <p class="text-sm leading-6 text-foreground">
                                    你仍然可以保留当前选择，继续从下拉列表中寻找高亮的可配对对象。
                                </p>
                            </div>
                        </div>
                    </div>

                    <div v-else class="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                        <div
                            class="rounded-[10px] border border-border bg-card p-3"
                        >
                            <div
                                class="flex flex-col gap-5 lg:flex-row lg:items-start"
                            >
                                <FriendPortrait
                                    :name="selectedMother.name"
                                    :alt="selectedMother.localized.zh.name"
                                    class="h-28 w-28 rounded-[1.6rem] border-border"
                                    img-class="object-cover object-top"
                                    eager
                                />

                                <div class="min-w-0 flex-1 space-y-4">
                                    <div>
                                        <p class="text-xs text-foreground">
                                            即将孵化
                                        </p>
                                        <h3
                                            class="mt-1 text-2xl font-semibold tracking-tight text-foreground"
                                        >
                                            {{
                                                selectedMother.localized.zh.name
                                            }}
                                        </h3>
                                        <p
                                            class="mt-2 text-sm leading-6 text-foreground"
                                        >
                                            精灵的特性、颜色有概率从父母继承
                                        </p>
                                    </div>

                                    <div class="flex flex-wrap gap-2">
                                        <Badge
                                            variant="outline"
                                            class="rounded-[10px] border-border/20 bg-card hover:bg-accent/10 text-foreground"
                                        >
                                            {{ inheritedTypeLabel }}
                                        </Badge>
                                        <Badge
                                            variant="outline"
                                            class="rounded-[10px] border-border bg-muted text-foreground"
                                        >
                                            总种族值 {{ totalStatsLabel }}
                                        </Badge>
                                        <Badge
                                            variant="outline"
                                            class="rounded-[10px] border-border bg-muted text-foreground"
                                        >
                                            {{ hatchDurationLabel }} 可孵化
                                        </Badge>
                                    </div>
                                </div>
                            </div>

                            <div
                                class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4"
                            >
                                <div
                                    class="rounded-[10px] border border-border bg-black/18 px-4 py-3"
                                >
                                    <p
                                        class="flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-foreground uppercase"
                                    >
                                        <Clock3
                                            class="h-3.5 w-3.5 text-foreground"
                                        />
                                        孵化时长
                                    </p>
                                    <p
                                        class="mt-2 text-sm font-semibold text-foreground"
                                    >
                                        {{ hatchDurationLabel }}
                                    </p>
                                </div>

                                <div
                                    class="rounded-[10px] border border-border bg-black/18 px-4 py-3"
                                >
                                    <p
                                        class="flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-foreground uppercase"
                                    >
                                        <Egg
                                            class="h-3.5 w-3.5 text-emerald-300"
                                        />
                                        冷却参考
                                    </p>
                                    <p
                                        class="mt-2 text-sm font-semibold text-foreground"
                                    >
                                        {{ cooldownReferenceLabel }}
                                    </p>
                                </div>

                                <div
                                    class="rounded-[10px] border border-border bg-black/18 px-4 py-3"
                                >
                                    <p
                                        class="text-[11px] tracking-[0.14em] text-foreground uppercase"
                                    >
                                        身高范围
                                    </p>
                                    <p
                                        class="mt-2 text-sm font-semibold text-foreground"
                                    >
                                        {{ heightRangeLabel }}
                                    </p>
                                </div>

                                <div
                                    class="rounded-[10px] border border-border bg-black/18 px-4 py-3"
                                >
                                    <p
                                        class="text-[11px] tracking-[0.14em] text-foreground uppercase"
                                    >
                                        体重范围
                                    </p>
                                    <p
                                        class="mt-2 text-sm font-semibold text-foreground"
                                    >
                                        {{ weightRangeLabel }}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div class="space-y-4">
                            <div
                                class="rounded-[1.8rem] border border-border bg-white/5 p-4"
                            >
                                <p
                                    class="text-xs tracking-[0.16em] text-foreground uppercase"
                                >
                                    配种判定
                                </p>
                                <div
                                    class="mt-3 space-y-3 text-sm text-foreground"
                                >
                                    <div
                                        class="rounded-[10px] border border-border bg-black/18 px-3 py-2.5"
                                    >
                                        <p>共享蛋组</p>
                                        <div class="mt-2 flex flex-wrap gap-2">
                                            <div
                                                v-for="groupId in pairEvaluation.overlapEggGroups"
                                                :key="groupId"
                                                class="flex gap-2 items-center"
                                            >
                                                <Badge
                                                    variant="outline"
                                                    class="rounded-[10px] border-emerald-300/20 bg-card hover:bg-accent/10 text-emerald-100"
                                                >
                                                    {{
                                                        formatEggGroup(groupId)
                                                    }}
                                                </Badge>
                                                <div class="text-[12px]">
                                                    {{
                                                        getEggGroupMeta(groupId)
                                                            ?.description
                                                    }}
                                                </div>
                                            </div>
                                        </div>
                                        <div class=""></div>
                                        <div
                                            class="mt-3 space-y-3 text-sm leading-6 text-foreground"
                                        >
                                            <p>
                                                冷却相关：{{
                                                    cooldownDescription
                                                }}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
            </CardContent>
        </Card>
    </section>
</template>

<style scoped></style>
