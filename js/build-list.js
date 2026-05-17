/**
 * 配裝展示組件 (修正版 - 完全對齊 simulator.js 的 loadConfig 流程)
 */
const BuildListComponent = {
    props: ['allItems'],
    setup(props) {
        const { ref, computed, onMounted, watch, nextTick, onUnmounted } = Vue;
        const builds = ref([]);
        const loading = ref(true);
        const searchQuery = ref('');
        const astData = ref({});
        const stablePools = ref({ heroes: [], gods: [], equips: [] });

        const renderCount = ref(40);
        const sentinel = ref(null);
        let observer = null;

        // 使用全域共享的 STATES_CONFIG 避免維護困難
        const STATES_CONFIG = window.STATES_CONFIG;

        // 與 simulator.js:787-805 的 getStablePool 完全對齊
        const getStablePool = (slotId) => {
            const pools = stablePools.value;
            if (slotId === 'rear_hero' || slotId === 'front_hero') return pools.heroes;
            if (slotId === 'god') return pools.gods;
            if (slotId === 'combat_keys') {
                const keys = [];
                Object.values(STATES_CONFIG.combat).forEach(group => keys.push(...Object.keys(group)));
                return keys;
            }
            if (slotId === 'range_keys') {
                const keys = [];
                Object.values(STATES_CONFIG.range).forEach(group => keys.push(...Object.keys(group)));
                return keys;
            }
            return pools.equips;
        };

        const calculateStats = (shareCode) => {
            if (!shareCode || !astData.value || !stablePools.value || !stablePools.value.heroes || !stablePools.value.heroes.length) return null;
            
            try {
                const pools = stablePools.value;

                // 1. 解碼 — 直接使用回傳的 config，不再重建
                const config = SimSharing.unpackConfigV2(shareCode, pools.heroes, pools.equips, pools.gods, getStablePool);
                if (!config) return { _err: '解碼失敗' };

                // 2. 取得主將基礎資料（與 simulator.js 對齊）
                const heroName = config.h;
                const baseName = heroName.replace(/^[神聖][·\.\s]/, '').trim();
                const hero = pools.heroes.find(h => h.name === baseName);

                // 3. 使用統一的 SimLogic 還原完整的 heroState
                const heroState = SimLogic.restoreHeroState(config, pools.heroes);

                // 4. 直接使用 config.e 作為 equipConfig
                const equipConfig = config.e;

                // 5. 計算
                const totals = SimLogic.calculateTotalStats(equipConfig, heroState, astData.value);
                
                // totals 只有加成值，核心四維需要加上基礎值
                const stats = {};
                const statKeys = ['武力', '智力', '魅力', '統御'];
                statKeys.forEach(k => {
                    let base = (hero && hero[k]) ? Number(hero[k]) : 0;
                    stats[k] = base + (totals[k] || 0);
                });

                return stats;
            } catch (e) {
                console.error('[BuildList] 運算異常:', e);
                return { _err: '崩潰' };
            }
        };

        const calculateAllStats = () => {
            if (!builds.value.length || !astData.value || Object.keys(astData.value).length === 0) return;
            builds.value = builds.value.map(item => ({
                ...item,
                _stats: calculateStats(item['分享代碼'])
            }));
        };

        const initData = async () => {
            try {
                const [heroes, gods, equips, equipAst, heroAst] = await Promise.all([
                    window.DataManager.getJSON('data/hero.json'),
                    window.DataManager.getJSON('data/god.json'),
                    window.DataManager.getJSON('data/equip.json'),
                    window.DataManager.getJSON('data/equip_ast.json'),
                    window.DataManager.getJSON('data/hero_ast.json')
                ]);
                stablePools.value = { heroes, gods, equips };
                astData.value = { ...equipAst, ...heroAst };
                
                await fetchBuilds();
            } catch (err) {
                console.error('[BuildList] 初始化資料失敗:', err);
                loading.value = false;
            }
        };

        onMounted(() => {
            initData();
        });

        watch(sentinel, (newEl, oldEl) => {
            if (observer) {
                observer.disconnect();
                observer = null;
            }
            if (newEl) {
                observer = new IntersectionObserver(entries => {
                    if (entries[0].isIntersecting && renderCount.value < filteredBuilds.value.length) {
                        renderCount.value += 40;
                    }
                }, { rootMargin: '300px' });
                observer.observe(newEl);
            }
        });

        onUnmounted(() => {
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        });

        const fetchBuilds = async () => {
            try {
                const rawData = await SimSharing.getBuilds();
                
                // 建立英文鍵值對應回前端範本所需中文鍵值的對照表
                const ENG_TO_CHI = {
                    hero: '主將名稱',
                    isAwakened: '是否覺醒',
                    isReincarnated: '是否輪迴',
                    shareCode: '分享代碼',
                    weapon: '神兵',
                    mount: '坐騎',
                    book: '寶典',
                    treasure: '奇珍',
                    token: '令符',
                    hunyu: '魂玉',
                    rear_hero: '後軍副將',
                    front_hero: '前軍副將',
                    god: '幻神',
                    weapon_p: '神兵神靈',
                    mount_p: '坐騎神靈',
                    book_p: '寶典神靈',
                    treasure_p: '奇珍神靈',
                    token_p: '令符神靈',
                    provider: '作者',
                    password: '密碼',
                    ID: 'ID',
                    timestamp: '更新時間'
                };

                builds.value = rawData.map(row => {
                    const cleanRow = {};
                    Object.keys(row).forEach(key => {
                        const chiKey = ENG_TO_CHI[key] || key;
                        cleanRow[chiKey] = row[key];
                    });
                    
                    // 保留試算表列號 rowNum 與其他核心 Key 值供調用
                    cleanRow.rowNum = row.ID || row.id || null;
                    cleanRow.shareCode = row.shareCode;
                    cleanRow.password = row.password || null;
                    cleanRow.timestamp = row.timestamp || null;
                    
                    // --- 核心連動：從 shareCode 解碼還原中文名稱 ---
                    if (cleanRow.shareCode && stablePools.value && stablePools.value.heroes && stablePools.value.heroes.length > 0) {
                        try {
                            const pools = stablePools.value;
                            const decoded = SimSharing.unpackConfigV2(cleanRow.shareCode, pools.heroes, pools.equips, pools.gods, getStablePool);
                            if (decoded) {
                                if (decoded.h) cleanRow['主將名稱'] = decoded.h;
                                if (decoded.e) {
                                    if (decoded.e.weapon) cleanRow['神兵'] = decoded.e.weapon;
                                    if (decoded.e.mount) cleanRow['坐騎'] = decoded.e.mount;
                                    if (decoded.e.book) cleanRow['寶典'] = decoded.e.book;
                                    if (decoded.e.treasure) cleanRow['奇珍'] = decoded.e.treasure;
                                    if (decoded.e.token) cleanRow['令符'] = decoded.e.token;
                                    if (decoded.e.hunyu) cleanRow['魂玉'] = decoded.e.hunyu;
                                    if (decoded.e.rear_hero) cleanRow['後軍副將'] = decoded.e.rear_hero;
                                    if (decoded.e.front_hero) cleanRow['前軍副將'] = decoded.e.front_hero;
                                    if (decoded.e.god) cleanRow['幻神'] = decoded.e.god;
                                    if (decoded.e.weapon_p) cleanRow['神兵神靈'] = decoded.e.weapon_p;
                                    if (decoded.e.mount_p) cleanRow['坐騎神靈'] = decoded.e.mount_p;
                                    if (decoded.e.book_p) cleanRow['寶典神靈'] = decoded.e.book_p;
                                    if (decoded.e.treasure_p) cleanRow['奇珍神靈'] = decoded.e.treasure_p;
                                    if (decoded.e.token_p) cleanRow['令符神靈'] = decoded.e.token_p;
                                }
                            }
                        } catch (err) {
                            console.warn('[BuildList] 從 shareCode 還原名稱失敗:', err);
                        }
                    }
                    
                    cleanRow._stats = null;
                    return cleanRow;
                });
                calculateAllStats();
            } catch (e) {
                console.error('[BuildList] 獲取失敗:', e);
            } finally {
                loading.value = false;
            }
        };

        const getItemName = (rawInput) => {
            if (!rawInput) return '';
            if (typeof rawInput === 'object') {
                if (rawInput.name) return rawInput.name;
                if (rawInput.item && rawInput.item.name) return rawInput.item.name;
                if (rawInput.n) return rawInput.n;
                return '';
            }
            return String(rawInput);
        };

        const getItemImage = (rawInput, categoryHint = null) => {
            const rawName = getItemName(rawInput);
            if (!rawName || rawName === "") return 'img/unknown.png';
            const cleanName = String(rawName).normalize('NFC').replace(/[\(\（\[\{].*[\)\）\]\}]/g, '').trim();
            let item = props.allItems.find(i => i.name === cleanName);
            if (!item || categoryHint === 'hero') {
                const baseHero = cleanName.replace(/^[神聖][·\.\s]/, '');
                item = props.allItems.find(i => i.name === baseHero && i.group === 'hero');
            }
            return item ? `img/${item.image}` : 'img/unknown.png';
        };

        const loadBuild = (item) => {
            if (!item || !item['分享代碼']) return;
            const shareCode = item['分享代碼'];
            const buildId = item.rowNum || item.ID || '';
            window.open(`?sim=${shareCode}&id=${buildId}`, '_blank');
        };

        const sortKey = ref(null);
        const sortOrder = ref(null); // 'asc', 'desc', null

        const toggleSort = (k) => {
            if (sortKey.value !== k) {
                sortKey.value = k;
                sortOrder.value = 'desc'; // 第一次點擊：降序
            } else if (sortOrder.value === 'desc') {
                sortOrder.value = 'asc';  // 第二次點擊：升序
            } else {
                sortKey.value = null;     // 第三次點擊：不排序
                sortOrder.value = null;
            }
        };

        const filteredBuilds = computed(() => {
            let list = [...builds.value];
            
            // 1. 搜尋過濾
            const query = searchQuery.value.trim().toLowerCase();
            if (query) {
                list = list.filter(item => {
                    const mainHero = item['主將名稱'];
                    if (mainHero && getItemName(mainHero).toLowerCase().includes(query)) return true;
                    
                    const equipKeys = ['神兵', '坐騎', '寶典', '奇珍', '令符', '魂玉'];
                    if (equipKeys.some(k => item[k] && getItemName(item[k]).toLowerCase().includes(query))) return true;
                    
                    const providerKeys = ['作者', '提供者', '提供者ID', 'ID'];
                    if (providerKeys.some(k => item[k] && String(item[k]).toLowerCase().includes(query))) return true;
                    
                    return false;
                });
            }

            // 2. 屬性排序
            if (sortKey.value && sortOrder.value) {
                list.sort((a, b) => {
                    const valA = (a._stats && a._stats[sortKey.value]) ? Number(a._stats[sortKey.value]) : 0;
                    const valB = (b._stats && b._stats[sortKey.value]) ? Number(b._stats[sortKey.value]) : 0;
                    if (sortOrder.value === 'asc') {
                        return valA - valB;
                    } else {
                        return valB - valA;
                    }
                });
            }
            
            return list;
        });

        const visibleBuilds = computed(() => filteredBuilds.value.slice(0, renderCount.value));

        watch(filteredBuilds, () => {
            renderCount.value = 40;
        });

        const equipSlots = ['神兵', '坐騎', '寶典', '奇珍', '令符'];
        const statKeys = ['武力', '智力', '魅力', '統御'];

        const getStatHeaderClass = (k) => {
            const classMap = {
                '武力': 'red-text',
                '智力': 'blue-text',
                '魅力': 'pink-text',
                '統御': 'orange-text'
            };
            return {
                [classMap[k]]: true,
                'active-sort': sortKey.value === k
            };
        };

        const formatTime = (rawTime) => {
            if (!rawTime) return '';
            try {
                const date = new Date(rawTime);
                if (isNaN(date.getTime())) return String(rawTime);
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                const hh = String(date.getHours()).padStart(2, '0');
                const mm = String(date.getMinutes()).padStart(2, '0');
                return `${y}-${m}-${d} ${hh}:${mm}`;
            } catch (e) {
                return String(rawTime);
            }
        };

         return { 
            builds, filteredBuilds, visibleBuilds, renderCount, sentinel, searchQuery, loading, 
            loadBuild, getItemImage, getItemName, formatTime,
            equipSlots, statKeys,
            sortKey, sortOrder, toggleSort, getStatHeaderClass
        };
    },
    template: `
        <div class="builds-container">
            <div class="builds-header">
                <div class="header-top">
                    <h1>📚 最新配裝展示 <span class="header-refresh-hint">（列表每10分鐘刷新）</span></h1>
                    <div class="builds-search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" v-model="searchQuery" placeholder="搜尋武將或裝備...">
                    </div>
                </div>
            </div>

            <div v-if="loading" class="builds-loader">
                <div class="loader-icon"></div>
                <p>正在蒐集外星科技...</p>
            </div>

            <div v-else class="builds-list">
                <!-- 列表頂部標題列 (全平台顯示) -->
                <div class="builds-list-header">
                    <div class="header-cell col-hero">主將</div>
                    <div class="header-cell col-stats">
                        <div v-for="k in statKeys" :key="k" 
                             class="stat-header-cell" 
                             :class="getStatHeaderClass(k)"
                             @click="toggleSort(k)">
                            <span class="stat-name">{{ k }}</span>
                            <span class="sort-arrow">
                                <template v-if="sortKey === k">{{ sortOrder === 'asc' ? '▲' : '▼' }}</template>
                                <template v-else>⬘</template>
                            </span>
                        </div>
                    </div>
                    <div class="header-cell col-equips"><span class="header-title-text">5件核心主裝備</span></div>
                    <div class="header-cell col-soul-jade"><span class="header-title-text">魂玉</span></div>
                    <div class="header-cell col-action">操作</div>
                </div>

                <div v-for="(item, idx) in visibleBuilds" :key="idx" class="build-row">
                    <!-- 左側英雄頭像與提供者 ID -->
                    <div class="row-section main-hero-section">
                        <div class="hero-avatar">
                            <img :src="getItemImage(item['主將名稱'], 'hero')" :title="getItemName(item['主將名稱'])">
                        </div>
                        <div class="provider-badge" :title="'作者: ' + (item['作者'] || item['提供者'] || item['提供者ID'] || item['ID'] || '無')">
                            作者: {{ item['作者'] || item['提供者'] || item['提供者ID'] || item['ID'] || '無' }}
                        </div>
                    </div>
                    
                    <!-- 四維屬性向右展開 -->
                    <div class="row-section stats-section-expanded">
                        <div v-if="item._stats && !item._stats._err" class="hero-flat-stats">
                            <div v-for="k in statKeys" :key="k" class="flat-stat-item">
                                <span class="stat-label mobile-only-label">{{ k[0] }}</span>
                                <span class="stat-val">{{ Math.round(item._stats[k]) || 0 }}</span>
                            </div>
                        </div>
                        <div v-else-if="item._stats && item._stats._err" class="stat-error-hint">
                            {{ item._stats._err }}
                        </div>
                        <div v-else class="stat-error-hint">載入中...</div>
                    </div>

                    <!-- 5件主裝備 -->
                    <div class="row-section slots-section main-equips">
                        <div class="mini-slots">
                            <div v-for="s in equipSlots" :key="s" class="mini-slot" :title="getItemName(item[s])">
                                <img v-if="item[s]" :src="getItemImage(item[s])">
                                <div v-else class="empty-mini"></div>
                            </div>
                        </div>
                    </div>

                    <!-- 魂玉 -->
                    <div class="row-section slots-section soul-jade">
                        <div class="mini-slots">
                            <div class="mini-slot" :title="getItemName(item['魂玉'])">
                                <img v-if="item['魂玉']" :src="getItemImage(item['魂玉'])">
                                <div v-else class="empty-mini"></div>
                            </div>
                        </div>
                    </div>

                    <!-- 載入按鈕 -->
                    <div class="row-section action-section">
                        <button class="row-load-btn" @click.stop="loadBuild(item)">
                            載入
                        </button>
                    </div>

                    <!-- 最後更新時間 (右下角絕對定位) -->
                    <div class="row-timestamp" v-if="item.timestamp">
                        更新時間: {{ formatTime(item.timestamp) }}
                    </div>
                </div>
                <div ref="sentinel" class="builds-sentinel"></div>
                <div v-if="filteredBuilds.length > visibleBuilds.length" class="builds-count">
                    顯示 {{ visibleBuilds.length }} / {{ filteredBuilds.length }} 項
                </div>
            </div>
        </div>
    `
};
