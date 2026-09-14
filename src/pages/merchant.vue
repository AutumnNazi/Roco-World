<script setup lang="ts">
import type { IMerchantItem, IMerchantPayload } from "@/lib/interface";
import {
    Clock,
    Package,
    RotateCcw,
    Sparkles,
    Store,
    Timer,
} from "lucide-vue-next";

const route = useRoute();

const payload = ref<IMerchantPayload | null>(null);
const rounds = ref<IMerchantPayload["rounds"]>([]);
const isLoading = ref(false);
const errorMessage = ref("");
const selectedRoundIndex = ref<number | null>(null);
const failedImages = ref(new Set<string>());
const nowSec = ref(Math.floor(Date.now() / 1000));

let clockTimer: number | undefined;

const dataIsStale = computed(() => {
    if (!payload.value?.date) return false;
    const today = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
    return payload.value.date !== today;
});

// 好游快爆的数据按每日 8/12/16/20 点四轮排期，客户端时钟只用来判断当前轮次。
const currentRound = computed(() => {
    return (
        rounds.value.find(
            (round) => nowSec.value >= round.start_ts && nowSec.value < round.end_ts,
        ) ?? null
    );
});

const upcomingRound = computed(() => {
    return rounds.value.find((round) => round.start_ts > nowSec.value) ?? null;
});

const countdownText = computed(() => {
    if (currentRound.value) {
        return `本轮剩余 ${formatDuration(currentRound.value.end_ts - nowSec.value)}`;
    }

    if (upcomingRound.value) {
        return `距开市 ${formatDuration(upcomingRound.value.start_ts - nowSec.value)}`;
    }

    return "今日已收市";
});

const activeRoundIndex = computed(() => {
    return selectedRoundIndex.value ?? currentRound.value?.index ?? rounds.value[0]?.index ?? null;
});

const activeRound = computed(() => {
    return rounds.value.find((round) => round.index === activeRoundIndex.value) ?? null;
});

const summaryItems = computed(() => [
    { label: "数据日期", value: payload.value?.date ?? "--" },
    { label: "当前轮次", value: currentRound.value ? `第 ${currentRound.value.index} 轮` : "未开市" },
    {
        label: "本轮商品",
        value: currentRound.value ? currentRound.value.items.length : 0,
    },
    {
        label: "全日商品",
        value: new Set(rounds.value.flatMap((round) => round.items.map((item) => item.name))).size,
    },
]);

const emptyRoundHint = computed(() => {
    const round = activeRound.value;

    if (!round) {
        return "该轮次暂无商品数据。";
    }

    if (round.start_ts > nowSec.value) {
        return "本轮尚未开市，商人会在开市时上架商品。";
    }

    return "本轮暂无商品（数据未覆盖或商人本轮无货）。";
});

