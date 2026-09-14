<script setup lang="ts">
import type { IMedalEntry, IMedalPayload } from "@/lib/interface";
import {
    Award,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    RotateCcw,
    Search,
    SlidersHorizontal,
} from "lucide-vue-next";

const PAGE_SIZE_OPTIONS = [24, 48, 96];

const QUALITY_OPTIONS = [
    { value: "all", label: "全部品质" },
    { value: "5", label: "传说" },
    { value: "4", label: "史诗" },
    { value: "3", label: "精良" },
    { value: "2", label: "优秀" },
    { value: "1", label: "普通" },
];

const QUALITY_TEXT: Record<number, string> = {
    5: "text-amber-200",
    4: "text-purple-200",
    3: "text-sky-200",
    2: "text-emerald-200",
    1: "text-foreground",
};

const medals = ref<IMedalEntry[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");
const searchQuery = ref("");
const selectedQuality = ref("all");
const selectedType = ref("all");
const currentPage = ref(1);
const pageSize = ref(48);

let controller: AbortController | null = null;

const typeOptions = computed(() => {
    const types = new Set<string>();

    for (const medal of medals.value) {
        if (medal.type_label) {
            types.add(medal.type_label);
        }
    }

    return [...types].sort((a, b) => a.localeCompare(b, "zh-CN"));
});

const filteredMedals = computed(() => {
    let result = medals.value;
    const query = searchQuery.value.trim().toLowerCase();

    if (query) {
        result = result.filter((medal) => {
            return (
                medal.name.toLowerCase().includes(query) ||
                medal.description.toLowerCase().includes(query) ||
                (medal.prefix_text && medal.prefix_text.toLowerCase().includes(query))
            );
        });
    }

    if (selectedQuality.value !== "all") {
        const quality = Number(selectedQuality.value);
        result = result.filter((medal) => medal.quality === quality);
    }

    if (selectedType.value !== "all") {
        result = result.filter((medal) => medal.type_label === selectedType.value);
    }

    return result;
});

const pageCount = computed(() =>
    Math.max(1, Math.ceil(filteredMedals.value.length / pageSize.value)),
);

const paginatedMedals = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value;
    return filteredMedals.value.slice(start, start + pageSize.value);
});

const currentRangeStart = computed(() => {
    if (filteredMedals.value.length === 0) return 0;
    return (currentPage.value - 1) * pageSize.value + 1;
});

const currentRangeEnd = computed(() => {
    return Math.min(currentPage.value * pageSize.value, filteredMedals.value.length);
});

const hasActiveFilters = computed(() => {
    return (
        searchQuery.value.trim() !== "" ||
        selectedQuality.value !== "all" ||
        selectedType.value !== "all"
    );
});

const summaryItems = computed(() => [
    { label: "奖牌总数", value: medals.value.length },
    { label: "当前筛选", value: filteredMedals.value.length },
    { label: "类型数", value: typeOptions.value.length },
]);

const pageSizeModel = computed({
    get: () => String(pageSize.value),
    set: (value: string) => {
        pageSize.value = Number(value);
        currentPage.value = 1;
    },
});

const pageItems = computed(() => buildPageItems(currentPage.value, pageCount.value));

watch([searchQuery, selectedQuality, selectedType], () => {
    currentPage.value = 1;
});

function qualityText(quality: number) {
    return QUALITY_TEXT[quality] ?? "text-foreground";
}

function setPage(page: number) {
    currentPage.value = Math.max(1, Math.min(page, pageCount.value));
}

function resetFilters() {
    searchQuery.value = "";
    selectedQuality.value = "all";
    selectedType.value = "all";
    currentPage.value = 1;
}

function buildPageItems(current: number, total: number) {
    if (total <= 7) {
        return Array.from({ length: total }, (_, index) => ({
            kind: "page" as const,
            value: index + 1,
            key: `p${index + 1}`,
        }));
    }

    const result: { kind: "page" | "ellipsis"; value?: number; key: string }[] = [];
    result.push({ kind: "page", value: 1, key: "p1" });

    if (current > 3) {
        result.push({ kind: "ellipsis", key: "e1" });
    }

    for (let page = Math.max(2, current - 1); page <= Math.min(total - 1, current + 1); page++) {
        result.push({ kind: "page", value: page, key: `p${page}` });
    }

    if (current < total - 2) {
        result.push({ kind: "ellipsis", key: "e2" });
    }

    result.push({ kind: "page", value: total, key: `p${total}` });
    return result;
}

