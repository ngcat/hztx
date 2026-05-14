const SimulatorPopover = {
    props: {
        show: Boolean,
        type: String, // 'hero', 'item', 'lieutenant', 'partial'
        slot: Object,
        modelValue: String,
        results: Array,
        sortStats: {
            type: Array,
            default: () => []
        },
        triggerSelector: String, 
        selectedEquip: Object,
        calculateTotalStats: Function, 
        heroState: Object
    },
    emits: ['update:modelValue', 'select', 'blur'],
    
    setup(props, { emit }) {
        const { computed, ref, watch, onMounted, onUnmounted, nextTick } = Vue;

        const popoverView = ref('items'); 
        const pendingItem = ref(null);
        const popoverStyle = ref({ display: 'none' }); 
        const isUpwards = ref(false);

        const updatePosition = () => {
            if (!props.show || !props.triggerSelector) {
                popoverStyle.value = { display: 'none' };
                return;
            }
            
            const el = document.querySelector(props.triggerSelector);
            if (!el) return;

            const rect = el.getBoundingClientRect();
            const screenHeight = window.innerHeight;
            const screenWidth = window.innerWidth;
            const popoverWidth = 280;
            
            const spaceAbove = rect.top;
            const spaceBelow = screenHeight - rect.bottom;
            
            const isMainHero = props.triggerSelector.includes('current-hero-display');
            isUpwards.value = !isMainHero && (spaceAbove > spaceBelow && spaceAbove > 300);

            let finalLeft = rect.left + rect.width / 2;
            let finalTop = isUpwards.value ? rect.top : rect.bottom;

            const halfWidth = popoverWidth / 2;
            if (finalLeft - halfWidth < 10) finalLeft = halfWidth + 10;
            if (finalLeft + halfWidth > screenWidth - 10) finalLeft = screenWidth - halfWidth - 10;

            const availableSpace = isUpwards.value ? (rect.top - 20) : (screenHeight - rect.bottom - 20);
            const maxH = Math.min(500, Math.max(100, availableSpace));

            let transform = 'translateX(-50%)';
            if (isUpwards.value) transform += ' translateY(-100%)';

            popoverStyle.value = {
                position: 'fixed',
                left: `${finalLeft}px`,
                top: `${finalTop + (isUpwards.value ? -5 : 5)}px`,
                transform: transform,
                zIndex: 10000,
                width: `${popoverWidth}px`,
                maxHeight: `${maxH}px`,
                minHeight: `${Math.min(200, maxH)}px`,
                display: 'flex',
                flexDirection: isUpwards.value ? 'column-reverse' : 'column'
            };
        };

        watch(() => props.show, (newVal) => {
            if (newVal) {
                popoverView.value = 'items';
                pendingItem.value = null;
                nextTick(updatePosition);
                setTimeout(updatePosition, 50); 
            } else {
                popoverStyle.value = { display: 'none' };
            }
        }, { immediate: true });

        onMounted(() => { window.addEventListener('resize', updatePosition); });
        onUnmounted(() => { window.removeEventListener('resize', updatePosition); });

        const handleSelect = (item, effectIdx = -1) => {
            if (props.type === 'hero' || props.type === 'lieutenant') {
                emit('select', item);
                return;
            }
            const slotId = props.slot?.id;
            if (slotId && slotId.endsWith('_p')) {
                if (effectIdx !== -1) {
                    emit('select', { item, effectIdx });
                    return;
                }
                // 使用父組件預算好的最佳詞條索引
                if (props.sortStats.length > 0 && typeof item._bestEffectIdx === 'number') {
                    emit('select', { item, effectIdx: item._bestEffectIdx });
                } else {
                    pendingItem.value = item;
                    popoverView.value = 'effects';
                }
            } else {
                emit('select', item);
            }
        };

        const toggleSortStat = (stat) => {
            const current = [...props.sortStats];
            const idx = current.indexOf(stat);
            if (idx === -1) current.push(stat);
            else current.splice(idx, 1);
            props.sortStats.length = 0;
            current.forEach(s => props.sortStats.push(s));
        };

        const searchQuery = computed({
            get: () => props.modelValue,
            set: (val) => emit('update:modelValue', val)
        });

        const processedResults = computed(() => {
            // 直接使用父組件處理好的結果
            return props.results || [];
        });

        return {
            searchQuery,
            handleSelect,
            toggleSortStat,
            processedResults,
            popoverView,
            pendingItem,
            popoverStyle,
            isUpwards,
            backToItems() {
                popoverView.value = 'items';
                pendingItem.value = null;
            }
        };
    },

    template: `
        <teleport to="body">
            <div v-if="show" :class="['slot-search-popover', type + '-popover', { 'upwards': isUpwards }]" :style="popoverStyle">
            
            <div class="popover-sort-options" v-if="type !== 'hero'">
                <div class="sort-label-main">依屬性排序</div>
                <div class="sort-checkboxes">
                    <label v-for="s in ['武力', '智力', '魅力', '統御']" :key="s">
                        <input type="checkbox" :checked="sortStats.includes(s)" @change="toggleSortStat(s)"> {{ s }}
                    </label>
                </div>
            </div>

            <input type="text" v-model="searchQuery" 
                   :placeholder="type === 'hero' ? '搜尋主將...' : (type === 'lieutenant' ? '搜尋副將...' : '搜尋裝備...')" 
                   autofocus @blur="$emit('blur')">

            <div class="popover-content-container">
                <template v-if="type === 'hero' || type === 'lieutenant'">
                    <div class="hero-results-list">
                        <div v-for="h in processedResults" :key="h.name" class="hero-result-item" @mousedown="handleSelect(h.name)">
                            <span class="hero-result-name">{{ h.name }}</span>
                            <span class="hero-result-tags">({{ h.category }})</span>
                            <div v-if="sortStats.length > 0" :class="['sort-bonus', { 'sort-negative': h._sortBonus < 0, 'sort-zero': h._sortBonus === 0 }]">
                                {{ h._sortBonus > 0 ? '+' : '' }}{{ h._sortBonus }}
                            </div>
                        </div>
                    </div>
                </template>

                <template v-else>
                    <div class="popover-viewport" v-if="type === 'partial'">
                        <div class="popover-track" :class="{ 'slide-effects': popoverView === 'effects' }">
                            <div class="popover-layer items-layer">
                                <div class="search-results-list">
                                    <div v-for="item in processedResults" :key="item.name" class="search-result-item" @mousedown="handleSelect(item)">
                                        <img :src="'img/' + item.image" alt="" @error="$event.target.src = 'img/unknown.png'">
                                        <div class="result-info">
                                            <div class="result-name">{{ item.name }}</div>
                                            <div v-if="sortStats.length > 0" :class="['sort-bonus', { 'sort-negative': item._sortBonus < 0, 'sort-zero': item._sortBonus === 0 }]">
                                                {{ item._sortBonus > 0 ? '+' : '' }}{{ item._sortBonus }}
                                            </div>
                                        </div>
                                    </div>
                                    <div v-if="processedResults.length === 0" class="no-results">無相符結果</div>
                                </div>
                            </div>
                            <div class="popover-layer effects-layer" v-if="pendingItem">
                                <div class="popover-layer-header">
                                    <button class="popover-back-btn" @click="backToItems"><i class="fas fa-chevron-left"></i></button>
                                    <span class="pending-item-name">{{ pendingItem.name }}</span>
                                </div>
                                <div class="popover-effects-list">
                                    <div v-for="(eff, idx) in pendingItem.effects" 
                                         :key="idx" 
                                         class="popover-effect-item"
                                         @click="handleSelect(pendingItem, idx)">
                                        <span class="eff-idx">{{ idx + 1 }}</span>
                                        <span class="eff-text">{{ eff }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="search-results-list" v-else>
                        <div v-for="item in processedResults" :key="item.name" class="search-result-item" @mousedown="handleSelect(item)">
                            <img v-if="slot?.id !== 'god'" :src="'img/' + item.image" alt="" @error="$event.target.src = 'img/unknown.png'">
                            <div class="result-info">
                                <div class="result-name">{{ item.name }}</div>
                                <div v-if="slot?.id === 'god'" style="font-size: 0.7rem; opacity: 0.5; margin-left: auto;">{{ item.category }}</div>
                                <div v-if="sortStats.length > 0" :class="['sort-bonus', { 'sort-negative': item._sortBonus < 0, 'sort-zero': item._sortBonus === 0 }]">
                                    {{ item._sortBonus > 0 ? '+' : '' }}{{ item._sortBonus }}
                                </div>
                            </div>
                        </div>
                        <div v-if="processedResults.length === 0" class="no-results">無相符結果</div>
                    </div>
                </template>
            </div>
        </div>
    </teleport>
    `
};
