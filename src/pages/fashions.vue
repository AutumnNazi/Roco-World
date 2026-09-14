<script setup lang="ts">
import type { IFashionEntry, IFashionPayload } from "@/lib/interface";
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    RotateCcw,
    Search,
    Shirt,
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

const QUALITY_LABELS: Record<number, string> = {
    5: "传说",
    4: "史诗",
    3: "精良",
    2: "优秀",
    1: "普通",
};

const QUALITY_TEXT: Record<number, string> = {
    5: "text-amber-200",
    4: "text-purple-200",
    3: "text-sky-200",
    2: "text-emerald-200",
    1: "text-foreground",
};

const fashions = ref<IFashionEntry[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");
const searchQuery = ref("");
const selectedQuality = ref("all");
const selectedGrade = ref("all");
const currentPage = ref(1);
const pageSize = ref(48);
const expandedKey = ref<string | null>(null);
const activeGenderByKey = ref<Record<string, number>>({});

let controller: AbortController | null = null;

const gradeOptions = computed(() => {
    const grades = new Set<string>();

    for (const fashion of fashions.value) {
        if (fashion.grade_name) {
            grades.add(fashion.grade_name);
        }
    }

    return [...grades].sort((a, b) => a.localeCompare(b, "zh-CN"));
});

const filteredFashions = computed(() => {
    let result = fashions.value;
    const query = searchQuery.value.trim().toLowerCase();

    if (query) {
        result = result.filter((fashion) => {
            return (
                fashion.name.toLowerCase().includes(query) ||
                fashion.description.toLowerCase().includes(query) ||
                fashion.variants.some((variant) =>
                    variant.pieces.some((piece) =>
                        piece.name.toLowerCase().includes(query),
                    ),
                )
            );
        });
    }

    if (selectedQuality.value !== "all") {
        const quality = Number(selectedQuality.value);
        result = result.filter((fashion) => fashion.quality === quality);
    }

    if (selectedGrade.value !== "all") {
        result = result.filter(
            (fashion) => fashion.grade_name === selectedGrade.value,
        );
    }

    return result;
});

const pageCount = computed(() =>
    Math.max(1, Math.ceil(filteredFashions.value.length / pageSize.value)),
);

const paginatedFashions = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value;
    return filteredFashions.value.slice(start, start + pageSize.value);
});

const currentRangeStart = computed(() => {
    if (filteredFashions.value.length === 0) return 0;
    return (currentPage.value - 1) * pageSize.value + 1;
});

const currentRangeEnd = computed(() => {
    return Math.min(
        currentPage.value * pageSize.value,
        filteredFashions.value.length,
    );
});

const hasActiveFilters = computed(() => {
    return (
        searchQuery.value.trim() !== "" ||
        selectedQuality.value !== "all" ||
        selectedGrade.value !== "all"
    );
});

const summaryItems = computed(() => [
    { label: "时装总数", value: fashions.value.length },
    { label: "当前筛选", value: filteredFashions.value.length },
    { label: "分级数", value: gradeOptions.value.length },
]);

const pageSizeModel = computed({
    get: () => String(pageSize.value),
    set: (value: string) => {
        pageSize.value = Number(value);
        currentPage.value = 1;
    },
});

const pageItems = computed(() => buildPageItems(currentPage.value, pageCount.value));

watch([searchQuery, selectedQuality, selectedGrade], () => {
    currentPage.value = 1;
});

function qualityLabel(quality: number) {
    return QUALITY_LABELS[quality] ?? "普通";
}

function qualityText(quality: number) {
    return QUALITY_TEXT[quality] ?? "text-foreground";
}

function activeVariant(fashion: IFashionEntry) {
    const index = activeGenderByKey.value[fashion.wiki_key] ?? 0;
    return fashion.variants[index] ?? fashion.variants[0] ?? null;
}

function setGender(fashion: IFashionEntry, index: number) {
    activeGenderByKey.value = {
        ...activeGenderByKey.value,
        [fashion.wiki_key]: index,
    };
}

function toggleExpand(key: string) {
    expandedKey.value = expandedKey.value === key ? null : key;
}

function setPage(page: number) {
    currentPage.value = Math.max(1, Math.min(page, pageCount.value));
}

