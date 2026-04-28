/**
 * 模擬配裝器組件
 */
const SimulatorComponent = {
    props: ['allItems'],
    setup(props) {
        const { ref, computed, watch, onMounted, onUnmounted, toRef } = Vue;
        const allItems = toRef(props, 'allItems');

        // --- 狀態定義 ---
        const activeSlot = ref(null);
        const slotSearchQuery = ref('');
        const selectedEquip = ref({
            'weapon': null,
            'mount': null,
            'book': null,
            'treasure': null,
            'token': null,
            'hunyu': null,
            'weapon_p': null,
            'mount_p': null,
            'book_p': null,
            'treasure_p': null,
            'token_p': null
        });

        const heroSearchQuery = ref('');
        const showHeroSearch = ref(false);

        const heroState = ref({
            selectedHeroName: '關羽',
            class: '武將',
            identity: '國士',
            gender: '男性',
            isAwakened: false,
            isReincarnated: false,
            fullCategory: ''
        });

        const allHeroes = ref([]);

        // 載入英雄資料
        fetch('data/hero.json').then(res => res.json()).then(data => {
            allHeroes.value = data;
            // 預設選中關羽並同步屬性
            updateHeroAttributes('關羽');
        });

        const filteredHeroes = computed(() => {
            const kw = heroSearchQuery.value.trim().toLowerCase();
            if (!kw) return allHeroes.value;

            return allHeroes.value.filter(h => {
                const haystack = (h.name + ' ' + (h.category || '')).toLowerCase();
                return haystack.includes(kw);
            });
        });

        const selectHero = (name) => {
            heroState.value.selectedHeroName = name;
            updateHeroAttributes(name);
            showHeroSearch.value = false;
            heroSearchQuery.value = '';
        };

        const updateHeroAttributes = (name) => {
            const hero = allHeroes.value.find(h => h.name === name);
            if (!hero) return;

            const cat = hero.category || '';
            heroState.value.fullCategory = cat;

            if (cat.includes('武將')) heroState.value.class = '武將';
            else if (cat.includes('文官')) heroState.value.class = '文官';
            else if (cat.includes('全才')) heroState.value.class = '全才';

            if (cat.includes('傳奇')) heroState.value.identity = '傳奇';
            else if (cat.includes('國士')) heroState.value.identity = '國士';
            else if (cat.includes('巾幗')) heroState.value.identity = '巾幗';
            else if (cat.includes('名將')) heroState.value.identity = '名將';
            else if (cat.includes('良才')) heroState.value.identity = '良才';
            else heroState.value.identity = '無';

            // 從資料庫讀取性別
            heroState.value.gender = hero.gender || '男性';
        };

        const syncGender = () => {
            // 已由 updateHeroAttributes 從資料庫同步，不再強制覆蓋
        };

        const simulatorSlots = [
            { id: 'weapon', name: '神兵' },
            { id: 'mount', name: '坐騎' },
            { id: 'book', name: '寶典' },
            { id: 'treasure', name: '奇珍' },
            { id: 'token', name: '令符' }
        ];

        const soulJadeSlots = [
            { id: 'hunyu', name: '魂玉' }
        ];

        const partialSlots = [
            { id: 'weapon_p', name: '神兵', category: '神兵' },
            { id: 'mount_p', name: '坐騎', category: '坐騎' },
            { id: 'book_p', name: '寶典', category: '寶典' },
            { id: 'treasure_p', name: '奇珍', category: '奇珍' },
            { id: 'token_p', name: '令符', category: '令符' }
        ];

        // --- 輔助函數 ---
        const cleanName = (name) => {
            if (!name) return '';
            return name.replace(/(金色|紫色|品質|套裝|套)/g, '').trim();
        };

        // --- 核心邏輯 ---
        const filteredSlotItems = (slot) => {
            const categoryName = slot.category || slot.name;
            let list = allItems.value;
            if (slot.id === 'hunyu') {
                list = list.filter(item => ['神兵', '坐騎', '寶典', '奇珍', '令符'].includes(item.category));
            } else {
                list = list.filter(item => item.category === categoryName);
            }

            // 神靈插槽限定：僅能選擇具備 5 個詞條的裝備
            if (slot.id && slot.id.endsWith('_p')) {
                list = list.filter(item => item.effects && item.effects.length === 5);
            }

            // 裝備唯一性檢查：排除已經在其他插槽選中的裝備
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
            return list;
        };

        const isSummaryOpen = ref(false);
        const popoverView = ref('items'); // 'items' or 'effects'
        const pendingItem = ref(null);

        // 監聽 activeSlot 變化，每次打開新插槽都重置彈窗狀態
        watch(activeSlot, (newVal) => {
            if (newVal) {
                popoverView.value = 'items';
                pendingItem.value = null;
            }
        });

        const isPopoverUpwards = (slotId) => {
            const el = document.querySelector(`.equip-slot.${slotId}`);
            if (!el) return slotId.endsWith('_p');
            const rect = el.getBoundingClientRect();
            return (window.innerHeight - rect.bottom) < 350;
        };

        const getPopoverStyle = (slotId) => {
            const el = document.querySelector(`.equip-slot.${slotId}`);
            if (!el) return {};

            const rect = el.getBoundingClientRect();
            const popoverWidth = 280;
            const screenWidth = window.innerWidth;

            let left = '50%';
            let transform = 'translateX(-50%)';
            let arrowLeft = '50%';

            const expectedLeft = rect.left + rect.width / 2 - popoverWidth / 2;
            const expectedRight = rect.left + rect.width / 2 + popoverWidth / 2;

            if (expectedLeft < 15) {
                left = `-${rect.left - 15}px`;
                transform = 'none';
                arrowLeft = `${rect.width / 2 + (rect.left - 15)}px`;
            } else if (expectedRight > screenWidth - 15) {
                const rightDist = screenWidth - rect.right;
                left = 'auto';
                const rightPos = `-${rightDist - 15}px`;
                arrowLeft = `${popoverWidth - (rect.width / 2 + rightDist - 15)}px`;

                // 計算可用空間，防止彈窗超出螢幕
                const isUp = isPopoverUpwards(slotId);
                const availableSpace = isUp ? (rect.top - 20) : (window.innerHeight - rect.bottom - 20);
                const maxH = Math.max(250, Math.min(450, availableSpace));

                return {
                    left: 'auto',
                    right: rightPos,
                    transform: 'none',
                    '--arrow-left': arrowLeft,
                    maxHeight: `${maxH}px`,
                    minHeight: `${Math.min(320, maxH)}px`
                };
            }

            // 計算可用空間，防止彈窗超出螢幕
            const isUp = isPopoverUpwards(slotId);
            const availableSpace = isUp ? (rect.top - 20) : (window.innerHeight - rect.bottom - 20);
            const maxH = Math.max(250, Math.min(450, availableSpace));

            return {
                left,
                transform,
                '--arrow-left': arrowLeft,
                maxHeight: `${maxH}px`,
                minHeight: `${Math.min(320, maxH)}px`
            };
        };


        const selectItemForSlot = (slotId, item) => {
            if (slotId.endsWith('_p')) {
                // 神靈插槽：進入第二層選擇詞條
                pendingItem.value = item;
                popoverView.value = 'effects';
            } else {
                selectedEquip.value[slotId] = item;
                activeSlot.value = null;
                slotSearchQuery.value = '';
                if (typeof hideItemPreview === 'function') hideItemPreview(true);
            }
        };

        const backToItems = () => {
            popoverView.value = 'items';
            pendingItem.value = null;
        };

        const selectPartialEffect = (slotId, idx) => {
            if (pendingItem.value && slotId.endsWith('_p')) {
                selectedEquip.value[slotId] = {
                    item: pendingItem.value,
                    effectIdx: idx
                };
                // 完成選定
                activeSlot.value = null;
                slotSearchQuery.value = '';
                popoverView.value = 'items';
                pendingItem.value = null;
                if (typeof hideItemPreview === 'function') hideItemPreview(true);
            }
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

        const getEquippedItems = () => {
            const items = [];
            Object.entries(selectedEquip.value).forEach(([key, val]) => {
                if (!val) return;
                if (key.endsWith('_p')) {
                    if (val.item && val.effectIdx >= 0) {
                        items.push({
                            ...val.item,
                            effects: [val.item.effects[val.effectIdx]],
                            isPartial: true,
                            parentName: val.item.name
                        });
                    }
                } else {
                    items.push(val);
                }
            });
            return items;
        };

        const combinedEffects = computed(() => {
            const result = {};
            Object.entries(selectedEquip.value).forEach(([key, val]) => {
                if (!val) return;
                if (key.endsWith('_p')) {
                    if (val && val.item) {
                        const effText = val.effectIdx >= 0
                            ? val.item.effects[val.effectIdx]
                            : '（未選定詞條）';
                        result[val.item.name] = [effText];
                    }
                } else {
                    if (val.effects && val.effects.length) {
                        result[val.name] = val.effects;
                    }
                }
            });
            return result;
        });

        const checkSegment = (segment, sourceItemName = null) => {
            if (!segment || typeof segment !== 'string') return true;

            const equippedItems = getEquippedItems();
            // 件數與品質判定：神靈插槽也會被計入
            let mainEquippedItems = [...equippedItems];

            // 【特殊規則】：作為「第 6 件」的裝備（通常是魂玉或特殊位），其「裝備5件金色品質」判定不包含自己
            // 這樣穿滿 6 件時（自己+其他5件），扣除自己後剛好滿足「5件」的完全體判定
            if (segment.includes('裝備5件金色品質') && sourceItemName) {
                mainEquippedItems = mainEquippedItems.filter(item => item.name !== sourceItemName);
            }

            const totalEquipped = mainEquippedItems.length;
            const goldCount = mainEquippedItems.filter(item => item.name && !item.name.includes('紫色')).length;
            const equippedNames = new Set(equippedItems.map(i => i.name));

            const setCounts = {};
            mainEquippedItems.forEach(item => {
                if (item.sets) {
                    item.sets.split(' ').forEach(s => { if (s.trim()) setCounts[s.trim()] = (setCounts[s.trim()] || 0) + 1; });
                }
            });

            // 件數觸發檢查 (支援「裝備5件XXX套」、「裝備5件金色品質」或「裝備5件金色品質祖龍套」)
            const countMatch = segment.match(/裝備\s*(\d+)\s*件(金色品質)?\s*(.+?)(?:套|時|$)/);
            if (countMatch) {
                const required = parseInt(countMatch[1]);
                const isGoldReq = !!countMatch[2];
                const rawSetName = countMatch[3].trim();
                const cleanedRequiredSet = cleanName(rawSetName);

                let currentCount = 0;
                // 如果指定了套裝名稱（例如：祖龍）
                if (cleanedRequiredSet && cleanedRequiredSet !== '金色' && cleanedRequiredSet !== '品質') {
                    Object.keys(setCounts).forEach(s => {
                        if (cleanName(s).includes(cleanedRequiredSet) || cleanedRequiredSet.includes(cleanName(s))) {
                            currentCount = setCounts[s];
                        }
                    });
                } else if (isGoldReq) {
                    // 如果只說「5件金色品質」，則統計所有金色裝備
                    currentCount = goldCount;
                }

                if (required === 5) {
                    // 傳統 5 件套判定 (包含 4+1 特效)
                    if (currentCount >= 4 && totalEquipped === 5 && !isGoldReq) return true;
                    // 金色品質 5 件判定
                    if (currentCount >= 5) return true;
                }

                if (required === 6) {
                    // 6 件套判定
                    if (currentCount >= 6) return true;
                }

                if (currentCount < required) return false;
            }

            // 特定裝備配對檢查 (支援「同時裝備」與「必須含有」等敘述)
            const pairMatch = segment.match(/(?:同時裝備|必須含有)\s*(?:【)?([^，；。）】]+)(?:】)?/);
            if (pairMatch) {
                const requiredItem = pairMatch[1].trim();
                // 如果字串中包含「件」，可能是「必須含有2件」之類的誤判，將其跳過交給件數判定
                if (!requiredItem.includes('件') && !equippedNames.has(requiredItem)) {
                    return false;
                }
            }

            // 英雄屬性條件檢查 (排除針對敵方或戰鬥情境的條件)
            const heroCheck = (kw, cond) => {
                if (!segment.includes(kw)) return false;

                // 精確判定：這是一個身分要求（如：男性裝備時、攜帶弓兵）還是戰鬥情境
                // 如果關鍵字後面跟著「裝備時」，或者我方「攜帶/帶領」，則視為身分要求
                // 注意：排除「敵方攜帶」、「敵方未攜帶」等針對對手的判定，以及「我方」整體判定
                const isHeroRequirement = (new RegExp(`${kw}.*裝備時`).test(segment) || 
                                          segment.includes('攜帶' + kw) || 
                                          segment.includes('帶領' + kw)) && 
                                          !segment.includes('敵方') && 
                                          !segment.includes('敵軍') &&
                                          !segment.includes('我方');
                
                // 針對「性別」與「身分」類關鍵字，縮小戰鬥情境的判定範圍
                const isIdentityKw = /男性|女性|傳奇|國士|巾幗|名將|良才/.test(kw);
                let isBattleOrStat = false;

                if (isIdentityKw) {
                    // 身分類關鍵字：
                    // 1. 如果關鍵字是「男性」，且有「受到」，代表是敵方性別，視為戰鬥情境
                    // 2. 如果是「對、針對、敵方」等字眼，一律視為戰鬥情境
                    const isEnemyGender = (kw === '男性' && segment.includes('受到' + kw)) || 
                                         (kw === '女性' && (segment.includes('對' + kw) || segment.includes('對陣' + kw))); // 對女性/對陣女性
                    
                    isBattleOrStat = isEnemyGender || new RegExp(`(?:對|針對|對戰|對陣|面對|敵方|敵軍)${kw}`).test(segment);
                } else {
                    // 兵種或其他關鍵字：維持較廣的判定（包含「受到」或「關鍵字+屬性」）
                    isBattleOrStat = !isHeroRequirement && (
                        new RegExp(`(?:對|受到|針對|對戰|對陣|面對|敵方|敵軍)${kw}|${kw}.*(?:傷害|免傷|攻擊|防禦|兵力|速度|武力|智力|魅力|統御|格擋|保全|士兵|標記|抗性|狀態|幾率|機率)`).test(segment) ||
                        segment.includes('敵方') || segment.includes('敵軍')
                    );
                }

                if (isHeroRequirement) {
                    // 如果明確是身分要求（裝備時），則忽略所有戰鬥情境判定，強制進行身分檢查
                    return !cond;
                }

                if (isBattleOrStat) return false;

                // 處理「非XXX」的情況 (例如：非女性英雄)
                if (segment.includes('非' + kw) || segment.includes('不為' + kw)) {
                    return cond; 
                }

                // 兵力、血量等戰鬥狀態條件預設達成
                if (/兵力|血量|不足|低於|少於|超過|高於/.test(segment)) return false;

                // 如果是身分要求但條件不符，回傳 true 讓外層返回 false
                return !cond;
            };

            if (heroCheck('傳奇英雄', heroState.value.identity === '傳奇')) return false;
            if (heroCheck('國士英雄', heroState.value.identity === '國士')) return false;
            if (heroCheck('女性', heroState.value.gender === '女性')) return false;
            if (heroCheck('男性', heroState.value.gender === '男性')) return false;
            if (heroCheck('巾幗', heroState.value.gender === '女性')) return false;
            if (heroCheck('騎兵', heroState.value.fullCategory.includes('騎兵'))) return false;
            if (heroCheck('弓兵', heroState.value.fullCategory.includes('弓兵'))) return false;
            if (heroCheck('步兵', heroState.value.fullCategory.includes('步兵'))) return false;
            if (heroCheck('方士', heroState.value.fullCategory.includes('方士'))) return false;
            // 職業條件檢查 (支援「文官或全才」、「武將/全才」等組合)
            // 優先處理「不為/非」的否定判定
            const notClassMatch = segment.match(/(?:不為|非|不是)(武將|文官|全才)/);
            if (notClassMatch) {
                if (heroState.value.class === notClassMatch[1]) return false;
            } else {
                // 如果片段中包含「對...」、「對戰...」、「敵方...」(且非針對自身)，視為戰鬥條件，預設生效
                const isBattleCondition = /(對|對戰|受到|針對|面對|敵方|敵軍)(武將|文官|全才)/.test(segment);
                
                if (!isBattleCondition) {
                    const classesInSegment = [];
                    if (segment.includes('文官')) classesInSegment.push('文官');
                    if (segment.includes('全才')) classesInSegment.push('全才');
                    if (segment.includes('武將')) classesInSegment.push('武將');
                    
                    if (classesInSegment.length > 0) {
                        // 如果字串中提到了職業要求，目前武將必須屬於其中之一
                        if (!classesInSegment.includes(heroState.value.class)) return false;
                    }
                }
            }

            // 特定英雄名稱檢查
            const nameMatch = segment.match(/(.+?)裝備時/);
            if (nameMatch) {
                const requiredHero = nameMatch[1].trim();
                // 排除職業關鍵字、性別、覺醒、輪迴等狀態詞，避免誤判為英雄姓名
                const isClassKeyword = /文官|全才|武將|男性|女性|巾幗/.test(requiredHero);
                if (!isClassKeyword && !requiredHero.includes('已輪迴') && !requiredHero.includes('已覺醒')) {
                    if (!requiredHero.includes(heroState.value.selectedHeroName)) return false;
                }
            }

            // 覺醒/輪迴檢查
            if (segment.includes('已覺醒') || segment.includes('覺醒英雄')) {
                if (!heroState.value.isAwakened) return false;
            }
            if (segment.includes('已輪迴') || segment.includes('輪迴英雄')) {
                if (!heroState.value.isReincarnated) return false;
            }

            // 英雄等級與品質條件預設達成 (假設玩家英雄已滿配)
            if (segment.includes('英雄等級達到') || segment.includes('品質達到金色')) {
                return true;
            }

            return true;
        };

        const isEffectActive = (eff, sourceItemName = null) => {
            if (typeof eff !== 'string') return true;
            // 智能分割：先確保後面整段不含戰鬥關鍵字（受到/對/敵方），才允許在逗號處切分身分要求
            const segments = eff.split(/；|;|(?:，|,)(?![^；;]*(?:受到|對|敵方|敵軍))(?=[^；;]*(?:裝備時|每裝備|品質達到|身份|等級|武將|文官|全才|男性|女性))/);
            return segments.some(seg => checkSegment(seg, sourceItemName));
        };

        const statAggregation = computed(() => {
            const totals = {};
            // 終極正則：支援各種排列組合與符號，並容忍空格
            const regex = /(前軍|後軍|全軍|步兵|騎兵|弓兵|方士)?\s*(?:(武力|統御|智力|魅力|基礎攻擊|基礎防禦|攻擊|防禦|兵力|速度|傷害|免傷)\s*(額外)?\s*([+-]?\s*\d+)(點|%|)|([+-]?\s*\d+)(點|%|)\s*(武力|統御|智力|魅力|基礎攻擊|基礎防禦|攻擊|防禦|兵力|速度|傷害|免傷))/g;

            const equippedItems = getEquippedItems();

            const totalEquipped = equippedItems.length;
            const goldCount = equippedItems.filter(item => item.name && !item.name.includes('紫色')).length;
            const equippedNames = new Set(equippedItems.map(i => i.name));
            const setCounts = {};
            equippedItems.forEach(item => {
                if (item.sets) {
                    item.sets.split(' ').forEach(s => { if (s.trim()) setCounts[s.trim()] = (setCounts[s.trim()] || 0) + 1; });
                }
            });

            const processedSetEffects = new Set();

            const setMultipliers = {};
            equippedItems.forEach(item => {
                if (!item.effects) return;
                item.effects.forEach((eff) => {
                    if (typeof eff !== 'string' || !checkSegment(eff, item.name)) return;
                    const m = eff.match(/使其他(.+?)套的(白色|綠色|藍色)屬性加成翻倍/);
                    if (m) {
                        const setName = cleanName(m[1]);
                        const color = m[2];
                        if (!setMultipliers[setName]) setMultipliers[setName] = [1, 1, 1, 1, 1];
                        const targetIdx = color === '白色' ? 0 : (color === '綠色' ? 1 : 2);
                        setMultipliers[setName][targetIdx] = 2;
                    }
                });
            });

            equippedItems.forEach(item => {
                if (item.effects) {
                    const itemSetName = cleanName(item.sets || '');
                    item.effects.forEach((eff, effIdx) => {
                        if (typeof eff !== 'string') return;

                        let currentSetMultiplier = 1;
                        Object.keys(setMultipliers).forEach(sName => {
                            if (itemSetName.includes(sName)) {
                                currentSetMultiplier = setMultipliers[sName][effIdx] || 1;
                            }
                        });

                        const parts = eff.split(/；|;|(?:，|,)(?![^；;]*(?:受到|對|敵方|敵軍))(?=[^；;]*(?:裝備時|每裝備|品質達到|身份|等級|武將|文官|全才|男性|女性))/).filter(p => p.trim());

                        parts.forEach(part => {
                            // 處理「分別獲得」邏輯 (例如：武將/文官/全才裝備時，分別獲得武力+3/智力+3/統御+3)
                            if (part.includes('分別') && part.includes('/')) {
                                const classMatch = part.match(/(.+?)\s*裝備時/);
                                if (classMatch) {
                                    const classList = classMatch[1].split('/');
                                    const idx = classList.indexOf(heroState.value.class);
                                    if (idx !== -1) {
                                        // 找到對應職業的屬性
                                        const effectMatch = part.match(/分別獲得\s*(.+)$/);
                                        if (effectMatch) {
                                            const effectList = effectMatch[1].split('/');
                                            if (effectList[idx]) part = effectList[idx];
                                            else return; 
                                        }
                                    } else {
                                        return; // 職業不匹配
                                    }
                                }
                            }

                            if (!checkSegment(part, item.name)) return;

                            const cnToNum = (s) => {
                                const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
                                return map[s] || parseInt(s) || 1;
                            };

                            const stackMatch = part.match(/每裝備\s*(\d+|一|二|三|四|五|六)\s*件\s*(.+?)套/);
                            const listStackMatch = part.match(/在\s*(.+?)\s*中每裝備\s*(\d+|一|二|三|四|五|六)\s*件/);

                            let multiplier = 1;
                            if (stackMatch) {
                                if (processedSetEffects.has(part)) return;
                                processedSetEffects.add(part);
                                const unit = cnToNum(stackMatch[1]);
                                const cleanedStackSet = cleanName(stackMatch[2]);
                                let currentCount = 0;
                                Object.keys(setCounts).forEach(s => {
                                    if (cleanName(s).includes(cleanedStackSet) || cleanedStackSet.includes(cleanName(s))) currentCount = setCounts[s];
                                });
                                multiplier = Math.floor(currentCount / unit);
                            } else if (listStackMatch) {
                                if (processedSetEffects.has(part)) return;
                                processedSetEffects.add(part);
                                const itemsInList = (listStackMatch[1].match(/【(.+?)】/g) || []).map(m => m.replace(/[【】]/g, '').trim());
                                let currentCount = 0;
                                itemsInList.forEach(name => { if (equippedNames.has(name)) currentCount++; });
                                multiplier = Math.floor(currentCount / cnToNum(listStackMatch[2]));
                            }

                            if (multiplier <= 0) return;

                            const eachRegex = /([武力|智力|魅力|統御|四維|基礎攻擊|基礎防禦|攻擊|防禦|兵力|速度|傷害|免傷|、\s]+)各\s*([+-]\s*\d+)(%?)/g;
                            let em;
                            while ((em = eachRegex.exec(part)) !== null) {
                                let stats = em[1].split(/[、\s]+/).filter(Boolean);
                                // 如果包含「四維」，展開為四個具體屬性
                                if (stats.includes('四維')) {
                                    stats = stats.filter(s => s !== '四維');
                                    stats.push('武力', '智力', '統御', '魅力');
                                }
                                const val = parseInt(em[2].replace(/\s+/g, '')) * multiplier * currentSetMultiplier;
                                const isPercent = em[3] === '%';
                                stats.forEach(s => {
                                    const key = s + (isPercent ? '%' : '');
                                    totals[key] = (totals[key] || 0) + val;
                                });
                            }

                            regex.lastIndex = 0;
                            let m;
                            while ((m = regex.exec(part)) !== null) {
                                // 判斷是哪種格式抓到的
                                const statName = (m[1] || '') + (m[2] || m[8]);
                                const rawVal = m[4] || m[6];
                                const unit = m[5] || m[7];
                                
                                if (statName && rawVal) {
                                    const val = parseInt(rawVal.replace(/\s+/g, '')) * multiplier * currentSetMultiplier;
                                    const isPercent = unit === '%';
                                    const key = statName + (isPercent ? '%' : '');
                                    totals[key] = (totals[key] || 0) + val;
                                }
                            }
                        });
                    });
                }
            });

            // 確保四維屬性始終以固定順序呈現，沒有加成則顯示 0
            const siweiOrder = ['武力', '智力', '魅力', '統御'];
            const finalTotals = {};
            
            siweiOrder.forEach(k => {
                finalTotals[k] = totals[k] || 0;
            });
            
            return finalTotals;

        });

        const allSets = computed(() => {
            const setMap = {};
            const list = allItems.value || [];
            list.forEach(item => {
                if (item.sets) {
                    item.sets.split(/\s+/).forEach(s => {
                        const trimmed = s.trim();
                        if (trimmed) setMap[trimmed] = true;
                    });
                }
            });
            return Object.keys(setMap).sort((a, b) => a.localeCompare(b, 'zh-TW'));
        });



        const applySet = (setName) => {
            if (!setName) {
                Object.keys(selectedEquip.value).forEach(k => {
                    if (!k.endsWith('_p')) selectedEquip.value[k] = null;
                });
                return;
            }

            const list = allItems.value || [];
            const setItems = list.filter(item => {
                if (!item.sets) return false;
                return item.sets.split(/\s+/).includes(setName);
            });

            if (setItems.length === 0) return;

            Object.keys(selectedEquip.value).forEach(k => {
                if (!k.endsWith('_p')) selectedEquip.value[k] = null;
            });
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

        const handleClickOutside = (e) => {
            if (activeSlot.value) {
                const isPopover = e.target.closest('.slot-search-popover');
                const isSlot = e.target.closest('.equip-slot');
                if (!isPopover && !isSlot) {
                    activeSlot.value = null;
                    slotSearchQuery.value = '';
                }
            }
            if (showHeroSearch.value) {
                const isHeroPopover = e.target.closest('.hero-search-popover');
                const isHeroTrigger = e.target.closest('.current-hero-display');
                if (!isHeroPopover && !isHeroTrigger) {
                    showHeroSearch.value = false;
                    heroSearchQuery.value = '';
                }
            }
        };

        const hashCode = (str) => {
            if (!str) return 0;
            let hash = 5381;
            for (let i = 0; i < str.length; i++) {
                hash = (hash * 33) ^ str.charCodeAt(i);
            }
            return hash >>> 0;
        };

        const compress = (config) => {
            const slotOrder = ['weapon', 'mount', 'book', 'treasure', 'token', 'hunyu', 'weapon_p', 'mount_p', 'book_p', 'treasure_p', 'token_p'];
            const bytes = [];
            
            // 1. 英雄 (24-bit / 3 bytes)
            const hHash = hashCode(config.h) & 0xFFFFFF;
            bytes.push((hHash >> 16) & 0xFF, (hHash >> 8) & 0xFF, hHash & 0xFF);
            
            // 2. 狀態 (1 byte)
            bytes.push(config.s & 0xFF);

            // 3. 裝備
            slotOrder.forEach(slotId => {
                const val = config.e[slotId];
                if (!val) {
                    const skip = slotId === 'hunyu' ? 3 : 2;
                    for (let i = 0; i < skip; i++) bytes.push(0);
                    if (slotId.endsWith('_p')) bytes.push(0);
                } else {
                    const itemName = typeof val === 'string' ? val : (val.item ? val.item.name : val.n);
                    
                    if (slotId === 'hunyu') {
                        const iHash = hashCode(itemName) & 0xFFFFFF;
                        bytes.push((iHash >> 16) & 0xFF, (iHash >> 8) & 0xFF, iHash & 0xFF);
                    } else {
                        const iHash = hashCode(itemName) & 0xFFFF;
                        bytes.push((iHash >> 8) & 0xFF, iHash & 0xFF);
                    }
                    
                    if (slotId.endsWith('_p')) {
                        const idx = val.effectIdx !== undefined ? val.effectIdx : (val.i || 0);
                        bytes.push((idx + 1) & 0xFF);
                    }
                }
            });

            return btoa(String.fromCharCode(...bytes));
        };

        const decompress = (encoded, heroes, items) => {
            const binary = atob(encoded);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            
            const slotOrder = ['weapon', 'mount', 'book', 'treasure', 'token', 'hunyu', 'weapon_p', 'mount_p', 'book_p', 'treasure_p', 'token_p'];
            const catMap = { '神兵': 'weapon', '坐騎': 'mount', '寶典': 'book', '奇珍': 'treasure', '令符': 'token' };
            const scopedMaps = { hero: {}, weapon: {}, mount: {}, book: {}, treasure: {}, token: {}, allEquip: {} };

            // 使用傳入的資料建立查找表
            (heroes || []).forEach(h => scopedMaps.hero[hashCode(h.name) & 0xFFFFFF] = h.name);
            (items || []).forEach(i => {
                const h16 = hashCode(i.name) & 0xFFFF;
                const h24 = hashCode(i.name) & 0xFFFFFF;
                const mappedCat = catMap[i.category]; 
                if (mappedCat) {
                    if (!scopedMaps[mappedCat]) scopedMaps[mappedCat] = {};
                    scopedMaps[mappedCat][h16] = i; 
                }
                scopedMaps.allEquip[h24] = i; 
            });

            const config = { h: null, s: 0, e: {} };
            let p = 0;
            
            const hHash = (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
            if (hHash !== 0) config.h = scopedMaps.hero[hHash] || null;
            config.s = bytes[p++];
            
            slotOrder.forEach(slotId => {
                const iHash = slotId === 'hunyu' 
                    ? (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++]
                    : (bytes[p++] << 8) | bytes[p++];
                    
                if (iHash !== 0) {
                    if (slotId === 'hunyu') {
                        config.e[slotId] = scopedMaps.allEquip[iHash];
                    } else if (slotId.endsWith('_p')) {
                        const effIdx = bytes[p++];
                        const cat = slotId.replace('_p', '');
                        const item = scopedMaps[cat] ? scopedMaps[cat][iHash] : scopedMaps.allEquip[iHash];
                        if (item) config.e[slotId] = { item, effectIdx: effIdx - 1 };
                    } else {
                        const cat = slotId;
                        config.e[slotId] = scopedMaps[cat] ? scopedMaps[cat][iHash] : scopedMaps.allEquip[iHash];
                    }
                } else if (slotId.endsWith('_p')) {
                    p++;
                }
            });
            
            return config;
        };


        const loadConfig = (config) => {
            if (!config) return;
            if (config.h) {
                heroState.value.selectedHeroName = config.h;
                updateHeroAttributes(config.h);
            }
            const status = config.s || 0;
            heroState.value.isAwakened = !!(status & 1);
            heroState.value.isReincarnated = !!(status & 2);
            if (config.e) {
                Object.entries(config.e).forEach(([slotId, data]) => {
                    if (data) selectedEquip.value[slotId] = JSON.parse(JSON.stringify(data));
                    else selectedEquip.value[slotId] = null;
                });
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

            const checkAndLoad = () => {
                // 從 URL search 或 hash 中提取 c 參數
                let encoded = '';
                const hash = window.location.hash;
                const search = window.location.search;
                
                // 先嘗試從 hash 提取 (優先級較高，且需手動處理 + 號問題)
                const hashMatch = hash.match(/[?&]c=([^&]+)/);
                if (hashMatch) {
                    encoded = hashMatch[1];
                } else {
                    // 再嘗試從 search 提取
                    const searchParams = new URLSearchParams(search);
                    encoded = searchParams.get('c');
                    // 如果是從 URLSearchParams 拿到的，要把空格轉回 + (因為 URLSearchParams 會自動轉換)
                    if (encoded) encoded = encoded.replace(/ /g, '+');
                }

                if (encoded) {
                    const target = decodeURIComponent(encoded);
                    let unwatch;
                    unwatch = watch(
                        [() => props.allItems, allHeroes], 
                        ([items, heroes]) => {
                            if (items && items.length > 0 && heroes && heroes.length > 0) {
                                try {
                                    const config = decompress(target, heroes, items);
                                    loadConfig(config);
                                } catch (e) {}
                                if (unwatch) unwatch();
                            }
                        }, 
                        { immediate: true, deep: true }
                    );
                }
            };

            checkAndLoad();
        });

        onUnmounted(() => {
            window.removeEventListener('mousedown', handleClickOutside, true);
        });

        return {
            activeSlot, slotSearchQuery, selectedEquip, simulatorSlots,
            filteredSlotItems, selectItemForSlot, handleSearchBlur,
            clearAllEquip, hasSelectedItems, combinedEffects,
            statAggregation, allSets, applySet, isEffectActive,
            heroState, syncGender,
            renderEffectSegments(eff, sourceItemName = null) {
                if (typeof eff !== 'string') return [{ text: eff, active: true }];
                // 智能分割並連動判定：確保戰鬥情境不被拆散
                const segments = eff.split(/(；|;|[，,](?![^；;]*(?:受到|對|敵方|敵軍))(?=[^；;]*(?:裝備時|每裝備|品質達到|身份|等級|武將|文官|全才|男性|女性)))/);
                const result = [];
                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];
                    if (seg === '；' || seg === ';' || seg === '，' || seg === ',') {
                        if (result.length > 0 && result[result.length - 1].hidden) continue;
                        result.push({ text: seg, active: true });
                    } else if (seg.trim()) {
                        // 只有當整段文字僅包含品質說明，且沒有具體屬性加成時才隱藏
                        const isGoldTag = seg.includes('品質達到金色') && !seg.includes('+') && !seg.includes('傷害') && !seg.includes('兵力');
                        result.push({
                            text: seg,
                            active: isEffectActive(seg, sourceItemName),
                            hidden: isGoldTag
                        });
                    }
                }
                return result.filter(r => !r.hidden);
            },
            allHeroes, updateHeroAttributes,
            heroSearchQuery, showHeroSearch, filteredHeroes, selectHero,
            isPopoverUpwards, getPopoverStyle,
            isSummaryOpen,
            soulJadeSlots, partialSlots,
            selectPartialEffect, popoverView, pendingItem, backToItems,
            shareConfig() {
                const config = {
                    h: heroState.value.selectedHeroName,
                    s: (heroState.value.isAwakened ? 1 : 0) | (heroState.value.isReincarnated ? 2 : 0),
                    e: {}
                };

                Object.entries(selectedEquip.value).forEach(([k, v]) => {
                    if (!v) return;
                    if (k.endsWith('_p')) {
                        config.e[k] = { n: v.item.name, i: v.effectIdx };
                    } else {
                        config.e[k] = v.name;
                    }
                });
                
                try {
                    const encoded = compress(config);
                    // 取得不含參數的基礎路徑
                    const baseUrl = window.location.origin + window.location.pathname;
                    const shareUrl = `${baseUrl}#sim?c=${encoded}`;
                    
                    // 備援機制：如果無法使用剪貼簿 API (如 Android 無痕模式)，則改用 prompt
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(shareUrl).then(() => {
                            alert('配置連結已複製到剪貼簿！');
                        }).catch(() => {
                            window.prompt('複製失敗，請手動複製下方連結：', shareUrl);
                        });
                    } else {
                        window.prompt('您的瀏覽器不支援自動複製，請手動複製下方連結：', shareUrl);
                    }
                } catch (e) {
                    console.error('分享失敗', e);
                    alert('分享失敗，請稍後再試。');
                }
            }
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
                                <div class="current-hero-display" @click="showHeroSearch = !showHeroSearch">
                                    {{ heroState.selectedHeroName || '請選擇英雄' }}
                                    <i class="fas fa-chevron-down"></i>
                                </div>
                                <div v-if="showHeroSearch" class="hero-search-popover">
                                    <input type="text" v-model="heroSearchQuery" placeholder="搜尋名稱或標籤 (如: 傳奇, 巾幗)..." autofocus @blur="setTimeout(() => showHeroSearch = false, 200)">
                                    <div class="hero-results-list">
                                        <div v-for="h in filteredHeroes" :key="h.name" class="hero-result-item" @mousedown="selectHero(h.name)">
                                            <span class="hero-result-name">{{ h.name }}</span>
                                            <span class="hero-result-tags">({{ h.category }})</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="control-group" style="margin-left: 10px;">
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
                            <div class="slot-card" @click="activeSlot = (activeSlot === slot.id ? null : slot.id)">
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
                            
                            <div v-if="activeSlot === slot.id" :class="['slot-search-popover', { 'upwards': isPopoverUpwards(slot.id) }]" :style="getPopoverStyle(slot.id)">
                                <input type="text" v-model="slotSearchQuery" :placeholder="'搜尋' + slot.name + '...'" autofocus @blur="handleSearchBlur">
                                <div class="search-results-list">
                                    <div v-for="item in filteredSlotItems(slot)" :key="item.name" 
                                         class="search-result-item" 
                                         @mousedown="selectItemForSlot(slot.id, item)">
                                        <img :src="'img/' + item.image" alt="" @error="$event.target.src = 'img/unknown.png'">
                                        <span>{{ item.name }}</span>
                                    </div>
                                    <div v-if="filteredSlotItems(slot).length === 0" class="no-results">無相符結果</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="equip-linear-wrapper" style="margin-top: 10px; border-top: 1px solid rgba(212, 175, 55, 0.1); padding-top: 25px;">
                        <div v-for="slot in soulJadeSlots" :key="slot.id" :class="['equip-slot', slot.id, { 'active': activeSlot === slot.id }]">
                            <div class="slot-label">{{ slot.name }}</div>
                            <div class="slot-card" @click="activeSlot = (activeSlot === slot.id ? null : slot.id)" style="border-style: dashed; background: rgba(100, 80, 255, 0.05); border-color: rgba(100, 80, 255, 0.3);">
                                <div class="slot-badge" style="background: linear-gradient(135deg, #7c3aed, #a78bfa); color: white;">3合魂玉</div>
                                <template v-if="selectedEquip[slot.id]">
                                    <div class="full-equip-display">
                                        <img :src="'img/' + selectedEquip[slot.id].image" :alt="selectedEquip[slot.id].name" @error="$event.target.src = 'img/unknown.png'">
                                        <div class="slot-item-name">{{ selectedEquip[slot.id].name }}</div>
                                    </div>
                                    <div class="remove-item" @click.stop="selectedEquip[slot.id] = null">×</div>
                                </template>
                                <div v-else class="slot-placeholder">
                                    <span class="plus-icon" style="color: rgba(100, 80, 255, 0.4);">+</span>
                                </div>
                            </div>
                            
                            <div v-if="activeSlot === slot.id" :class="['slot-search-popover', { 'upwards': isPopoverUpwards(slot.id) }]" :style="getPopoverStyle(slot.id)">
                                <input type="text" v-model="slotSearchQuery" :placeholder="'搜尋所有裝備...'" autofocus @blur="handleSearchBlur">
                                <div class="search-results-list">
                                    <div v-for="item in filteredSlotItems(slot)" :key="item.name" 
                                         class="search-result-item" 
                                         @mousedown="selectItemForSlot(slot.id, item)">
                                        <img :src="'img/' + item.image" alt="" @error="$event.target.src = 'img/unknown.png'">
                                        <span>{{ item.name }}</span>
                                        <span style="font-size: 0.7rem; opacity: 0.5; margin-left: auto;">{{ item.category }}</span>
                                    </div>
                                    <div v-if="filteredSlotItems(slot).length === 0" class="no-results">無相符結果</div>
                                </div>
                            </div>
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
                            
                            <div v-if="activeSlot === slot.id" 
                                 :class="['slot-search-popover', { 'upwards': isPopoverUpwards(slot.id) }]"
                                 :style="getPopoverStyle(slot.id)">
                                <div class="popover-viewport">
                                    <div class="popover-track" :class="{ 'slide-effects': popoverView === 'effects' }">
                                        <div class="popover-layer items-layer">
                                            <input type="text" v-model="slotSearchQuery" :placeholder="'搜尋' + slot.category + '...'" autofocus @blur="handleSearchBlur">
                                            <div class="search-results-list">
                                                <div v-for="item in filteredSlotItems(slot)" :key="item.name" 
                                                     class="search-result-item" 
                                                     @mousedown="selectItemForSlot(slot.id, item)">
                                                    <img :src="'img/' + item.image" alt="" @error="$event.target.src = 'img/unknown.png'">
                                                    <span>{{ item.name }}</span>
                                                </div>
                                                <div v-if="filteredSlotItems(slot).length === 0" class="no-results">無相符結果</div>
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
                                                     @click="selectPartialEffect(slot.id, idx)">
                                                    <span class="eff-idx">{{ idx + 1 }}</span>
                                                    <span class="eff-text">{{ eff }}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <button class="mobile-summary-toggle" @click="isSummaryOpen = !isSummaryOpen">
                <i :class="isSummaryOpen ? 'fas fa-times' : 'fas fa-chart-bar'"></i>
                {{ isSummaryOpen ? '關閉彙總' : '查看屬性' }}
            </button>

            <div class="summary-overlay" :class="{ 'show': isSummaryOpen }" @click="isSummaryOpen = false"></div>

            <div class="simulator-summary" :class="{ 'mobile-open': isSummaryOpen }">
                <div class="summary-header">
                    屬性彙總
                </div>
                <div class="summary-content">
                    <template v-if="hasSelectedItems">
                        <div class="summary-group aggregated-stats">
                            <div class="summary-item-title" style="color: var(--primary-gold); border-bottom: 1px solid rgba(212,175,55,0.3); padding-bottom: 5px;">Σ 四維加總</div>
                            <div class="stats-grid">
                                <div v-for="(val, stat) in statAggregation" :key="stat" class="stat-pill">
                                    <span class="stat-name">{{ stat }}</span>
                                    <span class="stat-value" :class="{ 'pos': val > 0, 'neg': val < 0 }">{{ val > 0 ? '+' + val : val }}</span>
                                </div>
                            </div>
                            <div v-if="Object.keys(statAggregation).length === 0" class="no-stats-hint">（無可量化屬性）</div>
                        </div>

                        <!-- 裝備詳細清單 -->
                        <div v-for="(effects, itemName) in combinedEffects" :key="itemName" class="summary-group">
                            <div class="summary-item-title">{{ itemName }}</div>
                            <ul class="summary-effects-list">
                                <li v-for="(eff, idx) in effects" :key="idx">
                                    <span v-for="(seg, sidx) in renderEffectSegments(eff, itemName)" :key="sidx" :class="{ 'inactive-segment': !seg.active }">
                                        {{ seg.text }}
                                    </span>
                                    <span v-if="!isEffectActive(eff, itemName)" class="inactive-tag">(未達成條件)</span>
                                </li>
                            </ul>
                        </div>
                    </template>
                    <div v-else class="empty-summary">
                        <p>尚未選擇任何裝備</p>
                        <p style="font-size: 0.8rem; opacity: 0.6;">點擊左側插槽開始配裝</p>
                    </div>
                </div>
            </div>
        </div>
    `
};
