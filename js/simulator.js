/**
 * 模擬配裝器組件
 */
const SimulatorComponent = {
    props: ['allItems'],
    setup(props) {
        const EFFECT_SPLIT_REGEX = /(；|;|。|(?<!時)(?:，|,)(?=[^；;。]*?裝備時))/;
        const { ref, computed, watch, onMounted, onUnmounted, toRef } = Vue;
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
                        partialItem.parentName = val.item.name;
                        partialItem.slotKey = key;
                        items.push(partialItem);
                    }
                } else if (key === 'rear_hero' || key === 'front_hero') {
                    items.push({ name: val, category: '副將' });
                } else {
                    const item = Object.create(val);
                    item.slotKey = key;
                    items.push(item);
                }
            });
            return items;
        };
        const checkSegmentSync = (segment, sourceItemName, equipConfig, context = null) => {
            if (!segment || typeof segment !== 'string') return true;

            let setCounts, equippedNames, goldCount;
            
            // 若上層有提供 context，直接套用，省去重複掃描所有裝備的時間
            if (context && context.setCounts) {
                setCounts = context.setCounts;
                equippedNames = context.equippedNames;
                goldCount = context.goldCount;
            } else {
                // 退回模式 (例如 UI 單件預覽時)，手動計算一次
            const equippedItems = getEquippedItemsSync(equipConfig);
            const normalItems = equippedItems.filter(item => {
                return !(item.effects || []).some(eff => typeof eff === 'string' && eff.includes('裝備5件金色品質'));
            });
                goldCount = normalItems.filter(item => item.name && !item.name.includes('紫色')).length;
                setCounts = {};
            normalItems.forEach(item => {
                if (item.sets) {
                    item.sets.split(' ').forEach(s => { if (s.trim()) setCounts[s.trim()] = (setCounts[s.trim()] || 0) + 1; });
                }
            });
                equippedNames = new Set(equippedItems.map(i => i.name));
                if (equipConfig.rear_hero) equippedNames.add(equipConfig.rear_hero);
                if (equipConfig.front_hero) equippedNames.add(equipConfig.front_hero);
            }

            // 3. 解析需求並判斷
            const countMatch = segment.match(/裝備\s*(\d+)\s*件(金色品質)?\s*(.+?)(?:套|時|$)/);
            if (countMatch) {
                const required = parseInt(countMatch[1]);
                const isGoldReq = !!countMatch[2];
                const rawSetName = (countMatch[3] || '').trim();
                const cleanedRequiredSet = cleanName(rawSetName);
                let currentCount = 0;

                if (cleanedRequiredSet && cleanedRequiredSet !== '金色' && cleanedRequiredSet !== '品質') {
                    Object.keys(setCounts).forEach(s => {
                        if (cleanName(s).includes(cleanedRequiredSet) || cleanedRequiredSet.includes(cleanName(s))) {
                            currentCount += setCounts[s]; 
                        }
                    });
                } else if (isGoldReq) {
                    currentCount = goldCount;
                }

                if (currentCount < required) return false;
            }

            // 4. 同時上陣/裝備判定
            if (segment.includes('同時上陣') || segment.includes('同時裝備') || segment.includes('必須含有')) {
                const bracketMatch = segment.match(/\(([^)]+)\)/);
                const pairMatch = segment.match(/(?:同時裝備|必須含有|同時上陣)\s*(?:【)?([^，；。）】\s]+)(?:】)?/);
                const targets = [];
                if (bracketMatch) targets.push(bracketMatch[1].trim());
                if (pairMatch) targets.push(pairMatch[1].trim());
                if (targets.length > 0) {
                    if (!targets.some(name => name.includes('件') || equippedNames.has(name))) return false;
                }
            }
            if (segment.includes('前軍副將') && sourceItemName === 'rear_hero') return false;
            if (segment.includes('後軍副將') && sourceItemName === 'front_hero') return false;
            const lieutTypeMatch = segment.match(/作為(步兵|騎兵|弓兵|方士)副將時/);
            if (lieutTypeMatch && (sourceItemName === 'front_hero' || sourceItemName === 'rear_hero')) {
                const reqs = lieutenantRequirements.value;
                const slotTypes = sourceItemName === 'front_hero' ? reqs.front : reqs.rear;
                if (!slotTypes.includes(lieutTypeMatch[1])) return false;
            }
            if (/作為男性(英雄的)?副將時/.test(segment) && heroState.value.gender !== '男性') return false;
            if (/作為女性(英雄的)?副將時/.test(segment) && heroState.value.gender !== '女性') return false;
            const heroCheck = (kw, cond) => {
                if (!segment.includes(kw)) return false;

                // 排除描述性文字：如果「文官/武將/全才」後面接的是「類英雄」或「類技能」，不視為身分限制
                if (/文官|武將|全才/.test(kw) && new RegExp(`${kw}(類英雄|類技能|類技|類屬性)`).test(segment)) {
                    return false;
                }

                const isHeroRequirement = (new RegExp(`${kw}.*裝備時`).test(segment) ||
                    segment.includes('攜帶' + kw) ||
                    segment.includes('帶領' + kw)) &&
                    !segment.includes('敵方') &&
                    !segment.includes('敵軍') &&
                    !segment.includes('我方');
                const isIdentityKw = /男性|女性|傳奇|國士|巾幗|名將|良才/.test(kw);
                let isBattleOrStat = false;
                if (isIdentityKw) {
                    isBattleOrStat = new RegExp(`(?:對|針對|對戰|對陣|面對|敵方|敵軍|受到)${kw}`).test(segment);
                } else {
                    isBattleOrStat = !isHeroRequirement && (
                        new RegExp(`(?:對|受到|針對|對戰|對陣|面對|敵方|敵軍)${kw}|${kw}.*(?:傷害|免傷|攻擊|防禦|兵力|速度|武力|智力|魅力|統御|格擋|保全|士兵|標記|抗性|狀態|幾率|機率)`).test(segment) ||
                        segment.includes('敵方') || segment.includes('敵軍')
                    );
                }
                if (isHeroRequirement) return !cond;
                if (isBattleOrStat) return false;
                if (segment.includes('非' + kw) || segment.includes('不為' + kw)) return cond;
                if (segment.includes('副將')) { if (heroState.value.isLieutenant) return true; return false; }
                if (/兵力|血量|不足|低於|少於|超過|高於|主將/.test(segment)) return false;
                return !cond;
            };

            if (heroCheck('傳奇英雄', heroState.value.identity === '傳奇')) return false;
            if (heroCheck('國士英雄', heroState.value.identity === '國士')) return false;
            if (heroCheck('名將英雄', heroState.value.identity === '名將')) return false;
            if (heroCheck('良才英雄', heroState.value.identity === '良才')) return false;
            if (heroCheck('巾幗英雄', heroState.value.identity === '巾幗')) return false;
            if (heroCheck('女性', heroState.value.gender === '女性')) return false;
            if (heroCheck('男性', heroState.value.gender === '男性')) return false;
            if (heroCheck('騎兵', heroState.value.fullCategory.includes('騎兵'))) return false;
            if (heroCheck('弓兵', heroState.value.fullCategory.includes('弓兵'))) return false;
            if (heroCheck('步兵', heroState.value.fullCategory.includes('步兵'))) return false;
            if (heroCheck('方士', heroState.value.fullCategory.includes('方士'))) return false;

            const notClassMatch = segment.match(/(?:不為|非|不是)(武將|文官|全才)/);
            if (notClassMatch && heroState.value.class === notClassMatch[1]) return false;
            if (!notClassMatch && !/(對|對戰|受到|針對|面對|敵方|敵軍)(武將|文官|全才)/.test(segment)) {
                const classesInSegment = [];
                if (segment.includes('文官') && !/文官類英雄/.test(segment)) classesInSegment.push('文官');
                if (segment.includes('全才') && !/全才類英雄/.test(segment)) classesInSegment.push('全才');
                if (segment.includes('武將') && !/武將類英雄/.test(segment)) classesInSegment.push('武將');
                if (classesInSegment.length > 0 && !classesInSegment.includes(heroState.value.class)) return false;
            }
            const nameMatch = segment.match(/(.+?)裝備時/);
            if (nameMatch && !/文官|全才|武將|傳奇|國士|名將|良才|女性|男性|巾幗|主將|副將/.test(nameMatch[1]) && !nameMatch[1].includes('已輪迴') && !nameMatch[1].includes('已覺醒') && !heroState.value.selectedHeroName.includes(nameMatch[1])) return false;
            if ((segment.includes('已覺醒') || segment.includes('覺醒英雄')) && !heroState.value.isAwakened) return false;
            if ((segment.includes('已輪迴') || segment.includes('輪迴英雄')) && !heroState.value.isReincarnated) return false;

            // 英雄等級與品質條件預設達成，放在最後作為保底
            if (segment.includes('英雄等級達到') || segment.includes('品質達到金色')) return true;

            return true;
        };

        /**
         * --- 單詞解釋核心 (Word Interpretation Core) ---
         * 負責將「整串效果文字」拆分為「單詞」，並對每個單詞進行分類與數值提取。
         */
        const interpretEffectSync = (eff, sourceItemName, equipConfig, context = {}, options = {}) => {
            if (typeof eff !== 'string') return { words: [], totalStats: {}, hasLinkage: false };

            // 快速掃描模式：利用單行正則掌控「連動」與「目標」判定
            if (options.quickScan) {
                const terms = new Set(['套', '同時裝備', '每裝備', '齊上陣']);
                if (options.targetStats && options.targetStats.length > 0) {
                    options.targetStats.forEach(s => {
                        terms.add(s);
                        // 支援縮寫與四維判定
                        if (['武力', '智力', '統御', '魅力'].includes(s)) {
                            terms.add(s.charAt(0));
                            terms.add('四維');
                        }
                    });
                }
                if (!new RegExp(Array.from(terms).join('|')).test(eff)) {
                    return { isIrrelevant: true, hasLinkage: false, totalStats: {} };
                }
            }

            const results = {
                words: [],
                totalStats: {},
                hasLinkage: false
            };

            const parts = eff.split(EFFECT_SPLIT_REGEX).filter(p => p !== undefined && p !== '');

            parts.forEach(part => {
                // 如果是標點符號或空格，直接視為啟動的純文字段
                if (EFFECT_SPLIT_REGEX.test(part) || !part.trim()) {
                    results.words.push({ text: part, stats: {}, isLinkage: false, isActive: true });
                    return;
                }

                let processedPart = part;
                const wordStats = {};
                const isLinkage = /套|同時裝備|每裝備|齊上陣/.test(part);
                if (isLinkage) results.hasLinkage = true;

                // 1. 處理「分別獲得」邏輯
                if (part.includes('分別') && part.includes('/')) {
                    const classMatch = part.match(/(.+?)\s*裝備時/);
                    if (classMatch) {
                        const classList = classMatch[1].split('/');
                        const idx = classList.indexOf(heroState.value.class);
                        if (idx !== -1) {
                            const effectMatch = part.match(/分別獲得\s*(.+)$/);
                            if (effectMatch) {
                                const effectList = effectMatch[1].split('/');
                                if (effectList[idx]) processedPart = effectList[idx]; else return;
                            }
                        } else return;
                    }
                }

                // 2. 條件判定
                if (!checkSegmentSync(processedPart, sourceItemName, equipConfig, context)) {
                    results.words.push({ text: part, stats: {}, isLinkage, isActive: false });
                    return;
                }
                if (processedPart.includes('每點') || /每\d+點/.test(processedPart)) {
                    results.words.push({ text: part, stats: {}, isLinkage: true, isActive: true });
                    return;
                }

                // 3. 處理倍率 (每 N 件)
                let multiplier = 1;
                const cnToNum = (s) => { const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 }; return map[s] || parseInt(s) || 1; };
                const stackMatch = processedPart.match(/每裝備\s*(\d+|一|二|三|四|五|六)\s*件\s*(.+?)套/);
                const listStackMatch = processedPart.match(/在\s*(.+?)\s*中每裝備\s*(\d+|一|二|三|四|五|六)\s*件/);

                if (stackMatch && context.setCounts) {
                    const unit = cnToNum(stackMatch[1]);
                    const cleanedStackSet = cleanName(stackMatch[2]);
                    let currentCount = 0;
                    Object.keys(context.setCounts).forEach(s => { if (cleanName(s).includes(cleanedStackSet) || cleanedStackSet.includes(cleanName(s))) currentCount = context.setCounts[s]; });
                    multiplier = Math.floor(currentCount / unit);
                } else if (listStackMatch && context.equippedNames) {
                    const itemsInList = (listStackMatch[1].match(/【(.+?)】/g) || []).map(m => m.replace(/[【】]/g, '').trim());
                    let currentCount = 0;
                    itemsInList.forEach(name => { if (context.equippedNames.has(name)) currentCount++; });
                    multiplier = Math.floor(currentCount / cnToNum(listStackMatch[2]));
                }

                if (multiplier <= 0) {
                    results.words.push({ text: part, stats: {}, isLinkage, isActive: false });
                    return;
                }

                // 4. 數值提取
                const masterRegex = /(主將|自身|全軍|後軍|前軍|近戰|步兵|騎兵|弓兵|方士|英雄|傳奇|國士|巾幗|名將|良才)?\s*(?:((?:武力|統御|智力|魅力|武|智|統|魅|四維|全四維|基礎攻擊|基礎防禦|攻擊|防禦|兵力|速度|傷害|免傷|傷害強度|傷害減免|格擋率|暴擊率|暴擊傷害|格擋傷害|暴擊傷害)(?:[\/\s、]*(?:武力|統御|智力|魅力|武|智|統|魅|四維|全四維|基礎攻擊|基礎防禦|攻擊|防禦|兵力|速度|傷害|免傷|傷害強度|傷害減免|格擋率|暴擊率|暴擊傷害|格擋傷害|暴擊傷害))*)\s*(額外)?\s*([+-]?\s*\d+)(點|%|)|([+-]?\s*\d+)(點|%|)\s*((?:武力|統御|智力|魅力|武|智|統|魅|四維|全四維|基礎攻擊|基礎防禦|攻擊|防禦|兵力|速度|傷害|免傷|傷害強度|傷害減免|格擋率|暴擊率|暴擊傷害|格擋傷害|暴擊傷害)(?:[\/\s、]*(?:武力|統御|智力|魅力|武|智|統|魅|四維|全四維|基礎攻擊|基礎防禦|攻擊|防禦|兵力|速度|傷害|免傷|傷害強度|傷害減免|格擋率|暴擊率|暴擊傷害|格擋傷害|暴擊傷害))*))/g;
                const eachRegex = /([主將|自身|全軍|後軍|前軍|近戰|步兵|騎兵|弓兵|方士|英雄|傳奇|國士|巾幗|名將|良才\s]*)?([武力|智力|魅力|統御|四維|基礎攻擊|基礎防禦|攻擊|防禦|兵力|速度|傷害|免傷|、\s]+)各\s*([+-]\s*\d+)(%?)/g;

                // 4.1 各+N
                let em;
                while ((em = eachRegex.exec(processedPart)) !== null) {
                    const prefix = (em[1] || '').trim().replace('英雄', '');
                    if (prefix && !['主將', '自身', '全軍'].includes(prefix) && !(heroState.value.fullCategory || '').includes(prefix)) continue;
                    let targets = em[2].split(/[、\s]+/).filter(Boolean);
                    if (targets.includes('四維')) { targets = targets.filter(s => s !== '四維'); targets.push('武力', '智力', '統御', '魅力'); }
                    const val = parseInt(em[3].replace(/\s+/g, '')) * multiplier;
                    const unit = em[4] === '%' ? '%' : '';
                    targets.forEach(s => { const key = s + unit; wordStats[key] = (wordStats[key] || 0) + val; });
                }

                // 4.2 常規
                let m; masterRegex.lastIndex = 0;
                while ((m = masterRegex.exec(processedPart)) !== null) {
                    const prefix = (m[1] || '').replace('英雄', '');
                    if (prefix && !['主將', '自身', '全軍'].includes(prefix) && !(heroState.value.fullCategory || '').includes(prefix)) continue;
                    const statRaw = m[2] || m[8], rawVal = m[4] || m[6], unit = (m[5] || m[7]) === '%' ? '%' : '';
                    if (statRaw && rawVal) {
                        const val = parseInt(rawVal.replace(/\s+/g, '')) * multiplier;
                        statRaw.split(/[/\s、]+/).forEach(sn => {
                            let fn = sn.trim();
                            if (fn === '四維' || fn === '全四維') {
                                ['武力', '智力', '統御', '魅力'].forEach(s => { wordStats[s + unit] = (wordStats[s + unit] || 0) + val; });
                            } else {
                                const map = { '武': '武力', '智': '智力', '統': '統御', '魅': '魅力' };
                                if (map[fn]) fn = map[fn];
                                wordStats[fn + unit] = (wordStats[fn + unit] || 0) + val;
                            }
                        });
                    }
                }

                results.words.push({ text: part, stats: wordStats, isLinkage, isActive: true });
                Object.keys(wordStats).forEach(k => { results.totalStats[k] = (results.totalStats[k] || 0) + wordStats[k]; });
            });

            return results;
        };



        const getHeroAndLieutSkillsSync = (equipConfig) => {
            const skills = { rear_hero: [], front_hero: [], hero_fate: [] };
            const hasLieutenant = !!(equipConfig.rear_hero || equipConfig.front_hero);

            if (hasLieutenant) {
                const mainHero = allHeroes.value.find(h => h.name === heroState.value.selectedHeroName);
                if (mainHero) {
                    ['talents', 'fates', 'awakening', 'holy_awakening', 'reincarnation'].forEach(cat => {
                        if (mainHero[cat]) mainHero[cat].forEach(skillText => {
                            if (skillText.includes('同時上陣')) skills.hero_fate.push(skillText);
                        });
                    });
                }
            }

            ['rear_hero', 'front_hero'].forEach(slotId => {
                const lieutName = equipConfig[slotId];
                if (lieutName) {
                    const hero = allHeroes.value.find(h => h.name === lieutName.replace(/^(神·|聖·)/, ''));
                    if (hero) {
                        let cats = ['talents'];
                        if (lieutName.startsWith('聖·')) cats.push('holy_awakening'); else if (lieutName.startsWith('神·')) cats.push('awakening');
                        cats.forEach(cat => {
                            if (hero[cat]) hero[cat].forEach(skill => {
                                if (skill.includes('作為主將') && !skill.includes('或副將')) return;
                                if (/(作為|擔任|擔當|身為).*?副將|副將品質加成|品質加成\(副將\)|\(副將\)|主將(武力|智力|統御|魅力|屬性|攻擊|防禦|兵力|速度|基礎)/.test(skill)) {
                                    skills[slotId].push(skill);
                                }
                            });
                        });
                    }
                }
            });
            return skills;
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
                    source: 'HERO_SKILL',
                    effects: extractedSkills.hero_fate
                });
            }

            ['rear_hero', 'front_hero'].forEach(slotId => {
                const skills = extractedSkills[slotId];
                if (skills && skills.length > 0) {
                    const lieutName = equipConfig[slotId];
                            const posLabel = slotId === 'front_hero' ? '前軍' : '後軍';
                            result.display.push({
                                label: `🎖️ ${posLabel}副將・${lieutName}`,
                                source: slotId,
                                effects: skills
                            });
                            result.skills[slotId] = skills.map(s => ({ text: s }));
                }
            });

            getEquippedItemsSync(equipConfig).forEach((item, index) => {
                if (item.category === '副將') return;

                let displayName = item.name || item.parentName || "未知裝備";
                if (item.isPartial) {
                    displayName = `${displayName}`;
                    let counter = 1;
                    const baseName = displayName;
                    // 檢查陣列中是否已有同名 label
                    while (result.display.some(d => d.label === displayName)) {
                        displayName = `${baseName} ${counter}`;
                        counter++;
                    }
                }

                let effects = item.effects || [];
                if (item.slotKey === 'god') {
                    effects = effects.concat(item.mutation || [], item.rage_cond || [], item.spell || []);
                }

                result.display.push({
                    label: displayName,
                    source: item.name || item.parentName,
                    effects: effects
                });
            });
            return result;
        };
        const calculateTotalStats = (equipConfig = selectedEquip.value) => {
            const totals = {};
            const context = { setCounts: {}, equippedNames: new Set(), goldCount: 0 };
            const equippedItems = getEquippedItemsSync(equipConfig);
            
            // 獨立算出 normalItems (不含「裝備5件金色品質」詞條)，以防迴圈依賴
            const normalItems = equippedItems.filter(item => {
                return !(item.effects || []).some(eff => typeof eff === 'string' && eff.includes('裝備5件金色品質'));
            });
            context.goldCount = normalItems.filter(item => item.name && !item.name.includes('紫色')).length;
            
            normalItems.forEach(item => {
                if (item.sets) item.sets.split(' ').forEach(s => { if (s.trim()) context.setCounts[s.trim()] = (context.setCounts[s.trim()] || 0) + 1; });
            });

            equippedItems.forEach(item => {
                if (item.name) context.equippedNames.add(item.name);
            });
            if (equipConfig.rear_hero) context.equippedNames.add(equipConfig.rear_hero);
            if (equipConfig.front_hero) context.equippedNames.add(equipConfig.front_hero);

            // 1. total_equip(): 裝備統計
            const calculateEquipStats = () => {
                const equipItems = equippedItems.filter(i => i.category !== '副將' && i.slotKey !== 'god');
                const hasYulinLing = equipConfig.token && (equipConfig.token.name === '羽林令' || equipConfig.token === '羽林令');
                const yulinMultipliers = hasYulinLing ? [2, 2, 2, 1, 1] : [1, 1, 1, 1, 1];

                equipItems.forEach(item => {
                    const isYulinSet = item.sets && item.sets.includes('羽林套裝');
                    (item.effects || []).forEach((eff, effIdx) => {
                        const m = isYulinSet ? (yulinMultipliers[effIdx] || 1) : 1;
                        const { words } = interpretEffectSync(eff, item.name, equipConfig, context);
                        words.forEach(word => {
                            if (word.isActive) Object.keys(word.stats).forEach(k => { totals[k] = (totals[k] || 0) + word.stats[k] * m; });
                        });
                    });
                });
            };

            // 2. total_副將(): 副將與主將技能統計
            const calculateLieutenantStats = () => {
                const extractedSkills = getHeroAndLieutSkillsSync(equipConfig);
                
                // 副將技能
                ['rear_hero', 'front_hero'].forEach(slotId => {
                    extractedSkills[slotId].forEach(skillText => {
                        // 注意：副將技能通常不帶 context，因為它的條件比較單純
                        const { totalStats } = interpretEffectSync(skillText, slotId, equipConfig);
                        Object.keys(totalStats).forEach(k => { totals[k] = (totals[k] || 0) + totalStats[k]; });
                    });
                });

                // 主將技能/宿命
                extractedSkills.hero_fate.forEach(skillText => {
                    const { totalStats } = interpretEffectSync(skillText, 'HERO_SKILL', equipConfig, context);
                            Object.keys(totalStats).forEach(k => { totals[k] = (totals[k] || 0) + totalStats[k]; });
                });
            };

            calculateEquipStats();
            calculateLieutenantStats();


            // 恢復：僅回傳四維屬性，避免結構複雜化
            const res = {};
            ['武力', '智力', '魅力', '統御'].forEach(k => {
                res[k] = totals[k] || 0;
            });
            return res;
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


        const selectHero = (name) => {
            if (activeHeroSlot.value === 'rear_hero' || activeHeroSlot.value === 'front_hero') {
                selectedEquip.value[activeHeroSlot.value] = name;
                activeSlot.value = null; // 關閉插槽彈窗
            } else {
                heroState.value.selectedHeroName = name;
                updateHeroAttributes(name);

                // 檢查副將是否仍然合格
                ['rear_hero', 'front_hero'].forEach(slot => {
                    const lieutName = selectedEquip.value[slot];
                    if (lieutName) {
                        // 1. 不能與主將相同
                        if (lieutName === name) {
                            selectedEquip.value[slot] = null;
                            return;
                        }
                        // 2. 軍種必須匹配
                        const heroData = allHeroes.value.find(h => h.name === lieutName);
                        if (heroData && !isHeroValidForLieutenant(heroData, slot)) {
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


        // 當主將變更時，自動檢查並清空不符合條件的副將
        watch(() => heroState.value.selectedHeroName, (newHeroName) => {
            if (!newHeroName) return;
            const mainHero = allHeroes.value.find(h => h.name === newHeroName);
            if (!mainHero) return;

            // 1. 預先計算新主將的宿命對象
            const fateHeroNames = new Set();
            const fateCategories = new Set();
            ['talents', 'fates', 'awakening', 'holy_awakening', 'reincarnation'].forEach(cat => {
                if (mainHero[cat]) {
                    mainHero[cat].forEach(text => {
                        if (text.includes('同時上陣') || text.includes('齊上陣') || text.includes('一同上陣')) {
                            const anyMatch = text.match(/與任意([^同時上陣齊上陣一同上陣\s，。：]+)/);
                            if (anyMatch) {
                                fateCategories.add(anyMatch[1].trim());
                            } else {
                                const nameMatch = text.match(/(?:與|、)([^與、同時上陣齊上陣一同上陣\s，。：]+?)(?:同時上陣|齊上陣|一同上陣)/) || text.match(/\(([^)]+)\)/);
                                if (nameMatch) {
                                    nameMatch[1].split(/[、\s]/).forEach(n => fateHeroNames.add(n.trim()));
                                }
                            }
                        }
                    });
                }
            });

            // 2. 檢查目前已選用的副將是否依然合法
            ['rear_hero', 'front_hero'].forEach(slot => {
                const lieutName = selectedEquip.value[slot];
                if (!lieutName) return;

                const baseName = lieutName.replace(/^(神·|聖·)/, '');
                const lHero = allHeroes.value.find(h => h.name === baseName);
                if (!lHero) {
                    selectedEquip.value[slot] = null;
                    return;
                }

                // 檢查是否為宿命對象
                const isFate = fateHeroNames.has(baseName);
                const heroCat = lHero.category || '';
                const matchesAnyFate = Array.from(fateCategories).some(cat => heroCat.includes(cat));

                // 檢查軍種/全能資質
                const isValidType = isHeroValidForLieutenant(lHero, slot);

                // 如果既不是宿命，軍種也不符，則清空
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
            const cat = heroState.value.fullCategory || '';
            const front = [];
            const rear = [];
            if (cat.includes('騎兵')) front.push('騎兵');
            if (cat.includes('步兵')) front.push('步兵');
            if (cat.includes('弓兵')) rear.push('弓兵');
            if (cat.includes('方士')) rear.push('方士');
            return { front, rear };
        });

        const isHeroValidForLieutenant = (hero, slot) => {
            if (!hero) return true;
            // 檢查是否具備「可擔當任意英雄的任意兵種副將」天賦 (劉邦為例外)
            const isUniversal = hero.name === '劉邦' || (hero.talents || []).some(t => t.includes('可擔當任意英雄的任意兵種副將'));
            if (isUniversal) return true;

            const hCat = hero.category || '';
            const reqs = lieutenantRequirements.value;
            if (slot === 'front_hero') {
                return reqs.front.some(r => hCat.includes(r));
            } else if (slot === 'rear_hero') {
                return reqs.rear.some(r => hCat.includes(r));
            }
            return true;
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
                    ['talents', 'fates', 'awakening', 'holy_awakening', 'reincarnation'].forEach(cat => {
                        if (mainHero[cat]) {
                            mainHero[cat].forEach(text => {
                                if (text.includes('同時上陣') || text.includes('齊上陣') || text.includes('一同上陣')) {
                                    // 1. 檢查「任意類別」格式，例如：與任意文官同時上陣
                                    const anyMatch = text.match(/與任意([^同時上陣齊上陣一同上陣\s，。：]+)/);
                                    if (anyMatch) {
                                        fateCategories.add(anyMatch[1].trim());
                                    } else {
                                        // 2. 檢查具體姓名格式，例如：與馬超同時上陣 或 舉火鏖戰(馬超)
                                        const nameMatch = text.match(/(?:與|、)([^與、同時上陣齊上陣一同上陣\s，。：]+?)(?:同時上陣|齊上陣|一同上陣)/) || text.match(/\(([^)]+)\)/);
                                        if (nameMatch) {
                                            nameMatch[1].split(/[、\s]/).forEach(n => fateHeroNames.add(n.trim()));
                                        }
                                    }
                                }
                            });
                        }
                    });
                }

                // 構建最終清單，處理「神·」版本與重複檢查
                const finalHeroList = [];
                const lieutRegex = /(作為|擔任|擔當|身為).*?副將|副將品質加成|品質加成\(副將\)|可擔當.+?副將|\(副將\)|主將(武力|智力|統御|魅力|屬性|攻擊|防禦|兵力|速度|基礎)/;

                // 取得另一個位置已選用的副將姓名 (用以排除重複)
                const otherSlot = activeHeroSlot.value === 'front_hero' ? 'rear_hero' : 'front_hero';
                const otherHeroName = selectedEquip.value[otherSlot];
                const baseOtherHeroName = otherHeroName ? otherHeroName.replace(/^(神·|聖·)/, '') : null;

                list.forEach(h => {
                    if (h.name === heroState.value.selectedHeroName) return;
                    // 排除已在另一個位置選用的英雄 (包含神、聖版本)
                    if (baseOtherHeroName && h.name === baseOtherHeroName) return;

                    const isFate = fateHeroNames.has(h.name);
                    const heroCat = h.category || '';
                    const matchesAnyFate = Array.from(fateCategories).some(cat => heroCat.includes(cat));
                    const filterLieut = (skillList) => {
                        return (skillList || []).some(skillText => {
                            if (skillText.includes('作為主將') && !skillText.includes('或副將')) return false;
                            return lieutRegex.test(skillText);
                        });
                    };

                    const hasTalentLieut = filterLieut(h.talents);
                    const hasAwakeningLieut = filterLieut(h.awakening);
                    const hasHolyLieut = filterLieut(h.holy_awakening);
                    const isValidType = isHeroValidForLieutenant(h, activeHeroSlot.value);

                    // A. 原版英雄：如果是宿命對象 (無視軍種) OR (符合軍種 且 (符合類別宿命 或 有天賦副將技))
                    if (isFate || (isValidType && (matchesAnyFate || hasTalentLieut))) {
                        finalHeroList.push(h);
                    }

                    // B. 「神·」版本：如果覺醒中有副將技 (需符合軍種)
                    if (isValidType && hasAwakeningLieut) {
                        finalHeroList.push({ ...h, name: '神·' + h.name, isDivine: true });
                    }

                    // C. 「聖·」版本：如果聖覺醒中有副將技 (需符合軍種)
                    if (isValidType && hasHolyLieut) {
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
        const cleanName = (name) => {
            if (!name) return '';
            return name.replace(/(金色|紫色|品質|套裝|套)/g, '').trim();
        };

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

        const isPopoverUpwards = (slotId) => {
            const el = document.querySelector(`.equip-slot.${slotId}`);
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.bottom > window.innerHeight * 0.7;
        };

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
            const baseName = heroName.replace(/^(神·|聖·)/, '');
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
                if (typeof hideItemPreview === 'function') hideItemPreview(true);
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


        const statAggregation = computed(() => {
            const config = { ...selectedEquip.value };
            return calculateTotalStats(config);
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
            if (config.h) {
                heroState.value.selectedHeroName = config.h;
                updateHeroAttributes(config.h);
            }
            const status = config.s || 0;
            heroState.value.isAwakened = !!(status & 1);
            heroState.value.isReincarnated = !!(status & 2);
            heroState.value.isLieutenant = !!(status & 4);
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
                        [() => props.allItems, allHeroes, allGods],
                        ([items, heroes, gods]) => {
                            if (items && items.length > 0 && heroes && heroes.length > 0 && gods && gods.length > 0) {
                                try {
                                    const config = decompress(target, heroes, items, gods);
                                    loadConfig(config);
                                } catch (e) { }
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
                        sortStats.value.forEach(stat => {
                            currentItemBonus += (potentialTotals[stat] || 0) - (currentTotals[stat] || 0);
                        });
                        if (currentItemBonus > maxItemBonus) maxItemBonus = currentItemBonus;
                    });
                    total = maxItemBonus;
                } else {
                    tempEquip[slot.id] = item;
                    const potentialTotals = calculateTotalStats(tempEquip);
                    sortStats.value.forEach(stat => {
                        total += (potentialTotals[stat] || 0) - (currentTotals[stat] || 0);
                    });
                }
                return total;
            },
            clearAllEquip, hasSelectedItems, combinedEffects,
            statAggregation, allSets, applySet,
            heroState,
            renderEffectSegments(eff, source = null) {
                if (!eff) return [];
                const interpretation = interpretEffectSync(eff, source, selectedEquip.value);
                return interpretation.words.map(word => ({
                    text: word.text,
                    active: word.isActive
                }));
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
                    s: (heroState.value.isAwakened ? 1 : 0) | (heroState.value.isReincarnated ? 2 : 0) | (heroState.value.isLieutenant ? 4 : 0),
                    e: {}
                };

                Object.entries(selectedEquip.value).forEach(([k, v]) => {
                    if (!v) return;
                    if (k.endsWith('_p')) {
                        config.e[k] = { n: v.item.name, i: v.effectIdx };
                    } else {
                        // 處理一般插槽與副將插槽 (副將插槽存的是字串，一般插槽存的是物件)
                        config.e[k] = typeof v === 'string' ? v : v.name;
                    }
                });

                try {
                    const encoded = compress(config);
                    // 取得不含參數的基礎路徑
                    const baseUrl = window.location.origin + window.location.pathname;
                    const shareUrl = `${baseUrl}#sim?c=${encoded}`;

                    // 備援機制：如果無法使用剪貼簿 API (如 Android 無痕模式)，則自動切換至手動複製
                    Utils.copyToClipboard(shareUrl).then(() => {
                        alert('配置連結已複製到剪貼簿！');
                    }).catch(() => {
                        window.prompt('複製失敗，請手動複製下方連結：', shareUrl);
                    });
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
                        </div>

                        <!-- 裝備詳細清單 -->
                        <div v-for="item in combinedEffects" :key="item.label" class="summary-group">
                            <div class="summary-item-title">{{ item.label }}</div>
                            <ul class="summary-effects-list">
                                <li v-for="(eff, idx) in item.effects" :key="idx">
                                    <template v-for="segments in [renderEffectSegments(eff, item.source)]">
                                        <span v-for="(seg, sidx) in segments" :key="sidx" :class="{ 'inactive-segment': !seg.active }">
                                            {{ seg.text }}
                                        </span>
                                        <span v-if="segments.length > 0 && !segments.every(s => s.active)" class="inactive-tag">(未達成條件)</span>
                                    </template>
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
