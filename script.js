// ======================================================
//  パチスロ設定推測ツール（PaddleOCR.js 新SDK版）
// ======================================================

// ▼ 機種データ
let MACHINE_FILES = [];
let machines = [];
let currentChart = null;

// ▼ PaddleOCR インスタンス
let ocr = null;

// ======================================================
//  ▼ PaddleOCR.js 初期化（新SDK）
// ======================================================
async function initPaddleOCR() {
  if (ocr) return;

  // CDN から PaddleOCR.js を読み込む
  const module = await import("https://cdn.jsdelivr.net/npm/paddleocrjs/dist/ocr.js");
  const PaddleOCR = module.PaddleOCR;

  ocr = await PaddleOCR.create({
    lang: "en"   // 日本語モデル（数字にも強い）
  });

  console.log("PaddleOCR.js 初期化完了");
}

// ======================================================
//  ▼ 画像縮小（最大幅 1200px）
// ======================================================
function resizeImage(img, maxWidth = 1200) {
  if (img.width <= maxWidth) return img;

  const scale = maxWidth / img.width;
  const canvas = document.createElement("canvas");
  canvas.width = maxWidth;
  canvas.height = img.height * scale;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const resized = new Image();
  resized.src = canvas.toDataURL("image/jpeg", 0.9);
  return resized;
}

// ======================================================
//  ▼ ガンマ補正（白飛び抑制）
// ======================================================
function applyGamma(imageData, gamma = 0.7) {
  const data = imageData.data;
  const inv = 1 / gamma;

  for (let i = 0; i < data.length; i += 4) {
    data[i]     = 255 * Math.pow(data[i] / 255, inv);
    data[i + 1] = 255 * Math.pow(data[i + 1] / 255, inv);
    data[i + 2] = 255 * Math.pow(data[i + 2] / 255, inv);
  }
  return imageData;
}

// ======================================================
//  ▼ ローカルコントラスト強調（簡易CLAHE）
// ======================================================
function localContrast(imageData) {
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;

  const radius = 10;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {

      let sum = 0, count = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

          const idx = (ny * w + nx) * 4;
          sum += data[idx];
          count++;
        }
      }

      const avg = sum / count;
      const idx = (y * w + x) * 4;

      const v = data[idx] * 1.4 - avg * 0.4;
      const clamped = Math.max(0, Math.min(255, v));

      data[idx] = data[idx + 1] = data[idx + 2] = clamped;
    }
  }

  return imageData;
}

// ======================================================
//  ▼ 二値化＋膨張処理（数字を太らせる）
// ======================================================
function binarizeAndThicken(imageData, threshold = 150) {
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;

  for (let i = 0; i < data.length; i += 4) {
    const v = data[i] > threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
  }

  const copy = new Uint8ClampedArray(data);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;

      const neighbors = [
        idx - 4, idx + 4,
        idx - w * 4, idx + w * 4
      ];

      if (neighbors.some(i => copy[i] === 255)) {
        data[idx] = data[idx + 1] = data[idx + 2] = 255;
      }
    }
  }

  return imageData;
}

// ======================================================
//  ▼ 数字補正（先頭0削除のみ）
// ======================================================
function fixNumber(num) {
  if (num === null || isNaN(num)) return null;

  let s = String(num);
  while (s.length > 1 && s[0] === "0") {
    s = s.substring(1);
  }
  return parseInt(s);
}

// ======================================================
//  ▼ PaddleOCR.js 実行（新SDK）
// ======================================================
async function runPaddleOCR(blob) {
  await initPaddleOCR();

  const buffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(buffer);

  // detectText → 新SDKの標準メソッド
  const result = await ocr.detectText(uint8);
  return result;
}

// ======================================================
//  ▼ BIG / REG / 総回転 を抽出
// ======================================================
function extractNumbers(result) {
  const texts = result.textBlocks.map(b => b.text);

  let big = null, reg = null, games = null;

  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];

    if (!big && /(BIG|BB|大当)/i.test(t)) {
      big = fixNumber(parseInt(texts[i + 1]?.replace(/\D/g, "")));
    }

    if (!reg && /(REG|RB|レギュ)/i.test(t)) {
      reg = fixNumber(parseInt(texts[i + 1]?.replace(/\D/g, "")));
    }

    if (!games && /(総回転|累計|TOTAL)/i.test(t)) {
      games = fixNumber(parseInt(texts[i + 1]?.replace(/\D/g, "")));
    }
  }

  return { big, reg, games };
}

// ======================================================
//  ▼ OCR メイン処理
// ======================================================
async function processImageForOCR(file) {
  if (!file) {
    alert("画像が選択されていません。");
    return;
  }

  document.getElementById("loadingOverlay").style.display = "flex";

  try {
    // ▼ 画像読み込み
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise(r => img.onload = r);

    // ▼ 縮小
    const resized = resizeImage(img);
    await new Promise(r => resized.onload = r);

    // ▼ Canvas に描画
    const canvas = document.createElement("canvas");
    canvas.width = resized.width;
    canvas.height = resized.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(resized, 0, 0);

    // ▼ 前処理
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    imageData = applyGamma(imageData);
    imageData = localContrast(imageData);
    imageData = binarizeAndThicken(imageData);

    ctx.putImageData(imageData, 0, 0);

    // ▼ Blob 化
    const blob = await new Promise(r => canvas.toBlob(r, "image/png"));

    // ▼ PaddleOCR 実行
    const result = await runPaddleOCR(blob);

    // ▼ 数字抽出
    const { big, reg, games } = extractNumbers(result);

    if (games !== null) document.getElementById("gamesInput").value = games;
    if (big   !== null) document.getElementById("bigInput").value   = big;
    if (reg   !== null) document.getElementById("regInput").value   = reg;

  } catch (e) {
    console.error(e);
    alert("読み取りに失敗しました。別の画像でお試しください。");
  } finally {
    document.getElementById("loadingOverlay").style.display = "none";
  }
}

