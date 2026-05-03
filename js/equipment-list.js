const EquipmentListComponent = {
    props: ['allItems', 'category'],
    template: `
        <div class="equipment-list-container">
            <div class="controls">
                <div class="search-box">
                    <input type="text" v-model="searchQuery" placeholder="搜尋武將、裝備或道具名稱...">
                    <div class="select-row">
                        <select class="merge-select category-select" v-model="tagFilter">
                            <option value="ALL">稀有度</option>
                            <option v-for="t in uniqueTags" :key="t" :value="t">{{ t }}</option>
                        </select>
                        <select v-if="category === 'hero'" class="merge-select" v-model="typeFilter">
                            <option value="ALL">類型</option>
                            <option value="武將">武將</option>
                            <option value="文官">文官</option>
                            <option value="全才">全才</option>
                        </select>
                        <select v-if="category === 'hero'" class="merge-select" v-model="frontFilter">
                            <option value="ALL">前軍</option>
                            <option value="步兵">步兵</option>
                            <option value="騎兵">騎兵</option>
                        </select>
                        <select v-if="category === 'hero'" class="merge-select" v-model="rearFilter">
                            <option value="ALL">後軍</option>
                            <option value="弓兵">弓兵</option>
                            <option value="方士">方士</option>
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

                        <select v-if="category !== 'hero'" class="merge-select" v-model="setFilter">
                            <option value="ALL">完整套裝</option>
                            <option v-for="s in uniqueSets" :key="s" :value="s">{{ s }}</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="gallery">
                <div v-for="(item, index) in filteredItems" :key="item.name + '-' + index" 
                    :class="['card', { 'hero-card': item.group === 'hero' }]" @click="selectedItem = item">
                    <div :class="['tag', 'tag-' + getCardTag(item)]">{{ getCardTag(item) }}</div>
                    <div class="release-tag" v-if="item.release !== undefined">{{ formatRelease(item.release) }}</div>
                    <div class="source-tag" v-if="item.source && (Array.isArray(item.source) ? item.source.length : item.source)">{{ Array.isArray(item.source) ? item.source.join(' / ') : item.source }}</div>
                    <div class="card-img-container" :class="{'silhouette-bg': item.group === 'hero' && !item.image}">
                        <img :src="item.image ? 'img/' + item.image : (item.group === 'hero' ? 'img/hero709770614.png' : 'img/unknown.png')" 
                            :alt="item.name" loading="lazy"
                            :class="{'hero-img': item.group === 'hero', 'grayscale-img': item.group === 'hero' && !item.image}">
                    </div>
                    <div class="card-info">
                        <div class="card-name">{{ item.name }}</div>
                        <div class="card-attr" v-if="item.attr && typeof item.attr === 'string'">{{ item.attr }}</div>
                        <div class="card-tags">
                            <span v-for="c in (item.category ? item.category.split(' ') : []).filter(tag => {
                                const t = tag.trim();
                                return t !== getCardTag(item) && t !== '前軍' && t !== '後軍' && t !== '全軍';
                            })" :key="c" class="mini-tag">{{ c }}</span>
                            <span v-for="s in (item.sets ? item.sets.split(' ') : [])" :key="s" class="mini-tag">{{ s }}</span>
                            <span v-for="t in (item.tags || [])" :key="t" class="mini-tag upgrade-mini-tag" v-if="t === '可升級'">{{ t }}</span>
                            <span v-for="t in (item.tags || [])" :key="t" class="mini-tag" v-else>{{ t }}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Detail Modal -->
            <teleport to="body">
                <div v-if="selectedItem" class="modal-overlay" @click.self="selectedItem = null">
                    <div class="modal-content" :class="{ 'hero-modal': selectedItem.group === 'hero' || selectedItem.talentName, 'activity-modal': selectedItem.group === 'act' }">
                        <template v-if="selectedItem.group === 'act'">
                            <div class="activity-detail-panel">
                                <button class="modal-close-btn" @click="selectedItem = null">×</button>
                                <button class="modal-share-btn" @click="shareItem(selectedItem)" title="分享此項目"><i class="fas fa-share-alt"></i></button>
                                <div class="activity-header">
                                    <div class="modal-title">{{ selectedItem.name }}</div>
                                    <div class="card-tags" style="justify-content: center; margin-bottom: 8px;">
                                        <span v-for="tag in selectedItem.category" :key="tag" class="mini-tag" style="padding: 4px 12px; font-size: 0.9rem;">{{ tag }}</span>
                                    </div>
                                    <div class="equip-release" v-if="selectedItem.release !== undefined" style="text-align: center; margin-bottom: 5px; opacity: 0.8;">開放時機: {{ formatRelease(selectedItem.release) }}</div>
                                    <div class="equip-source" v-if="selectedItem.source" style="text-align: center; margin-bottom: 15px; color: var(--accent-gold); font-size: 0.9rem;">{{ Array.isArray(selectedItem.release) ? '升級方式' : '取得來源' }}: {{ selectedItem.source }}</div>
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

                        <!-- Hero Detail Panel -->
                        <template v-else-if="selectedItem.group === 'hero'">
                            <div v-if="selectedItem" class="hero-detail-panel">
                                <button class="modal-close-btn" @click="selectedItem = null">×</button>
                                <button class="modal-share-btn" @click="shareItem(selectedItem)" title="分享此項目"><i class="fas fa-share-alt"></i></button>
                                <div class="hero-detail-header">
                                    <div class="hero-detail-img-container" :class="{'silhouette-bg': !selectedItem.image}">
                                        <div :class="['tag', 'tag-' + getCardTag(selectedItem)]">{{ getCardTag(selectedItem) }}</div>
                                        <img :src="selectedItem.image ? 'img/' + selectedItem.image : 'img/hero709770614.png'" 
                                            alt="Hero" class="hero-detail-img" :class="{'grayscale-img': !selectedItem.image}">
                                    </div>
                                    <div class="hero-detail-right">
                                        <div class="modal-title">{{ selectedItem.name }}</div>
                                        <div class="card-tags" style="justify-content: flex-start; margin-top: 10px;">
                                            <span v-for="c in (selectedItem.category ? selectedItem.category.split(' ') : []).filter(tag => {
                                                const t = tag.trim();
                                                return t !== getCardTag(selectedItem) && t !== '前軍' && t !== '後軍' && t !== '全軍';
                                            })" :key="c" class="mini-tag">{{ c }}</span>
                                        </div>
                                        <div class="equip-release" style="margin-top: 10px;">開放時機: {{ formatRelease(selectedItem.release) }}</div>
                                        <div class="equip-source" v-if="selectedItem.upgrade" style="margin-top: 5px;">覺醒方式: {{ selectedItem.upgrade }}</div>
                                        <div class="equip-source" v-if="selectedItem.source && selectedItem.source.length" style="margin-top: 5px;">取得來源: {{ Array.isArray(selectedItem.source) ? selectedItem.source.join(' / ') : selectedItem.source }}</div>
                                    </div>
                                </div>

                                <div class="hero-scroll-area">
                                    <div v-if="selectedItem.talents && selectedItem.talents.length" class="hero-section">
                                        <div class="hero-section-title talent-title">天賦【{{ selectedItem.talent_name }}】</div>
                                        <div class="hero-section-text">
                                            <div v-for="(t, idx) in selectedItem.talents" :key="idx" style="margin-bottom: 8px; position: relative; padding-left: 15px;">
                                                <span style="position: absolute; left: 0; color: var(--primary-gold);">◆</span> {{ t }}
                                            </div>
                                        </div>
                                    </div>

                                    <div v-if="selectedItem.legendary_attr" class="hero-section">
                                        <div class="hero-section-title" style="color: #00ffcc !important;">【傳奇屬性】</div>
                                        <div class="hero-section-text" style="color: #00ff00; font-weight: bold; font-size: 0.85rem;">{{ selectedItem.legendary_attr }}</div>
                                    </div>

                                    <div v-if="selectedItem.awakening && selectedItem.awakening.length" class="hero-section">
                                        <div class="hero-section-title reincarnation-title">【覺醒】特殊天賦</div>
                                        <div class="hero-section-text awakening-text">
                                            <div v-for="(a, idx) in selectedItem.awakening" :key="idx" style="margin-bottom: 8px; position: relative; padding-left: 15px;">
                                                <span style="position: absolute; left: 0; color: #ff9f43;">◆</span> {{ a }}
                                            </div>
                                        </div>
                                    </div>

                                    <div v-if="selectedItem.holy_awakening && selectedItem.holy_awakening.length" class="hero-section">
                                        <div class="hero-section-title reincarnation-title">【聖覺醒】特殊天賦</div>
                                        <div class="hero-section-text holy-awakening-text">
                                            <div v-for="(h, idx) in selectedItem.holy_awakening" :key="idx" style="margin-bottom: 8px; position: relative; padding-left: 15px;">
                                                <span style="position: absolute; left: 0; color: #00ffe5;">◆</span> {{ h }}
                                            </div>
                                        </div>
                                    </div>

                                    <div v-if="selectedItem.reincarnation && selectedItem.reincarnation.length" class="hero-section">
                                        <div class="hero-section-title reincarnation-title">【輪回】特殊天賦</div>
                                        <div class="hero-section-text reincarnation-text">
                                            <div v-for="(r, idx) in selectedItem.reincarnation" :key="idx" style="margin-bottom: 8px; position: relative; padding-left: 15px;">
                                                <span style="position: absolute; left: 0; color: #00d1ff;">◆</span> {{ r }}
                                            </div>
                                        </div>
                                    </div>

                                    <div v-if="selectedItem.fates && selectedItem.fates.length" class="hero-section">
                                        <div class="hero-section-title fate-title">宿命</div>
                                        <div class="hero-section-text fate-text">
                                            <div v-for="(f, idx) in selectedItem.fates" :key="idx" style="margin-bottom: 5px;">
                                                {{ f }}
                                            </div>
                                        </div>
                                    </div>

                                    <div v-if="selectedItem.bio" class="hero-section" style="background: rgba(0,0,0,0.2);">
                                        <div class="hero-section-title">傳記</div>
                                        <div class="hero-section-text" style="font-style: italic; opacity: 0.9;">{{ selectedItem.bio }}</div>
                                    </div>
                                </div>
                            </div>
                        </template>

                        <template v-else>
                            <div class="modal-details equip-panel">
                                <button class="modal-close-btn" @click="selectedItem = null">×</button>
                                <button class="modal-share-btn" @click="shareItem(selectedItem)" title="分享此項目"><i class="fas fa-share-alt"></i></button>
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
                                                <span v-for="t in (selectedItem.tags || [])" :key="t" class="mini-tag"
                                                    :class="{'upgrade-mini-tag': t === '可升級'}"
                                                    style="font-size: 0.8rem; padding: 2px 8px;">{{ t }}</span>
                                            </div>
                                        </div>
                                        <div class="modal-attr" v-if="selectedItem.attr">{{ selectedItem.attr }}</div>
                                        <div class="equip-release" v-if="selectedItem.release !== undefined">開放時機: {{ formatRelease(selectedItem.release) }}</div>
                                        <div class="equip-notes" v-if="selectedItem.notes" style="color: #ff6b6b; font-size: 0.85rem; margin-top: 4px;">備註: {{ selectedItem.notes }}</div>
                                        <div class="equip-source" v-if="selectedItem.source && (Array.isArray(selectedItem.source) ? selectedItem.source.length : selectedItem.source)">{{ Array.isArray(selectedItem.release) ? '升級方式' : '取得來源' }}: {{ Array.isArray(selectedItem.source) ? selectedItem.source.join(' / ') : selectedItem.source }}</div>
                                    </div>
                                </div>
                                <div v-if="selectedItem.effects && selectedItem.effects.length" class="effects-section">
                                    <ul class="effects-list">
                                        <li v-for="(eff, idx) in selectedItem.effects" :key="idx" class="effect-item">
                                            <div v-if="selectedItem.upgrade && selectedItem.upgrade.includes(idx)" class="upgrade-tag">
                                                {{ Array.isArray(selectedItem.release) ? selectedItem.release[1] : '' }}合開放
                                            </div>
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
        const { ref, computed, watch, onMounted } = Vue;

        // --- 內部狀態 ---
        const searchQuery = ref('');
        const mergeFilter = ref('ALL');
        const sourceFilter = ref('ALL');
        const typeFilter = ref('ALL');
        const setFilter = ref('ALL');
        const tagFilter = ref('ALL');
        const frontFilter = ref('ALL');
        const rearFilter = ref('ALL');

        const selectedItem = ref(null);

        // --- 重置過濾器 ---
        watch(() => props.category, () => {
            searchQuery.value = '';
            tagFilter.value = 'ALL';
            mergeFilter.value = 'ALL';
            sourceFilter.value = 'ALL';
            typeFilter.value = 'ALL';
            setFilter.value = 'ALL';
            frontFilter.value = 'ALL';
            rearFilter.value = 'ALL';

            checkUrlParams();
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
            if (Array.isArray(val)) {
                return val.map(v => formatRelease(v)).join(' / ');
            }
            if (val === 0 || val === '0') return '開服';
            if (val > 0 && val <= 8) return val + '合';
            return val;
        };

        const shareItem = (item) => {
            if (!item) return;
            const baseUrl = window.location.origin + window.location.pathname;
            const shareUrl = `${baseUrl}#${props.category}?n=${item.name}`;
            
            Utils.copyToClipboard(shareUrl).then(() => {
                alert('分享連結已複製到剪貼簿！');
            }).catch(() => {
                window.prompt('複製失敗，請手動複製連結：', shareUrl);
            });
        };

        const checkUrlParams = () => {
            const hash = window.location.hash;
            if (hash.includes('?n=')) {
                const params = new URLSearchParams(hash.split('?')[1]);
                const itemName = params.get('n');
                if (itemName) {
                    const item = props.allItems.find(i => i.group === props.category && i.name === itemName);
                    if (item) {
                        selectedItem.value = item;
                    }
                }
            }
        };

        watch(selectedItem, (newVal) => {
            if (newVal) {
                if (!window.history.state || !window.history.state.modalOpen) {
                    window.history.pushState({ modalOpen: true }, '');
                }
            }
        });

        onMounted(() => {
            checkUrlParams();
            window.addEventListener('hashchange', checkUrlParams);
            window.addEventListener('popstate', () => {
                if (selectedItem.value) {
                    selectedItem.value = null;
                }
            });
        });

        const { onUnmounted } = Vue;
        onUnmounted(() => {
            window.removeEventListener('hashchange', checkUrlParams);
        });

        // --- 過濾邏輯 ---
        const uniqueSources = computed(() => {
            const sourcesSet = new Set();
            const categoryItems = props.allItems.filter(item => item.group === props.category);
            categoryItems.forEach(item => {
                if (item.source) {
                    if (Array.isArray(item.source)) {
                        item.source.forEach(s => {
                            if (s) sourcesSet.add(s);
                        });
                    } else {
                        sourcesSet.add(item.source);
                    }
                }
            });
            return [...sourcesSet].sort((a, b) => a.localeCompare(b, 'zh-TW'));
        });

        const uniqueSets = computed(() => {
            const list = props.allItems.filter(item => item.group === props.category);
            const setMap = {};
            list.forEach(item => {
                if (item.sets) {
                    item.sets.split(' ').forEach(s => {
                        let rel = item.release !== undefined ? item.release : 99;
                        if (Array.isArray(rel)) rel = Math.min(...rel);
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
                if (item.tags && Array.isArray(item.tags)) {
                    item.tags.forEach(t => {
                        const trimmed = t.trim();
                        if (trimmed) tagsSet.add(trimmed);
                    });
                }
            });
            const tagOrder = [
                '良才', '名將', '巾幗', '國士', '傳奇',
                '武將', '文官', '全才',
                '步兵', '騎兵', '弓兵', '方士'
            ];
            return [...tagsSet]
                .filter(t => {
                    const trimmed = t.trim();
                    const excludeList = ['前軍', '後軍', '全軍', '步兵', '騎兵', '弓兵', '方士', '武將', '文官', '全才'];
                    return !excludeList.includes(trimmed);
                })
                .sort((a, b) => {
                    const idxA = tagOrder.indexOf(a);
                    const idxB = tagOrder.indexOf(b);
                    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                    if (idxA !== -1) return -1;
                    if (idxB !== -1) return 1;
                    return a.localeCompare(b, 'zh-TW');
                });
        });

        const filteredItems = computed(() => {
            let list = props.allItems.filter(item => item.group === props.category);
            if (mergeFilter.value !== 'ALL') {
                const filterVal = parseInt(mergeFilter.value);
                list = list.filter(item => {
                    if (Array.isArray(item.release)) {
                        return item.release.includes(filterVal);
                    }
                    return item.release === filterVal;
                });
            }
            if (sourceFilter.value !== 'ALL') {
                list = list.filter(item => {
                    if (Array.isArray(item.source)) {
                        return item.source.includes(sourceFilter.value);
                    }
                    return item.source === sourceFilter.value;
                });
            }
            if (setFilter.value !== 'ALL') {
                list = list.filter(item => item.sets && item.sets.split(' ').includes(setFilter.value));
            }
            if (tagFilter.value !== 'ALL') {
                const filterVal = tagFilter.value.trim();
                list = list.filter(item => {
                    const cats = item.category ? item.category.split(' ').map(c => c.trim()) : [];
                    const tags = item.tags ? item.tags.map(t => t.trim()) : [];
                    return cats.includes(filterVal) || tags.includes(filterVal);
                });
            }
            if (typeFilter.value !== 'ALL') {
                list = list.filter(item => {
                    const cats = item.category ? item.category.split(' ').map(c => c.trim()) : [];
                    return cats.includes(typeFilter.value);
                });
            }
            if (frontFilter.value !== 'ALL') {
                list = list.filter(item => {
                    const cats = item.category ? item.category.split(' ').map(c => c.trim()) : [];
                    return cats.includes(frontFilter.value);
                });
            }
            if (rearFilter.value !== 'ALL') {
                list = list.filter(item => {
                    const cats = item.category ? item.category.split(' ').map(c => c.trim()) : [];
                    return cats.includes(rearFilter.value);
                });
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
                        ...(item.tags || []),
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
            searchQuery, mergeFilter, sourceFilter, typeFilter, setFilter, tagFilter, 
            frontFilter, rearFilter, selectedItem,
            uniqueSources, uniqueSets, uniqueTags, filteredItems,
            getCardTag, formatRelease, selectedItem, activityTable,
            shareItem
        };
    }
};
