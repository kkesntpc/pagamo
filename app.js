/**
 * 智慧練習系統核心邏輯
 * 具備：
 * 1. 20 / 25 / 40 / 50 題模式選擇
 * 2. 整體總時間倒數 (以單題 10 秒計，例如 50 題 = 500 秒 = 8 分 20 秒)
 * 3. 難度題目隨機混合抽題 (支援難度篩選或全部混合)
 * 4. 答對立即自動跳下一題 (350ms 平滑延遲)，答錯直接停在該題下方顯示詳解與手動下一題
 * 5. 支援鍵盤無障礙導覽 (數字鍵 1-4 快速作答，Enter 跳下一題)
 * 6. 本機 localStorage 記錄歷次成績 (時間、題數模式、答對數、正確率、平均用時)
 * 7. 日夜模式切換與狀態記憶
 */

(function () {
  'use strict';

  // 模式設定 (題數與預設配時: 每題10秒)
  const MODE_CONFIGS = {
    20: { count: 20, seconds: 200, label: "20 題極速", timeDesc: "限時 3 分 20 秒" },
    25: { count: 25, seconds: 250, label: "25 題精簡", timeDesc: "限時 4 分 10 秒" },
    40: { count: 40, seconds: 400, label: "40 題進階", timeDesc: "限時 6 分 40 秒" },
    50: { count: 50, seconds: 500, label: "50 題挑戰", timeDesc: "限時 8 分 20 秒" }
  };

  let selectedMode = 50;
  let selectedDifficulty = "ALL"; // ALL, 易, 中, 難

  // 測驗進行中狀態變數
  let currentExamQuestions = [];
  let currentIndex = 0;
  let correctCount = 0;
  let totalTimeAllocated = 500;
  let timeRemaining = 500;
  let examTimer = null;
  let isAnswerLocked = false;
  let startTime = 0;

  // DOM 元素快取
  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  const themeIcon = document.getElementById("theme-icon");
  const themeLabel = document.getElementById("theme-label");

  const startSection = document.getElementById("start-section");
  const quizSection = document.getElementById("quiz-section");
  const resultSection = document.getElementById("result-section");

  const modeButtons = document.querySelectorAll(".mode-btn");
  const diffSelect = document.getElementById("diff-select");
  const startQuizBtn = document.getElementById("start-quiz-btn");

  const qProgressText = document.getElementById("q-progress-text");
  const qChapterText = document.getElementById("q-chapter-text");
  const qDiffBadge = document.getElementById("q-diff-badge");
  const examTimerDisplay = document.getElementById("exam-timer-display");
  const timerContainer = document.getElementById("timer-container");
  const questionTitle = document.getElementById("question-title");
  const optionsList = document.getElementById("options-list");

  const explanationPanel = document.getElementById("explanation-panel");
  const explanationContent = document.getElementById("explanation-content");
  const nextBtn = document.getElementById("next-btn");

  const historyTbody = document.getElementById("history-tbody");
  const clearHistoryBtn = document.getElementById("clear-history-btn");

  // 1. 日夜模式初始化
  function initTheme() {
    const savedTheme = localStorage.getItem("app_theme") || "light";
    if (savedTheme === "dark") {
      document.body.classList.add("dark-mode");
      themeIcon.textContent = "☀️";
      themeLabel.textContent = "日間模式";
    } else {
      document.body.classList.remove("dark-mode");
      themeIcon.textContent = "🌙";
      themeLabel.textContent = "夜間模式";
    }

    themeToggleBtn.addEventListener("click", () => {
      const isDark = document.body.classList.toggle("dark-mode");
      if (isDark) {
        themeIcon.textContent = "☀️";
        themeLabel.textContent = "日間模式";
        localStorage.setItem("app_theme", "dark");
      } else {
        themeIcon.textContent = "🌙";
        themeLabel.textContent = "夜間模式";
        localStorage.setItem("app_theme", "light");
      }
    });
  }

  // 2. 模式選擇與篩選設定
  function initModeSelection() {
    modeButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        modeButtons.forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        selectedMode = parseInt(btn.dataset.count, 10);
      });
    });

    diffSelect.addEventListener("change", (e) => {
      selectedDifficulty = e.target.value;
    });

    startQuizBtn.addEventListener("click", startExam);
    nextBtn.addEventListener("click", proceedToNextQuestion);
    clearHistoryBtn.addEventListener("click", clearHistory);
  }

  // 隨機洗牌演算法 (Fisher-Yates)
  function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 取得可用題庫
  function getRawQuestions() {
    if (window.QUIZ_DATA && Array.isArray(window.QUIZ_DATA) && window.QUIZ_DATA.length > 0) {
      return window.QUIZ_DATA;
    }
    return [];
  }

  // 3. 開始測驗
  function startExam() {
    const allQuestions = getRawQuestions();
    if (allQuestions.length === 0) {
      alert("未偵測到題庫資料，請確認 questions.js 是否正確置於同一資料夾！");
      return;
    }

    // 依難度篩選 (易/中/難)
    let filtered = allQuestions;
    if (selectedDifficulty !== "ALL") {
      filtered = allQuestions.filter(q => q.difficulty === selectedDifficulty);
      if (filtered.length === 0) {
        alert(`題庫中無「${selectedDifficulty}」難度的題目，改為全部難度！`);
        filtered = allQuestions;
      }
    }

    // 隨機抽選指定題數
    const shuffled = shuffle(filtered);
    const count = Math.min(selectedMode, shuffled.length);
    currentExamQuestions = shuffled.slice(0, count);

    // 重設測驗狀態
    currentIndex = 0;
    correctCount = 0;
    isAnswerLocked = false;
    startTime = Date.now();

    // 整體倒數設定 (單題10秒 * 總題數)
    totalTimeAllocated = count * 10;
    timeRemaining = totalTimeAllocated;

    // 切換畫面
    startSection.classList.add("hidden");
    resultSection.classList.add("hidden");
    quizSection.classList.remove("hidden");

    startOverallTimer();
    renderQuestion();
  }

  // 4. 整體時間倒數管理
  function startOverallTimer() {
    clearInterval(examTimer);
    updateTimerDisplay();

    examTimer = setInterval(() => {
      timeRemaining--;
      updateTimerDisplay();

      if (timeRemaining <= 0) {
        clearInterval(examTimer);
        alert("作答時間結束！系統將自動結算成績。");
        finishExam(true);
      }
    }, 1000);
  }

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function updateTimerDisplay() {
    examTimerDisplay.textContent = formatTime(timeRemaining);

    // 剩餘時間低於 20% 時觸發高對比警示色
    if (timeRemaining <= totalTimeAllocated * 0.2) {
      timerContainer.classList.add("urgent");
    } else {
      timerContainer.classList.remove("urgent");
    }
  }

  // 5. 渲染題目
  function renderQuestion() {
    isAnswerLocked = false;
    explanationPanel.classList.add("hidden");

    if (currentIndex >= currentExamQuestions.length) {
      finishExam(false);
      return;
    }

    const q = currentExamQuestions[currentIndex];

    // 更新進度與標籤
    qProgressText.textContent = `第 ${currentIndex + 1} 題 / 共 ${currentExamQuestions.length} 題`;
    qChapterText.textContent = q.chapter ? `單元：${q.chapter}` : "";
    
    qDiffBadge.textContent = q.difficulty || "混合";
    qDiffBadge.className = `badge-tag badge-difficulty-${q.difficulty || '易'}`;

    questionTitle.textContent = q.question;
    optionsList.innerHTML = "";

    // 判斷選項內容
    // 原題庫中的 answer 通常為 "O" / "X" 或 "A" / "B" / "C" / "D"
    q.options.forEach((optText, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-item";

      // 產生選項代號標籤 (A, B, C, D 或 O, X)
      let optLabel = "";
      if (q.type === "TF") {
        optLabel = optText; // "O" 或 "X"
      } else {
        optLabel = String.fromCharCode(65 + idx); // 0 -> A, 1 -> B...
      }

      btn.dataset.val = optLabel;
      btn.setAttribute("aria-label", `選項 ${optLabel}：${optText}`);

      const contentSpan = document.createElement("span");
      contentSpan.innerHTML = `<strong>${optLabel}.</strong> ${optText}`;

      const iconSpan = document.createElement("span");
      iconSpan.className = "option-status-icon";

      btn.appendChild(contentSpan);
      btn.appendChild(iconSpan);

      btn.addEventListener("click", () => handleSelectAnswer(btn, optLabel, q));
      optionsList.appendChild(btn);
    });

    // 自動將焦點給予第一個選項，方便鍵盤操作
    const firstOption = optionsList.querySelector(".option-item");
    if (firstOption) {
      firstOption.focus();
    }
  }

  // 6. 作答判定核心邏輯
  function handleSelectAnswer(selectedBtn, userVal, q) {
    if (isAnswerLocked) return;
    isAnswerLocked = true;

    const allButtons = optionsList.querySelectorAll(".option-item");
    allButtons.forEach(b => (b.disabled = true));

    // 比對答案 (容許字串大小寫與修飾)
    const normalizedUser = String(userVal).trim().toUpperCase();
    const normalizedCorrect = String(q.answer).trim().toUpperCase();

    const isCorrect = (normalizedUser === normalizedCorrect);

    if (isCorrect) {
      // ===== 答對流程 =====
      correctCount++;
      selectedBtn.classList.add("correct");
      const iconSpan = selectedBtn.querySelector(".option-status-icon");
      if (iconSpan) {
        iconSpan.innerHTML = `✔ <span style="font-size:0.85rem">(正確)</span>`;
      }

      // 平滑短暫提示 (350ms) 後直接跳至下一題
      setTimeout(() => {
        currentIndex++;
        renderQuestion();
      }, 350);

    } else {
      // ===== 答錯流程 =====
      // 標註自己選的錯項
      selectedBtn.classList.add("wrong");
      const wrongIcon = selectedBtn.querySelector(".option-status-icon");
      if (wrongIcon) {
        wrongIcon.innerHTML = `✖ <span style="font-size:0.85rem">(你的選擇)</span>`;
      }

      // 標註正確選項
      allButtons.forEach(b => {
        if (b.dataset.val === normalizedCorrect) {
          b.classList.add("correct");
          const correctIcon = b.querySelector(".option-status-icon");
          if (correctIcon) {
            correctIcon.innerHTML = `✔ <span style="font-size:0.85rem">(正確解答)</span>`;
          }
        }
      });

      // 展開詳解區塊
      const expl = q.explanation && q.explanation.trim() !== "" 
        ? q.explanation 
        : "本題無附加文字詳解，請參考正確答案。";
      explanationContent.textContent = expl;
      explanationPanel.classList.remove("hidden");

      // 鍵盤焦點導向「下一題」按鈕，支援 Enter 鍵流暢推進
      nextBtn.focus();
    }
  }

  function proceedToNextQuestion() {
    currentIndex++;
    renderQuestion();
  }

  // 鍵盤無障礙支援 (數字鍵 1-4 直接選答，Enter 推進下一題)
  document.addEventListener("keydown", (e) => {
    if (quizSection.classList.contains("hidden")) return;

    if (!isAnswerLocked) {
      const allButtons = Array.from(optionsList.querySelectorAll(".option-item"));
      if (e.key === "1" && allButtons[0]) allButtons[0].click();
      if (e.key === "2" && allButtons[1]) allButtons[1].click();
      if (e.key === "3" && allButtons[2]) allButtons[2].click();
      if (e.key === "4" && allButtons[3]) allButtons[3].click();
    } else {
      if (e.key === "Enter" && !explanationPanel.classList.contains("hidden")) {
        proceedToNextQuestion();
      }
    }
  });

  // 7. 測驗完成與紀錄保存
  function finishExam(isTimeout) {
    clearInterval(examTimer);

    quizSection.classList.add("hidden");
    resultSection.classList.remove("hidden");

    const totalQuestions = currentExamQuestions.length;
    const accuracy = totalQuestions > 0 ? ((correctCount / totalQuestions) * 100).toFixed(1) : "0";
    const timeSpent = Math.max(1, Math.round((Date.now() - startTime) / 1000));
    const avgTimePerQ = (timeSpent / totalQuestions).toFixed(1);

    document.getElementById("res-total").textContent = totalQuestions;
    document.getElementById("res-correct").textContent = correctCount;
    document.getElementById("res-accuracy").textContent = `${accuracy}%`;
    document.getElementById("res-time").textContent = formatTime(timeSpent);
    document.getElementById("res-avg-time").textContent = `${avgTimePerQ} 秒`;

    // 儲存紀錄至 localStorage
    const record = {
      date: new Date().toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
      mode: `${totalQuestions} 題模式`,
      correct: `${correctCount} / ${totalQuestions}`,
      accuracy: `${accuracy}%`,
      timeSpent: formatTime(timeSpent),
      status: isTimeout ? "時間結束" : "完整作答"
    };

    saveHistoryRecord(record);
    renderHistoryTable();
  }

  // 8. 本地歷次成績紀錄
  function saveHistoryRecord(rec) {
    const list = JSON.parse(localStorage.getItem("exam_quiz_history") || "[]");
    list.unshift(rec);
    if (list.length > 25) list.pop(); // 保留最新 25 筆
    localStorage.setItem("exam_quiz_history", JSON.stringify(list));
  }

  function renderHistoryTable() {
    const list = JSON.parse(localStorage.getItem("exam_quiz_history") || "[]");
    historyTbody.innerHTML = "";

    if (list.length === 0) {
      historyTbody.innerHTML = `<tr><td colspan="6" style="padding:16px; color:var(--text-muted)">尚未有任何練習紀錄</td></tr>`;
      return;
    }

    list.forEach(item => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.date}</td>
        <td><strong>${item.mode}</strong></td>
        <td>${item.correct}</td>
        <td><span style="font-weight:700; color:var(--brand-primary)">${item.accuracy}</span></td>
        <td>${item.timeSpent}</td>
        <td>${item.status}</td>
      `;
      historyTbody.appendChild(tr);
    });
  }

  function clearHistory() {
    if (confirm("確定要清除所有本機練習紀錄嗎？此動作無法復原。")) {
      localStorage.removeItem("exam_quiz_history");
      renderHistoryTable();
    }
  }

  // 9. 初始化啟動
  window.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initModeSelection();
    renderHistoryTable();

    // 重新測驗與返回首頁
    document.getElementById("retry-exam-btn").addEventListener("click", startExam);
    document.getElementById("back-home-btn").addEventListener("click", () => {
      resultSection.classList.add("hidden");
      startSection.classList.remove("hidden");
      renderHistoryTable();
    });
  });

})();
