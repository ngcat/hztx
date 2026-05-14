/**
 * 模擬器核心運算與 AST 解析邏輯
 */
window.SimLogic = (() => {
    // 預設等級配置
    const globalLevels = {
        '陣法': 0,
        '技能': 0
    };

    /**
     * 判定身份匹配 (考慮全才等邏輯)
     */
    const hasIdentityMatch = (traits, requiredIds) => {
        if (!requiredIds || requiredIds.length === 0) return true;
        const traitSet = traits instanceof Set ? traits : new Set(traits);
        
        return requiredIds.some(req => {
            if (req === '全才') return traitSet.has('武將') && traitSet.has('文官');
            return traitSet.has(req);
        });
    };

    /**
     * 獲取英雄 AST 資料 (處理神/聖前綴與空格)
     */
    const getHeroAst = (name, astData) => {
        if (!name || !astData) return null;
        const baseName = name.replace(/^[神聖][·\.\s]/, '').trim();
        let ast = astData[baseName] || astData[name];
        if (!ast) {
            const cleanKey = Object.keys(astData).find(k => k.trim() === baseName || k.trim() === name.trim());
            if (cleanKey) ast = astData[cleanKey];
        }
        return ast;
    };

    /**
     * 獲取當前裝備列表 (同步版)
     */
    const getEquippedItemsSync = (equipConfig) => {
        if (!equipConfig) return [];
        const items = [];
        Object.entries(equipConfig).forEach(([key, val]) => {
            if (!val) return;
            if (key.endsWith('_p')) {
                if (val.item && val.effectIdx >= 0) {
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

    /**
     * 獲取當前環境上下文 (用於判定條件)
     */
    const getCurrentContext = (equipConfig, state, astData) => {
        if (!equipConfig || !state) return { setCounts: {}, equippedNames: new Set(), deputyNames: new Set(), mainTraits: new Set(), deputyTraits: new Set(), goldCount: 0 };
        const equippedItems = getEquippedItemsSync(equipConfig);
        const context = {
            setCounts: {},
            equippedNames: new Set(),
            deputyNames: new Set(),
            mainTraits: new Set(),
            deputyTraits: new Set(),
            goldCount: 0
        };

        const getHeroName = (h) => (h && typeof h === 'object' ? h.name : h);
        const mainName = state.selectedHeroName;
        if (mainName) {
            context.equippedNames.add(mainName);
            context.mainTraits.add('主將');
            if (state.isAwakened) context.mainTraits.add('已覺醒');
            if (state.isReincarnated) context.mainTraits.add('已輪迴');
            const tags = (state.fullCategory || '').split(' ').filter(t => t.trim());
            tags.forEach(t => context.mainTraits.add(t));
            if (state.class) context.mainTraits.add(state.class);
        }

        const getDeputyTraits = (name) => {
            const traits = new Set();
            const dAst = getHeroAst(name, astData);
            if (dAst) {
                if (dAst.class) traits.add(dAst.class);
                if (dAst.identity) traits.add(dAst.identity);
                if (dAst.gender) traits.add(dAst.gender);
                if (dAst.slot) dAst.slot.forEach(s => traits.add(s));
            }
            return traits;
        };

        ['rear_hero', 'front_hero'].forEach(slotId => {
            const name = getHeroName(equipConfig[slotId]);
            if (name) {
                context.equippedNames.add(name);
                context.deputyNames.add(name);
                context.deputyTraits.add('副將');
                const traits = getDeputyTraits(name);
                traits.forEach(t => context.deputyTraits.add(t));
            }
        });

        const normalItems = equippedItems.filter(item => {
            return !(item.effects || []).some(eff => typeof eff === 'string' && eff.includes('裝備5件金色品質'));
        });
        context.goldCount = normalItems.filter(item => item.name && !item.name.includes('紫色')).length;
        normalItems.forEach(item => {
            if (item.sets) item.sets.split(' ').forEach(s => { if (s.trim()) context.setCounts[s.trim()] = (context.setCounts[s.trim()] || 0) + 1; });
        });
        equippedItems.forEach(item => { if (item.name) context.equippedNames.add(item.name); });

        return context;
    };

    /**
     * 提取主將宿命與副將技能
     */
    const getHeroAndLieutSkillsSync = (equipConfig, state, astData) => {
        const result = { hero_calculation_skills: [], hero_fate: [], rear_hero: [], front_hero: [] };
        if (!equipConfig || !state || !astData) return result;
        const mainName = state.selectedHeroName;
        const mainAst = getHeroAst(mainName, astData);

        if (mainAst && mainAst.fates) {
            mainAst.fates.forEach(fate => {
                if (fate.cond && fate.cond.heroes && fate.cond.heroes.length > 0) {
                    const skillData = { text: fate.raw, source: mainName, astEntry: fate };
                    result.hero_fate.push(skillData);
                    result.hero_calculation_skills.push(skillData);
                }
            });
        }

        ['rear_hero', 'front_hero'].forEach(slotId => {
            const lieutName = equipConfig[slotId];
            if (lieutName && typeof lieutName === 'string') {
                const heroAst = getHeroAst(lieutName, astData);
                if (heroAst) {
                    let deputySkills = [...(heroAst.as_deputy || [])];
                    if (lieutName.includes('聖·')) deputySkills.push(...(heroAst.as_deputy_awaken2 || []));
                    else if (lieutName.includes('神·')) deputySkills.push(...(heroAst.as_deputy_awaken || []));

                    deputySkills.forEach(entry => {
                        if (entry.raw) {
                            result[slotId].push({
                                text: entry.raw,
                                source: lieutName,
                                position: slotId === 'front_hero' ? '前軍' : '後軍',
                                astEntry: entry
                            });
                        }
                    });
                }
            }
        });
        return result;
    };

    /**
     * AST 條件判定核心
     */
    const checkAstCondition = (entry, context, state) => {
        const cond = entry.cond;
        const wearerTraits = context.wearerTraits || new Set();
        let isActive = true;
        let multiplier = 1;

        if (cond) {
            if (cond.heroes && cond.heroes.length > 0) {
                if (context.isItem) {
                    const mainName = state.selectedHeroName;
                    if (!cond.heroes.some(name => mainName && mainName.includes(name))) isActive = false;
                } else {
                    const pool = context.isDeputy ? context.equippedNames : context.deputyNames;
                    if (!cond.heroes.some(name => Array.from(pool || []).some(en => en.includes(name)))) isActive = false;
                }
            }
            if (isActive && cond.identity && cond.identity.length > 0) {
                if (!hasIdentityMatch(wearerTraits, cond.identity)) isActive = false;
            }
            if (isActive && cond.unit && cond.unit.length > 0) {
                if (!cond.unit.some(u => wearerTraits.has(u))) isActive = false;
            }
            if (isActive && (cond.awakened === true || cond.isAwakened === true) && !state.isAwakened) isActive = false;
            if (isActive && (cond.reincarnated === true || cond.isReincarnated === true) && !state.isReincarnated) isActive = false;

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
                    name.forEach(s => { if (context.equippedNames && context.equippedNames.has(s)) currentCount++; });
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

            if (isActive && cond.level) {
                const type = cond.level.type;
                const base = cond.level.base || 0;
                const step = cond.level.step || 0;
                const currentLevel = globalLevels[type] || 0;
                if (currentLevel > 0) multiplier = base + (currentLevel - 1) * step;
            }

            // 處理等級或其他通用倍率
            const mult = cond.multiplier || cond.level;
            if (isActive && mult && mult.name) {
                const { name, count } = mult;
                const currentVal = globalLevels[name] || 0;
                multiplier *= Math.floor(currentVal / (count || 1));
                if (multiplier <= 0) isActive = false;
            }

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
     * 解析效果字串
     */
    const interpretEffectSync = (eff, sourceItemName, equipConfig, context, options, state, astData) => {
        if (typeof eff !== 'string') return { words: [], totalStats: {}, hasLinkage: false };

        const results = { words: [], totalStats: {}, hasLinkage: false };
        const itemAst = getHeroAst(sourceItemName, astData) || astData[sourceItemName];
        
        if (itemAst) {
            let astEntries = null;
            let effIdx = options.effIdx;

            if (options.astEntry) {
                astEntries = Array.isArray(options.astEntry) ? options.astEntry : [options.astEntry];
            } else if (itemAst.effects) {
                if (effIdx === undefined) {
                    const sourceItem = getEquippedItemsSync(equipConfig).find(i => i.name === sourceItemName || i.parentName === sourceItemName);
                    if (sourceItem) {
                        effIdx = sourceItem.isPartial ? (equipConfig[sourceItem.slotKey]?.effectIdx ?? 0) : (sourceItem.effects || []).indexOf(eff);
                    }
                }
                if (effIdx !== undefined && effIdx >= 0 && itemAst.effects[effIdx]) astEntries = itemAst.effects[effIdx];
            } else {
                let allHeroEntries = [...(itemAst.fates || []), ...(itemAst.as_deputy || [])];
                if (sourceItemName.includes('聖·')) allHeroEntries.push(...(itemAst.as_deputy_awaken2 || []));
                else if (sourceItemName.includes('神·')) allHeroEntries.push(...(itemAst.as_deputy_awaken || []));
                const found = allHeroEntries.filter(e => e.raw === eff);
                if (found.length > 0) astEntries = found;
            }

            if (astEntries) {
                let heroTraits = new Set();
                if (options.isDeputy) {
                    if (context.deputyTraits) context.deputyTraits.forEach(t => heroTraits.add(t));
                } else {
                    if (context.mainTraits) context.mainTraits.forEach(t => heroTraits.add(t));
                    heroTraits.add('主將');
                }

                const sourceAst = getHeroAst(sourceItemName, astData);
                if (sourceAst && sourceAst.slot) {
                    sourceAst.slot.forEach(s => heroTraits.add(s));
                } else {
                    const hCat = state.fullCategory || '';
                    [state.class, state.identity, state.gender, ...hCat.split(/\s+/).filter(Boolean)].forEach(t => heroTraits.add(t));
                }
                if (state.isAwakened) heroTraits.add('已覺醒');
                if (state.isReincarnated) heroTraits.add('已輪迴');

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
                        isItem: options.effIdx !== undefined,
                        wearerTraits: heroTraits
                    }, state);

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
                                    if (val === null) wordStats[sk] = null;
                                    else if (wordStats[sk] !== null) wordStats[sk] = (wordStats[sk] || 0) + val;

                                    if (condActive) {
                                        if (val === null) results.totalStats[finalKey] = null;
                                        else if (results.totalStats[finalKey] !== null) results.totalStats[finalKey] = (results.totalStats[finalKey] || 0) + val;
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
        results.words.push({ text: eff, stats: {}, isLinkage: false, isActive: true });
        return results;
    };

    /**
     * 計算總體屬性
     */
    const calculateTotalStats = (equipConfig, state, astData) => {
        const totals = {};
        if (!equipConfig || !state || !astData) return totals;
        const context = getCurrentContext(equipConfig, state, astData);
        const equippedItems = getEquippedItemsSync(equipConfig);

        const addStats = (totalStats) => {
            Object.keys(totalStats).forEach(k => {
                if (totalStats[k] === null) totals[k] = null;
                else if (totals[k] !== null) totals[k] = (totals[k] || 0) + totalStats[k];
            });
        };

        // 1. 裝備統計
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
                    isDeputy: state.isLieutenant
                }, state, astData);
                addStats(totalStats);
            });
        });

        // 2. 英雄與副將統計
        const extracted = getHeroAndLieutSkillsSync(equipConfig, state, astData);
        extracted.hero_calculation_skills.forEach(skill => {
            const { totalStats } = interpretEffectSync(skill.text, skill.source, equipConfig, context, {
                isDeputy: state.isLieutenant,
                astEntry: skill.astEntry
            }, state, astData);
            addStats(totalStats);
        });

        ['rear_hero', 'front_hero'].forEach(slotId => {
            extracted[slotId].forEach(skill => {
                const { totalStats } = interpretEffectSync(skill.text, skill.source, equipConfig, context, {
                    isDeputy: true,
                    position: skill.position,
                    astEntry: skill.astEntry
                }, state, astData);
                addStats(totalStats);
            });
        });

        return totals;
    };

    return {
        globalLevels,
        hasIdentityMatch,
        getHeroAst,
        getEquippedItemsSync,
        getCurrentContext,
        getHeroAndLieutSkillsSync,
        calculateTotalStats,
        checkAstCondition,
        interpretEffectSync
    };
})();
