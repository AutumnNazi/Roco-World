<script setup lang="ts">
import type {
    IOfficialSkillEntry,
    IOfficialSkillsPayload,
    IPetsMove,
} from "@/lib/interface";
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    RotateCcw,
    Search,
    SlidersHorizontal,
    Sparkles,
    Swords,
} from "lucide-vue-next";

const PAGE_SIZE_OPTIONS = [24, 48, 96];

const CATEGORY_OPTIONS = ["物攻", "魔攻", "防御", "状态"];

const route = useRoute();
const router = useRouter();

const skills = ref<IOfficialSkillEntry[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");
const searchQuery = ref("");
const selectedElement = ref("all");
const selectedCategory = ref("all");
const selectedPool = ref("all");
const currentPage = ref(1);
const pageSize = ref(48);
const expandedSkillName = ref<string | null>(null);

let controller: AbortController | null = null;

const elementOptions = computed(() => {
    const elements = new Set<string>();

    for (const skill of skills.value) {
        if (skill.element) {
            elements.add(skill.element);
        }
    }

    return [...elements].sort((a, b) => a.localeCompare(b, "zh-CN"));
});

const poolOptions = computed(() => {
    const pools = new Set<string>();

    for (const skill of skills.value) {
        for (const record of skill.learn_pets) {
            pools.add(record.pool);
        }
    }

    return [...pools].sort((a, b) => a.localeCompare(b, "zh-CN"));
});

const filteredSkills = computed(() => {
    let result = skills.value;
    const query = searchQuery.value.trim().toLowerCase();

    if (query) {
        result = result.filter((skill) => {
            return (
                skill.name.toLowerCase().includes(query) ||
                (skill.effect && skill.effect.toLowerCase().includes(query)) ||
                skill.learn_pets.some((pet) => pet.name.toLowerCase().includes(query))
            );
        });
    }

    if (selectedElement.value !== "all") {
        result = result.filter((skill) => skill.element === selectedElement.value);
    }

    if (selectedCategory.value !== "all") {
        result = result.filter((skill) => skill.category === selectedCategory.value);
    }

    if (selectedPool.value !== "all") {
        result = result.filter((skill) => {
            return skill.learn_pets.some((pet) => pet.pool === selectedPool.value);
        });
    }

    return result;
});

const summaryItems = computed(() => [
    { label: "技能总数", value: skills.value.length },
    { label: "当前筛选", value: filteredSkills.value.length },
    { label: "系别数", value: elementOptions.value.length },
    { label: "血脉技能", value: skills.value.filter((skill) => skill.learn_pets.some((pet) => pet.pool === "血脉")).length },
]);

const pageCount = computed(() => Math.max(1, Math.ceil(filteredSkills.value.length / pageSize.value)));

const paginatedSkills = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value;
    return filteredSkills.value.slice(start, start + pageSize.value);
});

const currentRangeStart = computed(() => {
    if (filteredSkills.value.length === 0) return 0;
    return (currentPage.value - 1) * pageSize.value + 1;
});

const currentRangeEnd = computed(() => {
    return Math.min(currentPage.value * pageSize.value, filteredSkills.value.length);
});

const hasActiveFilters = computed(() => {
    return (
        searchQuery.value.trim() !== "" ||
        selectedElement.value !== "all" ||
        selectedCategory.value !== "all" ||
        selectedPool.value !== "all"
    );
});

const pageItems = computed(() => buildPageItems(currentPage.value, pageCount.value));

const pageSizeModel = computed({
    get: () => String(pageSize.value),
    set: (value: string) => {
        pageSize.value = Number(value);
        currentPage.value = 1;
    },
});

watch([searchQuery, selectedElement, selectedCategory, selectedPool], () => {
    currentPage.value = 1;
});

function toggleExpand(skillName: string) {
    expandedSkillName.value = expandedSkillName.value === skillName ? null : skillName;
}

