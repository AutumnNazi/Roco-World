<script setup lang="ts"></script>
<template>
    <div
        class="flex app-viewport w-full flex-col md:flex-row overflow-hidden bg-background text-foreground selection:bg-primary/30 font-sans antialiased"
    >
        <Sidebar />
        <main
            class="flex min-w-0 flex-1 flex-col min-h-0 bg-background relative"
        >
            <div
                class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 md:p-10 scroll-smooth"
            >
                <slot />
            </div>
        </main>
    </div>
</template>
<style scoped></style>
