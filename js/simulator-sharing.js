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
                writer.write(4, SIM_BIT_CONFIG_V2.EFFECT_IDX);
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
        const config = { h: hName, s: hFlags, e: {}, st: [], sl: {} };

        SIM_BIT_SLOT_ORDER.forEach((key) => {
            const pool = getPoolFn(key);
            if (key === 'front_hero' || key === 'rear_hero') {
                const dType = reader.read(SIM_BIT_CONFIG_V2.HERO_TYPE);
                const id = reader.read(SIM_BIT_CONFIG_V2.HERO_ID);
                reader.read(SIM_BIT_CONFIG_V2.EFFECT_IDX);
                if (id !== (1 << SIM_BIT_CONFIG_V2.HERO_ID) - 1 && id < pool.length) {
                    let dName = pool[id].name;
                    if (dType === 1 && !dName.startsWith('聖·')) dName = '聖·' + dName;
                    else if (dType === 2 && !dName.startsWith('神·')) dName = '神·' + dName;
                    config.e[key] = dName;
                }
            } else if (key === 'god') {
                const id = reader.read(SIM_BIT_CONFIG_V2.GOD_ID);
                if (id !== (1 << SIM_BIT_CONFIG_V2.GOD_ID) - 1 && id < pool.length) config.e[key] = pool[id];
            } else {
                const id = reader.read(SIM_BIT_CONFIG_V2.ITEM_ID);
                const eId = reader.read(SIM_BIT_CONFIG_V2.EFFECT_IDX);
                if (id !== (1 << SIM_BIT_CONFIG_V2.ITEM_ID) - 1 && id < pool.length) {
                    if (key.endsWith('_p')) config.e[key] = { item: pool[id], effectIdx: eId };
                    else config.e[key] = pool[id];
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

    return {
        packConfigV2,
        unpackConfigV2,
        compress,
        decompress,
        parseUrlParams() {
            const params = new URLSearchParams(window.location.search);
            const sim = params.get('sim');
            const legacy = params.get('c');
            return { sim, legacy };
        }
    };
})();