function navigateToPet(petId: number) {
    const resolved = router.resolve({ path: `/pets/${petId}` });
    window.open(resolved.href, "_blank");
}

function getSkillIconId(skill: IOfficialSkillEntry) {
    return skillIconLookup.value[skill.name] ?? null;
}

const skillIconLookup = ref<Record<string, string>>({});

function groupLearnPetsByPool(skill: IOfficialSkillEntry) {
    const groups = new Map<string, IOfficialSkillEntry["learn_pets"]>();

    for (const record of skill.learn_pets) {
        const bucket = groups.get(record.pool) ?? [];
        bucket.push(record);
        groups.set(record.pool, bucket);
    }

    return [...groups.entries()].sort((left, right) => {
        return left[0].localeCompare(right[0], "zh-CN");
    });
}

function setPage(page: number) {
    currentPage.value = Math.max(1, Math.min(page, pageCount.value));
}

function resetFilters() {
    searchQuery.value = "";
    selectedElement.value = "all";
    selectedCategory.value = "all";
    selectedPool.value = "all";
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

async function loadSkills() {
    controller?.abort();
    controller = new AbortController();
    isLoading.value = true;
    errorMessage.value = "";

    try {
        const [skillsResponse, movesResponse] = await Promise.all([
            fetch("/data/skills-official.json", { signal: controller.signal }),
            fetch("/data/moves.json", { signal: controller.signal }),
        ]);

        if (!skillsResponse.ok) {
            throw new Error(`请求失败: ${skillsResponse.status}`);
        }

        const payload = (await skillsResponse.json()) as IOfficialSkillsPayload;
        skills.value = Object.values(payload?.entries ?? {}).sort(
            (left, right) => left.name.localeCompare(right.name, "zh-CN"),
        );

        if (movesResponse.ok) {
            const moves = (await movesResponse.json()) as IPetsMove[];
            const iconByName: Record<string, string> = {};

            for (const move of moves) {
                const name = move?.localized?.zh?.name;

                if (name && move?.icon_id) {
                    iconByName[name] = move.icon_id;
                }
            }

            skillIconLookup.value = iconByName;
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            return;
        }

        errorMessage.value = "技能数据加载失败，请稍后重试。";
        skills.value = [];
    } finally {
        isLoading.value = false;
    }
}

function applySkillFromRoute() {
    const raw = route.query.keyword;
    const keyword = Array.isArray(raw) ? raw[0] : raw;

    if (typeof keyword === "string" && keyword.trim()) {
        searchQuery.value = keyword.trim();
    }
}

document.title = "技能图鉴 - 洛克王国工具箱";

onMounted(async () => {
    await loadSkills();
    applySkillFromRoute();
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
                        技能图鉴
                    </CardTitle>

                    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <div v-for="item in summaryItems" :key="item.label"
                            class="rounded-[10px] border border-border bg-muted px-4 py-3 shadow-sm">
                            <p class="text-xs tracking-[0.2em] text-foreground uppercase">
                                {{ item.label }}
                            </p>
                            <p class="mt-2 text-2xl font-semibold text-foreground">
                                {{ item.value }}
                            </p>
                        </div>
                    </div>
                </div>
            </CardHeader>

            <CardContent class="space-y-4 px-4 pb-6">
                <Separator class="bg-white/10" />

                <div class="grid gap-3 xl:grid-cols-[2fr_1fr_1fr_1fr]">
                    <div class="relative">
                        <Search
                            class="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground" />
                        <Input v-model="searchQuery" type="search" placeholder="搜索技能名称、效果或学习精灵"
                            class="h-10 rounded-[10px] border-border bg-card pl-11 text-sm text-foreground placeholder:text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20" />
                    </div>

                    <Select v-model="selectedElement">
                        <SelectTrigger
                            class="h-10 w-full rounded-[10px] border-border bg-card text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20">
                            <SelectValue placeholder="全部系别" />
                        </SelectTrigger>
                        <SelectContent class="border-border bg-slate-950/95 text-foreground">
                            <SelectItem value="all">全部系别</SelectItem>
                            <SelectItem v-for="element in elementOptions" :key="element" :value="element">
                                {{ element }}
                            </SelectItem>
                        </SelectContent>
                    </Select>

                    <Select v-model="selectedCategory">
                        <SelectTrigger
                            class="h-10 w-full rounded-[10px] border-border bg-card text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20">
                            <SelectValue placeholder="全部分类" />
                        </SelectTrigger>
                        <SelectContent class="border-border bg-slate-950/95 text-foreground">
                            <SelectItem value="all">全部分类</SelectItem>
                            <SelectItem v-for="category in CATEGORY_OPTIONS" :key="category" :value="category">
                                {{ category }}
                            </SelectItem>
                        </SelectContent>
                    </Select>

                    <Select v-model="selectedPool">
                        <SelectTrigger
                            class="h-10 w-full rounded-[10px] border-border bg-card text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20">
                            <SelectValue placeholder="全部获取池" />
                        </SelectTrigger>
                        <SelectContent class="border-border bg-slate-950/95 text-foreground">
                            <SelectItem value="all">全部获取池</SelectItem>
                            <SelectItem v-for="pool in poolOptions" :key="pool" :value="pool">
                                {{ pool }}学习
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-foreground">
                    <div class="flex flex-wrap items-center gap-2">
                        <Badge variant="outline"
                            class="rounded-[10px] border-border bg-white/5 px-3 py-1 text-foreground">
                            <SlidersHorizontal class="h-3.5 w-3.5 text-foreground" />
                            {{ filteredSkills.length }} 个技能
                        </Badge>
                        <Badge v-if="searchQuery" variant="outline"
                            class="rounded-[10px] border-primary/20 bg-primary/10 px-3 py-1 text-primary">
                            关键词 {{ searchQuery }}
                        </Badge>
                        <Badge v-if="selectedElement !== 'all'" variant="outline"
                            class="rounded-[10px] border-sky-400/20 bg-sky-400/10 px-3 py-1 text-sky-200">
                            {{ selectedElement }}系
                        </Badge>
                        <Badge v-if="selectedCategory !== 'all'" variant="outline"
                            class="rounded-[10px] border-violet-400/20 bg-card hover:bg-accent/10 px-3 py-1 text-violet-200">
                            {{ selectedCategory }}
                        </Badge>
                        <Badge v-if="selectedPool !== 'all'" variant="outline"
                            class="rounded-[10px] border-emerald-400/20 bg-card hover:bg-accent/10 px-3 py-1 text-emerald-200">
                            {{ selectedPool }}学习
                        </Badge>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <Select v-model="pageSizeModel">
                            <SelectTrigger
                                class="h-10 w-34.5 rounded-[10px] border-border bg-card text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20">
                                <SelectValue placeholder="每页显示" />
                            </SelectTrigger>
                            <SelectContent class="border-border bg-slate-950/95 text-foreground">
                                <SelectItem v-for="option in PAGE_SIZE_OPTIONS" :key="option" :value="String(option)">
                                    每页 {{ option }} 条
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

        <div v-if="isLoading" class="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <Skeleton v-for="index in 8" :key="index"
                class="h-40 rounded-[10px] border border-border bg-muted" />
        </div>

        <div v-else-if="errorMessage"
            class="rounded-[10px] border border-destructive/20 bg-destructive/8 px-4 py-10 text-center text-sm text-destructive">
            {{ errorMessage }}
        </div>

        <div v-else-if="filteredSkills.length === 0"
            class="rounded-[10px] border border-dashed border-white/12 bg-card px-4 py-6 text-center text-sm text-foreground">
            当前筛选条件下没有找到对应技能，请尝试放宽关键词或切换筛选项。
        </div>

        <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            <div v-for="skill in paginatedSkills" :key="skill.name" class="group"
                @click="toggleExpand(skill.name)">
                <Card
                    class="h-full cursor-pointer py-0 shadow-md transition duration-300 group-hover:-translate-y-1 group-hover:border-primary/30 group-hover:shadow-xl border-border bg-card"
                    style="content-visibility: auto; contain-intrinsic-size: 200px;">
                    <CardContent class="p-4">
                        <div class="flex gap-3">
                            <SkillIcon :icon-id="getSkillIconId(skill)" :alt="skill.name" size="sm" loading="lazy" />

                            <div class="min-w-0 flex-1">
                                <div class="flex items-start justify-between gap-2">
                                    <h3 class="truncate text-lg font-semibold tracking-tight text-foreground">
                                        {{ skill.name }}
                                    </h3>
                                    <Badge v-if="skill.power" variant="outline"
                                        class="shrink-0 rounded-[10px] border-rose-400/20 bg-rose-400/10 px-2 py-0.5 text-xs text-rose-200">
                                        威力 {{ skill.power }}
                                    </Badge>
                                </div>

                                <div class="mt-1.5 flex flex-wrap gap-1.5">
                                    <Badge v-if="skill.element" variant="outline"
                                        class="rounded-[10px] border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-xs text-sky-200">
                                        {{ skill.element }}
                                    </Badge>
                                    <Badge v-if="skill.category" variant="outline"
                                        class="rounded-[10px] border-border bg-white/5 px-2 py-0.5 text-xs text-foreground">
                                        {{ skill.category }}
                                    </Badge>
                                    <Badge v-if="skill.energy_cost !== null" variant="outline"
                                        class="rounded-[10px] border-violet-400/20 bg-violet-400/10 px-2 py-0.5 text-xs text-violet-200">
                                        能耗 {{ skill.energy_cost }}
                                    </Badge>
                                </div>
                            </div>
                        </div>

                        <p v-if="skill.effect" class="mt-2 line-clamp-2 text-sm leading-6 text-foreground">
                            {{ skill.effect }}
                        </p>

                        <div v-if="expandedSkillName === skill.name" class="mt-3 space-y-2 border-t border-white/8 pt-3"
                            @click.stop>
                            <div v-for="[pool, records] in groupLearnPetsByPool(skill)" :key="pool">
                                <p class="flex items-center gap-1 text-xs font-medium text-foreground">
                                    <Swords v-if="pool === '升级'" class="h-3 w-3" />
                                    <Sparkles v-else class="h-3 w-3" />
                                    {{ pool }}学习（{{ records.length }}）
                                </p>
                                <div class="mt-1 flex flex-wrap gap-1.5">
                                    <button v-for="record in records.slice(0, 24)" :key="`${skill.name}-${record.id}-${record.pool}`"
                                        class="inline-flex items-center gap-1 rounded-[10px] border border-emerald-400/15 bg-card px-2 py-0.5 text-xs text-emerald-200 transition hover:border-emerald-400/30 hover:bg-accent/10"
                                        @click="navigateToPet(record.id)">
                                        {{ record.name }}
                                        <span v-if="record.level" class="text-[10px] text-foreground/70">
                                            Lv.{{ record.level }}
                                        </span>
                                    </button>
                                    <span v-if="records.length > 24" class="px-1 text-[10px] text-foreground/70">
                                        等 {{ records.length }} 只
                                    </span>
                                </div>
                            </div>
                        </div>

                        <p v-else class="mt-2 text-[10px] tracking-wide text-foreground/50 uppercase">
                            {{ skill.learn_pets.length }} 只精灵可学习 · 点击展开
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>

        <div v-if="filteredSkills.length > 0 && pageCount > 1"
            class="flex flex-col gap-3 rounded-[10px] border border-border bg-card px-4 py-4 md:flex-row md:items-center md:justify-between">
            <p class="text-sm text-foreground">
                当前第 {{ currentPage }} / {{ pageCount }} 页，显示 {{ currentRangeStart }}-{{ currentRangeEnd }}
                / {{ filteredSkills.length }} 个技能。
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
