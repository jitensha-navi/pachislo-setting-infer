// ▼ machines/machines.json に一覧をまとめる方式に変更
let MACHINE_FILES = [];
let machines = [];
let currentChart = null;

// ▼ 二項分布の対数尤度
function logLikelihood(nGames, nHit, p) {
  if (p <= 0 || p >= 1) return -Infinity;
  return nHit * Math.log(p) + (nGames - nHit) * Math.log(1 - p);
}

// ▼ 設定推測ロジック
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

// ▼ グラフ描画
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

// ▼ 結果表示
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

// ▼ machines/machines.json を読み込む
async function loadMachineList() {
  try {
    const res = await fetch("machines/machines.json");
    MACHINE_FILES = await res.json();
  } catch (e) {
    console.error("machines.json の読み込み失敗", e);
  }
}

// ▼ 機種 JSON を読み込んでセレクトに反映
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

// ▼ 推測ボタン押下時
function setupEvents() {
  const button = document.getElementById("inferButton");
  button.addEventListener("click", () => {
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

//
// ▼ ローディング表示 ON/OFF
//
function showLoading() {
  document.getElementById("loadingOverlay").style.display = "flex";
}
function hideLoading() {
  document.getElementById("loadingOverlay").style.display = "none";
}

//
// ▼ 数字補正（安全版：先頭の0を削除するだけ）
//
function fixNumber(num) {
  if (num === null || isNaN(num)) return null;

  let s = String(num);

  // 1桁はそのまま
  if (s.length === 1) return num;

  // 先頭の0を削除（例：03 → 3, 0012 → 12）
  while (s.length > 1 && s[0] === "0") {
    s = s.substring(1);
  }

  return parseInt(s);
}

//
// ▼ 数字部分だけを切り出して再OCRする関数（補正付き）
//
async function ocrNumberArea(lines, index) {
  const text = lines[index] || "";
  const numStr = text.replace(/[^0-9]/g, "");

  if (numStr.length > 0) {
    const raw = parseInt(numStr);
    return fixNumber(raw);  // ← 補正を適用
  }

  return null;
}

//
// ▼ 改良版：processImageForOCR（2段階拡大＋ローディング対応）
//
async function processImageForOCR(file) {
  if (!file) {
    alert("画像が選択されていません。");
    return;
  }

  showLoading(); // ← ローディング開始

  try {

    // ▼ 画像読み込み
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise(resolve => img.onload = resolve);

    // ▼ まず全体を拡大（ラベル認識用）
    const scale1 = 1.8;
    const canvas1 = document.createElement("canvas");
    const ctx1 = canvas1.getContext("2d");

    canvas1.width = img.width * scale1;
    canvas1.height = img.height * scale1;

    ctx1.imageSmoothingEnabled = true;
    ctx1.imageSmoothingQuality = "high";
    ctx1.drawImage(img, 0, 0, canvas1.width, canvas1.height);

    // ▼ グレースケール＋コントラスト補正
    let imageData = ctx1.getImageData(0, 0, canvas1.width, canvas1.height);
    let data = imageData.data;

    const contrast = 1.15;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const newGray = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));

      data[i] = data[i + 1] = data[i + 2] = newGray;
    }

    ctx1.putImageData(imageData, 0, 0);

    // ▼ PNG に変換して OCR
    const blob1 = await new Promise(resolve => canvas1.toBlob(resolve, "image/png"));
    const { data: { text } } = await Tesseract.recognize(blob1, 'jpn');

    const lines = text.split("\n").map(l => l.trim());

    // ▼ ラベル位置を探す
    const bigLabels = ["BIG", "BB", "大当", "大当り", "当り回数"];
    const regLabels = ["REG", "RB", "レギュラー"];
    const gameLabels = ["総回転", "総回転数", "累計", "TOTAL"];

    let big = null, reg = null, games = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toUpperCase();

      if (big === null && bigLabels.some(k => line.includes(k.toUpperCase()))) {
        big = await ocrNumberArea(lines, i);
      }

      if (reg === null && regLabels.some(k => line.includes(k.toUpperCase()))) {
        reg = await ocrNumberArea(lines, i);
      }

      if (games === null && gameLabels.some(k => line.includes(k.toUpperCase()))) {
        games = await ocrNumberArea(lines, i);
      }
    }

    // ▼ 入力欄に反映（分かったものだけ）
    if (games !== null) document.getElementById("gamesInput").value = games;
    if (big   !== null) document.getElementById("bigInput").value   = big;
    if (reg   !== null) document.getElementById("regInput").value   = reg;

  } catch (err) {
    console.error("OCR エラー:", err);
    alert("画像の読み取りに失敗しました。別の画像でお試しください。");
  } finally {
    hideLoading(); // ← どんな状況でも必ず実行される
  }
}

// ▼ 写真添付時に自動読み取り
document.getElementById("photoInput").addEventListener("change", async (e) => {
  await processImageForOCR(e.target.files[0]);
});

// ▼ カメラ撮影時に自動読み取り
document.getElementById("cameraInput").addEventListener("change", async (e) => {
  await processImageForOCR(e.target.files[0]);
});

// ▼ 画像読み取りボタン（再読み取り）
document.getElementById("readImageButton").addEventListener("click", async () => {
  const photoFile = document.getElementById("photoInput").files[0];
  const cameraFile = document.getElementById("cameraInput").files[0];

  const file = cameraFile || photoFile;

  await processImageForOCR(file);
});

// ▼ 初期化
window.addEventListener("DOMContentLoaded", () => {
  loadMachines();
  setupEvents();
});
