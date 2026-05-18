// ==========================================
// 1. 初始化設定：執行此函數可自動在試算表第一列生成所有對齊的「英文」欄位名稱 (僅存英文)
// ==========================================
function setupSheetHeaders() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // 定義與前端 build-list.js 及系統專案術語完美對齊的純英文 JSON Key 陣列
  const headers = [
    "timestamp",
    "hero",
    "isAwakened",
    "isReincarnated",
    "shareCode",
    "weapon",
    "mount",
    "book",
    "treasure",
    "token",
    "hunyu",
    "rear_hero",
    "front_hero",
    "god",
    "weapon_p",
    "mount_p",
    "book_p",
    "treasure_p",
    "token_p",
    "provider",
    "password"
  ];
  
  // 清空並寫入首列
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  // 美化首列：凍結首列、加粗、置中、深灰色底、白字
  sheet.setFrozenRows(1);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight("bold")
             .setHorizontalAlignment("center")
             .setBackground("#2c3e50")
             .setFontColor("#ffffff");
             
  Logger.log("試算表欄位名稱已成功更新，已採用純英文 Header 格式！");
}

// ==========================================
// 2. 接收前端 Simulator 送來的 POST 請求 (新增/更新數據)
// ==========================================
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Sheet1') || ss.getActiveSheet();
  
  try {
    // 解析前端傳來的 JSON 數據
    const payload = JSON.parse(e.postData.contents);
    
    // 1. MD5 加密輔助函數
    function md5(str) {
      if (!str) return '';
      const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str, Utilities.Charset.UTF_8);
      let hash = "";
      for (let i = 0; i < digest.length; i++) {
        let byteVal = digest[i];
        if (byteVal < 0) byteVal += 256;
        let byteString = byteVal.toString(16);
        if (byteString.length == 1) byteString = "0" + byteString;
        hash += byteString;
      }
      return hash;
    }
    
    // 2. 直接依據純英文欄位順序進行寫入
    const headers = [
      "timestamp",
      "hero",
      "isAwakened",
      "isReincarnated",
      "shareCode",
      "weapon",
      "mount",
      "book",
      "treasure",
      "token",
      "hunyu",
      "rear_hero",
      "front_hero",
      "god",
      "weapon_p",
      "mount_p",
      "book_p",
      "treasure_p",
      "token_p",
      "provider",
      "password"
    ];
    
    // 判斷是「新增」還是「編輯」
    const isEdit = payload.ID && parseInt(payload.ID, 10) >= 2;
    let targetRowIndex = -1;
    
    if (isEdit) {
      targetRowIndex = parseInt(payload.ID, 10);
      const lastRow = sheet.getLastRow();
      if (targetRowIndex > lastRow) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: "編輯失敗：此 ID 配置不存在！"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      // 密碼驗證：找到 password 欄位在試算表的欄位位置 (1-based index)
      const passwordColIdx = headers.indexOf("password") + 1;
      const storedHash = sheet.getRange(targetRowIndex, passwordColIdx).getValue().toString().trim();
      const incomingHash = payload.password ? md5(payload.password) : "";
      
      if (storedHash && storedHash !== incomingHash) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: "編輯失敗：密碼驗證失敗！無法修改此配置。"
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    const rowData = headers.map(key => {
      // 特殊欄位：時間戳記
      if (key === "timestamp" || key === "createdAt") {
        return isEdit ? sheet.getRange(targetRowIndex, headers.indexOf("timestamp") + 1).getValue() : new Date();
      }
      
      // 特殊欄位：密碼 (寫入時進行 MD5 加密)
      if (key === "password") {
        return payload.password ? md5(payload.password) : "";
      }
      
      // 布林值屬性相容 (採用 1/0 數值對齊位元標記)
      if (key === "isAwakened" && payload.isAwakened !== undefined) {
        return payload.isAwakened ? 1 : 0;
      }
      if (key === "isReincarnated" && payload.isReincarnated !== undefined) {
        return payload.isReincarnated ? 1 : 0;
      }
      
      // 特殊欄位：作者名稱 (後端縱深防護：限 10 字且阻斷公式注入)
      if (key === "provider") {
        const val = payload.provider !== undefined ? String(payload.provider).trim() : "";
        let truncated = Array.from(val).slice(0, 10).join('');
        if (/^[=\+\-@\s]/.test(truncated)) {
          truncated = "'" + truncated;
        }
        return truncated;
      }
      
      // 從 payload 中取出對應的值，若無則填入空字串
      return payload[key] !== undefined ? payload[key] : "";
    });
    
    if (isEdit) {
      // 編輯模式：更新指定列的資料
      sheet.getRange(targetRowIndex, 1, 1, headers.length).setValues([rowData]);
    } else {
      // 新增模式：寫入新的一列
      sheet.appendRow(rowData);
      targetRowIndex = sheet.getLastRow(); // 取得新列號作為 ID
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: isEdit ? "配裝資料更新成功！" : "配裝資料儲存成功！",
      ID: targetRowIndex
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "操作失敗：" + error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// 3. 提供前端讀取配裝列表的 GET 請求，並自動注入「列號 (ID)」
// ==========================================
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Sheet1') || ss.getActiveSheet();
  
  try {
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    
    if (lastRow <= 1 || lastColumn === 0) {
      return ContentService.createTextOutput(JSON.stringify([]))
                          .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 獲取標題與所有資料
    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    
    // 讀取最近的 100 筆或全部
    const numRowsToFetch = Math.min(100, lastRow - 1);
    const startRow = lastRow - numRowsToFetch + 1;
    const data = sheet.getRange(startRow, 1, numRowsToFetch, lastColumn).getValues();
    
    // 組裝資料列表
    const result = data.map((row, idx) => {
      const obj = {};
      
      // 1. 最前面注入列表數字做為 ID
      obj["ID"] = startRow + idx;
      
      headers.forEach((header, colIdx) => {
        if (!header) return;
        
        // 直接取英文 Key 名稱，無須底線切割
        const key = header.toString().trim();
        
        // 2. 讀取時完全排除密碼欄位，確保隱私安全
        if (key === "password") {
          return;
        }
        
        obj[key] = row[colIdx];
      });
      
      return obj;
    });
    
    result.reverse();
    const jsonString = JSON.stringify(result);
    
    return ContentService.createTextOutput(jsonString)
                        .setMimeType(ContentService.MimeType.JSON);
                        
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "讀取失敗：" + error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
