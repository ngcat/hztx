const { createApp, ref, computed, onMounted, watch } = Vue;

createApp({
    components: {
        'equipment-list': EquipmentListComponent
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

        // --- 導覽功能 ---
        const selectCategory = (catId) => {
            currentCategory.value = catId;
            if (window.innerWidth <= 768) {
                isSidebarOpen.value = false;
            }
        };

        const resetToHome = () => {
            currentCategory.value = 'equip';
            if (window.innerWidth <= 768) {
                isSidebarOpen.value = false;
            }
        };

        onMounted(fetchData);

        return {
            loading, initError, currentCategory,
            isSidebarOpen, categories, allItems,
            selectCategory, resetToHome
        };
    }
}).mount('#app');
