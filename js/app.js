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

        // --- 路由功能 (動態參數化) ---
        const handleRouting = () => {
            const urlParams = new URLSearchParams(window.location.search);
            const hash = window.location.hash.slice(1);
            
            // 1. 自動轉換舊的 Hash 路由到 GET 參數
            if (hash) {
                const targetPage = hash.split('?')[0];
                const newParams = new URLSearchParams(window.location.search);
                newParams.set('page', targetPage);
                window.history.replaceState(null, '', `${window.location.pathname}?${newParams.toString()}`);
                window.location.hash = '';
                return handleRouting(); // 重新跑一次解析
            }

            // 2. 優先尋找「分類即 Key」的參數 (例如 ?hero=XXX, ?sim=XXX)
            let detectedPage = null;
            let detectedQuery = null;

            // 檢查是否有 ?sim= 參數
            if (urlParams.has('sim')) {
                detectedPage = 'sim';
                detectedQuery = urlParams.get('sim');
            } else {
                // 檢查是否有其他分類參數 (hero, weapon, horse 等)
                for (const cat of categories.value) {
                    if (urlParams.has(cat.id)) {
                        detectedPage = cat.id;
                        detectedQuery = urlParams.get(cat.id);
                        break;
                    }
                }
            }

            // 3. 回退到顯性 ?page= 參數
            const pageParam = detectedPage || urlParams.get('page');
            const hasConfig = urlParams.has('c');
            
            if (pageParam === 'sim' || (!pageParam && hasConfig)) {
                currentCategory.value = 'sim';
                // 網址標準化 (可選，如果你想保持網址列整齊)
            } else if (pageParam === 'disclaimer') {
                currentCategory.value = 'disclaimer';
            } else if (pageParam === 'equip' || !pageParam) {
                currentCategory.value = 'equip';
            } else {
                const validCategory = categories.value.find(c => c.id === pageParam);
                if (validCategory) {
                    currentCategory.value = pageParam;
                } else {
                    currentCategory.value = 'equip'; 
                }
            }
        };

        const selectCategory = (pageId) => {
            const url = new URL(window.location.origin + window.location.pathname);
            // 切換時使用簡潔的 ?pageID 格式
            url.searchParams.set(pageId, '');
            window.history.pushState(null, '', url.toString());
            currentCategory.value = pageId;

            if (window.innerWidth <= 768) {
                isSidebarOpen.value = false;
            }
        };

        const resetToHome = () => {
            const url = new URL(window.location.origin + window.location.pathname);
            window.history.pushState(null, '', url.toString());
            currentCategory.value = 'equip';

            if (window.innerWidth <= 768) {
                isSidebarOpen.value = false;
            }
        };



        onMounted(() => {
            fetchData().then(() => {
                handleRouting();
            });
            // 監聽前進/後退按鈕
            window.addEventListener('popstate', handleRouting);
        });


        return {
            loading, initError, currentCategory,
            isSidebarOpen, categories, allItems,
            selectCategory, resetToHome
        };
    }
}).mount('#app');