// ======================================================
//  ▼ 推測ロジック（元コード）
// ======================================================
function logLikelihood(nGames, nHit, p) {
  if (p <= 0 || p >= 1) return -Infinity;
  return nHit * Math.log(p) + (nGames - nHit) * Math.log(1 - p);
}

function inferSetting(machine, nGames, nBig, nReg) {
  const logLs = {};

  for (const s in machine.settings) {
    const probs = machine.settings[s];
    const pBig = 1 / probs.big;
    const pReg = 1 / probs.reg;

    const logBig = logLikelihood(nGames, nBig, pBig);
    const logReg = logLikelihood(nGames, nReg, pReg);

    logLs[s] = logBig + logReg;
  }

  const maxLog = Math.max(...Object.values(logLs));
  const weights = {};
  for (const s in logLs) {
    weights[s] = Math.exp(logLs[s] - maxLog);
  }

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const probs = {};
  for (const s in weights) {
    probs[s] = weights[s] / total;
  }

  return probs;
}

// ======================================================
//  ▼ グラフ描画（元コード）
// ======================================================
function drawChart(probs) {
  const ctx = document.getElementById("chartCanvas").getContext("2d");
  const labels = Object.keys(probs);
  const values = labels.map(s => probs[s] * 100);

  if (currentChart) currentChart.destroy();

  currentChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: "推定確率（%）",
        data: values,
        backgroundColor: "rgba(25, 118, 210, 0.7)"
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: value => value + "%" }
        }
      }
    }
  });
}

// ======================================================
//  ▼ 結果表示（元コード）
// ======================================================
function showResult(machine, probs) {
  const resultArea = document.getElementById("resultArea");
  const entries = Object.entries(probs).sort((a, b) => a[0].localeCompare(b[0]));
  let html = `<div>対象機種：<strong>${machine.name}</strong></div>`;
  html += "<div>--- 推測結果 ---</div>";

  for (const [s, p] of entries) {
    html += `<div>設定${s}: ${(p * 100).toFixed(2)}%</div>`;
  }

  const best = entries.reduce((a, b) => (a[1] > b[1] ? a : b))[0];
  html += `<div style="margin-top:8px;"><strong>最も可能性が高いのは『設定${best}』です。</strong></div>`;

  resultArea.innerHTML = html;
}

// ======================================================
//  ▼ 機種データ読み込み（元コード）
// ======================================================
async function loadMachineList() {
  try {
    const res = await fetch("machines/machines.json");
    MACHINE_FILES = await res.json();
  } catch (e) {
    console.error("machines.json の読み込み失敗", e);
  }
}

async function loadMachines() {
  await loadMachineList();

  const select = document.getElementById("machineSelect");
  select.innerHTML = "";

  for (const file of MACHINE_FILES) {
    try {
      const res = await fetch(file);
      const data = await res.json();
      machines.push({ file, data });
    } catch (e) {
      console.error("読み込み失敗:", file, e);
    }
  }

  if (machines.length === 0) {
    select.innerHTML = '<option value="">機種データが読み込めませんでした</option>';
    return;
  }

  select.innerHTML = '<option value="">機種を選択してください</option>';
  machines.forEach((m, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = m.data.name;
    select.appendChild(opt);
  });

  document.getElementById("inferButton").disabled = false;
}

// ======================================================
//  ▼ 推測ボタン
// ======================================================
function setupEvents() {
  document.getElementById("inferButton").addEventListener("click", () => {
    const select = document.getElementById("machineSelect");
    const idx = select.value;
    if (idx === "") {
      alert("機種を選択してください。");
      return;
    }

    const machine = machines[Number(idx)].data;

    const nGames = Number(document.getElementById("gamesInput").value);
    const nBig   = Number(document.getElementById("bigInput").value);
    const nReg   = Number(document.getElementById("regInput").value);

    if (!Number.isFinite(nGames) || !Number.isFinite(nBig) || !Number.isFinite(nReg)) {
      alert("数値を正しく入力してください。");
      return;
    }

    const probs = inferSetting(machine, nGames, nBig, nReg);
    showResult(machine, probs);
    drawChart(probs);
  });
}

// ======================================================
//  ▼ 画像読み取りイベント
// ======================================================
document.getElementById("photoInput").addEventListener("change", async (e) => {
  await processImageForOCR(e.target.files[0]);
});

document.getElementById("cameraInput").addEventListener("change", async (e) => {
  await processImageForOCR(e.target.files[0]);
});

document.getElementById("readImageButton").addEventListener("click", async () => {
  const photoFile = document.getElementById("photoInput").files[0];
  const cameraFile = document.getElementById("cameraInput").files[0];

  const file = cameraFile || photoFile;

  if (!file) {
    alert("先に画像を選択または撮影してください。");
    return;
  }

  await processImageForOCR(file);
});

// ======================================================
//  ▼ 初期化
// ======================================================
window.addEventListener("DOMContentLoaded", () => {
  loadMachines();
  setupEvents();
});
