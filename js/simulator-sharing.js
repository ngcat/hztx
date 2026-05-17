/**
 * 模擬配裝器分享與壓縮邏輯 (恢復原始位移邏輯版)
 */
window.SimSharing = (() => {
    const SIM_BIT_CONFIG_V2 = {
        VERSION: 4,     // 0-15
        HERO_ID: 8,     // 0-255
        HERO_TYPE: 2,   // 0-3 (普通, 聖, 神)
        HERO_FLAGS: 3,  // 0-7 (bit0:覺醒, bit1:轉生)
        ITEM_ID: 9,     // 0-511
        GOD_ID: 7,      // 0-127
        EFFECT_IDX: 3   // 0-7
    };

    const SIM_BIT_SLOT_ORDER = [
        'weapon', 'mount', 'book', 'treasure', 'token', 'hunyu',
        'weapon_p', 'mount_p', 'book_p', 'treasure_p', 'token_p',
        'rear_hero', 'front_hero', 'god'
    ];

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

    const packConfigV2 = (config, heroes, equips, gods, getPoolFn) => {
        // 區塊 1：基礎裝備 (固定長度邏輯)
        const writer = new BitWriter();
        writer.write(2, SIM_BIT_CONFIG_V2.VERSION); // Version 2

        // 1. 打包主將
        let hType = 0;
        let cleanName = config.h || '關羽';
        if (cleanName.startsWith('聖·')) { hType = 1; cleanName = cleanName.replace('聖·', ''); }
        else if (cleanName.startsWith('神·')) { hType = 2; cleanName = cleanName.replace('神·', ''); }
        const hIdx = heroes.findIndex(h => h.name === cleanName);
        writer.write(hIdx === -1 ? (1 << SIM_BIT_CONFIG_V2.HERO_ID) - 1 : hIdx, SIM_BIT_CONFIG_V2.HERO_ID);
        writer.write(hType, SIM_BIT_CONFIG_V2.HERO_TYPE);
        writer.write(config.s || 0, SIM_BIT_CONFIG_V2.HERO_FLAGS);
        writer.write(4, SIM_BIT_CONFIG_V2.EFFECT_IDX);

        // 2. 打包插槽
        SIM_BIT_SLOT_ORDER.forEach((key) => {
            const pool = getPoolFn(key);
            const val = config.e[key];
            let name = typeof val === 'string' ? val : (val?.name || val?.n || (val?.item ? (val.item.name || val.item.n) : ''));

            if (key === 'rear_hero' || key === 'front_hero') {
                let dType = 0;
                if (name && name.startsWith('聖·')) { dType = 1; name = name.replace('聖·', ''); }
                else if (name && name.startsWith('神·')) { dType = 2; name = name.replace('神·', ''); }
                writer.write(dType, SIM_BIT_CONFIG_V2.HERO_TYPE);
            }

            let id = -1;
            if (name) {
                id = pool.findIndex(p => p.name === name);
                if (id === -1) id = pool.findIndex(p => p.name === name.replace('聖·', '').replace('神·', ''));
            }

            let currentBitWidth = SIM_BIT_CONFIG_V2.ITEM_ID;
            if (key === 'god') currentBitWidth = SIM_BIT_CONFIG_V2.GOD_ID;
            else if (key === 'rear_hero' || key === 'front_hero') currentBitWidth = SIM_BIT_CONFIG_V2.HERO_ID;

            writer.write(id === -1 ? (1 << currentBitWidth) - 1 : id, currentBitWidth);

            if (key.endsWith('_p')) {
                writer.write(val?.i !== undefined ? val.i : (val?.effectIdx || 0), SIM_BIT_CONFIG_V2.EFFECT_IDX);
            } else if (key !== 'god') {
                const qVal = (config.q && config.q[key] !== undefined) ? config.q[key] : 4;
                writer.write(qVal, SIM_BIT_CONFIG_V2.EFFECT_IDX);
            }
        });

        let result = writer.toString();

        // 區塊 2：稀疏數據 (動態長度)
        const hasStates = config.st && config.st.length > 0;
        const hasSkills = config.sl && Object.keys(config.sl).length > 0;

        if (hasStates || hasSkills) {
            const writer2 = new BitWriter();

            // 寫入狀態
            const allCombatKeys = getPoolFn('combat_keys');
            const activeStates = (config.st || []).map(k => allCombatKeys.indexOf(k)).filter(idx => idx !== -1);
            writer2.write(activeStates.length, 6);
            activeStates.forEach(idx => writer2.write(idx, 8));

            // 寫入技能
            const allRangeKeys = getPoolFn('range_keys');
            const changedSkills = Object.entries(config.sl || {}).map(([k, v]) => {
                return { idx: allRangeKeys.indexOf(k), val: v };
            }).filter(item => item.idx !== -1);
            writer2.write(changedSkills.length, 6);
            changedSkills.forEach(item => {
                writer2.write(item.idx, 8);
                writer2.write(item.val, 8);
            });

            result += '-' + writer2.toString();
        }

        return result;
    };

    const unpackConfigV2 = (str, heroes, equips, gods, getPoolFn) => {
        const parts = str.split('-');
        const reader = new BitReader(parts[0]);
        const version = reader.read(SIM_BIT_CONFIG_V2.VERSION);
        if (version !== 2) throw new Error("Not V2");

        const hIdx = reader.read(SIM_BIT_CONFIG_V2.HERO_ID);
        const hType = reader.read(SIM_BIT_CONFIG_V2.HERO_TYPE);
        const hFlags = reader.read(SIM_BIT_CONFIG_V2.HERO_FLAGS);
        reader.read(SIM_BIT_CONFIG_V2.EFFECT_IDX);

        let hName = (hIdx < heroes.length) ? heroes[hIdx].name : '關羽';
        if (hType === 1 && !hName.startsWith('聖·')) hName = '聖·' + hName;
        else if (hType === 2 && !hName.startsWith('神·')) hName = '神·' + hName;
        const config = { h: hName, s: hFlags, e: {}, st: [], sl: {}, q: {} };

        SIM_BIT_SLOT_ORDER.forEach((key) => {
            const pool = getPoolFn(key);
            if (key === 'front_hero' || key === 'rear_hero') {
                const dType = reader.read(SIM_BIT_CONFIG_V2.HERO_TYPE);
                const id = reader.read(SIM_BIT_CONFIG_V2.HERO_ID);
                const qVal = reader.read(SIM_BIT_CONFIG_V2.EFFECT_IDX);
                if (id !== (1 << SIM_BIT_CONFIG_V2.HERO_ID) - 1 && id < pool.length) {
                    let dName = pool[id].name;
                    if (dType === 1 && !dName.startsWith('聖·')) dName = '聖·' + dName;
                    else if (dType === 2 && !dName.startsWith('神·')) dName = '神·' + dName;
                    config.e[key] = dName;
                    config.q[key] = qVal;
                }
            } else if (key === 'god') {
                const id = reader.read(SIM_BIT_CONFIG_V2.GOD_ID);
                if (id !== (1 << SIM_BIT_CONFIG_V2.GOD_ID) - 1 && id < pool.length) config.e[key] = pool[id];
            } else {
                const id = reader.read(SIM_BIT_CONFIG_V2.ITEM_ID);
                const eId = reader.read(SIM_BIT_CONFIG_V2.EFFECT_IDX);
                if (id !== (1 << SIM_BIT_CONFIG_V2.ITEM_ID) - 1 && id < pool.length) {
                    if (key.endsWith('_p')) config.e[key] = { item: pool[id], effectIdx: eId };
                    else {
                        config.e[key] = pool[id];
                        config.q[key] = eId;
                    }
                }
            }
        });

        // 解析區塊 2 (如果有)
        if (parts[1]) {
            const reader2 = new BitReader(parts[1]);
            try {
                const allCombatKeys = getPoolFn('combat_keys');
                const stCount = reader2.read(6);
                for (let i = 0; i < stCount; i++) {
                    const idx = reader2.read(8);
                    if (allCombatKeys[idx]) config.st.push(allCombatKeys[idx]);
                }
            } catch (e) { }

            try {
                const allRangeKeys = getPoolFn('range_keys');
                const slCount = reader2.read(6);
                for (let i = 0; i < slCount; i++) {
                    const idx = reader2.read(8);
                    const val = reader2.read(8);
                    if (allRangeKeys[idx]) config.sl[allRangeKeys[idx]] = val;
                }
            } catch (e) { }
        }

        return config;
    };

    const hashCode = (str) => {
        if (!str) return 0;
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = (hash * 33) ^ str.charCodeAt(i);
        }
        return hash >>> 0;
    };

    const decompress = (encoded, heroes, items, gods) => {
        try {
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
            if (p + 3 > bytes.length) return null;
            const hHash = (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
            if (hHash !== 0) config.h = scopedMaps.hero[hHash] || null;

            // 2. 狀態 (1 byte)
            if (p < bytes.length) config.s = bytes[p++];

            // 3. 裝備
            slotOrder.forEach(slotId => {
                if (p >= bytes.length) return;
                const iHash = (slotId === 'hunyu' || slotId === 'rear_p' || slotId === 'front_p')
                    ? (p + 3 <= bytes.length ? ((bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++]) : 0)
                    : (p + 2 <= bytes.length ? ((bytes[p++] << 8) | bytes[p++]) : 0);

                if (iHash !== 0) {
                    if (slotId === 'hunyu' || slotId === 'rear_p' || slotId === 'front_p') {
                        config.e[slotId] = scopedMaps.allEquip[iHash];
                    } else if (slotId.endsWith('_p')) {
                        const effIdx = (p < bytes.length) ? bytes[p++] : 0;
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

            // 4. 副將
            if (p + 3 <= bytes.length) {
                const rHash = (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
                if (rHash !== 0) config.e.rear_hero = scopedMaps.hero[rHash] || null;
            }
            if (p + 3 <= bytes.length) {
                const fHash = (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
                if (fHash !== 0) config.e.front_hero = scopedMaps.hero[fHash] || null;
            }

            // 5. 神靈
            if (p + 3 <= bytes.length) {
                const gHash = (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
                if (gHash !== 0) config.e.god = scopedMaps.allEquip[gHash] || null;
            }

            return config;
        } catch (e) {
            console.error('Legacy decompress error:', e);
            return null;
        }
    };

    const compress = (obj) => btoa(encodeURIComponent(JSON.stringify(obj)));

    const saveToCloud = async (heroState, selectedEquip, STABLE_POOLS, getStablePool, currentBuildId = null) => {
        const API_URL = window.APP_CONFIG.API_URL;
        if (!API_URL) return alert('API URL 未配置');

        const basicSlots = ['weapon', 'mount', 'book', 'treasure', 'token'];
        const hasAllBasic = basicSlots.every(slot => selectedEquip[slot]);
        if (!hasAllBasic) {
            alert("儲存失敗：您必須配置滿 5 件核心裝備(神兵、坐騎、寶典、奇珍、令符)才能進行儲存");
            return;
        }

        // 1. 取得 V2 分享代碼 (複用 shareConfig 邏輯)
        const config = {
            h: heroState.selectedHeroName,
            s: (heroState.isAwakened ? 1 : 0) | (heroState.isReincarnated ? 2 : 0) | (heroState.isLieutenant ? 4 : 0),
            st: [], sl: {}, e: {}, q: {}
        };

        Object.keys(heroState.combat).forEach(gName => {
            Object.entries(heroState.combat[gName]).forEach(([k, v]) => {
                if (v) config.st.push(k);
            });
        });

        Object.keys(heroState.range).forEach(cap => {
            Object.entries(heroState.range[cap]).forEach(([k, v]) => {
                if (v > 0) config.sl[k] = v;
            });
        });

        Object.entries(selectedEquip).forEach(([k, v]) => {
            if (!v) return;
            if (k.endsWith('_p')) config.e[k] = { n: v.item.name, i: v.effectIdx };
            else config.e[k] = typeof v === 'string' ? v : v.name;
            if (heroState.equipQuality[k] !== undefined) config.q[k] = heroState.equipQuality[k];
        });

        const shareCode = packConfigV2(config, STABLE_POOLS.heroes, STABLE_POOLS.equips, STABLE_POOLS.gods, getStablePool);

        // 2. ID 解析輔助方法 (依據目前 JSON 順序的 0-based ID)
        const getHeroId = (rawName) => {
            if (!rawName) return '';
            const cleanName = String(rawName).replace(/^[神聖][·\.\s]/, '').trim();
            const idx = STABLE_POOLS.heroes.findIndex(h => h.name === cleanName);
            return idx !== -1 ? idx : '';
        };

        const getEquipId = (rawName) => {
            if (!rawName) return '';
            const cleanName = String(rawName).replace(/[\(\（\[\{].*[\)\）\]\}]/g, '').trim();
            const idx = STABLE_POOLS.equips.findIndex(e => e.name === cleanName);
            return idx !== -1 ? idx : '';
        };

        const getGodId = (rawName) => {
            if (!rawName) return '';
            const cleanName = String(rawName).replace(/[\(\（\[\{].*[\)\）\]\}]/g, '').trim();
            const idx = STABLE_POOLS.gods.findIndex(g => g.name === cleanName);
            return idx !== -1 ? idx : '';
        };

        // 3. 欄位格式化方法
        const getEquipField = (slotId) => {
            const v = selectedEquip[slotId];
            if (!v) return '';
            const name = typeof v === 'string' ? v : (v.name || v.n);
            const eqId = getEquipId(name);
            if (eqId === '') return '';
            const q = heroState.equipQuality[slotId] !== undefined ? heroState.equipQuality[slotId] : 0;
            return `${eqId}_${q}`;
        };

        const getLinkageField = (slotId) => {
            const v = selectedEquip[slotId];
            if (!v) return '';
            const name = v.item?.name || v.n;
            const eqId = getEquipId(name);
            if (eqId === '') return '';
            const effectIdx = v.effectIdx !== undefined ? v.effectIdx : (v.i !== undefined ? v.i : 0);
            return `${eqId}_${effectIdx}`;
        };

        const provider = prompt("即將存入配裝展示\n請輸入作者名稱(10字內)：");
        if (provider === null) return; // 使用者按取消
        const cleanProvider = provider.trim();
        if (!cleanProvider) {
            alert("儲存失敗：作者名稱不可為空！");
            return;
        }
        if (cleanProvider.length > 10) {
            alert("儲存失敗：作者名稱長度不可超過 10 個字！");
            return;
        }

        const isEdit = currentBuildId && parseInt(currentBuildId, 10) >= 2;
        const passwordPromptText = isEdit
            ? `正在編輯配置(ID: ${currentBuildId})\n請輸入原密碼以驗證並更新(不可為空)：`
            : "請輸入此配置的新密碼(日後編輯認證使用，不可為空)：";
        const password = prompt(passwordPromptText);
        if (password === null) return; // 使用者按取消
        const cleanPassword = password.trim();
        if (!cleanPassword) {
            alert("儲存失敗：密碼不可為空！");
            return;
        }

        // 新建配置時，增加重複輸入密碼的確認流程以防打錯
        if (!isEdit) {
            const passwordConfirm = prompt("請再次輸入密碼以進行確認：");
            if (passwordConfirm === null) return; // 使用者按取消
            if (passwordConfirm.trim() !== cleanPassword) {
                alert("儲存失敗：兩次輸入的密碼不一致！");
                return;
            }
        }

        const payload = {
            ID: isEdit ? parseInt(currentBuildId, 10) : '',
            hero: getHeroId(heroState.selectedHeroName),
            isAwakened: heroState.isAwakened,
            isReincarnated: heroState.isReincarnated,
            shareCode: shareCode,
            weapon: getEquipField('weapon'),
            mount: getEquipField('mount'),
            book: getEquipField('book'),
            treasure: getEquipField('treasure'),
            token: getEquipField('token'),
            hunyu: getEquipField('hunyu'),
            rear_hero: getHeroId(selectedEquip.rear_hero),
            front_hero: getHeroId(selectedEquip.front_hero),
            god: selectedEquip.god ? getGodId(selectedEquip.god.name) : '',
            weapon_p: getLinkageField('weapon_p'),
            mount_p: getLinkageField('mount_p'),
            book_p: getLinkageField('book_p'),
            treasure_p: getLinkageField('treasure_p'),
            token_p: getLinkageField('token_p'),
            provider: cleanProvider,
            password: cleanPassword
        };

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                body: JSON.stringify(payload),
                redirect: 'follow'
            });
            const resJson = await response.json();

            if (resJson.status === 'success') {
                alert(resJson.message || '儲存成功！');
                return { ...resJson, provider: cleanProvider };
            } else {
                alert(resJson.message || '儲存失敗');
                return resJson;
            }
        } catch (e) {
            alert('儲存失敗，請檢查網路或 API 設定');
            return { status: 'error', message: e.toString() };
        }
    };

    const getBuilds = async () => {
        const now = Date.now();
        let cached = null;
        try {
            cached = localStorage.getItem('hztx_builds_cache');
        } catch (e) {}
        
        let rawData;

        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (now - parsed.timestamp < 600000) {
                    rawData = parsed.data;
                }
            } catch (e) {
                try {
                    localStorage.removeItem('hztx_builds_cache');
                } catch (err) {}
            }
        }

        if (!rawData) {
            const res = await fetch('https://raw.githubusercontent.com/ngcat/hztx-data/main/build.json?t=' + now);
            rawData = await res.json();
            try {
                localStorage.setItem('hztx_builds_cache', JSON.stringify({
                    timestamp: now,
                    data: rawData
                }));
            } catch (e) {}
        }
        return rawData;
    };

    const clearBuildsCache = () => {
        try {
            localStorage.removeItem('hztx_builds_cache');
        } catch (e) {}
    };

    return {
        packConfigV2,
        unpackConfigV2,
        compress,
        decompress,
        saveToCloud,
        getBuilds,
        clearBuildsCache,
        parseUrlParams() {
            const params = new URLSearchParams(window.location.search);
            const sim = params.get('sim');
            const legacy = params.get('c');
            const id = params.get('id');
            return { sim, legacy, id };
        }
    };
})();