function formatDuration(totalSeconds: number) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${secs}`;
}

function formatRoundTime(time: string) {
    return time.slice(11, 16);
}

function getImageSrc(item: IMerchantItem) {
    if (!item.image || failedImages.value.has(item.name)) return null;
    return item.image;
}

function onImageError(item: IMerchantItem) {
    failedImages.value.add(item.name);
}

function resetRoundSelection() {
    selectedRoundIndex.value = null;
}

async function loadMerchant() {
    isLoading.value = true;
    errorMessage.value = "";

    try {
        const response = await fetch("/data/merchant.json");

        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }

        payload.value = await response.json();
        rounds.value = payload.value?.rounds ?? [];
    } catch {
        errorMessage.value = "远行商人数据加载失败，请稍后重试。";
        rounds.value = [];
    } finally {
        isLoading.value = false;
    }
}

function applyRoundFromRoute() {
    const raw = route.query.round;
    const round = Number(Array.isArray(raw) ? raw[0] : raw);

    if (Number.isFinite(round) && rounds.value.some((entry) => entry.index === round)) {
        selectedRoundIndex.value = round;
    }
}

document.title = "远行商人 - 洛克王国工具箱";

onMounted(async () => {
    await loadMerchant();
    applyRoundFromRoute();
    clockTimer = window.setInterval(() => {
        nowSec.value = Math.floor(Date.now() / 1000);
    }, 1000);
});

onBeforeUnmount(() => {
    if (clockTimer !== undefined) {
        window.clearInterval(clockTimer);
    }
});
</script>

<template>
    <section class="space-y-3">
        <Card class="overflow-hidden border-border bg-card py-0 shadow-lg">
            <CardHeader class="gap-3 px-4 py-4">
                <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <CardTitle class="text-2xl tracking-tight text-foreground md:text-3xl">
                        远行商人
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

                <div class="flex flex-wrap items-center gap-3">
                    <Badge variant="outline"
                        class="rounded-[10px] border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-200">
                        <Timer class="mr-1.5 h-4 w-4" />
                        {{ countdownText }}
                    </Badge>
                    <Badge v-if="dataIsStale" variant="outline"
                        class="rounded-[10px] border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
                        <Clock class="mr-1.5 h-4 w-4" />
                        数据非今日（{{ payload?.date }}），等待同步更新
                    </Badge>
                    <p v-if="currentRound" class="text-sm text-foreground">
                        商人已开市，每轮 4 小时，当日共 4 轮（8:00 / 12:00 / 16:00 / 20:00 开市）。
                    </p>
                    <p v-else class="text-sm text-foreground">
                        商人 8:00 开市、24:00 收市，每 4 小时轮换一次商品。
                    </p>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                    <Button v-for="round in rounds" :key="round.index"
                        :variant="round.index === activeRoundIndex ? 'default' : 'outline'"
                        class="rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                        :class="round.index === activeRoundIndex ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''"
                        @click="selectedRoundIndex = round.index">
                        第 {{ round.index }} 轮
                        <span class="ml-1 text-xs opacity-80">
                            {{ formatRoundTime(round.start_time) }} - {{ formatRoundTime(round.end_time) }}
                        </span>
                        <Badge v-if="round.index === currentRound?.index" variant="outline"
                            class="ml-1 rounded-[10px] border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0 text-[10px] text-emerald-200">
                            进行中
                        </Badge>
                    </Button>

                    <Button v-if="selectedRoundIndex !== null" variant="outline"
                        class="rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                        @click="resetRoundSelection">
                        <RotateCcw class="h-3.5 w-3.5" />
                        回到当前轮次
                    </Button>
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

        <div v-else-if="!activeRound || activeRound.items.length === 0"
            class="rounded-[10px] border border-dashed border-white/12 bg-card px-4 py-6 text-center text-sm text-foreground">
            {{ emptyRoundHint }}
        </div>

        <template v-else>
            <div class="flex items-center justify-between text-sm text-foreground">
                <p>
                    第 {{ activeRound.index }} 轮（{{ activeRound.start_time }} ~
                    {{ activeRound.end_time }}）共 {{ activeRound.items.length }} 件商品
                </p>
            </div>

            <div class="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                <Card v-for="item in activeRound.items" :key="`${activeRound.index}-${item.name}`"
                    class="border-border bg-card py-0 shadow-md transition duration-300 hover:border-primary/30 hover:shadow-xl"
                    style="content-visibility: auto; contain-intrinsic-size: 160px;">
                    <CardContent class="p-4">
                        <div class="flex gap-3">
                            <div
                                class="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-border bg-slate-900/80 shadow-sm">
                                <img v-if="getImageSrc(item)" :src="getImageSrc(item)!" :alt="item.name"
                                    loading="lazy" decoding="async"
                                    class="h-full w-full object-contain p-1.5"
                                    @error="onImageError(item)" />
                                <span v-else class="text-lg font-bold text-foreground">
                                    {{ item.name.slice(0, 1) }}
                                </span>
                            </div>

                            <div class="min-w-0 flex-1">
                                <div class="flex items-start justify-between gap-2">
                                    <h3 class="truncate text-lg font-semibold tracking-tight text-foreground">
                                        {{ item.name }}
                                    </h3>
                                    <Badge v-if="item.rare" variant="outline"
                                        class="shrink-0 rounded-[10px] border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs font-medium text-amber-200">
                                        <Sparkles class="mr-1 h-3 w-3" />
                                        稀有
                                    </Badge>
                                </div>

                                <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <Badge v-if="item.category" variant="outline"
                                        class="rounded-[10px] border-border bg-white/5 px-2 py-0.5 text-xs text-foreground">
                                        {{ item.category }}
                                    </Badge>
                                    <Badge variant="outline"
                                        class="rounded-[10px] border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-200">
                                        <Store class="mr-1 h-3 w-3" />
                                        {{ item.price !== null ? `价格 ${item.price.toLocaleString("zh-CN")}` : "价格未知" }}
                                    </Badge>
                                    <Badge v-if="item.limit !== null" variant="outline"
                                        class="rounded-[10px] border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-xs text-sky-200">
                                        <Package class="mr-1 h-3 w-3" />
                                        限购 {{ item.limit }}
                                    </Badge>
                                </div>
                            </div>
                        </div>

                        <p v-if="item.description" class="mt-2 line-clamp-2 text-sm leading-6 text-foreground">
                            {{ item.description }}
                        </p>
                    </CardContent>
                </Card>
            </div>
        </template>
    </section>
</template>

<style scoped></style>
