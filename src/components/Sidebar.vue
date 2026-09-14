<script setup lang="ts">
import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
    Table,
    TableProperties,
    Gamepad2,
    HeartPulse,
    Egg,
    Sparkle,
    Menu,
    X,
    LifeBuoy,
    Package,
    ListTodo,
    Store,
    Swords,
} from "lucide-vue-next";
import { cn } from "@/lib/utils";

const route = useRoute();
const isMobileMenuOpen = ref(false);

watch(
    () => route.path,
    () => {
        isMobileMenuOpen.value = false;
    },
);

const navItems = [
    { name: "首页", path: "/", icon: Gamepad2 },
    { name: "图鉴", path: "/encyclopedia", icon: TableProperties },
    { name: "技能图鉴", path: "/skills", icon: Swords },
    { name: "图鉴进度", path: "/handbook-progress", icon: ListTodo },
    { name: "表格", path: "/table", icon: Table },
    { name: "配队", path: "/team", icon: Gamepad2 },
    { name: "配种", path: "/breeding", icon: HeartPulse },
    { name: "孵蛋", path: "/incubate", icon: Egg },
    { name: "星图", path: "/egggroup", icon: Sparkle },
    { name: "属性", path: "/attributes", icon: LifeBuoy },
    { name: "道具", path: "/items", icon: Package },
    { name: "远行商人", path: "/merchant", icon: Store },
];
</script>

<template>
    <!-- Desktop Sidebar -->
    <aside
        class="hidden md:flex w-64 flex-col border-r border-border bg-card bg-card shadow-lg transition-all duration-300"
    >
        <div
            class="flex h-14 items-center justify-start px-6"
            data-tauri-drag-region
        >
            <router-link to="/" class="flex items-center gap-3">
                <div
                    class="flex h-8 w-8 items-center justify-center rounded-[10px] text-primary-foreground shadow-sm"
                >
                    <img src="/favicon.ico" alt="Logo" class="h-8 w-8" />
                </div>
                <span
                    class="font-bold tracking-tight inline-block text-lg text-foreground"
                >
                    洛克王国工具箱
                </span>
            </router-link>
        </div>

        <div class="flex-1 overflow-auto py-4 flex flex-col gap-1 px-3">
            <router-link
                v-for="item in navItems"
                :key="item.path"
                :to="item.path"
                :class="
                    cn(
                        'group flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-colors relative overflow-hidden',
                        route.path === item.path
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )
                "
            >
                <component :is="item.icon" class="h-5 w-5 shrink-0" />
                <span>{{ item.name }}</span>

                <div
                    v-if="route.path === item.path"
                    class="absolute left-0 top-1/2 h-1/2 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                />
            </router-link>
        </div>
    </aside>

    <!-- Mobile Header -->
    <header
        class="md:hidden flex h-14 items-center justify-between border-b border-border bg-background/80 bg-card shadow-lg px-4 shrink-0 z-40 sticky top-0"
    >
        <router-link to="/" class="flex items-center gap-3">
            <img src="/favicon.ico" alt="Logo" class="h-8 w-8" />
            <span class="font-bold text-lg tracking-tight">洛克王国工具箱</span>
        </router-link>
        <button
            @click="isMobileMenuOpen = !isMobileMenuOpen"
            class="p-2 -mr-2 text-foreground flex items-center justify-center"
        >
            <Menu v-if="!isMobileMenuOpen" class="h-6 w-6" />
            <X v-else class="h-6 w-6" />
        </button>
    </header>

    <!-- Mobile Navigation Overlay -->
    <template v-if="isMobileMenuOpen">
        <!-- 点空白处收起，避免只能靠右上角按钮关闭 -->
        <div
            class="md:hidden fixed inset-0 top-14 z-40 bg-black/60 backdrop-blur-sm"
            @click="isMobileMenuOpen = false"
        />
        <div
            class="md:hidden fixed inset-x-0 top-14 bottom-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-background/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] duration-300 animate-in fade-in slide-in-from-top-4"
        >
            <div class="flex-1 flex flex-col gap-2">
                <router-link
                    v-for="item in navItems"
                    :key="item.path"
                    :to="item.path"
                    @click="isMobileMenuOpen = false"
                    :class="
                        cn(
                            'flex items-center gap-3 rounded-[10px] px-4 py-3 text-base font-medium transition-colors active:bg-accent',
                            route.path === item.path
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                        )
                    "
                >
                    <component :is="item.icon" class="h-6 w-6 shrink-0" />
                    <span>{{ item.name }}</span>
                </router-link>
            </div>
        </div>
    </template>
</template>
