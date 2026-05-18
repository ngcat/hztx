/**
 * 定時排程主函數：抓取試算表資料，排除密碼，加上 ID，並提交至 GitHub hztx-data (純英文 Headers 版)
 */
function cronSyncToGithub() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Sheet1') || ss.getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  
  if (lastRow <= 1 || lastColumn === 0) {
    Logger.log("工作表沒有資料，略過同步。");
    return;
  }
  
  // 1. 抓取 Sheet 首列與所有資料
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const data = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  
  // 2. 解析並重組 JSON 陣列 (直接取英文 key，排除密碼，前置注入 ID)
  const buildList = data.map((row, idx) => {
    const obj = {};
    
    // 首個屬性為實體列號 ID
    obj['ID'] = idx + 2;
    
    headers.forEach((header, colIdx) => {
      if (!header) return;
      // 直接取英文 Key，無須底線切割
      const key = header.toString().trim();
      
      // 完全排除密碼
      if (key === "password") {
        return;
      }
      
      obj[key] = row[colIdx];
    });
    
    return obj;
  });
  
  // 為了讓最新配裝在最前面顯示，反轉陣列排序
  buildList.reverse();
  
  const jsonString = JSON.stringify(buildList, null, 2);
  
  // 3. 從 GAS Script Properties 取得 GitHub PAT 憑證
  const scriptProperties = PropertiesService.getScriptProperties();
  const pat = scriptProperties.getProperty('PAT') || scriptProperties.getProperty('GITHUB_PAT');
  
  if (!pat) {
    Logger.log("錯誤：未在 GAS 專案設定中找到名稱為 'PAT' 或 'GITHUB_PAT' 的環境參數！");
    return;
  }
  
  // 4. 設定 GitHub API 傳遞細節
  const owner = "ngcat";
  const repo = "hztx-data";
  const path = "build.json";
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  
  // 5. 獲取 GitHub 上 build.json 既有的 sha (如果檔案已存在，更新時必須帶入 sha)
  let sha = null;
  const getHeaders = {
    "Authorization": "Bearer " + pat,
    "Accept": "application/vnd.github+json",
    "User-Agent": "GoogleAppsScript"
  };
  
  try {
    const getResponse = UrlFetchApp.fetch(apiUrl, {
      method: "get",
      headers: getHeaders,
      muteHttpExceptions: true
    });
    
    if (getResponse.getResponseCode() === 200) {
      const fileInfo = JSON.parse(getResponse.getContentText());
      sha = fileInfo.sha;
    }
  } catch (e) {
    Logger.log("獲取 existing sha 出錯 (可能是新檔案): " + e.toString());
  }
  
  // 6. Base64 編碼 JSON 內容 (GitHub API 規定)
  const base64Content = Utilities.base64Encode(jsonString, Utilities.Charset.UTF_8);
  
  // 7. 提交 Commit 請求 (PUT)
  const payload = {
    message: `Auto-sync: Update build.json to Row ${lastRow} via GAS Cron`,
    content: base64Content
  };
  if (sha) {
    payload.sha = sha;
  }
  
  const postHeaders = {
    "Authorization": "Bearer " + pat,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "GoogleAppsScript"
  };
  
  const options = {
    method: "put",
    headers: postHeaders,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(apiUrl, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();
  
  if (responseCode === 200 || responseCode === 201) {
    Logger.log("🎉 成功同步！build.json 已順利 commit 到 GitHub " + owner + "/" + repo);
  } else {
    Logger.log("❌ 同步失敗，錯誤代碼: " + responseCode + ", 回傳內容: " + responseText);
  }
}

/**
 * 輔助設定函數：手動執行此函數，可自動建立每 10 分鐘自動執行一次的排程驅動器
 */
function createCronTrigger() {
  // 先刪除所有既有的同名排程，避免重複建立
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'cronSyncToGithub') {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // 建立每 10 分鐘執行一次的排程
  ScriptApp.newTrigger('cronSyncToGithub')
           .timeBased()
           .everyMinutes(10)
           .create();
           
  Logger.log("🕒 同步排程已成功建立！每 10 分鐘會自動抓取試算表資料同步至 GitHub！");
}