function resetFilters() {
    searchQuery.value = "";
    selectedQuality.value = "all";
    selectedGrade.value = "all";
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

async function loadFashions() {
    controller?.abort();
    controller = new AbortController();
    isLoading.value = true;
    errorMessage.value = "";

    try {
        const response = await fetch("/data/fashions.json", {
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }

        const payload = (await response.json()) as IFashionPayload;
        fashions.value = Object.values(payload.entries ?? {});
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            return;
        }

        errorMessage.value = "时装数据加载失败，请稍后重试。";
        fashions.value = [];
    } finally {
        isLoading.value = false;
    }
}

document.title = "时装 - 洛克王国工具箱";

onMounted(() => {
    void loadFashions();
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
                        时装图鉴
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
                        <Input v-model="searchQuery" type="search" placeholder="搜索时装名称、描述或部件"
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

                    <Select v-model="selectedGrade">
                        <SelectTrigger
                            class="h-10 w-full rounded-[10px] border-border bg-card text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20">
                            <SelectValue placeholder="全部分级" />
                        </SelectTrigger>
                        <SelectContent class="border-border bg-slate-950/95 text-foreground">
                            <SelectItem value="all">全部分级</SelectItem>
                            <SelectItem v-for="grade in gradeOptions" :key="grade" :value="grade">
                                {{ grade }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-foreground">
                    <Badge variant="outline"
                        class="rounded-[10px] border-border bg-white/5 px-3 py-1 text-foreground">
                        <SlidersHorizontal class="h-3.5 w-3.5 text-foreground" />
                        {{ filteredFashions.length }} 套结果
                    </Badge>

                    <div class="flex flex-wrap items-center gap-2">
                        <Select v-model="pageSizeModel">
                            <SelectTrigger
                                class="h-10 w-34.5 rounded-[10px] border-border bg-card text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20">
                                <SelectValue placeholder="每页显示" />
                            </SelectTrigger>
                            <SelectContent class="border-border bg-slate-950/95 text-foreground">
                                <SelectItem v-for="option in PAGE_SIZE_OPTIONS" :key="option" :value="String(option)">
                                    每页 {{ option }} 套
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
                class="h-40 rounded-[10px] border border-border bg-muted" />
        </div>

        <div v-else-if="errorMessage"
            class="rounded-[10px] border border-destructive/20 bg-destructive/8 px-4 py-10 text-center text-sm text-destructive">
            {{ errorMessage }}
        </div>

        <div v-else-if="filteredFashions.length === 0"
            class="rounded-[10px] border border-dashed border-white/12 bg-card px-4 py-6 text-center text-sm text-foreground">
            当前筛选条件下没有找到时装，请调整关键词或筛选项。
        </div>

        <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div v-for="fashion in paginatedFashions" :key="fashion.wiki_key" class="group"
                @click="toggleExpand(fashion.wiki_key)">
                <Card
                    class="h-full cursor-pointer border-border bg-card py-0 shadow-md transition duration-300 group-hover:-translate-y-1 group-hover:border-primary/30 group-hover:shadow-xl">
                    <CardContent class="p-4">
                        <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                                <h3 class="truncate text-lg font-semibold tracking-tight text-foreground">
                                    {{ fashion.name }}
                                </h3>
                                <div class="mt-1 flex flex-wrap items-center gap-2">
                                    <Badge variant="outline"
                                        :class="['rounded-[10px] border-border bg-white/5 px-2.5 py-0.5 text-xs', qualityText(fashion.quality)]">
                                        {{ qualityLabel(fashion.quality) }}
                                    </Badge>
                                    <Badge v-if="fashion.grade_name" variant="outline"
                                        class="rounded-[10px] border-border bg-white/5 px-2.5 py-0.5 text-xs text-foreground">
                                        {{ fashion.grade_name }}
                                    </Badge>
                                </div>
                            </div>
                            <Shirt class="h-5 w-5 shrink-0 text-sky-300" />
                        </div>

                        <div v-if="fashion.variants.length > 1" class="mt-3 flex gap-2" @click.stop>
                            <Button v-for="(variant, index) in fashion.variants" :key="variant.gender"
                                size="sm"
                                :variant="(activeGenderByKey[fashion.wiki_key] ?? 0) === index ? 'default' : 'outline'"
                                class="h-7 rounded-[10px] border-border bg-white/5 px-3 text-xs text-foreground hover:bg-accent"
                                :class="(activeGenderByKey[fashion.wiki_key] ?? 0) === index ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''"
                                @click="setGender(fashion, index)">
                                {{ variant.gender_label }}
                            </Button>
                        </div>

                        <template v-for="variant in [activeVariant(fashion)]" :key="variant?.gender ?? 'none'">
                            <div v-if="variant" class="mt-3">
                                <div class="flex flex-wrap items-center gap-2 text-xs text-foreground">
                                    <Badge variant="outline"
                                        class="rounded-[10px] border-border bg-white/5 px-2.5 py-0.5 text-foreground">
                                        {{ variant.item_count }} 件套
                                    </Badge>
                                    <Badge v-for="way in variant.acquire" :key="way" variant="outline"
                                        class="rounded-[10px] border-emerald-400/20 bg-emerald-400/10 px-2.5 py-0.5 text-emerald-200">
                                        {{ way }}
                                    </Badge>
                                </div>

                                <p v-if="variant.description"
                                    class="mt-2 line-clamp-2 text-sm leading-6 text-foreground">
                                    {{ variant.description }}
                                </p>

                                <div v-if="expandedKey === fashion.wiki_key" class="mt-3 border-t border-white/8 pt-3">
                                    <p class="text-xs font-medium text-foreground">部件清单</p>
                                    <div class="mt-2 grid gap-1.5">
                                        <div v-for="piece in variant.pieces" :key="piece.id"
                                            class="flex items-center justify-between gap-2 rounded-[10px] border border-white/8 bg-white/4 px-2.5 py-1.5">
                                            <span class="truncate text-xs text-foreground">{{ piece.name }}</span>
                                            <Badge variant="outline"
                                                class="shrink-0 rounded-[10px] border-border bg-card px-2 py-0.5 text-[10px] text-foreground">
                                                {{ piece.slot }}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </CardContent>
                </Card>
            </div>
        </div>

        <div v-if="filteredFashions.length > 0 && pageCount > 1"
            class="flex flex-col gap-3 rounded-[10px] border border-border bg-card px-4 py-4 md:flex-row md:items-center md:justify-between">
            <p class="text-sm text-foreground">
                当前第 {{ currentPage }} / {{ pageCount }} 页，显示 {{ currentRangeStart }}-{{ currentRangeEnd }}
                / {{ filteredFashions.length }} 套结果。
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
