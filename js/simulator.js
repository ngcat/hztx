/**
 * 模擬配裝器組件
 */
const SimulatorComponent = {
    props: ['allItems'],
    setup(props) {
        const { ref, computed, watch, onMounted, onUnmounted, toRef, nextTick } = Vue;
        const allItems = toRef(props, 'allItems');

        // --- 核心運算邏輯 (無狀態同步版) ---
        const getEquippedItemsSync = (equipConfig) => {
            const items = [];
            Object.entries(equipConfig).forEach(([key, val]) => {
                if (!val) return;
                if (key.endsWith('_p')) {
                    if (val.item && val.effectIdx >= 0) {
                        // 使用原型繼承保留所有資料鏈，僅覆蓋需要變動的部分
                        const partialItem = Object.create(val.item);
                        partialItem.name = val.item.name;
                        partialItem.effects = [val.item.effects[val.effectIdx]];
                        partialItem.isPartial = true;
                        partialItem.effectIdx = val.effectIdx;
                        partialItem.parentName = val.item.name;
                        partialItem.slotKey = key;
                        items.push(partialItem);
                    }
                } else if (key === 'rear_hero' || key === 'front_hero') {
                    items.push({ name: val, slotKey: key });
                } else {
                    const item = Object.create(val);
                    item.slotKey = key;
                    items.push(item);
                }
            });
            return items;
        };
        // --- 核心運算邏輯 (AST 同步版) ---

        /**
         * --- AST 條件判定核心 ---
         */
        const checkAstCondition = (entry, context) => {
            const cond = entry.cond;
            const wearerTraits = context.wearerTraits || new Set();
            let isActive = true;
            let multiplier = 1;

            // 預設等級 (未來可由 UI 調整)
            const globalLevels = {
                '陣法': 0,
                '技能': 0
            };

            if (cond) {
                if (cond.heroes && cond.heroes.length > 0) {
                    if (context.isItem) {
                        // 裝備：必須是主將本人符合名單 (裝備只有主將能穿)
                        const mainName = heroState.value.selectedHeroName;
                        if (!cond.heroes.some(name => mainName && mainName.includes(name))) isActive = false;
                    } else {
                        // 英雄技能：如果是主將技能看副將，副將技能看主將 (排除本人)
                        const pool = context.isDeputy ? context.equippedNames : context.deputyNames;
                        if (!cond.heroes.some(name => Array.from(pool || []).some(en => en.includes(name)))) isActive = false;
                    }
                }
                if (isActive && cond.identity && cond.identity.length > 0) {
                    // 身份判定：考慮轉換邏輯 (全才 = 武將 + 文官)
                    if (!hasIdentityMatch(wearerTraits, cond.identity)) isActive = false;
                }


                if (isActive && cond.unit && cond.unit.length > 0) {
                    // 兵種判定永遠只看穿戴者/發動者本人
                    if (!cond.unit.some(u => wearerTraits.has(u))) isActive = false;
                }
                if (isActive && (cond.awakened === true || cond.isAwakened === true) && !heroState.value.isAwakened) isActive = false;
                if (isActive && (cond.reincarnated === true || cond.isReincarnated === true) && !heroState.value.isReincarnated) isActive = false;

                if (isActive && cond.position && cond.position.length > 0) {
                    if (!cond.position.includes(context.position)) isActive = false;
                }

                if (isActive && cond.equip && cond.equip.length > 0) {
                    if (!cond.equip.every(name => context.equippedNames && context.equippedNames.has(name))) isActive = false;
                }

                if (isActive && cond.set) {
                    const { name, count, mode } = cond.set;
                    let currentCount = 0;
                    if (Array.isArray(name)) {
                        name.forEach(s => {
                            if (context.equippedNames && context.equippedNames.has(s)) currentCount++;
                        });
                    } else if (typeof name === 'string') {
                        currentCount = context.setCounts[name] || 0;
                    }
                    if (mode === 'multiplier') {
                        multiplier = Math.floor(currentCount / (count || 1));
                        if (multiplier <= 0) isActive = false;
                    } else {
                        if (currentCount < (count || 1)) isActive = false;
                    }
                }

                // 2. 處理等級或其他通用倍率 (如：每 1 級、每 10 級)
                const mult = cond.multiplier || cond.level;
                if (isActive && mult) {
                    const { name, count, value } = mult;
                    const currentVal = name ? (globalLevels[name] || 0) : (value || 0);
                    multiplier *= Math.floor(currentVal / (count || 1));
                    if (multiplier <= 0) isActive = false;
                }

                // 3. 處理指定技能等級倍率 (如：每提升 1 級【急救】)
                if (isActive && cond.skill) {
                    Object.entries(cond.skill).forEach(([skillName, config]) => {
                        if (config.mode === 'multiplier') {
                            const level = globalLevels[skillName] || 0;
                            multiplier *= Math.floor(level / (config.count || 1));
                        }
                    });
                    if (multiplier <= 0) isActive = false;
                }
            }
            return { active: isActive, multiplier };
        };

        /**
         * --- 單詞解釋核心 (Word Interpretation Core) ---
         * 負責將「整串效果文字」拆分為「單詞」，並對每個單詞進行分類與數值提取。
         */
        const interpretEffectSync = (eff, sourceItemName, equipConfig, context = {}, options = {}) => {
            if (typeof eff !== 'string') return { words: [], totalStats: {}, hasLinkage: false };

            const results = {
                words: [],
                totalStats: {},
                hasLinkage: false
            };

            const itemAst = getHeroAst(sourceItemName) || astData.value[sourceItemName];
            if (itemAst) {
                let astEntries = null;
                let effIdx = options.effIdx;

                // --- 1. 定位 AST 條目 (定位邏輯相容裝備與英雄) ---
                if (options.astEntry) {
                    // 如果外部已經傳入定位好的 AST 條目 (通常是英雄技能/宿命)，直接使用
                    astEntries = Array.isArray(options.astEntry) ? options.astEntry : [options.astEntry];
                } else if (itemAst.effects) {
                    // 裝備類結構：有 effects 陣列
                    if (effIdx === undefined) {
                        const sourceItem = getEquippedItemsSync(equipConfig).find(i => i.name === sourceItemName || i.parentName === sourceItemName);
                        if (sourceItem) {
                            effIdx = sourceItem.isPartial ? (equipConfig[sourceItem.slotKey]?.effectIdx ?? 0) : (sourceItem.effects || []).indexOf(eff);
                        }
                    }
                    if (effIdx !== undefined && effIdx >= 0 && itemAst.effects[effIdx]) {
                        astEntries = itemAst.effects[effIdx];
                    }
                } else {
                    // 備援邏輯：英雄類結構且未傳入 astEntry 時 (儘量避免進入此處)
                    let allHeroEntries = [...(itemAst.fates || []), ...(itemAst.as_deputy || [])];
                    if (sourceItemName.includes('聖·')) {
                        allHeroEntries.push(...(itemAst.as_deputy_awaken2 || []));
                    } else if (sourceItemName.includes('神·')) {
                        allHeroEntries.push(...(itemAst.as_deputy_awaken || []));
                    }

                    const found = allHeroEntries.filter(e => e.raw === eff);
                    if (found.length > 0) astEntries = found;
                }


                // --- 2. 執行 AST 解析 ---
                if (astEntries) {
                    const hCat = heroState.value.fullCategory || '';

                    // 獲取當前穿戴/發動者的 traits
                    let heroTraits = new Set();
                    if (options.isDeputy) {
                        if (context.deputyTraits) context.deputyTraits.forEach(t => heroTraits.add(t));
                    } else {
                        if (context.mainTraits) context.mainTraits.forEach(t => heroTraits.add(t));
                        heroTraits.add('主將');
                    }

                    // 如果是英雄技能，且 AST 裡有額外 slot (例如特殊的分類)，補進去
                    const sourceAst = getHeroAst(sourceItemName);
                    if (sourceAst && sourceAst.slot) {
                        sourceAst.slot.forEach(s => heroTraits.add(s));
                    } else {
                        // 舊有的 Fallback 邏輯 (僅針對主將有效)
                        [heroState.value.class, heroState.value.identity, heroState.value.gender, ...hCat.split(/\s+/).filter(Boolean)].forEach(t => heroTraits.add(t));
                    }
                    if (heroState.value.isAwakened) heroTraits.add('已覺醒');
                    if (heroState.value.isReincarnated) heroTraits.add('已輪迴');

                    const isFront = heroTraits.has('步兵') || heroTraits.has('騎兵');
                    const isRear = heroTraits.has('弓兵') || heroTraits.has('方士');

                    const isStatApplicable = (k) => {
                        const unitPrefixes = ['步兵', '騎兵', '弓兵', '方士', '前軍', '後軍'];
                        for (const p of unitPrefixes) {
                            if (k.startsWith(p)) {
                                if (p === '前軍') return isFront;
                                if (p === '後軍') return isRear;
                                return heroTraits.has(p);
                            }
                        }

                        const traitPrefixes = ['武將', '文官', '全才', '傳奇', '國士', '巾幗', '名將', '良才', '男性', '女性'];
                        for (const p of traitPrefixes) {
                            if (k.startsWith(p)) return heroTraits.has(p);
                        }
                        return true;
                    };

                    astEntries.forEach((entry, idx) => {
                        const { active: condActive, multiplier } = checkAstCondition(entry, {
                            ...context,
                            isDeputy: options.isDeputy,
                            position: options.position,
                            isItem: options.effIdx !== undefined, // 判定是否為裝備
                            wearerTraits: heroTraits
                        });
                        const wordStats = {};
                        let hasApplicableStats = false;
                        let hasAnyStats = false;

                        if (entry.stats && Object.keys(entry.stats).length > 0) {
                            hasAnyStats = true;
                            Object.entries(entry.stats).forEach(([k, v]) => {
                                const statKey = k === '四維' ? ['武力', '智力', '統御', '魅力'] : [k];
                                statKey.forEach(sk => {
                                    if (isStatApplicable(sk)) {
                                        const val = v === null ? null : v * multiplier;
                                        let finalKey = sk;
                                        if (entry.cond) {
                                            const combatRound = entry.cond.combat?.[0] || entry.cond.phase?.[0];
                                            if (combatRound) finalKey = `__C:${combatRound}__${finalKey}`;
                                            if (entry.cond.position && entry.cond.position[0]) finalKey = `__P:${entry.cond.position[0]}__${finalKey}`;
                                        }
                                        if (val === null) {
                                            wordStats[sk] = null;
                                        } else if (wordStats[sk] !== null) {
                                            wordStats[sk] = (wordStats[sk] || 0) + val;
                                        }

                                        if (condActive) {
                                            if (val === null) {
                                                results.totalStats[finalKey] = null;
                                            } else if (results.totalStats[finalKey] !== null) {
                                                results.totalStats[finalKey] = (results.totalStats[finalKey] || 0) + val;
                                            }
                                        }
                                        hasApplicableStats = true;
                                    }
                                });
                            });
                        }


                        const finalActive = condActive && (hasAnyStats ? hasApplicableStats : true);

                        results.words.push({
                            text: (idx > 0 && astEntries.length > 1 ? '；' : '') + entry.raw,
                            stats: wordStats,
                            isLinkage: !!(entry.cond && (entry.cond.set || entry.cond.equip || entry.cond.heroes)),
                            isActive: finalActive
                        });
                    });
                    results.hasLinkage = results.words.some(w => w.isLinkage);
                    return results;
                }
            }

            // --- 3. 若完全沒有 AST 條目，回傳 Fallback 結果 (直接顯示原文) ---
            results.words.push({
                text: eff,
                stats: {},
                isLinkage: false,
                isActive: true // 沒有 AST 的預設為激活
            });
            return results;
        };


        // 輔助函式：統一獲取英雄 AST 資料 (處理神/聖前綴與空格)
        const getHeroAst = (name) => {
            if (!name) return null;
            const baseName = name.replace(/^[神聖][·\.\s]/, '').trim();
            // 優先嘗試精確匹配，失敗則嘗試去空格匹配
            let ast = astData.value[baseName] || astData.value[name];
            if (!ast) {
                const cleanKey = Object.keys(astData.value).find(k => k.trim() === baseName || k.trim() === name.trim());
                if (cleanKey) ast = astData.value[cleanKey];
            }
            return ast;
        };

        const getHeroAndLieutSkillsSync = (equipConfig) => {
            const result = {
                hero_calculation_skills: [],
                hero_fate: [],
                rear_hero: [],
                front_hero: []
            };

            const mainName = heroState.value.selectedHeroName;
            const mainAst = getHeroAst(mainName);

            // A. 主將宿命 (直接從 AST 提取)
            if (mainAst && mainAst.fates) {
                mainAst.fates.forEach(fate => {
                    // 只要 cond 中有 heroes，就代表是需要隊友觸發的宿命
                    if (fate.cond && fate.cond.heroes && fate.cond.heroes.length > 0) {
                        const skillData = {
                            text: fate.raw,
                            source: mainName,
                            astEntry: fate // 直接傳遞 AST 條目
                        };
                        result.hero_fate.push(skillData);
                        result.hero_calculation_skills.push(skillData);
                    }
                });
            }

            // B. 副將技能
            ['rear_hero', 'front_hero'].forEach(slotId => {
                const lieutName = equipConfig[slotId];
                if (lieutName && typeof lieutName === 'string') {
                    const heroAst = getHeroAst(lieutName);
                    if (heroAst) {
                        let deputySkills = [...(heroAst.as_deputy || [])];
                        if (lieutName.includes('聖·')) {
                            deputySkills.push(...(heroAst.as_deputy_awaken2 || []));
                        } else if (lieutName.includes('神·')) {
                            deputySkills.push(...(heroAst.as_deputy_awaken || []));
                        }

                        deputySkills.forEach(entry => {
                            if (entry.raw) {
                                result[slotId].push({
                                    text: entry.raw,
                                    source: lieutName,
                                    position: slotId === 'front_hero' ? '前軍' : '後軍',
                                    astEntry: entry // 直接傳遞 AST 條目
                                });
                            }
                        });
                    }
                }
            });


            return result;
        };

        const getCombinedEffectsSync = (equipConfig) => {
            const result = {
                skills: {},
                display: []
            };

            const extractedSkills = getHeroAndLieutSkillsSync(equipConfig);

            if (extractedSkills.hero_fate.length > 0) {
                result.display.push({
                    label: `🌟 ${heroState.value.selectedHeroName}・技能宿命`,
                    source: heroState.value.selectedHeroName,
                    effects: extractedSkills.hero_fate.map(s => ({ text: s.text, astEntry: s.astEntry }))
                });
            }

            ['rear_hero', 'front_hero'].forEach(slotId => {
                const skills = extractedSkills[slotId];
                if (skills && skills.length > 0) {
                    const lieutName = equipConfig[slotId];
                    const posLabel = slotId === 'front_hero' ? '前軍' : '後軍';
                    result.display.push({
                        label: `🎖️ ${posLabel}副將・${lieutName}`,
                        source: lieutName,
                        position: posLabel,
                        effects: skills.map(s => ({ text: s.text, astEntry: s.astEntry }))
                    });
                }
            });

            getEquippedItemsSync(equipConfig).forEach((item, index) => {
                if (item.slotKey && item.slotKey.endsWith('_hero')) return;

                let displayName = item.name || item.parentName || "未知裝備";
                if (item.isPartial) {
                    displayName = `${displayName}`;
                    let counter = 1;
                    const baseName = displayName;
                    while (result.display.some(d => d.label === displayName)) {
                        displayName = `${baseName} ${counter}`;
                        counter++;
                    }
                }

                let effects = item.effects || [];
                if (item.slotKey === 'god') {
                    effects = effects.concat(item.mutation || [], item.rage_cond || [], item.spell || []);
                }

                // 裝備類：此處 effIdx 資訊由 interpretEffectSync 根據 sourceItemName 與 index 再次定位，
                // 為了保持架構一致性，此處維持字串輸出，或可封裝為物件但不帶預定義 astEntry
                result.display.push({
                    label: displayName,
                    source: item.name || item.parentName,
                    effects: effects.map((eff, localIdx) => ({
                        text: eff,
                        effIdx: item.isPartial ? item.effectIdx : localIdx
                    }))
                });
            });

            return result;
        };
        const calculateTotalStats = (equipConfig = selectedEquip.value) => {
            const totals = {};
            const context = getCurrentContext(equipConfig);
            const equippedItems = getEquippedItemsSync(equipConfig);

            const addStats = (totalStats) => {
                Object.keys(totalStats).forEach(k => {
                    if (totalStats[k] === null) {
                        totals[k] = null;
                    } else if (totals[k] !== null) {
                        totals[k] = (totals[k] || 0) + totalStats[k];
                    }
                });
            };

            // 1. total_equip(): 裝備統計
            const calculateEquipStats = () => {
                const equipItems = equippedItems.filter(i => !i.slotKey.endsWith('_hero'));
                equipItems.forEach(item => {
                    let effects = (item.effects || []).flat();
                    if (item.slotKey === 'god') {
                        effects = effects.concat((item.mutation || []).flat(), (item.rage_cond || []).flat(), (item.spell || []).flat());
                    }
                    effects.forEach((eff, localIdx) => {
                        const actualEffIdx = item.isPartial ? item.effectIdx : localIdx;
                        const { totalStats } = interpretEffectSync(eff, item.parentName || item.name, equipConfig, context, {
                            effIdx: actualEffIdx,
                            isDeputy: heroState.value.isLieutenant
                        });
                        addStats(totalStats);
                    });
                });
            };

            // 2. calculateHeroStats(): 英雄自身、宿命與副將技能統計
            const calculateHeroStats = () => {
                const extracted = getHeroAndLieutSkillsSync(equipConfig);
                extracted.hero_calculation_skills.forEach(skill => {
                    const { totalStats } = interpretEffectSync(skill.text, skill.source, equipConfig, context, {
                        isDeputy: heroState.value.isLieutenant,
                        astEntry: skill.astEntry // 傳遞預定位的條目
                    });
                    addStats(totalStats);
                });

                ['rear_hero', 'front_hero'].forEach(slotId => {
                    extracted[slotId].forEach(skill => {
                        const { totalStats } = interpretEffectSync(skill.text, skill.source, equipConfig, context, {
                            isDeputy: true,
                            position: skill.position,
                            astEntry: skill.astEntry // 傳遞預定位的條目
                        });
                        addStats(totalStats);
                    });
                });

            };

            calculateEquipStats();
            calculateHeroStats();

            // 返回所有統計數值
            return totals;
        };


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

        // 載入英雄資料
        fetch('data/hero.json').then(res => res.json()).then(data => {
            allHeroes.value = data;
            // 預設選中關羽並同步屬性
            updateHeroAttributes('關羽');
        });

        // 獨立載入神靈資料
        fetch('data/god.json').then(res => res.json()).then(data => {
            allGods.value = data.map(item => ({ ...item, group: 'god' }));
        });

        // 載入 AST 資料 (合併裝備與英雄)
        Promise.all([
            fetch('data/equip_ast.json?v=20260512').then(res => res.json()),
            fetch('data/hero_ast.json?v=20260512').then(res => res.json())
        ]).then(([equipAst, heroAst]) => {
            astData.value = { ...equipAst, ...heroAst };
        }).catch(err => {
            console.error('AST 資料載入失敗', err);
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
            const ast = getHeroAst(name);
            const slots = ast ? (ast.slot || []) : [];

            heroState.value.fullCategory = slots.join(' '); // 保持相容性但來源改為 AST

            // 從 AST slot 中提取分類
            if (slots.includes('武將')) heroState.value.class = '武將';
            else if (slots.includes('文官')) heroState.value.class = '文官';
            else if (slots.includes('全才')) heroState.value.class = '全才';

            const traits = ['傳奇', '國士', '巾幗', '名將', '良才'];
            heroState.value.identity = traits.find(t => slots.includes(t)) || '無';
            heroState.value.gender = slots.includes('女性') ? '女性' : '男性';
        };

        // 輔助函式：判斷身份是否匹配 (嚴格匹配 AST slots)
        const hasIdentityMatch = (slots, requiredIds) => {
            if (!slots || !requiredIds || requiredIds.length === 0) return true;
            const slotSet = Array.isArray(slots) ? new Set(slots) : slots;
            return requiredIds.some(targetId => slotSet.has(targetId));
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


        const getCurrentContext = (equipConfig = selectedEquip.value) => {
            const context = {
                setCounts: {},
                equippedNames: new Set(),
                deputyNames: new Set(),
                mainTraits: new Set(), // 主將專用特性池
                deputyTraits: new Set(), // 副將專用特性池
                goldCount: 0
            };
            const equippedItems = getEquippedItemsSync(equipConfig);

            // 1. 收集英雄資訊 (支援字串或物件格式)
            const getHeroName = (h) => (h && typeof h === 'object' ? h.name : h);

            const mainName = heroState.value.selectedHeroName;
            if (mainName) {
                context.equippedNames.add(mainName);
                context.mainTraits.add('主將');
                if (heroState.value.isAwakened) context.mainTraits.add('已覺醒');
                if (heroState.value.isReincarnated) context.mainTraits.add('已輪迴');

                const baseMain = mainName.replace(/^[神聖][·\.\s]/, '');
                const mainAst = astData.value[baseMain] || astData.value[mainName];
                if (mainAst && mainAst.slot) {
                    mainAst.slot.forEach(s => context.mainTraits.add(s));
                }
            }

            ['rear_hero', 'front_hero'].forEach(slotId => {
                const name = getHeroName(equipConfig[slotId]);
                if (name) {
                    context.equippedNames.add(name);
                    context.deputyNames.add(name);
                    context.deputyTraits.add('副將');

                    const baseName = name.replace(/^[神聖][·\.\s]/, '');
                    const ast = astData.value[baseName] || astData.value[name];
                    if (ast && ast.slot) {
                        ast.slot.forEach(s => context.deputyTraits.add(s));
                    }
                }
            });

            // 2. 掃描主將自身技能 (天賦、宿命等)
            const heroData = getHeroAndLieutSkillsSync(equipConfig);

            // 2. 獨立算出 normalItems (不含「裝備5件金色品質」詞條)，以防迴圈依賴

            const normalItems = equippedItems.filter(item => {
                return !(item.effects || []).some(eff => typeof eff === 'string' && eff.includes('裝備5件金色品質'));
            });
            context.goldCount = normalItems.filter(item => item.name && !item.name.includes('紫色')).length;

            normalItems.forEach(item => {
                if (item.sets) item.sets.split(' ').forEach(s => { if (s.trim()) context.setCounts[s.trim()] = (context.setCounts[s.trim()] || 0) + 1; });
            });

            // 3. 裝備名稱也加入 equippedNames (用於宿命判定)
            equippedItems.forEach(item => {
                if (item.name) context.equippedNames.add(item.name);
            });

            return context;
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
        const popoverView = ref('items'); // 'items' or 'effects'
        const pendingItem = ref(null);

        // 監聽 activeSlot 變化，每次打開新插槽都重置彈窗狀態
        watch(activeSlot, (newVal) => {
            if (newVal) {
                popoverView.value = 'items';
                pendingItem.value = null;
                sortStats.value = []; // 切換插槽時重置排序
            }
        });

        // 監聽彙總分頁切換，自動捲回頂部
        watch(activeSummaryTab, () => {
            nextTick(() => {
                const el = document.querySelector('.summary-tab-content');
                if (el) el.scrollTop = 0;
            });
        });


        const formatStatValue = (stat, val) => {
            if (val === null) return '';
            // 數值顯示規則：
            // 1. 包含「提升」、「強度」、「減免」、「率」、「傷害」、「免傷」、「按比例」均顯示為 %
            // 2. 只有純「基礎、兵力、速度、四維、攻擊、防禦」且不含「提升」時顯示為固定點數
            const isPercent = /提升|強度|減免|率|傷害|免傷|按比例/.test(stat);
            const isRaw = /基礎|兵力|速度|武力|智力|統御|魅力|攻擊|防禦/.test(stat) && !isPercent;
            const prefix = val > 0 ? '+' : '';
            return `${prefix}${val}${isRaw ? '' : '%'}`;
        };

        const isPopoverUpwards = (slotId) => {
            const el = document.querySelector(`.equip-slot.${slotId}`);
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.bottom > window.innerHeight * 0.7;
        };

        const statAggregation = computed(() => {
            const totals = calculateTotalStats();
            const groups = {
                core: { '武力': 0, '智力': 0, '魅力': 0, '統御': 0 },
                left: [
                    { id: 'front', label: '前軍', stats: [] },
                    { id: 'rear', label: '後軍', stats: [] },
                    { id: 'attack', label: '攻擊時狀態', stats: [] },
                    { id: 'defense', label: '受傷害狀態', stats: [] },
                    { id: 'other', label: '其他', stats: [] },
                    { id: 'enemy', label: '敵方', stats: [] }
                ],
                right: [
                    { id: 'y1', label: '遠戰首回合', stats: [] },
                    { id: 'y2', label: '遠戰第二回合', stats: [] },
                    { id: 'j1', label: '近戰首回合', stats: [] },
                    { id: 'j2', label: '近戰第二回合', stats: [] }
                ]
            };

            // 1. 分離常態值與回合加成
            const baseTotals = {};      // 常態屬性
            const roundBonuses = {};    // 各回合額外加成: { '遠戰首回合': { '傷害%': 10 } }

            Object.entries(totals).forEach(([stat, val]) => {
                if (groups.core.hasOwnProperty(stat)) {
                    groups.core[stat] = val;
                    return;
                }

                const cMatch = stat.match(/__C:(.*?)__/);
                if (cMatch) {
                    const round = cMatch[1];
                    const cleanName = stat.replace(cMatch[0], '');
                    if (!roundBonuses[round]) roundBonuses[round] = {};
                    if (val === null) {
                        roundBonuses[round][cleanName] = null;
                    } else if (roundBonuses[round][cleanName] !== null) {
                        roundBonuses[round][cleanName] = (roundBonuses[round][cleanName] || 0) + val;
                    }
                } else {
                    if (val === null) {
                        baseTotals[stat] = null;
                    } else if (baseTotals[stat] !== null) {
                        baseTotals[stat] = (baseTotals[stat] || 0) + val;
                    }
                }
            });

            // 2. 處理左側 (常態顯示)
            Object.entries(baseTotals).forEach(([stat, val]) => {
                let cleanName = stat;
                let position = null;
                const pMatch = stat.match(/__P:(.*?)__/);
                if (pMatch) {
                    position = pMatch[1];
                    cleanName = cleanName.replace(pMatch[0], '');
                }

                const formatted = { name: cleanName, value: formatStatValue(cleanName, val) };
                let pos = position || (cleanName.startsWith('前軍') ? '前軍' : cleanName.startsWith('後軍') ? '後軍' : '其他');

                // 新增：將特定兵種歸類到對應位置
                if (pos === '其他') {
                    if (cleanName.startsWith('步兵') || cleanName.startsWith('騎兵')) pos = '前軍';
                    else if (cleanName.startsWith('方士') || cleanName.startsWith('弓兵')) pos = '後軍';
                }

                if (pos === '前軍') {
                    if (cleanName.startsWith('前軍')) formatted.name = cleanName.substring(2);
                    groups.left[0].stats.push(formatted);
                } else if (pos === '後軍') {
                    if (cleanName.startsWith('後軍')) formatted.name = cleanName.substring(2);
                    groups.left[1].stats.push(formatted);
                } else if (pos === '敵方' || cleanName.startsWith('敵方')) {
                    groups.left[5].stats.push(formatted);
                } else if (cleanName.includes('受到') && cleanName.includes('傷害') || cleanName.includes('免傷')) {
                    groups.left[3].stats.push(formatted);
                } else if (cleanName.includes('傷害')) {
                    groups.left[2].stats.push(formatted);
                } else {
                    groups.left[4].stats.push(formatted);
                }
            });

            // 3. 處理右側 (回合峰值 = 常態中對應屬性的總和 + 回合額外加成)
            // 先計算一個「純淨」的常態總表 (不帶 __P: 標籤) 用於加總
            const pureBase = {};
            Object.entries(baseTotals).forEach(([stat, val]) => {
                const clean = stat.replace(/__P:.*?__/, '');
                pureBase[clean] = (pureBase[clean] || 0) + val;
            });

            const combatConfigs = [
                { id: 'y1', keys: ['遠戰回合', '遠戰首回合'] },
                { id: 'y2', keys: ['遠戰回合', '遠戰第二回合'] },
                { id: 'j1', keys: ['近戰回合', '近戰首回合'] },
                { id: 'j2', keys: ['近戰回合', '近戰第二回合'] }
            ];

            combatConfigs.forEach(cfg => {
                const roundExtra = {};
                cfg.keys.forEach(k => {
                    if (roundBonuses[k]) {
                        Object.entries(roundBonuses[k]).forEach(([s, v]) => {
                            roundExtra[s] = (roundExtra[s] || 0) + v;
                        });
                    }
                });

                const group = groups.right.find(g => g.id === cfg.id);
                // 只顯示該回合額外獲得的加成 (不疊加常態基礎屬性)
                Object.entries(roundExtra).forEach(([stat, val]) => {
                    group.stats.push({
                        name: stat,
                        value: formatStatValue(stat, val)
                    });
                });
            });

            // 左右兩側所有分組均固定顯示，不再移除空分組

            return groups;
        });

        const handleSlotClick = (slot) => {
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


        const selectItemForSlot = (slotId, item, effectIdx = -1) => {
            if (slotId.endsWith('_p')) {
                // 如果已經指定了詞條索引 (來自自動優化或二階選單)
                if (effectIdx !== -1) {
                    selectedEquip.value[slotId] = { item, effectIdx };
                    activeSlot.value = null;
                    slotSearchQuery.value = '';
                    popoverView.value = 'items';
                    pendingItem.value = null;
                    return;
                }

                // 自動優化邏輯
                if (sortStats.value.length > 0 && typeof item._bestEffectIdx === 'number') {
                    selectedEquip.value[slotId] = { item, effectIdx: item._bestEffectIdx };
                    activeSlot.value = null;
                    slotSearchQuery.value = '';
                } else {
                    // 進入二階選單
                    pendingItem.value = item;
                    popoverView.value = 'effects';
                }
            } else {
                // 一般插槽
                selectedEquip.value[slotId] = item;
                activeSlot.value = null;
                slotSearchQuery.value = '';
            }
        };

        const backToItems = () => {
            popoverView.value = 'items';
            pendingItem.value = null;
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
        const combinedEffects = computed(() => getCombinedEffectsSync(selectedEquip.value).display);

        const handleUrlParams = () => {
            const params = new URLSearchParams(window.location.search);
            
            // 1. 處理新版 ?sim= (V2)
            const encoded = params.get('sim');
            if (encoded) {
                try {
                    const config = unpackConfigV2(encoded, STABLE_POOLS.heroes, STABLE_POOLS.items, STABLE_POOLS.gods);
                    heroState.value.selectedHeroName = config.h;
                    updateHeroAttributes(config.h);
                    heroState.value.isAwakened = (config.s & 1) !== 0;
                    heroState.value.isReincarnated = (config.s & 2) !== 0;
                    const newEquip = { ...selectedEquip.value };
                    Object.entries(config.e).forEach(([k, v]) => { newEquip[k] = v; });
                    selectedEquip.value = newEquip;
                } catch (e) { console.error("V2 Unpack failed", e); }
                return;
            }

            // 2. 處理舊版 ?c= (V0)
            const legacyEncoded = params.get('c');
            if (legacyEncoded) {
                try {
                    const config = decompress(legacyEncoded, STABLE_POOLS.heroes, STABLE_POOLS.items, STABLE_POOLS.gods);
                    if (config && config.h) {
                        heroState.value.selectedHeroName = config.h;
                        updateHeroAttributes(config.h);
                        heroState.value.isAwakened = (config.s & 1) !== 0;
                        heroState.value.isReincarnated = (config.s & 2) !== 0;
                        const newEquip = { ...selectedEquip.value };
                        Object.entries(config.e).forEach(([k, v]) => { newEquip[k] = v; });
                        selectedEquip.value = newEquip;
                    }
                } catch (e) { console.error("Legacy V0 Unpack failed", e); }
            }
        };

        onMounted(async () => {

            await initStablePools();
            handleUrlParams();
        });

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

        // --- 全新位元流分享系統 (Base62 + Bitstream) ---

        const SIM_BIT_CONFIG_V1 = {
            VERSION: 6,
            HERO_ID: 10,
            HERO_TYPE: 2,
            HERO_FLAGS: 3,
            ITEM_ID: 10,
            EFFECT_IDX: 3
        };

        const SIM_BIT_CONFIG_V2 = {
            VERSION: 4,
            HERO_ID: 8,
            HERO_TYPE: 2,
            HERO_FLAGS: 3,
            ITEM_ID: 9,
            GOD_ID: 7,
            EFFECT_IDX: 3,
            MASK_BITS: 16
        };

        // --- 穩定索引池 (用於分享連結，避免受 AST 或 UI 排序影響) ---
        const STABLE_POOLS = {
            heroes: [],
            gods: [],
            items: [],
            loaded: false
        };

        const initStablePools = async () => {
            if (STABLE_POOLS.loaded) return;
            try {
                const [h, g, e] = await Promise.all([
                    fetch('data/hero.json').then(r => r.json()),
                    fetch('data/god.json').then(r => r.json()),
                    fetch('data/equip.json').then(r => r.json())
                ]);
                STABLE_POOLS.heroes = h;
                STABLE_POOLS.gods = g;
                STABLE_POOLS.items = e;
                STABLE_POOLS.loaded = true;
            } catch (err) {
                console.error("Failed to load stable pools for sharing", err);
            }
        };

        const getStablePool = (slotId) => {
            if (slotId === 'rear_hero' || slotId === 'front_hero') return STABLE_POOLS.heroes;
            if (slotId === 'god') return STABLE_POOLS.gods;
            return STABLE_POOLS.items;
        };







        const Base62 = {
            chars: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            encode(num) {
                if (num === 0n) return "0";
                let res = "";
                while (num > 0n) {
                    res = this.chars[Number(num % 62n)] + res;
                    num = num / 62n;
                }
                return res;
            },
            decode(str) {
                let res = 0n;
                for (let i = 0; i < str.length; i++) {
                    const idx = this.chars.indexOf(str[i]);
                    if (idx === -1) throw new Error("Invalid Base62");
                    res = res * 62n + BigInt(idx);
                }
                return res;
            }
        };

        class BitWriter {
            constructor() {
                this.val = 0n;
                this.offset = 0;
            }
            write(value, bits) {
                this.val |= (BigInt(value) & ((1n << BigInt(bits)) - 1n)) << BigInt(this.offset);
                this.offset += bits;
            }
            toString() {
                return Base62.encode(this.val);
            }
        }

        class BitReader {
            constructor(str) {
                this.val = Base62.decode(str);
                this.offset = 0;
            }
            read(bits) {
                const mask = (1n << BigInt(bits)) - 1n;
                const res = Number((this.val >> BigInt(this.offset)) & mask);
                this.offset += bits;
                return res;
            }
        }

        const SIM_BIT_SLOT_ORDER = [
            'weapon', 'mount', 'book', 'treasure', 'token', 'hunyu',
            'weapon_p', 'mount_p', 'book_p', 'treasure_p', 'token_p',
            'rear_p', 'front_p', 'rear_hero', 'front_hero', 'god'
        ];

        // V2 (最新優化版) 專用的有效插槽過濾
        const IS_V2_REDUNDANT = (slotId) => (slotId === 'rear_p' || slotId === 'front_p');

        const getSlotPool = (slotId, items, gods, heroes) => {
            if (slotId === 'rear_hero' || slotId === 'front_hero') {
                return heroes; // 使用完整的英雄池 (已包含神靈)
            }
            if (slotId === 'god') {
                return gods;
            }
            return items;
        };






        const packConfigV1 = (config, heroes, items, gods) => {
            const writer = new BitWriter();
            writer.write(1, SIM_BIT_CONFIG_V1.VERSION); // Version 1
            let hType = 0;
            let cleanName = config.h || '';
            if (cleanName.startsWith('聖·')) { hType = 1; cleanName = cleanName.replace('聖·', ''); }
            else if (cleanName.startsWith('神·')) { hType = 2; cleanName = cleanName.replace('神·', ''); }
            const pool = hType === 2 ? gods : heroes.filter(h => (hType === 1) ? h.name.startsWith('聖·') : !h.name.startsWith('聖·'));
            const hIdx = pool.findIndex(h => (hType === 2 ? h.name : h.name.replace('聖·', '')) === cleanName);
            writer.write(hIdx === -1 ? 1023 : hIdx, SIM_BIT_CONFIG_V1.HERO_ID);
            writer.write(hType, SIM_BIT_CONFIG_V1.HERO_TYPE);
            writer.write(config.s || 0, SIM_BIT_CONFIG_V1.HERO_FLAGS);
            SIM_BIT_SLOT_ORDER.forEach(key => {
                const val = config.e[key];
                if (!val) {
                    writer.write(1023, SIM_BIT_CONFIG_V1.ITEM_ID);
                    if (key.endsWith('_p')) writer.write(7, SIM_BIT_CONFIG_V1.EFFECT_IDX);
                    return;
                }
                if (key === 'front_hero' || key === 'rear_hero') {
                    const id = heroes.findIndex(h => h.name === val);
                    writer.write(id === -1 ? 1023 : id, SIM_BIT_CONFIG_V1.ITEM_ID);
                } else if (key === 'god') {
                    const name = typeof val === 'string' ? val : (val.name || val.item?.name);
                    const id = gods.findIndex(g => g.name === name);
                    writer.write(id === -1 ? 1023 : id, SIM_BIT_CONFIG_V1.ITEM_ID);
                } else if (key.endsWith('_p')) {
                    const id = items.findIndex(i => i.name === val.n);
                    writer.write(id === -1 ? 1023 : id, SIM_BIT_CONFIG_V1.ITEM_ID);
                    writer.write(val.i === undefined ? 7 : val.i, SIM_BIT_CONFIG_V1.EFFECT_IDX);
                } else {
                    const name = typeof val === 'string' ? val : (val.name || val.item?.name);
                    const id = items.findIndex(i => i.name === name);
                    writer.write(id === -1 ? 1023 : id, SIM_BIT_CONFIG_V1.ITEM_ID);
                }
            });
            return writer.toString();
        };

        const unpackConfigV1 = (str, heroes, items, gods) => {
            const reader = new BitReader(str);
            const version = reader.read(SIM_BIT_CONFIG_V1.VERSION);
            if (version !== 1) throw new Error("Not V1");
            const hIdx = reader.read(SIM_BIT_CONFIG_V1.HERO_ID);
            const hType = reader.read(SIM_BIT_CONFIG_V1.HERO_TYPE);
            const hFlags = reader.read(SIM_BIT_CONFIG_V1.HERO_FLAGS);
            const pool = hType === 2 ? gods : heroes.filter(h => (hType === 1) ? h.name.startsWith('聖·') : !h.name.startsWith('聖·'));
            let hName = (hIdx < pool.length) ? pool[hIdx].name : '關羽';
            if (hType === 1 && !hName.startsWith('聖·')) hName = '聖·' + hName;
            const config = { h: hName, s: hFlags, e: {} };
            SIM_BIT_SLOT_ORDER.forEach(key => {
                const itemIdx = reader.read(SIM_BIT_CONFIG_V1.ITEM_ID);
                if (key.endsWith('_p')) {
                    const effIdx = reader.read(SIM_BIT_CONFIG_V1.EFFECT_IDX);
                    if (itemIdx < items.length) {
                        const item = items[itemIdx];
                        if (item) config.e[key] = { item, effectIdx: effIdx - 1 };
                    }
                } else {
                    if (itemIdx === 1023) return;
                    if (key === 'front_hero' || key === 'rear_hero') {
                        if (itemIdx < heroes.length) config.e[key] = heroes[itemIdx].name;
                    } else {
                        if (itemIdx < items.length) config.e[key] = items[itemIdx];
                    }
                }
            });
            return config;
        };

        const packConfigV2 = (config, heroes, items, gods) => {
            const writer = new BitWriter();



            writer.write(2, SIM_BIT_CONFIG_V2.VERSION); // Version 2

            const fullMask = SIM_BIT_SLOT_ORDER.reduce((m, key, idx) => {
                return (config.e[key] && !IS_V2_REDUNDANT(key)) ? (m | (1 << idx)) : m;
            }, 0);

            const targetFullMask = SIM_BIT_SLOT_ORDER.reduce((m, key, idx) => {
                return !IS_V2_REDUNDANT(key) ? (m | (1 << idx)) : m;
            }, 0);

            if (fullMask === targetFullMask) {
                writer.write(1, 1);
            } else {
                writer.write(0, 1);
                writer.write(fullMask, SIM_BIT_CONFIG_V2.MASK_BITS);
            }
            const mask = (fullMask === targetFullMask) ? targetFullMask : fullMask;


            // 1. 打包主將 (Hero 專屬位)
            const hBits = SIM_BIT_CONFIG_V2.HERO_ID;
            let hType = 0;
            let cleanName = config.h || '關羽';
            if (cleanName.startsWith('聖·')) { hType = 1; cleanName = cleanName.replace('聖·', ''); }
            else if (cleanName.startsWith('神·')) { hType = 2; cleanName = cleanName.replace('神·', ''); }
            const hIdx = heroes.findIndex(h => h.name === cleanName);
            writer.write(hIdx === -1 ? (1 << hBits) - 1 : hIdx, hBits);
            writer.write(hType, SIM_BIT_CONFIG_V2.HERO_TYPE);
            writer.write(config.s || 0, SIM_BIT_CONFIG_V2.HERO_FLAGS);



            SIM_BIT_SLOT_ORDER.forEach((key, idx) => {
                if (!(mask & (1 << idx))) return;
                const pool = getStablePool(key);



                // 使用安全固定的位元寬度，防止池大小差異導致的位元偏移
                const bitWidth = SIM_BIT_CONFIG_V2.ITEM_ID; // 統一使用 10-bit
                const val = config.e[key];

                if (IS_V2_REDUNDANT(key)) return;

                let name = typeof val === 'string' ? val : (val.name || val.n || (val.item ? (val.item.name || val.item.n) : ''));

                if (key === 'rear_hero' || key === 'front_hero') {
                    let dType = 0;
                    if (name && name.startsWith('聖·')) { dType = 1; name = name.replace('聖·', ''); }
                    else if (name && name.startsWith('神·')) { dType = 2; name = name.replace('神·', ''); }
                    writer.write(dType, SIM_BIT_CONFIG_V2.HERO_TYPE);
                }

                let id = pool.findIndex(p => p.name === name);
                if (id === -1 && name) {
                    const cleanName = name.replace('聖·', '').replace('神·', '');
                    id = pool.findIndex(p => p.name === cleanName);
                }

                // 根據插槽類型選擇精確位元寬度
                let currentBitWidth = SIM_BIT_CONFIG_V2.ITEM_ID; // 預設 9-bit
                if (key === 'god') currentBitWidth = SIM_BIT_CONFIG_V2.GOD_ID; // 7-bit
                else if (key === 'rear_hero' || key === 'front_hero') currentBitWidth = SIM_BIT_CONFIG_V2.HERO_ID; // 7-bit

                writer.write(id === -1 ? (1 << currentBitWidth) - 1 : id, currentBitWidth);


                if (key.endsWith('_p')) {
                    writer.write(val.i !== undefined ? val.i : (val.effectIdx || 0), SIM_BIT_CONFIG_V2.EFFECT_IDX);
                }
            });


            return writer.toString();
        };

        const unpackConfigV2 = (str, heroes, items, gods) => {
            const reader = new BitReader(str);


            const version = reader.read(SIM_BIT_CONFIG_V2.VERSION);
            if (version !== 2) throw new Error("Not V2");

            const targetFullMask = SIM_BIT_SLOT_ORDER.reduce((m, key, idx) => {
                return !IS_V2_REDUNDANT(key) ? (m | (1 << idx)) : m;
            }, 0);

            const isFull = reader.read(1);
            const mask = isFull ? targetFullMask : reader.read(SIM_BIT_CONFIG_V2.MASK_BITS);

            // 1. 解析主將 (Hero 專屬位)
            const hBits = SIM_BIT_CONFIG_V2.HERO_ID;
            const hIdx = reader.read(hBits);
            const hType = reader.read(SIM_BIT_CONFIG_V2.HERO_TYPE);
            const hFlags = reader.read(SIM_BIT_CONFIG_V2.HERO_FLAGS);

            // 從原始 hero.json 池還原
            let hName = (hIdx < STABLE_POOLS.heroes.length) ? STABLE_POOLS.heroes[hIdx].name : '關羽';
            if (hType === 1 && !hName.startsWith('聖·')) hName = '聖·' + hName;
            else if (hType === 2 && !hName.startsWith('神·')) hName = '神·' + hName;
            const config = { h: hName, s: hFlags, e: {} };


            SIM_BIT_SLOT_ORDER.forEach((key, idx) => {
                if (!(mask & (1 << idx))) return;
                if (IS_V2_REDUNDANT(key)) return;

                const pool = getStablePool(key);



                const bitWidth = SIM_BIT_CONFIG_V2.ITEM_ID; // 統一使用 10-bit


                if (key === 'front_hero' || key === 'rear_hero') {
                    const dType = reader.read(SIM_BIT_CONFIG_V2.HERO_TYPE);
                    const id = reader.read(SIM_BIT_CONFIG_V2.HERO_ID);
                    if (id < pool.length) {
                        let dName = pool[id].name;
                        if (dType === 1 && !dName.startsWith('聖·')) dName = '聖·' + dName;
                        else if (dType === 2 && !dName.startsWith('神·')) dName = '神·' + dName;
                        config.e[key] = dName;
                    }
                } else if (key === 'god') {
                    const id = reader.read(SIM_BIT_CONFIG_V2.GOD_ID);
                    if (id < pool.length) config.e[key] = pool[id];
                } else {
                    const id = reader.read(SIM_BIT_CONFIG_V2.ITEM_ID);
                    if (key.endsWith('_p')) {
                        const eId = reader.read(SIM_BIT_CONFIG_V2.EFFECT_IDX);
                        if (id < pool.length) config.e[key] = { item: pool[id], effectIdx: eId };
                    } else {
                        if (id < pool.length) config.e[key] = pool[id];
                    }
                }


            });

            return config;
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
                const isLieutSlot = e.target.closest('.equip-slot.rear_hero') || e.target.closest('.equip-slot.front_hero');
                if (!isHeroPopover && !isHeroTrigger && !isLieutSlot) {
                    showHeroSearch.value = false;
                    heroSearchQuery.value = '';
                    activeHeroSlot.value = null;
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
            const slotOrder = ['weapon', 'mount', 'book', 'treasure', 'token', 'hunyu', 'weapon_p', 'mount_p', 'book_p', 'treasure_p', 'token_p', 'rear_p', 'front_p'];
            const bytes = [];

            // 1. 英雄 (24-bit / 3 bytes)
            const hHash = config.h ? (hashCode(config.h) & 0xFFFFFF) : 0;
            bytes.push((hHash >> 16) & 0xFF, (hHash >> 8) & 0xFF, hHash & 0xFF);

            // 2. 狀態 (1 byte)
            // bit 0: isAwakened, bit 1: isReincarnated, bit 2: isLieutenant
            let status = 0;
            if (config.s & 0x01) status |= 0x01;
            if (config.s & 0x02) status |= 0x02;
            if (config.s & 0x04) status |= 0x04;
            bytes.push(status);

            // 3. 裝備
            slotOrder.forEach(slotId => {
                const val = config.e[slotId];
                if (!val) {
                    const skip = (slotId === 'hunyu' || slotId === 'rear_p' || slotId === 'front_p') ? 3 : 2;
                    for (let i = 0; i < skip; i++) bytes.push(0);
                    if (slotId.endsWith('_p')) bytes.push(0);
                } else {
                    const itemName = typeof val === 'string' ? val : (val.item ? val.item.name : val.n);

                    if (slotId === 'hunyu' || slotId === 'rear_p' || slotId === 'front_p') {
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

            // 4. 副將 (放在最後以相容舊版本)
            ['rear_hero', 'front_hero'].forEach(slot => {
                const name = config.e[slot];
                const hHash = name ? (hashCode(name) & 0xFFFFFF) : 0;
                bytes.push((hHash >> 16) & 0xFF, (hHash >> 8) & 0xFF, hHash & 0xFF);
            });

            // 5. 神靈 (最後加入)
            const gName = config.e['god'];
            const gHash = gName ? (hashCode(typeof gName === 'string' ? gName : (gName.name || gName.n || '')) & 0xFFFFFF) : 0;
            bytes.push((gHash >> 16) & 0xFF, (gHash >> 8) & 0xFF, gHash & 0xFF);

            return btoa(String.fromCharCode(...bytes));
        };

        const decompress = (encoded, heroes, items, gods) => {
            const binary = atob(encoded);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            const slotOrder = ['weapon', 'mount', 'book', 'treasure', 'token', 'hunyu', 'weapon_p', 'mount_p', 'book_p', 'treasure_p', 'token_p', 'rear_p', 'front_p'];
            const catMap = { '神兵': 'weapon', '坐騎': 'mount', '寶典': 'book', '奇珍': 'treasure', '令符': 'token' };
            const scopedMaps = { hero: {}, weapon: {}, mount: {}, book: {}, treasure: {}, token: {}, allEquip: {} };

            // 使用傳入的資料建立查找表
            (gods || []).forEach(g => {
                scopedMaps.allEquip[hashCode(g.name) & 0xFFFFFF] = g;
            });
            (heroes || []).forEach(h => {
                const baseName = h.name;
                scopedMaps.hero[hashCode(baseName) & 0xFFFFFF] = baseName;
                scopedMaps.hero[hashCode('神·' + baseName) & 0xFFFFFF] = '神·' + baseName;
                scopedMaps.hero[hashCode('聖·' + baseName) & 0xFFFFFF] = '聖·' + baseName;
            });
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

            // 1. 讀取主將 (24-bit)
            const hHash = (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
            if (hHash !== 0) config.h = scopedMaps.hero[hHash] || null;

            // 2. 狀態 (1 byte)
            config.s = bytes[p++];

            // 3. 裝備
            slotOrder.forEach(slotId => {
                const iHash = (slotId === 'hunyu' || slotId === 'rear_p' || slotId === 'front_p')
                    ? (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++]
                    : (bytes[p++] << 8) | bytes[p++];

                if (iHash !== 0) {
                    if (slotId === 'hunyu' || slotId === 'rear_p' || slotId === 'front_p') {
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

            // 4. 副將 (如果位元組足夠，則讀取)
            if (p + 3 <= bytes.length) {
                const rHash = (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
                if (rHash !== 0) config.e.rear_hero = scopedMaps.hero[rHash] || null;
            }
            if (p + 3 <= bytes.length) {
                const fHash = (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
                if (fHash !== 0) config.e.front_hero = scopedMaps.hero[fHash] || null;
            }

            // 5. 神靈 (如果還有剩餘位元組)
            if (p + 3 <= bytes.length) {
                const gHash = (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
                if (gHash !== 0) config.e.god = scopedMaps.allEquip[gHash] || null;
            }

            return config;
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
            heroState.value.isAwakened = !!(status & 1);
            heroState.value.isReincarnated = !!(status & 2);
            heroState.value.isLieutenant = !!(status & 4);

            // 3. 還原裝備 (直接賦值以保持引用一致)
            if (config.e) {
                Object.keys(selectedEquip.value).forEach(k => selectedEquip.value[k] = null);
                Object.entries(config.e).forEach(([slotId, data]) => {
                    selectedEquip.value[slotId] = data;
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
                const urlParams = new URLSearchParams(window.location.search);
                // 優先從 ?sim= 讀取，其次從舊有的 ?c= 讀取
                const encoded = urlParams.get('sim') || urlParams.get('c');
                if (encoded) {
                    const target = decodeURIComponent(encoded.replace(/ /g, '+'));
                    const unwatch = watch(
                        [() => props.allItems, allHeroes, allGods],
                        ([items, heroes, gods]) => {
                            if (items?.length && heroes?.length && gods?.length) {
                                try {
                                    // 嘗試 V2 (最新版)
                                    try {
                                        const configV2 = unpackConfigV2(target, heroes, items, gods);
                                        loadConfig(configV2);
                                        unwatch();
                                        return;
                                    } catch (e2) { }

                                    // 嘗試 V1
                                    try {
                                        const configV1 = unpackConfigV1(target, heroes, items, gods);
                                        loadConfig(configV1);
                                        unwatch();
                                        return;
                                    } catch (e1) { }

                                    const config = decompress(target, heroes, items, gods);
                                    if (config) loadConfig(config);
                                } catch (e) {
                                    console.error('Share load error:', e);
                                }
                                unwatch();
                            }
                        },
                        { immediate: true }
                    );
                }
            };

            checkAndLoad();
        });

        onUnmounted(() => {
            window.removeEventListener('mousedown', handleClickOutside, true);
        });

        return {
            activeSlot, slotSearchQuery, sortStats, selectedEquip, simulatorSlots,
            filteredSlotItems, activeSlotItems, selectItemForSlot, handleSearchBlur,
            toggleSortStat(stat) {
                const idx = sortStats.value.indexOf(stat);
                if (idx === -1) sortStats.value.push(stat);
                else sortStats.value.splice(idx, 1);
            },
            getSortBonus(item, slot, cachedCurrentTotals = null) {
                if (sortStats.value.length === 0) return 0;
                const currentTotals = cachedCurrentTotals || calculateTotalStats();
                const tempEquip = { ...selectedEquip.value };
                const isDeitySlot = slot.id && slot.id.endsWith('_p');
                let total = 0;
                if (isDeitySlot) {
                    let maxItemBonus = -Infinity;
                    (item.effects || []).forEach((eff, idx) => {
                        tempEquip[slot.id] = { item, effectIdx: idx };
                        const potentialTotals = calculateTotalStats(tempEquip);
                        let currentItemBonus = 0;
                        sortStats.value.forEach(stat => { currentItemBonus += (potentialTotals[stat] || 0) - (currentTotals[stat] || 0); });
                        if (currentItemBonus > maxItemBonus) maxItemBonus = currentItemBonus;
                    });
                    total = maxItemBonus;
                } else {
                    tempEquip[slot.id] = item;
                    const potentialTotals = calculateTotalStats(tempEquip);
                    sortStats.value.forEach(stat => { total += (potentialTotals[stat] || 0) - (currentTotals[stat] || 0); });
                }
                return total;
            },
            clearAllEquip, hasSelectedItems, combinedEffects,
            statAggregation, allSets, applySet,
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
            isPopoverUpwards, getPopoverStyle,
            handleSlotClick, getHeroImage,
            isSummaryOpen,
            soulJadeSlots, partialSlots,
            popoverView, pendingItem, backToItems,
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
                    const encoded = packConfigV2(config, allHeroes.value, props.allItems, allGods.value);
                    const url = new URL(window.location.origin + window.location.pathname);
                    url.searchParams.set('sim', encoded);
                    const shareUrl = url.toString();
                    Utils.copyToClipboard(shareUrl).then(() => { alert('配置連結已複製到剪貼簿！'); }).catch(() => { window.prompt('複製失敗，請手動複製下方連結：', shareUrl); });
                } catch (e) { alert('分享失敗，請稍後再試。'); }
            },
            activeSummaryTab,
            formatStatValue
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
                                <div v-if="showHeroSearch && activeHeroSlot === 'main'" class="hero-search-popover">
                                    <input type="text" v-model="heroSearchQuery" placeholder="搜尋主將..." autofocus>
                                    <div class="hero-results-list">
                                        <div v-for="h in filteredHeroes" :key="h.name" class="hero-result-item" @mousedown="selectHero(h.name)">
                                            <span class="hero-result-name">{{ h.name }}</span>
                                            <span class="hero-result-tags">({{ h.category }})</span>
                                        </div>
                                    </div>
                                </div>
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
                                <div class="popover-sort-options">
                                    <div class="sort-label-main">依屬性排序</div>
                                    <div class="sort-checkboxes">
                                        <label v-for="s in ['武力', '智力', '魅力', '統御']" :key="s">
                                            <input type="checkbox" :checked="sortStats.includes(s)" @change="toggleSortStat(s)"> {{ s }}
                                        </label>
                                    </div>
                                </div>
                                <input type="text" v-model="slotSearchQuery" :placeholder="'搜尋' + slot.name + '...'" autofocus @blur="handleSearchBlur">
                                            <div class="search-results-list">
                                                <div v-for="item in activeSlotItems" :key="item.name" 
                                                     class="search-result-item" 
                                                     @mousedown="selectItemForSlot(slot.id, item)">
                                                    <img :src="'img/' + item.image" alt="" @error="$event.target.src = 'img/unknown.png'">
                                                    <div class="result-info">
                                                        <div class="result-name">{{ item.name }}</div>
                                                        <div v-if="sortStats.length > 0" :class="['sort-bonus', { 'sort-negative': item._sortBonus < 0, 'sort-zero': item._sortBonus === 0 }]">{{ item._sortBonus > 0 ? '+' : '' }}{{ item._sortBonus }}</div>
                                                    </div>
                                                </div>
                                                <div v-if="activeSlotItems.length === 0" class="no-results">無相符結果</div>
                                            </div>
                            </div>
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

                            <div v-if="activeSlot === slot.id" :class="['slot-search-popover', { 'upwards': isPopoverUpwards(slot.id) }]" :style="getPopoverStyle(slot.id)">
                                <!-- 副將英雄搜尋模式 -->
                                <template v-if="slot.id === 'rear_hero' || slot.id === 'front_hero'">
                                    <div class="popover-sort-options">
                                        <div class="sort-label-main">依屬性排序</div>
                                        <div class="sort-checkboxes">
                                            <label v-for="s in ['武力', '智力', '魅力', '統御']" :key="s">
                                                <input type="checkbox" :checked="sortStats.includes(s)" @change="toggleSortStat(s)"> {{ s }}
                                            </label>
                                        </div>
                                    </div>
                                    <input type="text" v-model="heroSearchQuery" :placeholder="'搜尋' + slot.name + '...'" autofocus>
                                    <div class="hero-results-list">
                                        <div v-for="h in filteredHeroes" :key="h.name" class="hero-result-item" @mousedown="selectHero(h.name)">
                                            <span class="hero-result-name">{{ h.name }}</span>
                                            <span class="hero-result-tags">({{ h.category }})</span>
                                            <div v-if="sortStats.length > 0" :class="['sort-bonus', { 'sort-negative': h._sortBonus < 0, 'sort-zero': h._sortBonus === 0 }]" style="margin-left: auto;">{{ h._sortBonus > 0 ? '+' : '' }}{{ h._sortBonus }}</div>
                                        </div>
                                    </div>
                                </template>
                                <template v-else>
                                    <div class="popover-sort-options" v-if="slot.id !== 'god'">
                                        <div class="sort-label-main">依屬性排序</div>
                                        <div class="sort-checkboxes">
                                            <label v-for="s in ['武力', '智力', '魅力', '統御']" :key="s">
                                                <input type="checkbox" :checked="sortStats.includes(s)" @change="toggleSortStat(s)"> {{ s }}
                                            </label>
                                        </div>
                                    </div>
                                    <input type="text" v-model="slotSearchQuery" :placeholder="'搜尋' + (slot.id === 'god' ? '神靈' : '所有裝備') + '...'" autofocus @blur="handleSearchBlur">
                                    <div class="search-results-list">
                                        <div v-for="item in activeSlotItems" :key="item.name" class="search-result-item" @mousedown="selectItemForSlot(slot.id, item)">
                                            <img v-if="slot.id !== 'god'" :src="'img/' + item.image" alt="" @error="$event.target.src = 'img/unknown.png'">
                                            <div class="result-info">
                                                <div class="result-name">{{ item.name }}</div>
                                                <div style="font-size: 0.7rem; opacity: 0.5; margin-left: auto;">{{ item.category }}</div>
                                                <div v-if="sortStats.length > 0" :class="['sort-bonus', { 'sort-negative': item._sortBonus < 0, 'sort-zero': item._sortBonus === 0 }]" style="margin-left: 8px; min-width: 32px; text-align: right;">{{ item._sortBonus > 0 ? '+' : '' }}{{ item._sortBonus }}</div>
                                            </div>
                                        </div>
                                        <div v-if="activeSlotItems.length === 0" class="no-results">無相符結果</div>
                                    </div>
                                </template>
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
                                            <div class="popover-sort-options">
                                                <div class="sort-label-main">依屬性排序</div>
                                                <div class="sort-checkboxes">
                                                    <label v-for="s in ['武力', '智力', '魅力', '統御']" :key="s">
                                                        <input type="checkbox" :checked="sortStats.includes(s)" @change="toggleSortStat(s)"> {{ s }}
                                                    </label>
                                                </div>
                                            </div>
                                            <input type="text" v-model="slotSearchQuery" :placeholder="'搜尋' + slot.category + '...'" autofocus @blur="handleSearchBlur">
                                            <div class="search-results-list">
                                                <div v-for="item in activeSlotItems" :key="item.name" class="search-result-item" @mousedown="selectItemForSlot(slot.id, item)">
                                                    <img :src="'img/' + item.image" alt="" @error="$event.target.src = 'img/unknown.png'">
                                                    <div class="result-info">
                                                        <div class="result-name">{{ item.name }}</div>
                                                        <div v-if="sortStats.length > 0" :class="['sort-bonus', { 'sort-negative': item._sortBonus < 0, 'sort-zero': item._sortBonus === 0 }]">{{ item._sortBonus > 0 ? '+' : '' }}{{ item._sortBonus }}</div>
                                                    </div>
                                                </div>
                                                <div v-if="activeSlotItems.length === 0" class="no-results">無相符結果</div>
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
                                                     @click="selectItemForSlot(slot.id, pendingItem, idx)">
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

            <!-- 使用 Teleport 將按鈕傳送到 body 下，防止被父容器的 transform 干擾 fixed 定位 -->
            <teleport to="body">
                <button class="mobile-summary-toggle" :class="{ 'is-open': isSummaryOpen }" @click="isSummaryOpen = !isSummaryOpen">

                    <i :class="isSummaryOpen ? 'fas fa-times' : 'fas fa-chart-bar'"></i>
                </button>
            </teleport>





            <div class="summary-overlay" :class="{ 'show': isSummaryOpen }" @click="isSummaryOpen = false"></div>

            <div class="simulator-summary" :class="{ 'mobile-open': isSummaryOpen }">
                <div class="summary-header">
                    <span class="header-tag">屬性彙總</span>
                </div>

                <div class="summary-content">
                    <template v-if="hasSelectedItems">
                        <!-- 1. 四維彙總 (固定在最上方) -->
                        <div class="stats-grid core-grid">
                            <div v-for="(val, stat) in statAggregation.core" :key="stat" class="stat-pill">
                                <span class="stat-name">{{ stat }}</span>
                                <span class="stat-value" :class="{ 'pos': val > 0, 'neg': val < 0 }">+{{ val }}</span>
                            </div>
                        </div>

                        <!-- 2. Tab 切換按鈕 -->
                        <div class="summary-tabs">
                            <button :class="{ active: activeSummaryTab === 'effects' }" @click="activeSummaryTab = 'effects'">
                                <i class="fas fa-magic"></i> 裝備詞綴
                            </button>
                            <button :class="{ active: activeSummaryTab === 'stats' }" @click="activeSummaryTab = 'stats'">
                                <i class="fas fa-list-ul"></i> 數值計算
                            </button>
                        </div>

                        <!-- 3. Tab 內容 -->
                        <div class="summary-tab-content">
                            <!-- 屬性匯總分頁 -->
                            <div v-if="activeSummaryTab === 'stats'" class="tab-pane stats-pane">
                                <div class="stat-summary-details">
                                    <!-- 左欄: 位置與其他 -->
                                    <div class="stat-col left-col">
                                        <div v-for="group in statAggregation.left" :key="group.id" class="stat-group">
                                            <div class="group-header">{{ group.label }}</div>
                                            <div class="group-content">
                                                <div v-for="stat in group.stats" :key="stat.name" class="stat-detail-item">
                                                    <span class="name">{{ stat.name }}</span>
                                                    <span class="value">{{ stat.value }}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <!-- 右欄: 回合 -->
                                    <div class="stat-col right-col">
                                        <div v-for="group in statAggregation.right" :key="group.id" class="stat-group">
                                            <div class="group-header">{{ group.label }}</div>
                                            <div class="group-content">
                                                <div v-for="stat in group.stats" :key="stat.name" class="stat-detail-item">
                                                    <span class="name">{{ stat.name }}</span>
                                                    <span class="value">{{ stat.value }}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- 裝備詞條分頁 -->
                            <div v-if="activeSummaryTab === 'effects'" class="tab-pane effects-pane">
                                <div v-for="item in combinedEffects" :key="item.label" class="summary-group">
                                    <div class="summary-item-title">{{ item.label }}</div>
                                    <ul class="summary-effects-list">
                                        <li v-for="(eff, idx) in item.effects" :key="idx">
                                            <template v-for="segments in [renderEffectSegments(eff, item.source, { position: item.position, isDeputy: !!item.position })]">
                                                <span v-for="(seg, sidx) in segments" :key="sidx" :class="{ 'inactive-segment': !seg.active }">
                                                    {{ seg.text }}
                                                </span>
                                                <span v-if="segments.length > 0 && !segments.every(s => s.active)" class="inactive-tag">(未達成條件)</span>
                                            </template>
                                        </li>
                                    </ul>
                                </div>
                            </div>
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
