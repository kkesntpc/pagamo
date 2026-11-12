/**
 * 無障礙練習與認證測驗系統核心邏輯 (v6)
 * 具備：
 * 1. 「保護式選項洗牌」：自動偵測「以上皆是 / 以上皆非 / 皆可 / 上述皆」等字眼並鎖定原順序，其餘題目隨機打亂選項並自動重新對應正確答案
 * 2. 完整保留原題庫「26 個主題章節分類」＋ 新增「🚀 展望未來 100 題專題」＋「🏆 認證測驗模式（80分合格）」
 * 3. 整體總時間倒數（單題 10 秒配時；練習模式看詳解自動暫停計時，50題認證大考持續計時）
 * 4. 學習歷程與答對率回顧：
 *    - 累計學習統計卡片（總測驗次數、累計作答題數、總平均答對率、💯 滿分次數）
 *    - 各主題章節累計答對率進度條分析面板
 *    - 每筆測驗完整記錄逐題作答明細（題幹、你的選項、正確選項、解析），支援結算畫面及歷史列表隨時回顧
 * 5. 100% 滿分達成橫向紀錄列 + 多筆勾選並列印驗證證明單（@media print 專屬驗證單排版）
 */

(function () {
  'use strict';

  const CERT_PASS_SCORE = 80; // 認證模式及格標準 (80%)
  const STORAGE_KEY_HISTORY = "exam_quiz_history_v3";

  // 保護式洗牌關鍵字黑名單
  const LOCK_ORDER_KEYWORDS = [
    "以上皆是", "以上皆非", "以上皆可", "以上皆對", "以上皆錯",
    "上述皆是", "上述皆非", "上述皆可", "皆是", "皆非", "皆可",
    "A與B", "A和B", "B與C", "B和C", "A、B", "B、C"
  ];

  let currentModeType = "practice"; // "practice" | "future" | "cert"
  let selectedMode = 50;
  let selectedChapter = "ALL";
  let selectedDifficulty = "ALL";

  // 測驗進行中狀態變數
  let currentExamQuestions = [];
  let currentQuestionPrepared = null;
  let sessionLogs = []; // 記錄本輪每一題作答結果供回顧
  let currentIndex = 0;
  let correctCount = 0;
  let totalTimeAllocated = 500;
  let timeRemaining = 500;
  let examTimer = null;
  let isTimerPaused = false;
  let activeSecondsElapsed = 0;
  let isAnswerLocked = false;
  let candidateName = "";
  let latestFinishedRecord = null;
  let activeDetailRecord = null;

  // 多選勾選 ID 集合
  let selectedRecordIds = new Set();

  // DOM 元素快取
  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  const themeIcon = document.getElementById("theme-icon");
  const themeLabel = document.getElementById("theme-label");

  const mainTabsNav = document.getElementById("main-tabs-nav");
  const tabBtnPractice = document.getElementById("tab-btn-practice");
  const tabBtnHistory = document.getElementById("tab-btn-history");
  const tabHistoryBadge = document.getElementById("tab-history-badge");

  const startSection = document.getElementById("tab-panel-practice");
  const historySection = document.getElementById("tab-panel-history");
  const quizSection = document.getElementById("quiz-section");
  const resultSection = document.getElementById("result-section");
  const historyDetailSection = document.getElementById("history-detail-section");

  const modeButtons = document.querySelectorAll(".mode-btn");
  const chapterSelect = document.getElementById("chapter-select");
  const diffSelect = document.getElementById("diff-select");
  const candidateInput = document.getElementById("candidate-name");
  const certNoticeBox = document.getElementById("cert-notice-box");
  const futureNoticeBox = document.getElementById("future-notice-box");
  const practiceFiltersBox = document.getElementById("practice-filters-box");
  const chapterFilterWrapper = document.getElementById("chapter-filter-wrapper");
  const startQuizBtn = document.getElementById("start-quiz-btn");
  const startBtnText = document.getElementById("start-btn-text");

  const qProgressText = document.getElementById("q-progress-text");
  const qChapterText = document.getElementById("q-chapter-text");
  const qDiffBadge = document.getElementById("q-diff-badge");
  const qCertBadge = document.getElementById("q-cert-badge");
  const qFutureBadge = document.getElementById("q-future-badge");
  const examTimerDisplay = document.getElementById("exam-timer-display");
  const timerContainer = document.getElementById("timer-container");
  const timerIcon = document.getElementById("timer-icon");
  const timerStatusText = document.getElementById("timer-status-text");
  const questionTitle = document.getElementById("question-title");
  const optionsList = document.getElementById("options-list");

  const explanationPanel = document.getElementById("explanation-panel");
  const explanationContent = document.getElementById("explanation-content");
  const nextBtn = document.getElementById("next-btn");

  const perfectBanner = document.getElementById("perfect-banner");
  const certificateBox = document.getElementById("certificate-box");
  const certCandidateDisplay = document.getElementById("cert-candidate-display");
  const certScoreDisplay = document.getElementById("cert-score-display");
  const certDateDisplay = document.getElementById("cert-date-display");

  const historyTbody = document.getElementById("history-tbody");
  const selectAllCheckbox = document.getElementById("select-all-checkbox");
  const selectedCountBadge = document.getElementById("selected-count-badge");

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

  // 2. 載入原題庫章節分類至下拉選單
  function populateChapters() {
    const allQuestions = getRawQuestions();
    if (allQuestions.length === 0) return;

    const chapterCounts = {};
    allQuestions.forEach(q => {
      const ch = q.chapter || "未分類";
      chapterCounts[ch] = (chapterCounts[ch] || 0) + 1;
    });

    const sortedChapters = Object.keys(chapterCounts).sort();

    chapterSelect.innerHTML = `<option value="ALL">📚 全部章節分類（共 ${allQuestions.length} 題）</option>`;
    sortedChapters.forEach(ch => {
      const opt = document.createElement("option");
      opt.value = ch;
      opt.textContent = `${ch}（${chapterCounts[ch]} 題）`;
      chapterSelect.appendChild(opt);
    });
  }

  // 3. 模式選擇與篩選設定
  function initModeSelection() {
    const savedName = localStorage.getItem("candidate_name") || "";
    if (savedName) candidateInput.value = savedName;

    modeButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        modeButtons.forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");

        currentModeType = btn.dataset.modeType;
        selectedMode = parseInt(btn.dataset.count, 10);

        certNoticeBox.classList.add("hidden");
        futureNoticeBox.classList.add("hidden");

        if (currentModeType === "cert") {
          certNoticeBox.classList.remove("hidden");
          practiceFiltersBox.classList.add("hidden");
          startBtnText.textContent = "開始正式認證測驗（50 題）";
        } else if (currentModeType === "future") {
          futureNoticeBox.classList.remove("hidden");
          practiceFiltersBox.classList.remove("hidden");
          chapterFilterWrapper.classList.add("hidden");
          startBtnText.textContent = `開始展望未來專題（${selectedMode} 題）`;
        } else {
          practiceFiltersBox.classList.remove("hidden");
          chapterFilterWrapper.classList.remove("hidden");
          startBtnText.textContent = `開始練習（${selectedMode} 題）`;
        }
      });
    });

    chapterSelect.addEventListener("change", (e) => {
      selectedChapter = e.target.value;
    });

    diffSelect.addEventListener("change", (e) => {
      selectedDifficulty = e.target.value;
    });

    startQuizBtn.addEventListener("click", startExam);
    nextBtn.addEventListener("click", proceedToNextQuestion);
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

  // 保護式選項洗牌檢查
  function shouldLockOptionOrder(options) {
    if (!Array.isArray(options)) return true;
    return options.some(optText => {
      const normalized = String(optText).replace(/\s+/g, "");
      return LOCK_ORDER_KEYWORDS.some(kw => normalized.includes(kw));
    });
  }

  function prepareQuestionOptions(q) {
    if (q.type === "TF" || !Array.isArray(q.options) || q.options.length <= 2) {
      return {
        displayOptions: [...q.options],
        correctAnswerLetter: String(q.answer).trim().toUpperCase(),
        isShuffled: false
      };
    }

    const origCorrectLetter = String(q.answer).trim().toUpperCase();
    const origCorrectIdx = origCorrectLetter.charCodeAt(0) - 65;

    if (shouldLockOptionOrder(q.options) || origCorrectIdx < 0 || origCorrectIdx >= q.options.length) {
      return {
        displayOptions: [...q.options],
        correctAnswerLetter: origCorrectLetter,
        isShuffled: false
      };
    }

    const paired = q.options.map((text, idx) => ({
      text,
      isCorrect: idx === origCorrectIdx
    }));
    const shuffledPaired = shuffle(paired);
    const newCorrectIdx = shuffledPaired.findIndex(item => item.isCorrect);

    return {
      displayOptions: shuffledPaired.map(item => item.text),
      correctAnswerLetter: String.fromCharCode(65 + newCorrectIdx),
      isShuffled: true
    };
  }

  function getRawQuestions() {
    if (window.QUIZ_DATA && Array.isArray(window.QUIZ_DATA) && window.QUIZ_DATA.length > 0) {
      return window.QUIZ_DATA;
    }
    return [];
  }

  // 4. 開始測驗
  function startExam() {
    const allQuestions = getRawQuestions();
    if (allQuestions.length === 0) {
      alert("未偵測到題庫資料，請確認 questions.js 是否正確置於同一資料夾！");
      return;
    }

    candidateName = candidateInput.value.trim() || "訪客考生";
    localStorage.setItem("candidate_name", candidateName);

    let pool = allQuestions;
    let scopeLabel = "全範圍綜合";

    if (currentModeType === "cert") {
      pool = allQuestions;
      scopeLabel = "🏆 認證測驗（全範圍）";
    } else if (currentModeType === "future") {
      pool = allQuestions.filter(q => String(q.id || "").startsWith("FUT-"));
      scopeLabel = "🚀 展望未來專題";
      if (selectedDifficulty !== "ALL") {
        pool = pool.filter(q => q.difficulty === selectedDifficulty);
        scopeLabel += ` (${selectedDifficulty})`;
      }
    } else {
      if (selectedChapter !== "ALL") {
        pool = pool.filter(q => (q.chapter || "未分類") === selectedChapter);
        scopeLabel = selectedChapter;
      }
      if (selectedDifficulty !== "ALL") {
        pool = pool.filter(q => q.difficulty === selectedDifficulty);
        scopeLabel += ` (${selectedDifficulty})`;
      }
    }

    if (pool.length === 0) {
      alert("目前篩選條件下沒有符合的題目，請調整難度或章節條件！");
      return;
    }

    const shuffled = shuffle(pool);
    const count = Math.min(selectedMode, shuffled.length);
    currentExamQuestions = shuffled.slice(0, count);
    currentExamQuestions._scopeLabel = scopeLabel;

    currentIndex = 0;
    correctCount = 0;
    sessionLogs = [];
    isAnswerLocked = false;
    isTimerPaused = false;
    activeSecondsElapsed = 0;

    totalTimeAllocated = count * 10;
    timeRemaining = totalTimeAllocated;

    mainTabsNav.classList.add("hidden");
    startSection.classList.add("hidden");
    historySection.classList.add("hidden");
    resultSection.classList.add("hidden");
    historyDetailSection.classList.add("hidden");
    quizSection.classList.remove("hidden");

    qCertBadge.classList.toggle("hidden", currentModeType !== "cert");
    qFutureBadge.classList.toggle("hidden", currentModeType !== "future");

    startOverallTimer();
    renderQuestion();
  }

  // 5. 整體時間倒數管理
  function startOverallTimer() {
    clearInterval(examTimer);
    isTimerPaused = false;
    updateTimerDisplay();

    examTimer = setInterval(() => {
      if (isTimerPaused) return;

      timeRemaining--;
      activeSecondsElapsed++;
      updateTimerDisplay();

      if (timeRemaining <= 0) {
        clearInterval(examTimer);
        alert("作答時間結束！系統將自動結算成績。");
        finishExam(true);
      }
    }, 1000);
  }

  function setTimerPaused(paused) {
    if (currentModeType === "cert") {
      isTimerPaused = false;
    } else {
      isTimerPaused = paused;
    }
    updateTimerDisplay();
  }

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function updateTimerDisplay() {
    examTimerDisplay.textContent = formatTime(timeRemaining);

    if (isTimerPaused) {
      timerContainer.classList.remove("urgent");
      timerContainer.classList.add("paused");
      timerIcon.textContent = "⏸️";
      timerStatusText.textContent = "看詳解暫停中";
      timerStatusText.classList.remove("hidden");
    } else {
      timerContainer.classList.remove("paused");
      timerIcon.textContent = "⏱️";
      timerStatusText.classList.add("hidden");

      if (timeRemaining <= totalTimeAllocated * 0.2) {
        timerContainer.classList.add("urgent");
      } else {
        timerContainer.classList.remove("urgent");
      }
    }
  }

  // 6. 渲染題目（含保護式選項洗牌）
  function renderQuestion() {
    isAnswerLocked = false;
    nextBtn.classList.add("hidden");
    explanationPanel.classList.add("hidden");
    setTimerPaused(false);

    if (currentIndex >= currentExamQuestions.length) {
      finishExam(false);
      return;
    }

    const q = currentExamQuestions[currentIndex];
    currentQuestionPrepared = prepareQuestionOptions(q);

    qProgressText.textContent = `第 ${currentIndex + 1} 題 / 共 ${currentExamQuestions.length} 題`;
    qChapterText.textContent = q.chapter ? `分類單元：${q.chapter}` : "分類單元：一般題庫";

    qDiffBadge.textContent = q.difficulty || "混合";
    qDiffBadge.className = `badge-tag badge-difficulty-${q.difficulty || '易'}`;

    questionTitle.textContent = q.question;
    optionsList.innerHTML = "";

    currentQuestionPrepared.displayOptions.forEach((optText, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-item";

      let optLabel = "";
      if (q.type === "TF") {
        optLabel = optText;
      } else {
        optLabel = String.fromCharCode(65 + idx);
      }

      btn.dataset.val = optLabel;
      btn.dataset.text = optText;
      btn.setAttribute("aria-label", `選項 ${optLabel}：${optText}`);

      const contentSpan = document.createElement("span");
      contentSpan.innerHTML = `<strong>${optLabel}.</strong> ${optText}`;

      const iconSpan = document.createElement("span");
      iconSpan.className = "option-status-icon";

      btn.appendChild(contentSpan);
      btn.appendChild(iconSpan);

      btn.addEventListener("click", () => handleSelectAnswer(btn, optLabel, optText, currentQuestionPrepared.correctAnswerLetter, q));
      optionsList.appendChild(btn);
    });

    const firstOption = optionsList.querySelector(".option-item");
    if (firstOption) {
      firstOption.focus();
    }
  }

  // 7. 作答判定與記錄逐題作答明細
  function handleSelectAnswer(selectedBtn, userVal, userText, correctVal, q) {
    if (isAnswerLocked) return;
    isAnswerLocked = true;

    const allButtons = optionsList.querySelectorAll(".option-item");
    allButtons.forEach(b => (b.disabled = true));

    const normalizedUser = String(userVal).trim().toUpperCase();
    const normalizedCorrect = String(correctVal).trim().toUpperCase();
    const isCorrect = (normalizedUser === normalizedCorrect);

    // 找出正確選項完整文字
    let correctFullText = normalizedCorrect;
    allButtons.forEach(b => {
      if (b.dataset.val === normalizedCorrect) {
        correctFullText = q.type === "TF" ? normalizedCorrect : `${normalizedCorrect}. ${b.dataset.text}`;
      }
    });
    const userFullText = q.type === "TF" ? normalizedUser : `${normalizedUser}. ${userText}`;

    // 儲存本題作答日誌供後續回顧
    sessionLogs.push({
      qNum: currentIndex + 1,
      chapter: q.chapter || "一般題庫",
      difficulty: q.difficulty || "易",
      question: q.question,
      userAnswer: userFullText,
      correctAnswer: correctFullText,
      isCorrect: isCorrect,
      explanation: q.explanation || ""
    });

    if (isCorrect) {
      correctCount++;
      selectedBtn.classList.add("correct");
      const iconSpan = selectedBtn.querySelector(".option-status-icon");
      if (iconSpan) {
        iconSpan.innerHTML = `✔ <span style="font-size:0.85rem">(正確)</span>`;
      }

      setTimeout(() => {
        currentIndex++;
        renderQuestion();
      }, 350);

    } else {
      selectedBtn.classList.add("wrong");
      const wrongIcon = selectedBtn.querySelector(".option-status-icon");
      if (wrongIcon) {
        wrongIcon.innerHTML = `✖ <span style="font-size:0.85rem">(你的選擇)</span>`;
      }

      allButtons.forEach(b => {
        if (b.dataset.val === normalizedCorrect) {
          b.classList.add("correct");
          const correctIcon = b.querySelector(".option-status-icon");
          if (correctIcon) {
            correctIcon.innerHTML = `✔ <span style="font-size:0.85rem">(正確解答)</span>`;
          }
        }
      });

      setTimerPaused(true);

      const expl = q.explanation && q.explanation.trim() !== ""
        ? q.explanation
        : "本題無附加文字詳解，請參考上方標示之正確解答。";
      explanationContent.textContent = expl;
      explanationPanel.classList.remove("hidden");
      nextBtn.classList.remove("hidden");

      nextBtn.focus();
    }
  }

  function proceedToNextQuestion() {
    currentIndex++;
    renderQuestion();
  }

  // 鍵盤無障礙支援
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

  // 8. 測驗完成與紀錄保存
  function finishExam(isTimeout) {
    clearInterval(examTimer);

    quizSection.classList.add("hidden");
    resultSection.classList.remove("hidden");

    const totalQuestions = currentExamQuestions.length;
    const accuracyNum = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;
    const accuracyStr = accuracyNum.toFixed(1);
    const isPerfect = (correctCount === totalQuestions && totalQuestions > 0 && !isTimeout);
    const timeSpent = Math.max(1, activeSecondsElapsed);
    const avgTimePerQ = (timeSpent / totalQuestions).toFixed(1);

    document.getElementById("res-total").textContent = totalQuestions;
    document.getElementById("res-correct").textContent = correctCount;
    document.getElementById("res-accuracy").textContent = isPerfect ? "100%" : `${accuracyStr}%`;
    document.getElementById("res-time").textContent = formatTime(timeSpent);
    document.getElementById("res-avg-time").textContent = `${avgTimePerQ} 秒`;

    // 滿分橫幅顯示
    perfectBanner.classList.toggle("hidden", !isPerfect);

    let statusType = "practice";
    let statusLabel = isTimeout ? "練習(超時)" : (isPerfect ? "💯 滿分達成" : "練習完成");

    if (currentModeType === "cert") {
      const isPassed = accuracyNum >= CERT_PASS_SCORE && !isTimeout;
      if (isPassed) {
        statusType = "pass";
        statusLabel = isPerfect ? "🏆 認證滿分合格" : "🏆 認證合格";
        certificateBox.classList.remove("hidden");
        certCandidateDisplay.textContent = candidateName;
        certScoreDisplay.textContent = `${isPerfect ? "100" : accuracyStr}%（答對 ${correctCount} / ${totalQuestions} 題）`;
        certDateDisplay.textContent = new Date().toLocaleDateString("zh-TW");
      } else {
        statusType = "fail";
        statusLabel = isTimeout ? "❌ 未通過(超時)" : "❌ 未達80分";
        certificateBox.classList.add("hidden");
      }
    } else {
      certificateBox.classList.add("hidden");
    }

    const recordId = "REC-" + Date.now();
    const record = {
      id: recordId,
      date: new Date().toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
      candidate: candidateName,
      scope: currentExamQuestions._scopeLabel || "綜合",
      modeType: currentModeType,
      totalCount: totalQuestions,
      correctCount: correctCount,
      accuracyNum: isPerfect ? 100 : parseFloat(accuracyStr),
      accuracy: isPerfect ? "100%" : `${accuracyStr}%`,
      isPerfect: isPerfect,
      timeSpent: formatTime(timeSpent),
      statusType: statusType,
      statusLabel: statusLabel,
      logs: sessionLogs
    };

    latestFinishedRecord = record;
    saveHistoryRecord(record);
    renderSessionReview(sessionLogs, document.getElementById("session-review-list"), false);
  }

  // 渲染逐題回顧卡片列表
  function renderSessionReview(logs, containerEl, wrongOnly) {
    containerEl.innerHTML = "";
    if (!logs || logs.length === 0) {
      containerEl.innerHTML = `<p style="color:var(--text-muted); padding: 12px;">此筆紀錄未包含逐題作答明細。</p>`;
      return;
    }

    const filtered = wrongOnly ? logs.filter(item => !item.isCorrect) : logs;
    if (filtered.length === 0) {
      containerEl.innerHTML = `<p style="color:var(--state-correct-text); font-weight:700; padding: 12px;">🎉 太棒了！本輪所有題目皆全數答對，無錯題紀錄！</p>`;
      return;
    }

    filtered.forEach(item => {
      const card = document.createElement("div");
      card.className = `review-item-card ${item.isCorrect ? "" : "is-wrong"}`;
      card.innerHTML = `
        <div class="review-item-header">
          <span>第 ${item.qNum} 題 ｜ ${item.chapter}（${item.difficulty}）</span>
          <span style="color: ${item.isCorrect ? 'var(--state-correct-text)' : 'var(--state-wrong-text)'}">
            ${item.isCorrect ? '✔ 答對' : '✖ 答錯'}
          </span>
        </div>
        <div class="review-q-text">${item.question}</div>
        <div class="review-ans-row">
          <span><strong>你的作答：</strong><span style="color: ${item.isCorrect ? 'var(--state-correct-text)' : 'var(--state-wrong-text)'}">${item.userAnswer}</span></span>
          ${!item.isCorrect ? `<span><strong>正確解答：</strong><span style="color: var(--state-correct-text); font-weight:700;">${item.correctAnswer}</span></span>` : ""}
        </div>
        ${!item.isCorrect && item.explanation ? `<div class="review-expl-text"><strong>📖 解析：</strong>${item.explanation}</div>` : ""}
      `;
      containerEl.appendChild(card);
    });
  }

  // 9. 本地歷次成績與學習歷程管理
  function getHistoryList() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || "[]");
  }

  function saveHistoryRecord(rec) {
    const list = getHistoryList();
    list.unshift(rec);
    if (list.length > 40) list.pop();
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(list));
  }

  // 渲染整體學習歷程KPI、各主題答對率、100分橫向紀錄列與明細表
  function renderLearningPortfolio() {
    const list = getHistoryList();

    // 1. 計算整體 KPI
    const totalSessions = list.length;
    let totalAnswered = 0;
    let totalCorrect = 0;
    let perfectRecords = [];

    // 各章節累計統計
    const chapterMap = {};

    list.forEach(rec => {
      totalAnswered += (rec.totalCount || 0);
      totalCorrect += (rec.correctCount || 0);
      if (rec.isPerfect || rec.accuracy === "100%" || rec.accuracyNum === 100) {
        perfectRecords.push(rec);
      }

      if (Array.isArray(rec.logs)) {
        rec.logs.forEach(log => {
          const ch = log.chapter || "未分類";
          if (!chapterMap[ch]) chapterMap[ch] = { total: 0, correct: 0 };
          chapterMap[ch].total += 1;
          if (log.isCorrect) chapterMap[ch].correct += 1;
        });
      }
    });

    const overallAcc = totalAnswered > 0 ? ((totalCorrect / totalAnswered) * 100).toFixed(1) + "%" : "0%";
    document.getElementById("kpi-sessions").textContent = totalSessions;
    if (tabHistoryBadge) tabHistoryBadge.textContent = totalSessions;
    document.getElementById("kpi-total-q").textContent = totalAnswered;
    document.getElementById("kpi-overall-acc").textContent = overallAcc;
    document.getElementById("kpi-perfect-count").textContent = perfectRecords.length;

    // 2. 渲染各主題答對率統計
    const chapterStatsList = document.getElementById("chapter-stats-list");
    chapterStatsList.innerHTML = "";
    const chKeys = Object.keys(chapterMap).sort();
    if (chKeys.length === 0) {
      chapterStatsList.innerHTML = `<p style="color:var(--text-muted); font-size:0.9rem;">完成至少一次測驗後，此處將自動彙整各主題章節的累計答對率。</p>`;
    } else {
      chKeys.forEach(ch => {
        const st = chapterMap[ch];
        const pct = Math.round((st.correct / st.total) * 100);
        const div = document.createElement("div");
        div.className = "chapter-stat-item";
        div.innerHTML = `
          <div class="chapter-stat-top">
            <span>${ch}</span>
            <span>${pct}% (${st.correct}/${st.total})</span>
          </div>
          <div class="progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-fill" style="width: ${pct}%;"></div>
          </div>
        `;
        chapterStatsList.appendChild(div);
      });
    }

    // 3. 渲染「100% 滿分達成橫向紀錄列」
    const perfectSection = document.getElementById("perfect-streak-section");
    const perfectHorizontalList = document.getElementById("perfect-horizontal-list");
    if (perfectRecords.length === 0) {
      perfectSection.classList.add("hidden");
    } else {
      perfectSection.classList.remove("hidden");
      perfectHorizontalList.innerHTML = "";
      perfectRecords.forEach((pRec, idx) => {
        const isChecked = selectedRecordIds.has(pRec.id);
        const card = document.createElement("div");
        card.className = "perfect-chip-card";
        card.setAttribute("role", "listitem");
        card.innerHTML = `
          <div class="perfect-chip-top">
            <span>💯 滿分 #${perfectRecords.length - idx}</span>
            <label style="display:flex; align-items:center; gap:4px; font-size:0.8rem; cursor:pointer;">
              <input type="checkbox" class="perfect-sync-cb" data-id="${pRec.id}" ${isChecked ? "checked" : ""}>
              <span>列印勾選</span>
            </label>
          </div>
          <div class="perfect-chip-scope">${pRec.scope}</div>
          <div class="perfect-chip-meta">
            <span>${pRec.candidate} · ${pRec.totalCount}題</span>
            <span>${pRec.date.split(" ")[0]}</span>
          </div>
        `;
        perfectHorizontalList.appendChild(card);
      });

      // 綁定橫向滿分卡片上的勾選框與主表格同步
      perfectHorizontalList.querySelectorAll(".perfect-sync-cb").forEach(cb => {
        cb.addEventListener("change", (e) => {
          const id = e.target.dataset.id;
          if (e.target.checked) selectedRecordIds.add(id);
          else selectedRecordIds.delete(id);
          syncCheckboxesUI();
        });
      });
    }

    // 4. 渲染歷次成績明細表格
    historyTbody.innerHTML = "";
    if (list.length === 0) {
      historyTbody.innerHTML = `<tr><td colspan="8" style="padding:16px; color:var(--text-muted)">尚未有任何測驗或認證紀錄</td></tr>`;
      updateSelectedBadge();
      return;
    }

    list.forEach(item => {
      const tr = document.createElement("tr");
      const pillClass = item.statusType === "pass"
        ? "status-pass"
        : item.statusType === "fail"
          ? "status-fail"
          : "status-practice";

      const isChecked = selectedRecordIds.has(item.id);
      tr.innerHTML = `
        <td>
          <input type="checkbox" class="row-select-cb" data-id="${item.id}" aria-label="勾選 ${item.date} ${item.scope} 紀錄" ${isChecked ? "checked" : ""}>
        </td>
        <td>${item.date}</td>
        <td><strong>${item.candidate || "訪客"}</strong></td>
        <td>${item.scope}</td>
        <td>${item.correctCount} / ${item.totalCount}</td>
        <td><span style="font-weight:800; color:var(--brand-primary)">${item.accuracy}</span></td>
        <td>${item.timeSpent}</td>
        <td>
          <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
            <span class="status-pill ${pillClass}">${item.statusLabel}</span>
            <button type="button" class="btn-review-row" data-id="${item.id}">回顧</button>
          </div>
        </td>
      `;
      historyTbody.appendChild(tr);
    });

    // 綁定表格列勾選框
    historyTbody.querySelectorAll(".row-select-cb").forEach(cb => {
      cb.addEventListener("change", (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked) selectedRecordIds.add(id);
        else selectedRecordIds.delete(id);
        syncCheckboxesUI();
      });
    });

    // 綁定「回顧」按鈕
    historyTbody.querySelectorAll(".btn-review-row").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = e.target.dataset.id;
        openHistoryDetail(id);
      });
    });

    syncCheckboxesUI();
  }

  function syncCheckboxesUI() {
    const list = getHistoryList();
    document.querySelectorAll(".row-select-cb").forEach(cb => {
      cb.checked = selectedRecordIds.has(cb.dataset.id);
    });
    document.querySelectorAll(".perfect-sync-cb").forEach(cb => {
      cb.checked = selectedRecordIds.has(cb.dataset.id);
    });
    selectAllCheckbox.checked = list.length > 0 && list.every(item => selectedRecordIds.has(item.id));
    updateSelectedBadge();
  }

  function updateSelectedBadge() {
    selectedCountBadge.textContent = selectedRecordIds.size;
  }

  // 開啟單筆歷史紀錄詳細回顧檢視
  function openHistoryDetail(recordId) {
    const list = getHistoryList();
    const rec = list.find(r => r.id === recordId);
    if (!rec) return;

    activeDetailRecord = rec;
    mainTabsNav.classList.add("hidden");
    startSection.classList.add("hidden");
    historySection.classList.add("hidden");
    resultSection.classList.add("hidden");
    quizSection.classList.add("hidden");
    historyDetailSection.classList.remove("hidden");

    document.getElementById("detail-title").textContent = `📋 作答回顧：${rec.scope}`;
    document.getElementById("detail-subtitle").textContent =
      `作答者：${rec.candidate} ｜ 時間：${rec.date} ｜ 得分：${rec.correctCount}/${rec.totalCount}（${rec.accuracy}）｜ 狀態：${rec.statusLabel}`;

    renderSessionReview(rec.logs, document.getElementById("detail-review-list"), false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // 10. 列印驗證紀錄單功能
  function printVerificationRecords(recordsToPrint) {
    if (!recordsToPrint || recordsToPrint.length === 0) {
      alert("請先在歷次成績表中勾選至少一筆欲列印驗證的測驗紀錄！");
      return;
    }

    const printCandidate = candidateInput.value.trim() || recordsToPrint[0].candidate || "訪客考生";
    const nowStr = new Date().toLocaleString("zh-TW");

    let sumAcc = 0;
    recordsToPrint.forEach(r => {
      sumAcc += (typeof r.accuracyNum === "number" ? r.accuracyNum : parseFloat(r.accuracy) || 0);
    });
    const avgAcc = (sumAcc / recordsToPrint.length).toFixed(1) + "%";

    document.getElementById("print-candidate-name").textContent = printCandidate;
    document.getElementById("print-timestamp").textContent = nowStr;
    document.getElementById("print-record-count").textContent = recordsToPrint.length;
    document.getElementById("print-avg-acc").textContent = avgAcc;

    const printTbody = document.getElementById("print-tbody");
    printTbody.innerHTML = "";
    recordsToPrint.forEach((rec, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${rec.date}</td>
        <td>${rec.candidate || printCandidate}</td>
        <td>${rec.scope}</td>
        <td>${rec.correctCount} / ${rec.totalCount}</td>
        <td><strong>${rec.accuracy}</strong></td>
        <td>${rec.timeSpent}</td>
        <td>${rec.statusLabel}</td>
      `;
      printTbody.appendChild(tr);
    });

    // 產生防偽驗證識別碼
    const hashSeed = `${printCandidate}-${recordsToPrint.length}-${Date.now().toString(36).toUpperCase()}`;
    document.getElementById("print-verify-hash").textContent = hashSeed;

    window.print();
  }

  function clearHistory() {
    if (confirm("確定要清除所有本機學習歷程與認證紀錄嗎？此動作無法復原。")) {
      localStorage.removeItem(STORAGE_KEY_HISTORY);
      selectedRecordIds.clear();
      renderLearningPortfolio();
    }
  }

  // 11. 初始化啟動
  window.addEventListener("DOMContentLoaded", () => {
    initTheme();
    populateChapters();
    initModeSelection();
    renderLearningPortfolio();

    function switchTab(targetTab) {
      mainTabsNav.classList.remove("hidden");
      quizSection.classList.add("hidden");
      resultSection.classList.add("hidden");
      historyDetailSection.classList.add("hidden");

      if (targetTab === "history") {
        tabBtnPractice.classList.remove("active");
        tabBtnPractice.setAttribute("aria-selected", "false");
        tabBtnHistory.classList.add("active");
        tabBtnHistory.setAttribute("aria-selected", "true");

        startSection.classList.add("hidden");
        historySection.classList.remove("hidden");
        renderLearningPortfolio();
      } else {
        tabBtnHistory.classList.remove("active");
        tabBtnHistory.setAttribute("aria-selected", "false");
        tabBtnPractice.classList.add("active");
        tabBtnPractice.setAttribute("aria-selected", "true");

        historySection.classList.add("hidden");
        startSection.classList.remove("hidden");
      }
    }

    function goHome(targetTab = "practice") {
      if (!quizSection.classList.contains("hidden")) {
        if (!confirm("測驗仍在進行中，確定要中斷並返回嗎？（本次進度將不會列入紀錄）")) {
          return;
        }
        clearInterval(examTimer);
      }
      switchTab(targetTab);
    }

    tabBtnPractice.addEventListener("click", () => switchTab("practice"));
    tabBtnHistory.addEventListener("click", () => switchTab("history"));

    document.getElementById("brand-home-btn").addEventListener("click", () => goHome("practice"));
    document.getElementById("retry-exam-btn").addEventListener("click", startExam);
    document.getElementById("back-home-btn").addEventListener("click", () => goHome("history"));
    document.getElementById("detail-back-btn").addEventListener("click", () => goHome("history"));

    // 結算畫面「只顯示錯題」切換
    document.getElementById("filter-wrong-only").addEventListener("change", (e) => {
      renderSessionReview(sessionLogs, document.getElementById("session-review-list"), e.target.checked);
    });

    // 結算畫面「列印本次成績驗證單」
    document.getElementById("print-current-btn").addEventListener("click", () => {
      if (latestFinishedRecord) printVerificationRecords([latestFinishedRecord]);
    });

    // 詳細回顧頁面「列印此筆驗證單」
    document.getElementById("detail-print-btn").addEventListener("click", () => {
      if (activeDetailRecord) printVerificationRecords([activeDetailRecord]);
    });

    // 各主題答對率折疊切換
    const toggleChapterBtn = document.getElementById("toggle-chapter-stats-btn");
    const chapterPanel = document.getElementById("chapter-stats-panel");
    toggleChapterBtn.addEventListener("click", () => {
      const isHidden = chapterPanel.classList.toggle("hidden");
      toggleChapterBtn.setAttribute("aria-expanded", String(!isHidden));
      toggleChapterBtn.textContent = isHidden ? "查看各主題答對率分析 ▾" : "收合各主題答對率分析 ▴";
    });

    // 全選 / 取消全選
    selectAllCheckbox.addEventListener("change", (e) => {
      const list = getHistoryList();
      if (e.target.checked) {
        list.forEach(item => selectedRecordIds.add(item.id));
      } else {
        selectedRecordIds.clear();
      }
      syncCheckboxesUI();
    });

    // 一鍵勾選全部 100% 滿分紀錄
    document.getElementById("select-all-perfect-btn").addEventListener("click", () => {
      const list = getHistoryList();
      list.forEach(item => {
        if (item.isPerfect || item.accuracy === "100%" || item.accuracyNum === 100) {
          selectedRecordIds.add(item.id);
        }
      });
      syncCheckboxesUI();
    });

    // 一鍵勾選全部認證合格紀錄
    document.getElementById("select-all-cert-btn").addEventListener("click", () => {
      const list = getHistoryList();
      list.forEach(item => {
        if (item.statusType === "pass") {
          selectedRecordIds.add(item.id);
        }
      });
      syncCheckboxesUI();
    });

    // 列印勾選之驗證紀錄
    document.getElementById("print-selected-btn").addEventListener("click", () => {
      const list = getHistoryList();
      const chosen = list.filter(item => selectedRecordIds.has(item.id));
      printVerificationRecords(chosen);
    });

    document.getElementById("clear-history-btn").addEventListener("click", clearHistory);
  });

})();
