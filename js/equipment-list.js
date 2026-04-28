const EquipmentListComponent = {
    props: ['allItems', 'category'],
    template: `
        <div class="equipment-list-container">
            <div class="controls">
                <div class="search-box">
                    <input type="text" v-model="searchQuery" placeholder="搜尋武將、裝備或道具名稱...">
                    <div class="select-row">
                        <select class="merge-select category-select" v-model="tagFilter">
                            <option value="ALL">類別</option>
                            <option v-for="t in uniqueTags" :key="t" :value="t">{{ t }}</option>
                        </select>
                        <select class="merge-select" v-model="mergeFilter">
                            <option value="ALL">開放時機</option>
                            <option :value="0">開服</option>
                            <option v-for="n in 8" :key="n" :value="n">{{ n }}合</option>
                        </select>
                        <select class="merge-select" v-model="sourceFilter">
                            <option value="ALL">取得來源</option>
                            <option v-for="src in uniqueSources" :key="src" :value="src">{{ src }}</option>
                        </select>
                        <select class="merge-select" v-model="setFilter">
                            <option value="ALL">完整套裝</option>
                            <option v-for="s in uniqueSets" :key="s" :value="s">{{ s }}</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="gallery">
                <div v-for="(item, index) in filteredItems" :key="item.name + '-' + index" class="card" @click="selectedItem = item">
                    <div :class="['tag', 'tag-' + getCardTag(item)]">{{ getCardTag(item) }}</div>
                    <div class="release-tag" v-if="item.release !== undefined">{{ formatRelease(item.release) }}</div>
                    <div class="source-tag" v-if="item.source">{{ item.source }}</div>
                    <img :src="item.image ? 'img/' + item.image : 'img/unknown.png'" :alt="item.name" loading="lazy"
                        :class="{'hero-img': item.group === 'hero'}">
                    <div class="card-info">
                        <div class="card-name">{{ item.name }}</div>
                        <div class="card-attr" v-if="item.attr && typeof item.attr === 'string'">{{ item.attr }}</div>
                        <div class="card-tags">
                            <span v-for="c in (item.category ? item.category.split(' ') : [])" :key="c" class="mini-tag">{{ c }}</span>
                            <span v-for="s in (item.sets ? item.sets.split(' ') : [])" :key="s" class="mini-tag">{{ s }}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Detail Modal -->
            <teleport to="body">
                <div v-if="selectedItem" class="modal-overlay" @click.self="selectedItem = null">
                    <div class="modal-content" :class="{ 'hero-modal': selectedItem.talentName, 'activity-modal': selectedItem.group === 'act' }">
                        <div class="close-btn" @click="selectedItem = null">✕</div>

                        <!-- Activity Detail Panel -->
                        <template v-if="selectedItem.group === 'act'">
                            <div class="activity-detail-panel">
                                <div class="activity-header">
                                    <div class="modal-title">{{ selectedItem.name }}</div>
                                    <div class="card-tags" style="justify-content: center; margin-bottom: 8px;">
                                        <span v-for="tag in selectedItem.category" :key="tag" class="mini-tag" style="padding: 4px 12px; font-size: 0.9rem;">{{ tag }}</span>
                                    </div>
                                    <div class="equip-release" v-if="selectedItem.release !== undefined" style="text-align: center; margin-bottom: 5px; opacity: 0.8;">開放時機: {{ formatRelease(selectedItem.release) }}</div>
                                    <div class="equip-source" v-if="selectedItem.source" style="text-align: center; margin-bottom: 15px; color: var(--accent-gold); font-size: 0.9rem;">取得來源: {{ selectedItem.source }}</div>
                                </div>

                                <div v-if="selectedItem.table" class="activity-table-container">
                                    <div class="activity-table-title" v-if="selectedItem.table.title">{{ selectedItem.table.title }}</div>
                                    <table class="complex-table">
                                        <thead>
                                            <tr>
                                                <th v-for="col in selectedItem.table.columns" :key="col">{{ col }}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr v-for="(row, ridx) in activityTable" :key="ridx">
                                                <template v-for="(cell, cidx) in row" :key="cidx">
                                                    <td v-if="cell.show" 
                                                        :rowspan="cell.rowspan" 
                                                        :data-label="selectedItem.table.columns[cidx]">
                                                        {{ cell.value }}
                                                    </td>
                                                </template>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                
                                <div v-if="selectedItem.info" class="activity-info-box">
                                    {{ selectedItem.info }}
                                </div>
                            </div>
                        </template>
                        <template v-else>
                            <div class="modal-details equip-panel">
                                <div class="equip-header">
                                    <img :src="selectedItem.image ? 'img/' + selectedItem.image : 'img/unknown.png'" alt="Preview" class="equip-img" @error="$event.target.src = 'img/unknown.png'">
                                    <div class="equip-info-top">
                                        <div class="equip-title-row">
                                            <div class="modal-title">{{ selectedItem.name }}</div>
                                            <div class="card-tags" style="margin-top: 0; flex-wrap: wrap;">
                                                <span v-for="c in (selectedItem.category ? selectedItem.category.split(' ') : [])" :key="c" class="mini-tag"
                                                    style="font-size: 0.8rem; padding: 2px 8px;">{{ c }}</span>
                                                <span v-for="s in (selectedItem.sets ? selectedItem.sets.split(' ') : [])" :key="s" class="mini-tag"
                                                    style="font-size: 0.8rem; padding: 2px 8px;">{{ s }}</span>
                                            </div>
                                        </div>
                                        <div class="modal-attr" v-if="selectedItem.attr">{{ selectedItem.attr }}</div>
                                        <div class="equip-release" v-if="selectedItem.release !== undefined">開放時機: {{ formatRelease(selectedItem.release) }}</div>
                                        <div class="equip-notes" v-if="selectedItem.notes" style="color: #ff6b6b; font-size: 0.85rem; margin-top: 4px;">備註: {{ selectedItem.notes }}</div>
                                        <div class="equip-source" v-if="selectedItem.source">取得來源: {{ selectedItem.source }}</div>
                                    </div>
                                </div>
                                <div v-if="selectedItem.effects && selectedItem.effects.length" class="effects-section">
                                    <ul class="effects-list">
                                        <li v-for="(eff, idx) in selectedItem.effects" :key="idx" class="effect-item">
                                            {{ eff }}
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            </teleport>
        </div>
    `,
    setup(props) {
        const { ref, computed, watch } = Vue;

        // --- 內部狀態 ---
        const searchQuery = ref('');
        const mergeFilter = ref('ALL');
        const sourceFilter = ref('ALL');
        const setFilter = ref('ALL');
        const tagFilter = ref('ALL');
        const selectedItem = ref(null);

        // --- 重置過濾器 ---
        watch(() => props.category, () => {
            searchQuery.value = '';
            tagFilter.value = 'ALL';
            mergeFilter.value = 'ALL';
            sourceFilter.value = 'ALL';
            setFilter.value = 'ALL';
        });

        // --- 工具函數 ---
        const getCardTag = (item) => {
            const cats = item.category ? item.category.split(' ') : [];
            if (cats.includes('良才')) return '良才';
            if (cats.includes('國士')) return '國士';
            if (cats.includes('巾幗')) return '巾幗';
            if (cats.includes('名將')) return '名將';
            if (cats.includes('傳奇')) return '傳奇';
            if (item.group === 'equip') return '裝備';
            return '道具';
        };

        const formatRelease = (val) => {
            if (val === 0 || val === '0') return '開服';
            if (val > 0 && val <= 8) return val + '合';
            return val;
        };

        // --- 過濾邏輯 ---
        const uniqueSources = computed(() => {
            const list = props.allItems.filter(item => item.group === props.category);
            const sources = list.map(item => item.source).filter(Boolean);
            return [...new Set(sources)].sort();
        });

        const uniqueSets = computed(() => {
            const list = props.allItems.filter(item => item.group === props.category);
            const setMap = {};
            list.forEach(item => {
                if (item.sets) {
                    item.sets.split(' ').forEach(s => {
                        const rel = item.release !== undefined ? item.release : 99;
                        if (setMap[s] === undefined || rel < setMap[s]) {
                            setMap[s] = rel;
                        }
                    });
                }
            });
            return Object.keys(setMap).sort((a, b) => {
                if (setMap[a] !== setMap[b]) return setMap[a] - setMap[b];
                return a.localeCompare(b, 'zh-TW');
            });
        });

        const uniqueTags = computed(() => {
            const list = props.allItems.filter(item => item.group === props.category);
            const tagsSet = new Set();
            list.forEach(item => {
                if (item.category) {
                    item.category.split(' ').forEach(c => {
                        const trimmed = c.trim();
                        if (trimmed) tagsSet.add(trimmed);
                    });
                }
            });
            return [...tagsSet].sort((a, b) => a.localeCompare(b, 'zh-TW'));
        });

        const filteredItems = computed(() => {
            let list = props.allItems.filter(item => item.group === props.category);
            if (mergeFilter.value !== 'ALL') {
                list = list.filter(item => item.release === parseInt(mergeFilter.value));
            }
            if (sourceFilter.value !== 'ALL') {
                list = list.filter(item => item.source === sourceFilter.value);
            }
            if (setFilter.value !== 'ALL') {
                list = list.filter(item => item.sets && item.sets.split(' ').includes(setFilter.value));
            }
            if (tagFilter.value !== 'ALL') {
                list = list.filter(item => item.category && item.category.split(' ').some(c => c.trim() === tagFilter.value.trim()));
            }
            if (searchQuery.value.trim()) {
                const keywords = searchQuery.value.toLowerCase().split(/\s+/).filter(Boolean);
                list = list.filter(item => {
                    const haystack = [
                        item.name,
                        item.category,
                        item.sets,
                        item.attr || '',
                        item.notes || '',
                        ...(item.effects || [])
                    ].join(' ').toLowerCase();
                    return keywords.every(kw => haystack.includes(kw));
                });
            }
            return list;
        });

        const activityTable = computed(() => {
            if (!selectedItem.value || !selectedItem.value.table) return [];
            const rows = selectedItem.value.table.rows;
            const result = [];
            for (let ridx = 0; ridx < rows.length; ridx++) {
                const rowData = [];
                for (let cidx = 0; cidx < rows[ridx].length; cidx++) {
                    const value = rows[ridx][cidx];
                    const show = ridx === 0 || rows[ridx][cidx] !== rows[ridx - 1][cidx];
                    let rowspan = 1;
                    if (show) {
                        for (let k = ridx + 1; k < rows.length; k++) {
                            if (rows[k][cidx] === value) rowspan++; else break;
                        }
                    }
                    rowData.push({ value, show, rowspan });
                }
                result.push(rowData);
            }
            return result;
        });

        watch(selectedItem, (newVal) => {
            document.body.classList.toggle('no-scroll', !!newVal);
        });

        return {
            searchQuery, mergeFilter, sourceFilter, setFilter, tagFilter, selectedItem,
            uniqueSources, uniqueSets, uniqueTags, filteredItems, activityTable,
            getCardTag, formatRelease
        };
    }
};