async function loadMedals() {
    controller?.abort();
    controller = new AbortController();
    isLoading.value = true;
    errorMessage.value = "";

    try {
        const response = await fetch("/data/medals.json", {
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }

        const payload = (await response.json()) as IMedalPayload;
        medals.value = Object.values(payload.entries ?? {});
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            return;
        }

        errorMessage.value = "奖牌数据加载失败，请稍后重试。";
        medals.value = [];
    } finally {
        isLoading.value = false;
    }
}

document.title = "奖牌 - 洛克王国工具箱";

onMounted(() => {
    void loadMedals();
});

onBeforeUnmount(() => {
    controller?.abort();
});
</script>

<template>
    <section class="space-y-3">
        <Card class="overflow-hidden border-border bg-card py-0 shadow-lg">
            <CardHeader class="gap-3 px-4 py-4">
                <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <CardTitle class="text-2xl tracking-tight text-foreground md:text-3xl">
                        奖牌图鉴
                    </CardTitle>

                    <div class="grid grid-cols-3 gap-2 md:gap-3">
                        <div v-for="item in summaryItems" :key="item.label"
                            class="rounded-[10px] border border-border bg-muted px-3 py-2.5 shadow-sm md:px-4 md:py-3">
                            <p class="text-[10px] tracking-[0.12em] text-foreground uppercase sm:text-xs sm:tracking-[0.2em]">
                                {{ item.label }}
                            </p>
                            <p class="mt-1 text-lg font-semibold text-foreground sm:mt-2 sm:text-2xl">
                                {{ item.value }}
                            </p>
                        </div>
                    </div>
                </div>
            </CardHeader>

            <CardContent class="space-y-4 px-4 pb-6">
                <Separator class="bg-white/10" />

                <div class="grid gap-3 xl:grid-cols-[2fr_1fr_1fr]">
                    <div class="relative">
                        <Search
                            class="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground" />
                        <Input v-model="searchQuery" type="search" placeholder="搜索奖牌名称、称号或获取条件"
                            class="h-10 rounded-[10px] border-border bg-card pl-11 text-sm text-foreground placeholder:text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20" />
                    </div>

                    <Select v-model="selectedQuality">
                        <SelectTrigger
                            class="h-10 w-full rounded-[10px] border-border bg-card text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20">
                            <SelectValue placeholder="全部品质" />
                        </SelectTrigger>
                        <SelectContent class="border-border bg-slate-950/95 text-foreground">
                            <SelectItem v-for="option in QUALITY_OPTIONS" :key="option.value" :value="option.value">
                                {{ option.label }}
                            </SelectItem>
                        </SelectContent>
                    </Select>

                    <Select v-model="selectedType">
                        <SelectTrigger
                            class="h-10 w-full rounded-[10px] border-border bg-card text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20">
                            <SelectValue placeholder="全部类型" />
                        </SelectTrigger>
                        <SelectContent class="border-border bg-slate-950/95 text-foreground">
                            <SelectItem value="all">全部类型</SelectItem>
                            <SelectItem v-for="type in typeOptions" :key="type" :value="type">
                                {{ type }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-foreground">
                    <Badge variant="outline"
                        class="rounded-[10px] border-border bg-white/5 px-3 py-1 text-foreground">
                        <SlidersHorizontal class="h-3.5 w-3.5 text-foreground" />
                        {{ filteredMedals.length }} 枚结果
                    </Badge>

                    <div class="flex flex-wrap items-center gap-2">
                        <Select v-model="pageSizeModel">
                            <SelectTrigger
                                class="h-10 w-34.5 rounded-[10px] border-border bg-card text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20">
                                <SelectValue placeholder="每页显示" />
                            </SelectTrigger>
                            <SelectContent class="border-border bg-slate-950/95 text-foreground">
                                <SelectItem v-for="option in PAGE_SIZE_OPTIONS" :key="option" :value="String(option)">
                                    每页 {{ option }} 枚
                                </SelectItem>
                            </SelectContent>
                        </Select>

                        <Button v-if="hasActiveFilters" variant="outline"
                            class="rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                            @click="resetFilters">
                            <RotateCcw class="h-3.5 w-3.5" />
                            重置条件
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>

        <div v-if="isLoading" class="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            <Skeleton v-for="index in 6" :key="index"
                class="h-32 rounded-[10px] border border-border bg-muted" />
        </div>

        <div v-else-if="errorMessage"
            class="rounded-[10px] border border-destructive/20 bg-destructive/8 px-4 py-10 text-center text-sm text-destructive">
            {{ errorMessage }}
        </div>

        <div v-else-if="filteredMedals.length === 0"
            class="rounded-[10px] border border-dashed border-white/12 bg-card px-4 py-6 text-center text-sm text-foreground">
            当前筛选条件下没有找到奖牌，请调整关键词或筛选项。
        </div>

        <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card v-for="medal in paginatedMedals" :key="medal.wiki_key"
                class="border-border bg-card py-0 shadow-md transition duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl">
                <CardContent class="p-4">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                                <h3 class="text-lg font-semibold tracking-tight text-foreground">
                                    {{ medal.name }}
                                </h3>
                                <Badge v-if="medal.prefix_text" variant="outline"
                                    class="rounded-[10px] border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-200">
                                    {{ medal.prefix_text }}
                                </Badge>
                            </div>
                            <div class="mt-1 flex flex-wrap items-center gap-2">
                                <Badge variant="outline"
                                    :class="['rounded-[10px] border-border bg-white/5 px-2.5 py-0.5 text-xs', qualityText(medal.quality)]">
                                    {{ medal.quality_label }}
                                </Badge>
                                <Badge v-if="medal.type_label" variant="outline"
                                    class="rounded-[10px] border-border bg-white/5 px-2.5 py-0.5 text-xs text-foreground">
                                    {{ medal.type_label }}
                                </Badge>
                            </div>
                        </div>
                        <Award class="h-5 w-5 shrink-0 text-amber-300" />
                    </div>

                    <p v-if="medal.description" class="mt-2 text-sm leading-6 text-foreground">
                        {{ medal.description }}
                    </p>

                    <div v-if="medal.tasks.length" class="mt-3 border-t border-white/8 pt-3">
                        <p class="text-xs font-medium text-foreground">获得条件</p>
                        <div class="mt-1.5 space-y-1">
                            <p v-for="(task, index) in medal.tasks" :key="index"
                                class="text-xs leading-5 text-foreground">
                                {{ task.description }}
                                <span v-if="task.count > 1" class="text-foreground/70">（×{{ task.count }}）</span>
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>

        <div v-if="filteredMedals.length > 0 && pageCount > 1"
            class="flex flex-col gap-3 rounded-[10px] border border-border bg-card px-4 py-4 md:flex-row md:items-center md:justify-between">
            <p class="text-sm text-foreground">
                当前第 {{ currentPage }} / {{ pageCount }} 页，显示 {{ currentRangeStart }}-{{ currentRangeEnd }}
                / {{ filteredMedals.length }} 枚结果。
            </p>

            <div class="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="icon"
                    class="rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                    :disabled="currentPage === 1" @click="setPage(1)">
                    <ChevronsLeft class="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon"
                    class="rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                    :disabled="currentPage === 1" @click="setPage(currentPage - 1)">
                    <ChevronLeft class="h-4 w-4" />
                </Button>

                <template v-for="item in pageItems" :key="item.key">
                    <Button v-if="item.kind === 'page'"
                        :variant="item.value === currentPage ? 'default' : 'outline'"
                        class="min-w-10 rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                        @click="setPage(item.value ?? 1)">
                        {{ item.value }}
                    </Button>
                    <span v-else class="px-1 text-foreground">...</span>
                </template>

                <Button variant="outline" size="icon"
                    class="rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                    :disabled="currentPage === pageCount" @click="setPage(currentPage + 1)">
                    <ChevronRight class="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon"
                    class="rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                    :disabled="currentPage === pageCount" @click="setPage(pageCount)">
                    <ChevronsRight class="h-4 w-4" />
                </Button>
            </div>
        </div>
    </section>
</template>

<style scoped></style>
