/**
 * 模擬配裝器組件
 */
const SimulatorComponent = {
    components: { SimulatorPopover, SimulatorSummary },
    props: ['allItems'],
    setup(props) {
        const { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated, toRef, nextTick } = Vue;
        const allItems = toRef(props, 'allItems');

        // 用於控制 keep-alive 狀態下的全域 UI 顯示 (例如 Teleport 到的 body 的按鈕)
        const isCompActive = ref(true);
        onActivated(() => { isCompActive.value = true; });
        onDeactivated(() => { isCompActive.value = false; });

        // --- 核心運算邏輯代理 (委派至 SimLogic) ---
        const getEquippedItemsSync = (config) => SimLogic.getEquippedItemsSync(config);
        const getHeroAst = (name) => SimLogic.getHeroAst(name, astData.value);
        const getCurrentContext = (config) => SimLogic.getCurrentContext(config, heroState.value, astData.value);
        const getHeroAndLieutSkillsSync = (config) => SimLogic.getHeroAndLieutSkillsSync(config, heroState.value, astData.value);
        const interpretEffectSync = (eff, src, conf, ctx, opt) => SimLogic.interpretEffectSync(eff, src, conf, ctx, opt, heroState.value, astData.value);
        const calculateTotalStats = (config = selectedEquip.value) => SimLogic.calculateTotalStats(config, heroState.value, astData.value);
        const hasIdentityMatch = SimLogic.hasIdentityMatch;



        // --- 狀態定義 ---
        const activeSlot = ref(null);
        const slotSearchQuery = ref('');
        const sortStats = ref([]); // ['武力', '智力', '魅力', '統御']
        const selectedEquip = ref({
            'weapon': null,
            'mount': null,
            'book': null,
            'treasure': null,
            'token': null,
            'hunyu': null,
            'rear_hero': null,
            'front_hero': null,
            'god': null,
            'weapon_p': null,
            'mount_p': null,
            'book_p': null,
            'treasure_p': null,
            'token_p': null
        });

        const heroSearchQuery = ref('');
        const showHeroSearch = ref(false);
        const activeHeroSlot = ref(null); // 'main', 'rear_hero', 'front_hero'

        const heroState = ref({
            selectedHeroName: '關羽',
            class: '武將',
            identity: '國士',
            gender: '男性',
            isAwakened: false,
            isReincarnated: false,
            isLieutenant: false,
            fullCategory: ''
        });

        const allHeroes = ref([]);
        const allGods = ref([]);
        const astData = ref({});

        // --- 穩定索引池 (用於分享連結，避免受 AST 或 UI 排序影響) ---
        const STABLE_POOLS = {
            heroes: [],
            gods: [],
            equips: []
        };

        // 統一載入所有必要資料
        Promise.all([
            window.DataManager.getJSON('data/hero.json'),
            window.DataManager.getJSON('data/god.json'),
            window.DataManager.getJSON('data/equip.json'),
            window.DataManager.getJSON('data/equip_ast.json'),
            window.DataManager.getJSON('data/hero_ast.json')
        ]).then(([heroes, gods, equips, equipAst, heroAst]) => {
            // 1. 填充穩定池
            STABLE_POOLS.heroes = heroes;
            STABLE_POOLS.gods = gods;
            STABLE_POOLS.equips = equips;

            // 2. 填充響應式資料
            allHeroes.value = heroes;
            allGods.value = gods.map(item => ({ ...item, group: 'god' }));
            astData.value = { ...equipAst, ...heroAst };

            // 3. 預設選中並同步
            updateHeroAttributes('關羽');

            // 4. 資料就緒後處理網址參數
            handleUrlParams();
        }).catch(err => {
            console.error('資料載入失敗', err);
        });



        const selectHero = (name) => {
            if (activeHeroSlot.value === 'rear_hero' || activeHeroSlot.value === 'front_hero') {
                selectedEquip.value[activeHeroSlot.value] = name;
                activeSlot.value = null;
            } else {
                // 更新主將名稱並立即觸發屬性同步
                heroState.value.selectedHeroName = name;
                updateHeroAttributes(name);

                // 檢查副將合法性
                ['rear_hero', 'front_hero'].forEach(slot => {
                    const lieutName = selectedEquip.value[slot];
                    if (lieutName) {
                        const baseLieut = lieutName.replace(/^[神聖][·\.\s]/, '');
                        const lHero = allHeroes.value.find(h => h.name === baseLieut);
                        if (lieutName === name || (lHero && !isHeroValidForLieutenant(lHero, slot))) {
                            selectedEquip.value[slot] = null;
                        }
                    }
                });

                showHeroSearch.value = false;
                heroSearchQuery.value = '';
            }
            activeHeroSlot.value = null;
        };

        const updateHeroAttributes = (name) => {
            const hero = allHeroes.value.find(h => h.name === name);
            if (!hero) return;

            // 主將屬性一律優先抓取 hero.json 的原始資料
            const categoryTags = (hero.category || '').split(' ').filter(t => t.trim());
            const slots = [...categoryTags, hero.gender];

            heroState.value.fullCategory = slots.join(' ');

            // 從標籤中提取分類
            if (slots.includes('武將')) heroState.value.class = '武將';
            else if (slots.includes('文官')) heroState.value.class = '文官';
            else if (slots.includes('全才')) heroState.value.class = '全才';
            else heroState.value.class = '無';

            const traits = ['傳奇', '國士', '巾幗', '名將', '良才'];
            heroState.value.identity = traits.find(t => slots.includes(t)) || '無';
            heroState.value.gender = hero.gender || '男性';
        };



        // 當主將變更時，自動檢查並清空不符合條件的副將
        watch(() => heroState.value.selectedHeroName, (newHeroName) => {
            if (!newHeroName) return;

            const fateHeroNames = new Set();
            const fateCategories = new Set();
            const mainAst = getHeroAst(newHeroName);
            if (mainAst && mainAst.fates) {
                mainAst.fates.forEach(f => {
                    if (f.cond) {
                        if (f.cond.heroes) f.cond.heroes.forEach(n => fateHeroNames.add(n.trim()));
                        if (f.cond.identity) f.cond.identity.forEach(id => fateCategories.add(id.trim()));
                    }
                });
            }

            ['rear_hero', 'front_hero'].forEach(slot => {
                const lieutName = selectedEquip.value[slot];
                if (!lieutName) return;
                const baseName = lieutName.replace(/^[神聖][·\.\s]/, '');
                const lHero = allHeroes.value.find(h => h.name === baseName);
                if (!lHero) {
                    selectedEquip.value[slot] = null;
                    return;
                }
                const lAst = getHeroAst(lieutName);
                const isFate = fateHeroNames.has(baseName);
                const slots = lAst ? (lAst.slot || []) : [];
                const matchesAnyFate = Array.from(fateCategories).some(targetId => {
                    if (slots.includes(targetId)) return true;
                    if (targetId === '武將' && slots.includes('全才')) return true;
                    if (targetId === '文官' && slots.includes('全才')) return true;
                    return false;
                });

                const isValidType = isHeroValidForLieutenant(lHero, slot);

                if (!isFate && !matchesAnyFate && !isValidType) {
                    selectedEquip.value[slot] = null;
                }
            });
        });

        const simulatorSlots = [
            { id: 'weapon', name: '神兵' },
            { id: 'mount', name: '坐騎' },
            { id: 'book', name: '寶典' },
            { id: 'treasure', name: '奇珍' },
            { id: 'token', name: '令符' }
        ];

        const soulJadeSlots = [
            { id: 'rear_hero', name: '後軍副將', badge: null },
            { id: 'front_hero', name: '前軍副將', badge: null },
            { id: 'hunyu', name: '魂玉', badge: '3合魂玉' },
            { id: 'god', name: '神靈', badge: null }
        ];

        const partialSlots = [
            { id: 'weapon_p', name: '神兵', category: '神兵' },
            { id: 'mount_p', name: '坐騎', category: '坐騎' },
            { id: 'book_p', name: '寶典', category: '寶典' },
            { id: 'treasure_p', name: '奇珍', category: '奇珍' },
            { id: 'token_p', name: '令符', category: '令符' }
        ];

        const lieutenantRequirements = computed(() => {
            const mainAst = getHeroAst(heroState.value.selectedHeroName);
            const slots = mainAst ? (mainAst.slot || []) : [];
            const front = [];
            const rear = [];
            if (slots.includes('騎兵')) front.push('騎兵');
            if (slots.includes('步兵')) front.push('步兵');
            if (slots.includes('弓兵')) rear.push('弓兵');
            if (slots.includes('方士')) rear.push('方士');
            return { front, rear };
        });

        const isHeroValidForLieutenant = (hero, slot) => {
            if (!hero) return true;
            const mainHeroName = heroState.value.selectedHeroName;
            if (!mainHeroName) return true;

            const candidateBaseName = hero.name.replace(/^[神聖][·\.\s]/, '');
            const mainBaseName = mainHeroName.replace(/^[神聖][·\.\s]/, '');

            const candidateAst = getHeroAst(candidateBaseName);
            const mainAst = getHeroAst(mainBaseName);

            // 1. 宿命/副將技豁免 (只要有姓名關聯，即可無視軍種上陣)
            // 檢查主將宿命
            if (mainAst && mainAst.fates) {
                if (mainAst.fates.some(f => f.cond && f.cond.heroes && f.cond.heroes.includes(candidateBaseName))) return true;
            }
            // 檢查候選人宿命與副將技
            if (candidateAst) {
                const checkTarget = (list) => (list || []).some(f => f.cond && f.cond.heroes && f.cond.heroes.includes(mainBaseName));
                if (checkTarget(candidateAst.fates)) return true;
                if (checkTarget(candidateAst.as_deputy)) return true;
                if (checkTarget(candidateAst.as_deputy_awaken)) return true;
                if (checkTarget(candidateAst.as_deputy_awaken2)) return true;

                // 2. 特殊資格 (任意兵種副將)
                if (candidateAst.slot && candidateAst.slot.includes('any')) return true;

                // 3. 標準兵種判定
                const reqs = lieutenantRequirements.value;
                const allowedTypes = slot === 'front_hero' ? reqs.front : reqs.rear;
                return candidateAst.slot.some(s => allowedTypes.includes(s));
            }

            // 退回原始模式 (若 AST 尚未定義，或 AST 中沒有 slot 資訊)
            const hCat = hero.category || '';
            const reqs = lieutenantRequirements.value;
            const allowedTypes = slot === 'front_hero' ? reqs.front : reqs.rear;
            return allowedTypes.some(r => hCat.includes(r));
        };



        const filteredHeroes = computed(() => {
            let list = allHeroes.value;
            const kw = heroSearchQuery.value.trim().toLowerCase();

            if (activeHeroSlot.value === 'rear_hero' || activeHeroSlot.value === 'front_hero') {
                // 提取目前主將的所有宿命英雄姓名與類別
                const mainHero = allHeroes.value.find(mh => mh.name === heroState.value.selectedHeroName);
                const fateHeroNames = new Set();
                const fateCategories = new Set();

                if (mainHero) {
                    const baseMain = mainHero.name.replace(/^[神聖][·\.\s]/, '');
                    const mainAst = astData.value[baseMain] || astData.value[mainHero.name];

                    if (mainAst && mainAst.fates) {
                        mainAst.fates.forEach(fate => {
                            if (fate.cond) {
                                // 提取具體英雄姓名
                                if (fate.cond.heroes) {
                                    fate.cond.heroes.forEach(name => fateHeroNames.add(name.trim()));
                                }
                                // 提取類別需求 (例如：全才)
                                if (fate.cond.identity) {
                                    fate.cond.identity.forEach(id => fateCategories.add(id.trim()));
                                }
                            }
                        });
                    }
                }

                // 構建最終清單，處理「神·」版本與重複檢查
                const finalHeroList = [];

                // 取得另一個位置已選用的副將姓名 (用以排除重複)
                const otherSlot = activeHeroSlot.value === 'front_hero' ? 'rear_hero' : 'front_hero';
                const otherHeroName = selectedEquip.value[otherSlot];
                const baseOtherHeroName = otherHeroName ? otherHeroName.replace(/^[神聖][·\.\s]/, '') : null;

                list.forEach(h => {
                    if (h.name === heroState.value.selectedHeroName) return;
                    // 排除已在另一個位置選用的英雄 (包含神、聖版本)
                    if (baseOtherHeroName && h.name === baseOtherHeroName) return;

                    // --- 改用 AST 判定副將資格 ---
                    const baseName = h.name.replace(/^[神聖][·\.\s]/, '');
                    const ast = getHeroAst(baseName);

                    const isFate = fateHeroNames.has(h.name);
                    const slots = ast ? (ast.slot || []) : [];
                    const matchesAnyFate = hasIdentityMatch(slots, Array.from(fateCategories));
                    const isValidType = isHeroValidForLieutenant(h, activeHeroSlot.value);

                    // 具備副將資格判定：有副將技資料 OR 是宿命對象
                    const hasDeputyData = ast && (
                        (ast.as_deputy && ast.as_deputy.length > 0) ||
                        (ast.as_deputy_awaken && ast.as_deputy_awaken.length > 0) ||
                        (ast.as_deputy_awaken2 && ast.as_deputy_awaken2.length > 0)
                    );

                    if (!hasDeputyData && !isFate) return;

                    // A. 原版英雄：(是宿命對象) OR (符合軍種條件 且 (符合類別宿命 或 有普通副將技))
                    if (isFate || (isValidType && (matchesAnyFate || (ast && ast.as_deputy && ast.as_deputy.length > 0)))) {
                        finalHeroList.push(h);
                    }

                    // B. 「神·」版本：AST中有覺醒副將技 (需符合軍種)
                    if (isValidType && ast.as_deputy_awaken && ast.as_deputy_awaken.length > 0) {
                        finalHeroList.push({ ...h, name: '神·' + h.name, isDivine: true });
                    }

                    // C. 「聖·」版本：AST中有聖覺醒副將技 (需符合軍種)
                    if (isValidType && ast.as_deputy_awaken2 && ast.as_deputy_awaken2.length > 0) {
                        finalHeroList.push({ ...h, name: '聖·' + h.name, isSaint: true });
                    }

                });

                list = finalHeroList;
            }

            if (kw) {
                list = list.filter(h => {
                    const haystack = (h.name + ' ' + (h.category || '')).toLowerCase();
                    return haystack.includes(kw);
                });
            }

            // 副將排序：模擬裝備每位副將後的四維差值
            if (sortStats.value.length > 0 && (activeHeroSlot.value === 'rear_hero' || activeHeroSlot.value === 'front_hero')) {
                const currentTotals = calculateTotalStats();
                list.forEach(h => {
                    const tempEquip = { ...selectedEquip.value };
                    tempEquip[activeHeroSlot.value] = h.name;
                    const potentialTotals = calculateTotalStats(tempEquip);
                    let bonus = 0;
                    sortStats.value.forEach(s => bonus += (potentialTotals[s] || 0) - (currentTotals[s] || 0));
                    h._sortBonus = bonus;
                });
                list.sort((a, b) => b._sortBonus - a._sortBonus);
            } else {
                list.forEach(h => h._sortBonus = 0);
            }

            return list;
        });

        // --- 輔助函數 ---

        const filteredSlotItems = (slot) => {
            const categoryName = slot.category || slot.name;
            let list = allItems.value;
            if (slot.id === 'god') {
                list = allGods.value;
            } else if (slot.id === 'hunyu') {
                list = list.filter(item => ['神兵', '坐騎', '寶典', '奇珍', '令符'].includes(item.category));
            } else {
                list = list.filter(item => item.category === categoryName);
            }

            if (slot.id && slot.id.endsWith('_p')) {
                list = list.filter(item => item.effects && item.effects.length === 5);
            }

            const equippedNames = new Set();
            Object.entries(selectedEquip.value).forEach(([id, val]) => {
                if (!val || id === slot.id) return;
                if (id.endsWith('_p')) {
                    if (val.item) equippedNames.add(val.item.name);
                } else {
                    equippedNames.add(val.name);
                }
            });
            list = list.filter(item => !equippedNames.has(item.name));

            if (slotSearchQuery.value.trim()) {
                const kw = slotSearchQuery.value.toLowerCase();
                list = list.filter(item => item.name.toLowerCase().includes(kw));
            }

            // --- 執行排序與裝飾 ---
            const currentTotals = calculateTotalStats();
            const isDeitySlot = slot.id && slot.id.endsWith('_p');
            const tempEquip = { ...selectedEquip.value };

            // 建立裝飾後的清單，不修改原始 allItems
            let resultList = list.map(item => {
                const decorated = Object.create(item); // 使用原型繼承，避免觸發響應式
                if (slot.id === 'god') {
                    decorated._sortBonus = 0;
                    return decorated;
                }
                let maxItemBonus = 0;
                let bestIdx = 0;

                if (sortStats.value.length > 0) {
                    if (isDeitySlot) {
                        // 1. 基準計算
                        tempEquip[slot.id] = { item, effectIdx: -1 };
                        const basePot = calculateTotalStats(tempEquip);
                        const baseStats = {};
                        sortStats.value.forEach(s => baseStats[s] = (basePot[s] || 0) - (currentTotals[s] || 0));

                        // 2. 啟發式掃描 TODO
                        const targetIndices = [];
                        const linkageIndices = [];
                        const allEffects = (item.effects || []);
                        const effectAnalyses = [];

                        allEffects.forEach((eff, idx) => {
                            const result = interpretEffectSync(eff, item.name, tempEquip, {}, {
                                quickScan: true,
                                targetStats: sortStats.value
                            });
                            effectAnalyses[idx] = result;
                            if (!result.isIrrelevant) {
                                if (sortStats.value.some(s => result.totalStats[s] !== undefined)) targetIndices.push(idx);
                                if (result.hasLinkage || !!item.sets) linkageIndices.push(idx);
                            } else if (item.sets) {
                                linkageIndices.push(idx);
                            }
                        });

                        // 3. 決定路徑
                        const toProcess = new Map();
                        if (targetIndices.length === 0) {
                            toProcess.set(0, 'slow');
                        } else {
                            targetIndices.forEach(idx => toProcess.set(idx, linkageIndices.includes(idx) ? 'slow' : 'fast'));
                            linkageIndices.forEach(idx => toProcess.set(idx, 'slow'));
                            if (toProcess.size < 5) {
                                for (let i = 0; i < allEffects.length; i++) {
                                    if (!toProcess.has(i)) { toProcess.set(i, 'slow'); break; }
                                }
                            }
                        }

                        // 4. 計算分數
                        maxItemBonus = -Infinity;
                        toProcess.forEach((type, idx) => {
                            let currentEffectBonus = 0;
                            if (type === 'slow') {
                                tempEquip[slot.id] = { item, effectIdx: idx };
                                const pot = calculateTotalStats(tempEquip);
                                sortStats.value.forEach(s => currentEffectBonus += (pot[s] || 0) - (currentTotals[s] || 0));
                            } else {
                                const { totalStats } = effectAnalyses[idx];
                                sortStats.value.forEach(s => currentEffectBonus += baseStats[s] + (totalStats[s] || 0));
                            }
                            if (currentEffectBonus > maxItemBonus) {
                                maxItemBonus = currentEffectBonus;
                                bestIdx = idx;
                            }
                        });
                    } else {
                        // 普通位
                        tempEquip[slot.id] = item;
                        const pot = calculateTotalStats(tempEquip);
                        sortStats.value.forEach(s => maxItemBonus += (pot[s] || 0) - (currentTotals[s] || 0));
                    }
                }

                decorated._sortBonus = maxItemBonus === -Infinity ? 0 : maxItemBonus;
                decorated._bestEffectIdx = bestIdx;
                return decorated;
            });

            if (sortStats.value.length > 0) {
                resultList.sort((a, b) => (b._sortBonus || 0) - (a._sortBonus || 0));
            }

            return resultList;
        };

        const sortMetadata = new Map();

        const activeSlotItems = computed(() => {
            if (!activeSlot.value) return [];
            const slot = typeof activeSlot.value === 'string'
                ? [...simulatorSlots, ...soulJadeSlots, ...partialSlots].find(s => s.id === activeSlot.value)
                : activeSlot.value;

            // 每次計算前清空臨時數據
            sortMetadata.clear();
            return filteredSlotItems(slot, sortMetadata);
        });

        const isSummaryOpen = ref(false);
        const activeSummaryTab = ref('effects'); // 預設顯示裝備詞條
        // 監聽 activeSlot 變化，切換插槽時重置排序
        watch(activeSlot, (newVal) => {
            if (newVal) {
                sortStats.value = [];
            }
        });

        // 監聽彙總分頁切換，自動捲回頂部
        watch(activeSummaryTab, () => {
            nextTick(() => {
                const el = document.querySelector('.summary-tab-content');
                if (el) el.scrollTop = 0;
            });
        });



        const handleSlotClick = (slot) => {
            // 切換插槽時，關閉主將搜尋選單
            showHeroSearch.value = false;

            activeSlot.value = (activeSlot.value === slot.id ? null : slot.id);
            if (activeSlot.value && (slot.id === 'rear_hero' || slot.id === 'front_hero')) {
                activeHeroSlot.value = slot.id;
            }
        };

        // 監聽插槽關閉，自動清理副將選擇狀態
        watch(activeSlot, (newVal) => {
            if (!newVal && (activeHeroSlot.value === 'rear_hero' || activeHeroSlot.value === 'front_hero')) {
                activeHeroSlot.value = null;
            }
        });

        const getHeroImage = (heroName) => {
            if (!heroName) return 'unknown.png';
            const baseName = heroName.replace(/^[神聖][·\.\s]/, '');
            const h = allHeroes.value.find(h => h.name === baseName);
            return h ? h.image : 'unknown.png';
        };

        const selectItemForSlot = (slotId, payload) => {
            selectedEquip.value[slotId] = payload;
            activeSlot.value = null;
            slotSearchQuery.value = '';
        };


        const handleSearchBlur = () => {
            // 移除自動關閉，改由 window mousedown 處理點擊外部關閉
            // 這樣才不會干擾神靈位從第一層跳轉到第二層的操作
        };

        const clearAllEquip = () => {
            Object.keys(selectedEquip.value).forEach(k => selectedEquip.value[k] = null);
        };

        const hasSelectedItems = computed(() => {
            return Object.values(selectedEquip.value).some(v => v !== null);
        });

        const handleUrlParams = () => {
            const { sim, legacy } = SimSharing.parseUrlParams();
            if (sim) {
                try {
                    const config = SimSharing.unpackConfigV2(sim, STABLE_POOLS.heroes, STABLE_POOLS.equips, STABLE_POOLS.gods, getStablePool);
                    loadConfig(config);
                } catch (e) { console.error("V2 Unpack failed", e); }
            } else if (legacy) {
                try {
                    const config = SimSharing.decompress(legacy, STABLE_POOLS.heroes, STABLE_POOLS.equips, STABLE_POOLS.gods);
                    loadConfig(config);
                } catch (e) { console.error("Legacy V0 Unpack failed", e); }
            }
        };


        const allSets = computed(() => {
            const setMap = {};
            (allItems.value || []).forEach(item => { if (item.sets) item.sets.split(/\s+/).forEach(s => { if (s.trim()) setMap[s.trim()] = true; }); });
            return Object.keys(setMap).sort((a, b) => a.localeCompare(b, 'zh-TW'));
        });

        const applySet = (setName) => {
            const standardSlots = ['weapon', 'mount', 'book', 'treasure', 'token', 'hunyu'];

            // 統一正向篩選：一開始就先清空基礎 5 個插槽與魂玉位
            standardSlots.forEach(k => selectedEquip.value[k] = null);

            if (!setName) return;

            const list = allItems.value || [];
            const setItems = list.filter(item => {
                if (!item.sets) return false;
                return item.sets.split(/\s+/).includes(setName);
            });

            if (setItems.length === 0) return;

            const usedItems = new Set();

            // 如果神靈位裝備了屬於該套裝的物品，優先移除神靈位的該裝備，避免衝突
            const setItemNames = new Set(setItems.map(i => i.name));
            Object.keys(selectedEquip.value).forEach(k => {
                if (k.endsWith('_p')) {
                    const val = selectedEquip.value[k];
                    if (val && val.item && setItemNames.has(val.item.name)) {
                        selectedEquip.value[k] = null;
                    }
                }
            });

            // 1. 優先處理核心觸發裝備（通常是第 6 件，帶有 5 件金色判定），放進魂玉位
            const coreItem = setItems.find(item =>
                item.effects && item.effects.some(eff => typeof eff === 'string' && eff.includes('裝備5件金色品質'))
            );
            if (coreItem) {
                selectedEquip.value['hunyu'] = coreItem;
                usedItems.add(coreItem.name);
            }

            // 2. 剩餘裝備按分類填入基本 5 個插槽
            simulatorSlots.forEach(slot => {
                const match = setItems.find(item => item.category === slot.name && !usedItems.has(item.name));
                if (match) {
                    selectedEquip.value[slot.id] = match;
                    usedItems.add(match.name);
                }
            });

            // 3. 如果還有剩餘裝備（且魂玉位尚未被核心裝備佔用），填入魂玉位
            if (!selectedEquip.value['hunyu']) {
                const remaining = setItems.filter(item => !usedItems.has(item.name));
                if (remaining.length > 0) {
                    selectedEquip.value['hunyu'] = remaining[0];
                }
            }
        };

        const getStablePool = (slotId, poolSource = STABLE_POOLS) => {
            if (slotId === 'rear_hero' || slotId === 'front_hero') return poolSource.heroes;
            if (slotId === 'god') return poolSource.gods;
            return poolSource.equips;
        };

        const handleClickOutside = (e) => {
            // 如果點擊的是任何一種彈窗內部，直接跳過關閉邏輯
            if (e.target.closest('.slot-search-popover')) return;

            if (activeSlot.value && !e.target.closest('.equip-slot')) {
                activeSlot.value = null;
                slotSearchQuery.value = '';
            }
            if (showHeroSearch.value) {
                const isHeroTrigger = e.target.closest('.current-hero-display');
                const isLieutSlot = e.target.closest('.equip-slot.rear_hero') || e.target.closest('.equip-slot.front_hero');
                if (!isHeroTrigger && !isLieutSlot) {
                    showHeroSearch.value = false;
                    heroSearchQuery.value = '';
                    activeHeroSlot.value = null;
                }
            }
        };





        const loadConfig = (config) => {
            if (!config) return;

            // 1. 還原英雄
            if (config.h) {
                heroState.value.selectedHeroName = config.h;
                updateHeroAttributes(config.h);
            }

            // 2. 還原狀態
            const status = config.s || 0;
            heroState.value.isAwakened = (status & 1) !== 0;
            heroState.value.isReincarnated = (status & 2) !== 0;
            heroState.value.isLieutenant = (status & 4) !== 0;

            if (config.e) {
                Object.keys(selectedEquip.value).forEach(k => selectedEquip.value[k] = null);
                Object.entries(config.e).forEach(([k, v]) => { selectedEquip.value[k] = v; });
            }
        };

        // 監聽裝備變化，用於導航提醒
        watch(selectedEquip, (newVal) => {
            window.isSimulatorDirty = Object.values(newVal).some(v => v !== null);
        }, { deep: true });

        onMounted(() => {
            window.addEventListener('mousedown', handleClickOutside, true);

            // 瀏覽器關閉/重新整理提醒
            window.addEventListener('beforeunload', (e) => {
                if (window.isSimulatorDirty) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });


        });

        onUnmounted(() => {
            window.removeEventListener('mousedown', handleClickOutside, true);
        });

        return {
            activeSlot, slotSearchQuery, sortStats, selectedEquip, simulatorSlots,
            filteredSlotItems, activeSlotItems, selectItemForSlot, handleSearchBlur,
            clearAllEquip, hasSelectedItems,
            statAggregation: null, // 已遷移至 Summary 組件
            allSets, applySet,
            heroState,
            renderEffectSegments(effData, source = null, options = {}) {
                if (!effData) return [];
                const effText = typeof effData === 'string' ? effData : effData.text;
                const localOptions = { ...options };
                if (typeof effData === 'object') {
                    if (effData.astEntry) localOptions.astEntry = effData.astEntry;
                    if (effData.effIdx !== undefined) localOptions.effIdx = effData.effIdx;
                }
                const context = getCurrentContext();
                const interpretation = interpretEffectSync(effText, source, selectedEquip.value, context, localOptions);
                return interpretation.words.map(word => ({ text: word.text, active: word.isActive, isLinkage: word.isLinkage }));
            },
            allHeroes, updateHeroAttributes,
            heroSearchQuery, showHeroSearch, filteredHeroes, selectHero,
            handleSlotClick, getHeroImage, getEquippedItemsSync, getHeroAst, getHeroAndLieutSkillsSync, calculateTotalStats,
            soulJadeSlots, partialSlots,
            shareConfig() {
                const config = {
                    h: heroState.value.selectedHeroName,
                    s: (heroState.value.isAwakened ? 1 : 0) | (heroState.value.isReincarnated ? 2 : 0),
                    e: {}
                };
                Object.entries(selectedEquip.value).forEach(([k, v]) => {
                    if (!v) return;
                    if (k.endsWith('_p')) config.e[k] = { n: v.item.name, i: v.effectIdx };
                    else config.e[k] = typeof v === 'string' ? v : v.name;
                });
                try {
                    const encoded = SimSharing.packConfigV2(config, STABLE_POOLS.heroes, STABLE_POOLS.equips, STABLE_POOLS.gods, getStablePool);
                    const url = new URL(window.location.origin + window.location.pathname);
                    url.searchParams.set('sim', encoded);
                    const shareUrl = url.toString();
                    Utils.copyToClipboard(shareUrl).then(() => { alert('配置連結已複製到剪貼簿！'); }).catch(() => { window.prompt('複製失敗，請手動複製下方連結：', shareUrl); });
                } catch (e) { alert('分享失敗，請稍後再試。'); }
            },
            isCompActive
        };
    },

    template: `
        <div class="simulator-container">
            <div class="simulator-left-panel">
                <div class="simulator-controls">
                    <div class="controls-top-bar">
                        <button class="action-btn share-btn" @click="shareConfig">
                            <i class="fas fa-share-alt"></i> 分享配置
                        </button>
                        <button class="action-btn clear-btn" @click="clearAllEquip" v-if="hasSelectedItems">
                            <i class="fas fa-trash-alt"></i> 清除全部
                        </button>
                    </div>
                    <div class="control-row">
                        <div class="control-group">
                            <label>套裝：</label>
                            <select @change="applySet($event.target.value)">
                                <option value="">-- 請選擇套裝 --</option>
                                <option v-for="s in allSets" :key="s" :value="s">{{ s }}</option>
                            </select>
                        </div>
                        <div class="control-group hero-selector-group">
                            <label>英雄：</label>
                            <div class="hero-autocomplete-container">
                                <div class="current-hero-display" @click="activeSlot = null; activeHeroSlot = 'main'; showHeroSearch = !showHeroSearch">
                                    {{ heroState.selectedHeroName || '請選擇英雄' }}
                                    <i class="fas fa-chevron-down"></i>
                                </div>
                                <simulator-popover 
                                    :show="showHeroSearch && activeHeroSlot === 'main'"
                                    type="hero"
                                    v-model="heroSearchQuery"
                                    :results="filteredHeroes"
                                    trigger-selector=".current-hero-display"
                                    :calculate-total-stats="calculateTotalStats"
                                    :selected-equip="selectedEquip"
                                    :hero-state="heroState"
                                    @select="selectHero" />
                            </div>
                        </div>
                        <div class="control-group">
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 5px; color: var(--primary-gold); font-size: 0.9rem;">
                                <input type="checkbox" v-model="heroState.isAwakened" style="accent-color: var(--primary-gold); width: 16px; height: 16px;"> 已覺醒
                            </label>
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 5px; color: var(--primary-gold); font-size: 0.9rem; margin-left: 10px;">
                                <input type="checkbox" v-model="heroState.isReincarnated" style="accent-color: var(--primary-gold); width: 16px; height: 16px;"> 已輪迴
                            </label>
                        </div>
                    </div>
                </div>
                <div class="simulator-layout">
                    <div class="equip-linear-wrapper">
                        <div v-for="slot in simulatorSlots" :key="slot.id" :class="['equip-slot', slot.id, { 'active': activeSlot === slot.id }]">
                            <div class="slot-label">{{ slot.name }}</div>
                            <div class="slot-card" @click="showHeroSearch = false; activeSlot = (activeSlot === slot.id ? null : slot.id)">
                                <template v-if="selectedEquip[slot.id]">
                                    <div class="full-equip-display">
                                        <img :src="'img/' + selectedEquip[slot.id].image" :alt="selectedEquip[slot.id].name" @error="$event.target.src = 'img/unknown.png'">
                                         <div class="slot-item-name">{{ selectedEquip[slot.id].name }}</div>
                                     </div>
                                     <div class="remove-item" @click.stop="selectedEquip[slot.id] = null">×</div>
                                </template>
                                <div v-else class="slot-placeholder">
                                    <span class="plus-icon">+</span>
                                </div>
                            </div>
                            
                            <simulator-popover
                                :show="activeSlot === slot.id"
                                type="item"
                                :slot="slot"
                                v-model="slotSearchQuery"
                                :results="activeSlotItems"
                                :sort-stats="sortStats"
                                :trigger-selector="'.equip-slot.' + slot.id"
                                :calculate-total-stats="calculateTotalStats"
                                :selected-equip="selectedEquip"
                                :hero-state="heroState"
                                @select="(payload) => selectItemForSlot(slot.id, payload)"
                                @blur="handleSearchBlur" />
                        </div>
                    </div>

                    <div class="equip-linear-wrapper souljade-row" style="margin-top: 10px; border-top: 1px solid rgba(212, 175, 55, 0.1); padding-top: 25px;">
                        <div v-for="slot in soulJadeSlots" :key="slot.id" :class="['equip-slot', slot.id, { 'active': activeSlot === slot.id }]">
                            <div class="slot-label">{{ slot.name }}</div>
                            <div class="slot-card" @click="handleSlotClick(slot)">
                                <div v-if="slot.id === 'hunyu'" class="slot-badge" style="background: linear-gradient(135deg, #7c3aed, #a78bfa); color: white;">3合魂玉</div>
                                <div v-else-if="slot.id === 'god'" class="slot-badge">6合神靈</div>
                                <div v-else-if="slot.badge" class="slot-badge">{{ slot.badge }}</div>
                                
                                <!-- 副將英雄顯示 -->
                                <template v-if="slot.id === 'rear_hero' || slot.id === 'front_hero'">
                                    <div v-if="selectedEquip[slot.id]" class="full-equip-display">
                                        <img :src="'img/' + getHeroImage(selectedEquip[slot.id])" 
                                             :alt="selectedEquip[slot.id]" 
                                             class="lieutenant-hero-img"
                                             @error="$event.target.src = 'img/unknown.png'">
                                        <div class="slot-item-name lieutenant-name">{{ selectedEquip[slot.id] }}</div>
                                    </div>
                                    <div v-else class="slot-placeholder">
                                        <span class="plus-icon">+</span>
                                    </div>
                                    <div v-if="selectedEquip[slot.id]" 
                                         class="remove-item" 
                                         @click.stop="selectedEquip[slot.id] = null">×</div>
                                </template>

                                <!-- 魂玉顯示 -->
                                <template v-else-if="selectedEquip[slot.id]">
                                    <div class="full-equip-display">
                                        <img :src="'img/' + selectedEquip[slot.id].image" :alt="selectedEquip[slot.id].name" @error="$event.target.src = 'img/unknown.png'">
                                        <div class="slot-item-name">{{ selectedEquip[slot.id].name }}</div>
                                    </div>
                                    <div class="remove-item" @click.stop="selectedEquip[slot.id] = null">×</div>
                                </template>
                                <div v-else class="slot-placeholder">
                                    <span class="plus-icon">+</span>
                                </div>
                            </div>

                            <simulator-popover
                                :show="activeSlot === slot.id"
                                :type="slot.id === 'rear_hero' || slot.id === 'front_hero' ? 'lieutenant' : 'item'"
                                :slot="slot"
                                :modelValue="slot.id === 'rear_hero' || slot.id === 'front_hero' ? heroSearchQuery : slotSearchQuery"
                                @update:modelValue="val => { if (slot.id === 'rear_hero' || slot.id === 'front_hero') heroSearchQuery = val; else slotSearchQuery = val; }"
                                :results="slot.id === 'rear_hero' || slot.id === 'front_hero' ? filteredHeroes : activeSlotItems"
                                :sort-stats="sortStats"
                                :trigger-selector="'.equip-slot.' + slot.id"
                                :calculate-total-stats="calculateTotalStats"
                                :selected-equip="selectedEquip"
                                :hero-state="heroState"
                                @select="(payload) => (slot.id === 'rear_hero' || slot.id === 'front_hero') ? selectHero(payload) : selectItemForSlot(slot.id, payload)"
                                @blur="handleSearchBlur" />
                        </div>
                    </div>

                    <div class="equip-linear-wrapper" style="margin-top: 10px; border-top: 1px solid rgba(212, 175, 55, 0.1); padding-top: 25px;">
                        <div v-for="slot in partialSlots" :key="slot.id" :class="['equip-slot', slot.id, { 'active': activeSlot === slot.id }]">
                            <div class="slot-label">{{ slot.name }}</div>
                            <div class="slot-card" @click="activeSlot = (activeSlot === slot.id ? null : slot.id)">
                                <div class="slot-badge">6合神靈</div>
                                <template v-if="selectedEquip[slot.id] && selectedEquip[slot.id].item">
                                    <div class="full-equip-display">
                                        <img :src="'img/' + selectedEquip[slot.id].item.image" :alt="selectedEquip[slot.id].item.name" @error="$event.target.src = 'img/unknown.png'">
                                        <div class="slot-item-name">{{ selectedEquip[slot.id].item.name }}</div>
                                    </div>
                                    <div class="remove-item" @click.stop="selectedEquip[slot.id] = null">×</div>
                                </template>
                                <div v-else class="slot-placeholder">
                                    <span class="plus-icon">+</span>
                                </div>
                            </div>
                            
                            <simulator-popover
                                 :show="activeSlot === slot.id"
                                 type="partial"
                                 :slot="slot"
                                 v-model="slotSearchQuery"
                                 :results="activeSlotItems"
                                 :sort-stats="sortStats"
                                 :trigger-selector="'.equip-slot.' + slot.id"
                                 :calculate-total-stats="calculateTotalStats"
                                 :selected-equip="selectedEquip"
                                 :hero-state="heroState"
                                 @select="(payload) => selectItemForSlot(slot.id, payload)"
                                 @blur="handleSearchBlur" />
                        </div>
                    </div>
                </div>
            </div>

            <div class="simulator-right-panel">
                <simulator-summary
                    :show="isCompActive"
                    :hero-state="heroState"
                    :selected-equip="selectedEquip"
                    :army-data="allHeroes"
                    :all-skills="astData"
                    :has-items="hasSelectedItems"
                    :get-equipped-items-sync="getEquippedItemsSync"
                    :get-hero-and-lieut-skills-sync="getHeroAndLieutSkillsSync"
                    :get-hero-ast="getHeroAst"
                    :render-segments="renderEffectSegments"
                    :calculate-total-stats="calculateTotalStats" />
            </div>
        </div>
    `
};
