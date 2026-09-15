<script setup lang="ts">
import type {
    IMerchantHistoryPayload,
    IMerchantItem,
    IMerchantPayload,
} from "@/lib/interface";
import {
    Clock,
    Cloud,
    History,
    Package,
    RefreshCw,
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

const lastSyncText = computed(() => {
    const generatedAt = payload.value?.generated_at;

    if (!generatedAt) {
        return "";
    }

    // generated_at 形如 "2026-09-14 17:27:17"（北京时间），只展示到分钟即可。
    return generatedAt.slice(0, 16);
});

const activeRoundIndex = computed(() => {
    return selectedRoundIndex.value ?? currentRound.value?.index ?? rounds.value[0]?.index ?? null;
});

// 默认视图：开市时是当前轮次，未开市时是第一轮。
// 只有用户手动切到了「非默认」轮次，才需要显示返回按钮，
// 否则选中当前轮次后按钮仍然挂着，点它也不会有任何变化。
const defaultRoundIndex = computed(() => {
    return currentRound.value?.index ?? rounds.value[0]?.index ?? null;
});

const showBackToCurrent = computed(() => {
    return (
        selectedRoundIndex.value !== null &&
        selectedRoundIndex.value !== defaultRoundIndex.value
    );
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

// 站点可能部署在纯静态服务器（nginx 等）上，那里没有进程会去抓源站，
// 数据只会停在构建那一刻。仓库侧的 GitHub Actions 会定时把新数据提交上去，
// 因此页面在本地数据过期时直接读仓库原始文件兜底（该域带 CORS 头，可跨域直取）。
const REMOTE_DATA_BASE =
    "https://raw.githubusercontent.com/AutumnNazi/Roco-World/main/public/data";

const syncRunning = ref(false);
const syncMessage = ref("");
const usingRemoteData = ref(false);

async function fetchMerchantFrom(url: string) {
    const response = await fetch(`${url}?t=${Date.now()}`, {
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as IMerchantPayload;
}

function applyMerchantPayload(next: IMerchantPayload, fromRemote: boolean) {
    payload.value = next;
    rounds.value = next?.rounds ?? [];
    usingRemoteData.value = fromRemote;
    nowSec.value = Math.floor(Date.now() / 1000);
}

// 比较两份数据谁更新：先看数据日期，再看生成时间。
function isNewerPayload(
    next: IMerchantPayload | null,
    current: IMerchantPayload | null,
) {
    if (!next?.date) {
        return false;
    }

    if (!current?.date) {
        return true;
    }

    if (next.date !== current.date) {
        return next.date > current.date;
    }

    return (next.generated_at ?? "") > (current.generated_at ?? "");
}

async function triggerManualSync() {
    if (syncRunning.value) {
        return;
    }

    syncRunning.value = true;
    syncMessage.value = "正在从云端拉取…";

    try {
        const remote = await fetchMerchantFrom(`${REMOTE_DATA_BASE}/merchant.json`);

        if (isNewerPayload(remote, payload.value)) {
            applyMerchantPayload(remote, true);
            syncMessage.value = `已更新到 ${remote.date}`;
        } else {
            syncMessage.value = "已是最新数据";
        }
    } catch {
        syncMessage.value = "云端拉取失败，请稍后重试";
    } finally {
        syncRunning.value = false;
        window.setTimeout(() => {
            syncMessage.value = "";
        }, 5000);
    }
}

// 本地部署由 scripts/serve-local.mjs 定时写盘，开着的页面需要自己把新数据取回来，
// 否则要手动刷新才能看到新一轮商品。
const REFRESH_INTERVAL_MS = 60_000;
let refreshTimer: number | undefined;

async function refreshMerchantSilently(force = false) {
    const local = await fetchMerchantFrom("/data/merchant.json").catch(
        () => null,
    );

    if (local && isNewerPayload(local, payload.value)) {
        applyMerchantPayload(local, false);
    } else if (force && local && !payload.value) {
        applyMerchantPayload(local, false);
    }

    // 本地那份没跟上（纯静态托管时它永远停在构建时刻）就用云端的。
    if (!shouldTryRemote()) {
        return;
    }

    const remote = await fetchMerchantFrom(
        `${REMOTE_DATA_BASE}/merchant.json`,
    ).catch(() => null);

    if (remote && isNewerPayload(remote, payload.value)) {
        applyMerchantPayload(remote, true);
    }
}

// 只在本地数据不是「今天」时才走云端，避免每分钟都打 GitHub。
function shouldTryRemote() {
    const today = beijingDateString();
    return payload.value?.date !== today;
}

function beijingDateString() {
    const beijingNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return beijingNow.toISOString().slice(0, 10);
}

function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
        void refreshMerchantSilently();
    }
}

// 历史归档（public/data/merchant-history.json）：每轮商品首次出现或变化时记录，
// 默认折叠、展开时才拉取，避免给首屏添负担。
const historyPayload = ref<IMerchantHistoryPayload | null>(null);
const historyExpanded = ref(false);
const historyLoading = ref(false);

async function toggleHistory() {
    historyExpanded.value = !historyExpanded.value;

    if (!historyExpanded.value) {
        return;
    }

    historyLoading.value = true;
    try {
        const response = await fetch(
            `/data/merchant-history.json?t=${Date.now()}`,
            { cache: "no-store" },
        );

        if (response.ok) {
            historyPayload.value =
                (await response.json()) as IMerchantHistoryPayload;
        }
    } catch {
        // 没有历史文件时保持空态。
    } finally {
        historyLoading.value = false;
    }
}

const historyDays = computed(() => {
    const days = historyPayload.value?.days ?? {};

    return Object.values(days)
        .sort((left, right) => right.date.localeCompare(left.date))
        .map((day) => ({
            date: day.date,
            rounds: Object.values(day.rounds).sort(
                (left, right) => left.index - right.index,
            ),
        }));
});

async function loadMerchant() {
    isLoading.value = true;
    errorMessage.value = "";

    // 必须禁用缓存：静态服务器常给 JSON 带上强缓存/启发式缓存，
    // 首屏会读到旧快照（表现为「刷新后又没有本轮数据」）。
    let local: IMerchantPayload | null = null;

    try {
        local = await fetchMerchantFrom("/data/merchant.json");
        applyMerchantPayload(local, false);
    } catch {
        local = null;
    }

    // 纯静态托管时本地文件停在构建那一刻，用仓库里的最新数据兜底。
    try {
        const remote = await fetchMerchantFrom(
            `${REMOTE_DATA_BASE}/merchant.json`,
        );

        if (isNewerPayload(remote, local)) {
            applyMerchantPayload(remote, true);
        }
    } catch {
        // 云端不可达时保留本地数据。
    }

    if (!payload.value) {
        errorMessage.value = "远行商人数据加载失败，请稍后重试。";
        rounds.value = [];
    }

    isLoading.value = false;
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
    refreshTimer = window.setInterval(() => {
        void refreshMerchantSilently();
    }, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
});

onBeforeUnmount(() => {
    if (clockTimer !== undefined) {
        window.clearInterval(clockTimer);
    }

    if (refreshTimer !== undefined) {
        window.clearInterval(refreshTimer);
    }

    document.removeEventListener("visibilitychange", handleVisibilityChange);
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

                    <div class="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
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

                <div class="flex flex-wrap items-center gap-3">
                    <Badge variant="outline"
                        class="rounded-[10px] border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-200">
                        <Timer class="mr-1.5 h-4 w-4" />
                        {{ countdownText }}
                    </Badge>
                    <Badge v-if="lastSyncText" variant="outline"
                        class="rounded-[10px] border-border bg-white/5 px-3 py-1.5 text-sm text-foreground">
                        <Clock class="mr-1.5 h-4 w-4" />
                        最后同步 {{ lastSyncText }}
                    </Badge>
                    <Button variant="outline" :disabled="syncRunning"
                        class="h-9 rounded-[10px] border-border bg-white/5 text-sm text-foreground hover:bg-accent"
                        @click="triggerManualSync">
                        <RefreshCw class="mr-1.5 h-3.5 w-3.5" :class="syncRunning ? 'animate-spin' : ''" />
                        {{ syncRunning ? "拉取中…" : "立即同步" }}
                    </Button>
                    <Badge v-if="usingRemoteData" variant="outline"
                        class="rounded-[10px] border-sky-400/20 bg-sky-400/10 px-3 py-1.5 text-sm text-sky-200">
                        <Cloud class="mr-1.5 h-4 w-4" />
                        云端数据
                    </Badge>
                    <span v-if="syncMessage" class="text-xs text-foreground">{{ syncMessage }}</span>
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

                    <Button v-if="showBackToCurrent" variant="outline"
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

        <Card class="border-border bg-card py-0 shadow-md">
            <CardHeader class="gap-2 px-4 py-4">
                <div class="flex items-center justify-between gap-3">
                    <CardTitle class="flex items-center gap-2 text-lg tracking-tight text-foreground">
                        <History class="h-4 w-4 text-foreground" />
                        历史记录
                    </CardTitle>
                    <Button variant="outline"
                        class="rounded-[10px] border-border bg-white/5 text-foreground hover:bg-accent"
                        @click="toggleHistory">
                        {{ historyExpanded ? "收起" : "展开" }}
                    </Button>
                </div>
                <p class="text-xs leading-5 text-foreground">
                    每轮商品首次出现或变化时自动归档，不会被次日快照覆盖。
                </p>
            </CardHeader>
            <CardContent v-if="historyExpanded" class="space-y-3 px-4 pb-5">
                <Separator class="bg-white/10" />
                <p v-if="historyLoading" class="text-sm text-foreground">加载中…</p>
                <p v-else-if="historyDays.length === 0" class="text-sm text-foreground">
                    暂无历史记录（需要先运行一次数据同步）。
                </p>
                <div v-else class="space-y-3">
                    <div v-for="day in historyDays" :key="day.date"
                        class="rounded-[10px] border border-border bg-muted px-3 py-2.5">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-semibold text-foreground">{{ day.date }}</span>
                            <Badge v-if="day.date === payload?.date" variant="outline"
                                class="rounded-[10px] border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-200">
                                今天
                            </Badge>
                            <span class="text-xs text-foreground">{{ day.rounds.length }} 轮有货</span>
                        </div>
                        <div v-for="round in day.rounds" :key="`${day.date}-${round.index}`" class="mt-2">
                            <p class="text-xs text-foreground">
                                第 {{ round.index }} 轮 {{ round.start_time.slice(11, 16) }}-{{ round.end_time.slice(11, 16) }}
                            </p>
                            <div class="mt-1 flex flex-wrap gap-1.5">
                                <Badge v-for="item in round.items" :key="`${day.date}-${round.index}-${item.name}`"
                                    variant="outline"
                                    :title="item.price !== null ? `价格 ${item.price}${item.limit !== null ? ` · 限购 ${item.limit}` : ''}` : undefined"
                                    class="rounded-[10px] border-border bg-white/5 px-2 py-0.5 text-xs text-foreground">
                                    {{ item.name }}
                                    <span v-if="item.price !== null" class="ml-1 text-[10px] text-foreground/70">
                                        {{ item.price }}
                                    </span>
                                </Badge>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    </section>
</template>

<style scoped></style>
