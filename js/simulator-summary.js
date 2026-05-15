const SimulatorSummary = {
    props: {
        show: Boolean,
        heroState: Object,
        selectedEquip: Object,
        armyData: Array,
        allSkills: Object,
        hasItems: Boolean,
        getEquippedItemsSync: Function,
        getHeroAndLieutSkillsSync: Function,
        getHeroAst: Function,
        renderSegments: Function,
        calculateTotalStats: Function // 新增：傳入計算引擎
    },

    setup(props) {
        const { ref, computed } = Vue;

        const isOpen = ref(false);
        const activeTab = ref('effects'); // 'effects' | 'stats'

        const toggleOpen = () => {
            isOpen.value = !isOpen.value;
        };

        // --- 數值格式化邏輯 (從主程序遷移) ---
        const formatStatValue = (stat, val) => {
            if (val === null) return '';
            const isPercent = /提升|強度|減免|率|傷害|免傷|按比例/.test(stat);
            const isRaw = /基礎|兵力|速度|武力|智力|統御|魅力|攻擊|防禦|次數|豁免/.test(stat) && !isPercent;
            const prefix = val > 0 ? '+' : '';
            return `${prefix}${val}${isRaw ? '' : '%'}`;
        };

        // --- 數據彙總邏輯 (從主程序遷移) ---
        const aggregation = computed(() => {
            if (!props.calculateTotalStats) return { core: {}, left: [], right: [] };

            const totals = props.calculateTotalStats();
            const phaseConfigs = [
                { id: 'y1', keys: ['遠戰首回合', '遠戰回合'] },
                { id: 'y2', keys: ['遠戰第二回合', '遠戰回合'] },
                { id: 'j1', keys: ['近戰首回合', '近戰回合'] },
                { id: 'j2', keys: ['近戰第二回合', '近戰回合'] }
            ];

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
                right: phaseConfigs.map(c => ({ id: c.id, label: c.keys[0], stats: [] }))
            };

            const baseTotals = {};
            const roundBonuses = {};

            Object.entries(totals).forEach(([stat, val]) => {
                if (groups.core.hasOwnProperty(stat)) {
                    groups.core[stat] = val;
                    return;
                }

                // 如果是戰鬥階段屬性 (包含 __C:)，跳過左側統計，由右側 phaseConfigs 處理
                if (stat.includes('__C:')) return;

                let cleanName = stat;
                let position = null;
                const pMatch = stat.match(/__P:(.*?)__/);
                if (pMatch) {
                    position = pMatch[1];
                    cleanName = cleanName.replace(pMatch[0], '');
                }

                const formatted = { name: cleanName, value: formatStatValue(cleanName, val) };
                let pos = position || (cleanName.startsWith('前軍') ? '前軍' : cleanName.startsWith('後軍') ? '後軍' : '其他');

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

            const pureBase = {};
            Object.entries(baseTotals).forEach(([stat, val]) => {
                const clean = stat.replace(/__P:.*?__/, '');
                pureBase[clean] = (pureBase[clean] || 0) + val;
            });


            phaseConfigs.forEach(cfg => {
                const group = groups.right.find(g => g.id === cfg.id);
                const relevantStats = {};
                Object.entries(totals).forEach(([stat, val]) => {
                    let clean = stat;
                    let found = false;
                    cfg.keys.forEach(k => {
                        const tag = `__C:${k}__`;
                        if (stat.includes(tag)) {
                            clean = stat.replace(tag, '');
                            // 將位置標籤還原為文字 (例如 __P:前軍__ -> 前軍)
                            clean = clean.replace(/__P:(.*?)__/, '$1');
                            found = true;
                        }
                    });
                    if (found) relevantStats[clean] = (relevantStats[clean] || 0) + val;
                });

                Object.entries(relevantStats).forEach(([name, val]) => {
                    group.stats.push({ name, value: formatStatValue(name, val) });
                });
            });

            return groups;
        });

        const combinedEffects = computed(() => {
            const result = [];
            const equipConfig = props.selectedEquip;
            if (!equipConfig || !props.getHeroAndLieutSkillsSync) return result;

            const extractedSkills = props.getHeroAndLieutSkillsSync(equipConfig);

            if (extractedSkills.hero_fate.length > 0) {
                result.push({
                    label: `🌟 ${props.heroState.selectedHeroName}・技能宿命`,
                    source: props.heroState.selectedHeroName,
                    effects: extractedSkills.hero_fate.map(s => ({ text: s.text, astEntry: s.astEntry }))
                });
            }

            ['rear_hero', 'front_hero'].forEach(slotId => {
                const skills = extractedSkills[slotId];
                if (skills && skills.length > 0) {
                    const lieutName = equipConfig[slotId];
                    const posLabel = slotId === 'front_hero' ? '前軍' : '後軍';
                    result.push({
                        label: `🎖️ ${posLabel}副將・${lieutName}`,
                        source: lieutName,
                        position: posLabel,
                        effects: skills.map(s => ({ text: s.text, astEntry: s.astEntry }))
                    });
                }
            });

            if (props.getEquippedItemsSync) {
                props.getEquippedItemsSync(equipConfig).forEach((item) => {
                    if (item.slotKey && item.slotKey.endsWith('_hero')) return;

                    let displayName = item.name || item.parentName || "未知裝備";
                    let effects = item.effects || [];
                    if (item.slotKey === 'god') {
                        effects = effects.concat(item.mutation || [], item.rage_cond || [], item.spell || []);
                    }

                    result.push({
                        label: displayName,
                        source: item.name || item.parentName,
                        effects: effects.map((eff, localIdx) => ({
                            text: eff,
                            effIdx: item.isPartial ? item.effectIdx : localIdx
                        }))
                    });
                });
            }

            return result;
        });

        return {
            isOpen,
            activeTab,
            toggleOpen,
            combinedEffects,
            aggregation
        };
    },

    template: `
        <div v-if="show" style="height: 100%;">
            <teleport to="body">
                <button class="mobile-summary-toggle" :class="{ 'is-open': isOpen }" @click="toggleOpen">
                    <i :class="isOpen ? 'fas fa-times' : 'fas fa-chart-bar'"></i>
                </button>
            </teleport>

            <div class="summary-overlay" :class="{ 'show': isOpen }" @click="isOpen = false"></div>

            <div class="simulator-summary" :class="{ 'mobile-open': isOpen }">
                <div class="summary-header">
                    <span class="header-tag">屬性彙總</span>
                </div>

                <div class="summary-content">
                    <template v-if="hasItems">
                        <div class="stats-grid core-grid">
                            <div v-for="(val, stat) in aggregation.core" :key="stat" class="stat-pill">
                                <span class="stat-name">{{ stat }}</span>
                                <span class="stat-value" :class="{ 'pos': val > 0, 'neg': val < 0 }">+{{ val }}</span>
                            </div>
                        </div>

                        <div class="summary-tabs">
                            <button :class="{ active: activeTab === 'effects' }" @click="activeTab = 'effects'">
                                <i class="fas fa-magic"></i> 裝備詞綴
                            </button>
                            <button :class="{ active: activeTab === 'stats' }" @click="activeTab = 'stats'">
                                <i class="fas fa-list-ul"></i> 數值計算
                            </button>
                        </div>

                        <div class="summary-tab-content">
                            <div v-if="activeTab === 'stats'" class="tab-pane stats-pane">
                                <div class="stat-summary-details">
                                    <div class="stat-col left-col">
                                        <div v-for="group in aggregation.left" :key="group.id" class="stat-group">
                                            <div class="group-header">{{ group.label }}</div>
                                            <div class="group-content">
                                                <div v-for="stat in group.stats" :key="stat.name" class="stat-detail-item">
                                                    <span class="name">{{ stat.name }}</span>
                                                    <span class="value">{{ stat.value }}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="stat-col right-col">
                                        <div v-for="group in aggregation.right" :key="group.id" class="stat-group">
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

                            <div v-if="activeTab === 'effects'" class="tab-pane effects-pane">
                                <div v-for="item in combinedEffects" :key="item.label" class="summary-group">
                                    <div class="summary-item-title">{{ item.label }}</div>
                                    <ul class="summary-effects-list">
                                        <li v-for="(eff, idx) in item.effects" :key="idx">
                                            <template v-for="segments in [renderSegments(eff, item.source, { position: item.position, isDeputy: !!item.position })]">
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
