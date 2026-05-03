const { createApp, ref, computed, onMounted, watch } = Vue;

// --- 全域工具函數 ---
window.Utils = {
    copyToClipboard(text) {
        return new Promise((resolve, reject) => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(resolve).catch(() => {
                    this.fallbackCopy(text) ? resolve() : reject();
                });
            } else {
                this.fallbackCopy(text) ? resolve() : reject();
            }
        });
    },
    fallbackCopy(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            return successful;
        } catch (err) {
            document.body.removeChild(textArea);
            return false;
        }
    }
};

createApp({
    components: {
        'equipment-list': EquipmentListComponent,
        'simulator-component': SimulatorComponent
    },
    setup() {
        // --- 基礎狀態 ---
        const loading = ref(true);
        const initError = ref(false);
        const currentCategory = ref('equip');
        const isSidebarOpen = ref(window.innerWidth > 768);
        const categories = ref([]);
        const allItems = ref([]);

        // --- 數據讀取 ---
        const fetchData = async () => {
            try {
                const catRes = await fetch('data/categories.json');
                categories.value = await catRes.json();

                const loadTasks = categories.value.map(async (cat) => {
                    try {
                        const res = await fetch(`data/${cat.id}.json`);
                        const data = await res.json();
                        return data.map(val => {
                            if (typeof val === 'string') {
                                return {
                                    name: val.replace(/\.[^/.]+$/, ""),
                                    image: val,
                                    group: cat.id,
                                    attr: '',
                                    category: '',
                                    sets: '',
                                    tags: [],
                                    effects: []
                                };
                            }
                            return { ...val, group: cat.id, effects: val.effects || [] };
                        });
                    } catch (e) {
                        console.warn(`Could not load data for category: ${cat.id}`);
                        return [];
                    }
                });

                const results = await Promise.all(loadTasks);
                allItems.value = results.flat();
                loading.value = false;
            } catch (err) {
                console.error(err);
                initError.value = true;
                loading.value = false;
            }
        };

        // --- 路由功能 ---
        const handleRouting = () => {
            const hash = window.location.hash.slice(1).split('?')[0];
            const hasConfig = window.location.search.includes('c=') || window.location.hash.includes('c=');
            
            // 優先級：明確的 Hash > 分享參數
            if (hash.startsWith('sim')) {
                currentCategory.value = 'sim';
            } else if (hash === 'disclaimer') {
                currentCategory.value = 'disclaimer';
            } else if (hash === 'equip') {
                currentCategory.value = 'equip';
            } else if (!hash && hasConfig) {
                // 只有在首頁且帶有配置時，才強制進入模擬器
                currentCategory.value = 'sim';
            } else {
                // 處理其他數據分類
                const validCategory = categories.value.find(c => c.id === hash);
                if (validCategory) {
                    currentCategory.value = hash;
                } else {
                    currentCategory.value = 'equip'; // 預設回裝備
                }
            }
        };

        const selectCategory = (catId) => {
            window.location.hash = catId;
            if (window.innerWidth <= 768) {
                isSidebarOpen.value = false;
            }
        };

        const resetToHome = () => {
            window.location.hash = 'equip';
            if (window.innerWidth <= 768) {
                isSidebarOpen.value = false;
            }
        };

        onMounted(() => {
            fetchData().then(() => {
                handleRouting();
            });
            window.addEventListener('hashchange', handleRouting);
        });

        return {
            loading, initError, currentCategory,
            isSidebarOpen, categories, allItems,
            selectCategory, resetToHome
        };
    }
}).mount('#app');
