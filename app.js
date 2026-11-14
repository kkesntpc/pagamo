(function () {
  'use strict';

  const CERT_PASS_SCORE = 80;
  const STAGE_PASS_SCORE = 80;
  const STAGE_SIZE = 25;
  const STORAGE_KEY_HISTORY = "exam_quiz_history_v4";
  const STORAGE_KEY_SEEN = "exam_seen_q_ids_v1";
  const STORAGE_KEY_STAGES = "exam_stage_progress_v1";

  const LOCK_ORDER_KEYWORDS = [
    "以上皆是", "以上皆非", "以上皆可", "以上皆對", "以上皆錯",
    "上述皆是", "上述皆非", "上述皆可", "皆是", "皆非", "皆可",
    "A與B", "A和B", "B與C", "B和C", "A、B", "B、C"
  ];

  // ========================================================================
  // 1. 輕量級 Web Audio API 合成音效模組（免外部音檔、支援靜音切換）
  // ========================================================================
  const SoundFX = (() => {
    let ctx = null;
    let enabled = localStorage.getItem("app_sound") !== "off";

    function ensureCtx() {
      if (!ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) ctx = new AudioCtx();
      }
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      return ctx;
    }

    function playTone(freq, startOffset, duration, type = "sine", volume = 0.14) {
      if (!enabled) return;
      const ac = ensureCtx();
      if (!ac) return;
      try {
        const now = ac.currentTime + startOffset;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(now);
        osc.stop(now + duration + 0.02);
      } catch (e) {}
    }

    return {
      isEnabled: () => enabled,
      toggle: () => {
        enabled = !enabled;
        localStorage.setItem("app_sound", enabled ? "on" : "off");
        if (enabled) playTone(587.33, 0, 0.09, "sine", 0.1);
        return enabled;
      },
      playCorrect: () => {
        playTone(523.25, 0, 0.11, "sine", 0.14);      // C5
        playTone(659.25, 0.08, 0.16, "sine", 0.15);   // E5
      },
      playWrong: () => {
        playTone(329.63, 0, 0.13, "triangle", 0.14);  // E4
        playTone(261.63, 0.11, 0.18, "triangle", 0.14); // C4
      },
      playFinish: (isSuccess, isPerfect) => {
        if (isPerfect) {
          playTone(523.25, 0, 0.12, "sine", 0.15);    // C5
          playTone(659.25, 0.1, 0.12, "sine", 0.15);  // E5
          playTone(783.99, 0.2, 0.12, "sine", 0.15);  // G5
          playTone(1046.5, 0.3, 0.28, "sine", 0.17);  // C6
        } else if (isSuccess) {
          playTone(523.25, 0, 0.12, "sine", 0.14);
          playTone(659.25, 0.1, 0.12, "sine", 0.14);
          playTone(783.99, 0.2, 0.22, "sine", 0.15);
        } else {
          playTone(392.00, 0, 0.16, "triangle", 0.12);
          playTone(349.23, 0.14, 0.22, "triangle", 0.12);
        }
      },
      playTick: () => {
        playTone(880, 0, 0.04, "sine", 0.06);
      }
    };
  })();

  // ========================================================================
  // 2. 全域狀態變數
  // ========================================================================
  let currentModeType = "custom"; // "custom" | "future" | "cert" | "stage" | "topic" | "wrong_review"
  let selectedDifficulty = "SMART";

  let selectedStageNumber = 1;
  let currentStageFilter = "ALL";
  let builtStagesCache = null;

  let selectedTopicChapter = "";
  let selectedTopicDifficulty = "SMART";

  let lastCustomWrongPool = [];
  let currentExamQuestions = [];
  let currentQuestionPrepared = null;
  let sessionLogs = [];
  let currentIndex = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let totalTimeAllocated = 300;
  let timeRemaining = 300;
  let examTimer = null;
  let isTimerPaused = false;
  let activeSecondsElapsed = 0;
  let isAnswerLocked = false;
  let candidateName = "";
  let latestFinishedRecord = null;
  let activeDetailRecord = null;
  let selectedRecordIds = new Set();

  // DOM 快取
  const soundToggleBtn = document.getElementById("sound-toggle-btn");
  const soundIcon = document.getElementById("sound-icon");
  const soundLabel = document.getElementById("sound-label");

  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  const themeIcon = document.getElementById("theme-icon");
  const themeLabel = document.getElementById("theme-label");

  const mainTabsNav = document.getElementById("main-tabs-nav");
  const tabBtnPractice = document.getElementById("tab-btn-practice");
  const tabBtnStage = document.getElementById("tab-btn-stage");
  const tabBtnTopic = document.getElementById("tab-btn-topic");
  const tabBtnHistory = document.getElementById("tab-btn-history");
  const tabStageBadge = document.getElementById("tab-stage-badge");
  const tabHistoryBadge = document.getElementById("tab-history-badge");

  const startSection = document.getElementById("tab-panel-practice");
  const stageSection = document.getElementById("tab-panel-stage");
  const topicSection = document.getElementById("tab-panel-topic");
  const historySection = document.getElementById("tab-panel-history");
  const quizSection = document.getElementById("quiz-section");
  const resultSection = document.getElementById("result-section");
  const historyDetailSection = document.getElementById("history-detail-section");

  const modeButtons = document.querySelectorAll(".mode-btn");
  const diffSelect = document.getElementById("diff-select");
  const candidateInput = document.getElementById("candidate-name");
  const certNoticeBox = document.getElementById("cert-notice-box");
  const futureNoticeBox = document.getElementById("future-notice-box");
  const customSettingsBox = document.getElementById("custom-settings-box");
  const customQCountInput = document.getElementById("custom-q-count");
  const practiceFiltersBox = document.getElementById("practice-filters-box");
  const startQuizBtn = document.getElementById("start-quiz-btn");
  const startBtnText = document.getElementById("start-btn-text");
  const unseenPoolBadge = document.getElementById("unseen-pool-badge");

  const stageCardsGrid = document.getElementById("stage-cards-grid");
  const stageSearchInput = document.getElementById("stage-search-input");
  const continueNextStageBtn = document.getElementById("continue-next-stage-btn");

  const topicCandidateInput = document.getElementById("topic-candidate-name");
  const topicSearchInput = document.getElementById("topic-search-input");
  const topicDiffSelect = document.getElementById("topic-diff-select");
  const topicQCountInput = document.getElementById("topic-q-count");
  const topicCardsGrid = document.getElementById("topic-cards-grid");
  const startTopicBtn = document.getElementById("start-topic-btn");
  const startTopicBtnText = document.getElementById("start-topic-btn-text");

  const quizLinearFill = document.getElementById("quiz-linear-fill");
  const qProgressText = document.getElementById("q-progress-text");
  const liveCorrectCnt = document.getElementById("live-correct-cnt");
  const liveWrongCnt = document.getElementById("live-wrong-cnt");
  const qChapterText = document.getElementById("q-chapter-text");
  const qDiffBadge = document.getElementById("q-diff-badge");
  const qCertBadge = document.getElementById("q-cert-badge");
  const qFutureBadge = document.getElementById("q-future-badge");
  const qStageBadge = document.getElementById("q-stage-badge");
  const qWrongBadge = document.getElementById("q-wrong-badge");
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
  const nextStageResultBtn = document.getElementById("next-stage-result-btn");

  const historyTbody = document.getElementById("history-tbody");
  const selectAllCheckbox = document.getElementById("select-all-checkbox");
  const selectedCountBadge = document.getElementById("selected-count-badge");
  const selectedWrongCountBadge = document.getElementById("selected-wrong-count-badge");

  // ========================================================================
  // 3. 主題與音效控制初始化
  // ========================================================================
  function initThemeAndSound() {
    const savedTheme = localStorage.getItem("app_theme") || "light";
    if (savedTheme === "dark") {
      document.body.classList.add("dark-mode");
      themeIcon.textContent = "☀️";
      themeLabel.textContent = "日間";
    }
    themeToggleBtn.addEventListener("click", () => {
      const isDark = document.body.classList.toggle("dark-mode");
      themeIcon.textContent = isDark ? "☀️" : "🌙";
      themeLabel.textContent = isDark ? "日間" : "夜間";
      localStorage.setItem("app_theme", isDark ? "dark" : "light");
    });

    const syncSoundUI = () => {
      const on = SoundFX.isEnabled();
      soundIcon.textContent = on ? "🔊" : "🔇";
      soundLabel.textContent = on ? "音效" : "靜音";
    };
    syncSoundUI();
    soundToggleBtn.addEventListener("click", () => {
      SoundFX.toggle();
      syncSoundUI();
    });
  }

    function getRawQuestions() {
    let pool = [];
    if (window.QUIZ_DATA && Array.isArray(window.QUIZ_DATA)) {
      pool = pool.concat(window.QUIZ_DATA);
    }
    if (window.QUIZ_DATA2 && Array.isArray(window.QUIZ_DATA2)) {
      pool = pool.concat(window.QUIZ_DATA2);
    }
    return pool;
  }

  // ========================================================================
  // 4. 已作答新題追蹤 & 智慧難度分層抽題引擎
  // ========================================================================
  function getSeenQuestionIds() {
    const seen = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_SEEN) || "[]"));
    // 同步相容舊有歷史紀錄中的題目 ID
    getHistoryList().forEach(rec => {
      if (Array.isArray(rec.logs)) {
        rec.logs.forEach(l => {
          if (l.questionId) seen.add(String(l.questionId));
        });
      }
    });
    return seen;
  }

  function markQuestionsAsSeen(questions) {
    const seen = getSeenQuestionIds();
    questions.forEach(q => {
      if (q && q.id) seen.add(String(q.id));
    });
    localStorage.setItem(STORAGE_KEY_SEEN, JSON.stringify(Array.from(seen)));
    updateUnseenBadge();
  }

  function updateUnseenBadge() {
    const all = getRawQuestions();
    if (!all.length || !unseenPoolBadge) return;
    const seen = getSeenQuestionIds();
    const unseenCount = all.filter(q => !seen.has(String(q.id))).length;
    unseenPoolBadge.textContent = `✨ 未刷新題：${unseenCount.toLocaleString()} / ${all.length.toLocaleString()} 題`;
  }

  function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 優先挑選未做過的新題，不足再從已做過的題目隨機補足
  function pickWithUnseenPriority(pool, count, seenSet) {
    if (count <= 0 || pool.length === 0) return [];
    const unseen = [];
    const seen = [];
    pool.forEach(q => {
      if (seenSet.has(String(q.id))) seen.push(q);
      else unseen.push(q);
    });
    const combined = [...shuffle(unseen), ...shuffle(seen)];
    return combined.slice(0, Math.min(count, combined.length));
  }

  // 智慧分層抽題：預設 40% 易 + 40% 中 + 20% 難，並優先抽取未做過的新題
  function smartSelectQuestions(pool, targetCount, diffStrategy) {
    const seenSet = getSeenQuestionIds();
    const finalCount = Math.min(targetCount, pool.length);
    if (finalCount <= 0) return [];

    if (diffStrategy === "易" || diffStrategy === "中" || diffStrategy === "難") {
      const filtered = pool.filter(q => q.difficulty === diffStrategy);
      return pickWithUnseenPriority(filtered, finalCount, seenSet);
    }

    if (diffStrategy === "ALL") {
      return pickWithUnseenPriority(pool, finalCount, seenSet);
    }

    // SMART 分層配比：40% 易 / 40% 中 / 20% 難
    const easyPool = pool.filter(q => q.difficulty === "易");
    const medPool = pool.filter(q => q.difficulty === "中");
    const hardPool = pool.filter(q => q.difficulty === "難");
    const otherPool = pool.filter(q => !["易", "中", "難"].includes(q.difficulty));

    let easyTarget = Math.round(finalCount * 0.4);
    let medTarget = Math.round(finalCount * 0.4);
    let hardTarget = Math.max(0, finalCount - easyTarget - medTarget);

    const chosenEasy = pickWithUnseenPriority(easyPool, easyTarget, seenSet);
    const chosenMed = pickWithUnseenPriority(medPool, medTarget, seenSet);
    const chosenHard = pickWithUnseenPriority(hardPool, hardTarget, seenSet);

    const picked = [...chosenEasy, ...chosenMed, ...chosenHard];
    const pickedIds = new Set(picked.map(q => q.id));

    // 若某難度題數不足（例如特定單元缺少難題），自動由同範圍其餘題目優先新題補足
    if (picked.length < finalCount) {
      const remainingPool = [...easyPool, ...medPool, ...hardPool, ...otherPool].filter(q => !pickedIds.has(q.id));
      const extra = pickWithUnseenPriority(remainingPool, finalCount - picked.length, seenSet);
      picked.push(...extra);
    }

    return shuffle(picked);
  }

  // ========================================================================
  // 5. 🎮 1,215 題闖關模式建構與進度管理
  // ========================================================================
  function getAllStages() {
    if (builtStagesCache) return builtStagesCache;
    const all = getRawQuestions();
    if (!all.length) return [];

    // 依章節整齊分組，並將展望未來（FUT-）與 question2 舉一反多新題（Q2-）各自獨立分關
    const byChap = {};
    const futList = [];
    const q2List = [];
    all.forEach(q => {
      if (String(q.id || "").startsWith("question2-") || String(q.id || "").startsWith("Q2-") || (Array.isArray(window.QUIZ_DATA2) && window.QUIZ_DATA2.includes(q))) {
        q2List.push(q);
      } else if (String(q.id || "").startsWith("FUT-")) {
        futList.push(q);
      } else {
        const ch = q.chapter || "未分類";
        if (!byChap[ch]) byChap[ch] = [];
        byChap[ch].push(q);
      }
    });

    const mainOrdered = [];
    Object.keys(byChap).sort().forEach(ch => {
      mainOrdered.push(...byChap[ch]);
    });

    const rawSlices = [];
    for (let i = 0; i < mainOrdered.length; i += STAGE_SIZE) rawSlices.push(mainOrdered.slice(i, i + STAGE_SIZE));
    for (let i = 0; i < futList.length; i += STAGE_SIZE) rawSlices.push(futList.slice(i, i + STAGE_SIZE));
    for (let i = 0; i < q2List.length; i += STAGE_SIZE) rawSlices.push(q2List.slice(i, i + STAGE_SIZE));

    const diffRank = { "易": 1, "中": 2, "難": 3 };
    const stages = [];
    for (const rawSlice of rawSlices) {
      // 單關內部依「易 → 中 → 難」漸進排列，越後面越有挑戰性
      const progressiveQuestions = [...rawSlice].sort((a, b) => (diffRank[a.difficulty] || 2) - (diffRank[b.difficulty] || 2));

      const chapCounts = {};
      let easyCnt = 0, medCnt = 0, hardCnt = 0;
      const isQ2Stage = progressiveQuestions.every(q => String(q.id || "").startsWith("Q2-") || String(q.id || "").startsWith("question2-") || (Array.isArray(window.QUIZ_DATA2) && window.QUIZ_DATA2.includes(q)));
      const isFutStage = !isQ2Stage && progressiveQuestions.every(q => String(q.id || "").startsWith("FUT-"));

      progressiveQuestions.forEach(q => {
        const ch = q.chapter || "未分類";
        chapCounts[ch] = (chapCounts[ch] || 0) + 1;
        if (q.difficulty === "易") easyCnt++;
        else if (q.difficulty === "中") medCnt++;
        else if (q.difficulty === "難") hardCnt++;
      });

      const sortedChaps = Object.entries(chapCounts).sort((a, b) => b[1] - a[1]);
      let titleTopic = isQ2Stage ? "🎈 question2 趣味挑戰" : (isFutStage ? "🚀 展望未來前瞻專題" : sortedChaps[0][0]);
      if (!isQ2Stage && !isFutStage && sortedChaps.length > 1) {
        titleTopic += ` 等${sortedChaps.length}單元`;
      }

      stages.push({
        stageNum: stages.length + 1,
        titleTopic,
        questions: progressiveQuestions,
        easyCnt,
        medCnt,
        hardCnt,
        timeMinutes: Math.max(3, Math.ceil(progressiveQuestions.length / 5)) // 25題 -> 5分鐘, 15題 -> 3分鐘
      });
    }

    builtStagesCache = stages;
    return stages;
  }

  function getStageProgressMap() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_STAGES) || "{}");
  }

  function updateStageProgress(stageNum, accuracyNum, isPerfect, isTimeout) {
    const map = getStageProgressMap();
    const key = String(stageNum);
    const prev = map[key] || { bestAcc: 0, passed: false, perfect: false, attempts: 0 };
    const passedNow = !isTimeout && accuracyNum >= STAGE_PASS_SCORE;
    map[key] = {
      bestAcc: Math.max(prev.bestAcc, accuracyNum),
      passed: prev.passed || passedNow,
      perfect: prev.perfect || isPerfect,
      attempts: prev.attempts + 1
    };
    localStorage.setItem(STORAGE_KEY_STAGES, JSON.stringify(map));
  }

  function renderStageHub() {
    const stages = getAllStages();
    const progMap = getStageProgressMap();
    const kw = (stageSearchInput ? stageSearchInput.value : "").trim().toLowerCase();

    let clearedStages = 0;
    let masteredQuestions = 0;
    let firstUnpassedStage = null;

    stages.forEach(st => {
      const p = progMap[String(st.stageNum)];
      if (p && p.passed) {
        clearedStages++;
        masteredQuestions += st.questions.length;
      } else if (!firstUnpassedStage) {
        firstUnpassedStage = st;
      }
    });

    if (tabStageBadge) tabStageBadge.textContent = `${clearedStages}/${stages.length}`;
    const clearedEl = document.getElementById("stage-cleared-text");
    const masteredEl = document.getElementById("stage-mastered-q-text");
    const barEl = document.getElementById("stage-overall-bar");
    const totalQ = getRawQuestions().length || 1215;

    if (clearedEl) clearedEl.textContent = `已通關：${clearedStages} / ${stages.length} 關`;
    if (masteredEl) masteredEl.textContent = `已征服題數：${masteredQuestions.toLocaleString()} / ${totalQ.toLocaleString()} 題 (${Math.round((masteredQuestions / totalQ) * 100)}%)`;
    if (barEl) barEl.style.width = `${stages.length > 0 ? Math.round((clearedStages / stages.length) * 100) : 0}%`;

    if (continueNextStageBtn) {
      const targetSt = firstUnpassedStage || stages[0];
      if (targetSt) {
        continueNextStageBtn.textContent = firstUnpassedStage
          ? `▶️ 繼續挑戰：第 ${targetSt.stageNum} 關`
          : `🏆 全數通關！重溫第 1 關`;
        continueNextStageBtn.onclick = () => {
          selectedStageNumber = targetSt.stageNum;
          currentModeType = "stage";
          startExam();
        };
      }
    }

    if (!stageCardsGrid) return;
    stageCardsGrid.innerHTML = "";

    const filteredStages = stages.filter(st => {
      const p = progMap[String(st.stageNum)];
      if (currentStageFilter === "UNPASSED" && p && p.passed) return false;
      if (currentStageFilter === "PASSED" && (!p || !p.passed)) return false;
      if (currentStageFilter === "PERFECT" && (!p || !p.perfect)) return false;
      if (kw) {
        const label = `第${st.stageNum}關 ${st.stageNum} ${st.titleTopic}`.toLowerCase();
        if (!label.includes(kw)) return false;
      }
      return true;
    });

    if (filteredStages.length === 0) {
      stageCardsGrid.innerHTML = `<p style="color:var(--text-muted); padding:16px; grid-column:1/-1;">目前篩選條件下沒有符合的關卡。</p>`;
      return;
    }

    filteredStages.forEach(st => {
      const p = progMap[String(st.stageNum)];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stage-card-item";
      if (p && p.perfect) btn.classList.add("is-perfect");
      else if (p && p.bestAcc >= 90) btn.classList.add("is-excellent");
      else if (p && p.passed) btn.classList.add("is-passed");

      let starsHtml = "☆☆☆";
      let statusText = "尚未挑戰";
      if (p) {
        if (p.perfect) {
          starsHtml = "👑 滿分";
          statusText = "100% 滿分通關";
        } else if (p.bestAcc >= 90) {
          starsHtml = "🌟 優異";
          statusText = `最高 ${p.bestAcc}% (超群表現)`;
        } else if (p.passed) {
          starsHtml = "⭐ 合格";
          statusText = `最高 ${p.bestAcc}% (達標通關)`;
        } else {
          starsHtml = "★☆☆";
          statusText = `最高 ${p.bestAcc}% (未達80%)`;
        }
      }

      btn.innerHTML = `
        <div class="stage-card-top">
          <span>第 ${String(st.stageNum).padStart(2, "0")} 關</span>
          <span class="stage-stars" aria-label="${statusText}">${starsHtml}</span>
        </div>
        <div class="stage-card-topic">${st.titleTopic}</div>
        <div class="stage-card-bottom">
          <span>${st.questions.length}題 · 易${st.easyCnt}/中${st.medCnt}/難${st.hardCnt}</span>
          <strong>${statusText}</strong>
        </div>
      `;

      btn.addEventListener("click", () => {
        selectedStageNumber = st.stageNum;
        currentModeType = "stage";
        startExam();
      });

      stageCardsGrid.appendChild(btn);
    });
  }

  // ========================================================================
  // 6. 📚 主題分類練習卡片網格
  // ========================================================================
  function getChapterAccuracyStats() {
    const list = getHistoryList();
    const chapterMap = {};
    list.forEach(rec => {
      if (Array.isArray(rec.logs)) {
        rec.logs.forEach(log => {
          const ch = log.chapter || "未分類";
          if (!chapterMap[ch]) chapterMap[ch] = { total: 0, correct: 0 };
          chapterMap[ch].total += 1;
          if (log.isCorrect) chapterMap[ch].correct += 1;
        });
      }
    });
    return chapterMap;
  }

  function getFilteredTopicPool() {
    const allQuestions = getRawQuestions();
    let pool = allQuestions.filter(q => (q.chapter || "未分類") === selectedTopicChapter);
    if (["易", "中", "難"].includes(selectedTopicDifficulty)) {
      pool = pool.filter(q => q.difficulty === selectedTopicDifficulty);
    }
    return pool;
  }

  function renderTopicCards(keyword = "") {
    const allQuestions = getRawQuestions();
    if (allQuestions.length === 0) return;
    const chapterCounts = {};
    allQuestions.forEach(q => {
      const ch = q.chapter || "未分類";
      chapterCounts[ch] = (chapterCounts[ch] || 0) + 1;
    });
    const sortedChapters = Object.keys(chapterCounts).sort();
    if (!selectedTopicChapter && sortedChapters.length > 0) {
      selectedTopicChapter = sortedChapters[0];
    }
    const histStats = getChapterAccuracyStats();
    const kw = keyword.trim().toLowerCase();
    const filteredChapters = kw ? sortedChapters.filter(ch => ch.toLowerCase().includes(kw)) : sortedChapters;

    topicCardsGrid.innerHTML = "";
    if (filteredChapters.length === 0) {
      topicCardsGrid.innerHTML = `<p style="color:var(--text-muted); padding:16px; grid-column:1/-1;">找不到符合「${keyword}」的主題單元。</p>`;
      updateTopicStartButton();
      return;
    }

    filteredChapters.forEach(ch => {
      const btn = document.createElement("button");
      btn.type = "button";
      const isActive = (ch === selectedTopicChapter);
      btn.className = `topic-unit-card ${isActive ? "active" : ""}`;
      const st = histStats[ch];
      const accBadgeText = st && st.total > 0 ? `答對率 ${Math.round((st.correct / st.total) * 100)}%` : "尚未練習";
      btn.innerHTML = `<div class="topic-unit-name">${ch}</div>
        <div class="topic-unit-meta">
          <span>共 ${chapterCounts[ch]} 題</span><span class="topic-acc-pill">${accBadgeText}</span>
        </div>`;
      btn.addEventListener("click", () => {
        selectedTopicChapter = ch;
        renderTopicCards(topicSearchInput.value);
      });
      topicCardsGrid.appendChild(btn);
    });
    updateTopicStartButton();
  }

  function calcAutoMinutes(qCount) {
    const n = Math.max(1, parseInt(qCount, 10) || 1);
    return Math.ceil((n * 10) / 60);
  }

  function updateCustomTimePreview() {
    const previewEl = document.getElementById("custom-time-preview");
    if (!previewEl || !customQCountInput) return;
    const qCount = Math.max(1, parseInt(customQCountInput.value, 10) || 20);
    previewEl.textContent = `⏱️ ${calcAutoMinutes(qCount)} 分鐘`;
  }

  function updateTopicStartButton() {
    const previewEl = document.getElementById("topic-time-preview");
    const pool = selectedTopicChapter ? getFilteredTopicPool() : [];
    const reqCount = Math.max(1, parseInt(topicQCountInput.value, 10) || 20);
    const actualCount = selectedTopicChapter && pool.length > 0 ? Math.min(reqCount, pool.length) : reqCount;
    const tLimit = calcAutoMinutes(actualCount);
    if (previewEl) previewEl.textContent = `⏱️ ${tLimit} 分鐘`;

    if (!selectedTopicChapter) {
      startTopicBtn.disabled = true;
      startTopicBtnText.textContent = "請先選擇上方主題單元";
      return;
    }
    startTopicBtn.disabled = pool.length === 0;
    startTopicBtnText.textContent = `開始主題練習（${selectedTopicChapter} · ${actualCount}題 / ${tLimit}分鐘） ➔`;
  }

  // ========================================================================
  // 7. 模式選擇與表單事件綁定
  // ========================================================================
  function syncAllCandidateInputs(val) {
    const footerInput = document.getElementById("footer-candidate-name");
    if (candidateInput && candidateInput.value !== val) candidateInput.value = val;
    if (topicCandidateInput && topicCandidateInput.value !== val) topicCandidateInput.value = val;
    if (footerInput && footerInput.value !== val) footerInput.value = val;
    localStorage.setItem("candidate_name", val);
  }

  function initModeSelection() {
    const savedName = localStorage.getItem("candidate_name") || "";
    const footerInput = document.getElementById("footer-candidate-name");
    if (savedName) syncAllCandidateInputs(savedName);

    [candidateInput, topicCandidateInput, footerInput].forEach(inp => {
      if (inp) {
        inp.addEventListener("input", e => syncAllCandidateInputs(e.target.value));
      }
    });
    if (customQCountInput) {
      customQCountInput.addEventListener("input", updateCustomTimePreview);
      updateCustomTimePreview();
    }

    modeButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        modeButtons.forEach(b => { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        currentModeType = btn.dataset.modeType;

        certNoticeBox.classList.add("hidden");
        futureNoticeBox.classList.add("hidden");
        customSettingsBox.classList.add("hidden");
        practiceFiltersBox.classList.remove("hidden");

        if (currentModeType === "cert") {
          certNoticeBox.classList.remove("hidden");
          practiceFiltersBox.classList.add("hidden");
          startBtnText.textContent = "開始正式認證測驗（50題 / 10分鐘） ➔";
        } else if (currentModeType === "future") {
          futureNoticeBox.classList.remove("hidden");
          startBtnText.textContent = "開始 question2 趣味挑戰（30題 / 5分鐘） ➔";
        } else {
          customSettingsBox.classList.remove("hidden");
          startBtnText.textContent = "開始智慧綜合練習 ➔";
        }
      });
    });

    diffSelect.addEventListener("change", e => selectedDifficulty = e.target.value);

    // 闖關分頁篩選與搜尋
    document.querySelectorAll(".stage-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".stage-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentStageFilter = btn.dataset.stageFilter;
        renderStageHub();
      });
    });
    if (stageSearchInput) {
      stageSearchInput.addEventListener("input", renderStageHub);
    }

    // 主題分頁事件
    topicSearchInput.addEventListener("input", e => renderTopicCards(e.target.value));
    topicDiffSelect.addEventListener("change", e => {
      selectedTopicDifficulty = e.target.value;
      updateTopicStartButton();
    });
    topicQCountInput.addEventListener("input", updateTopicStartButton);

    document.getElementById("topic-all-q-btn").addEventListener("click", () => {
      const pool = getFilteredTopicPool();
      if (pool.length > 0) {
        topicQCountInput.value = pool.length;
        updateTopicStartButton();
      }
    });

    startQuizBtn.addEventListener("click", () => {
      const activeBtn = document.querySelector(".mode-btn.active");
      if (activeBtn) currentModeType = activeBtn.dataset.modeType;
      startExam();
    });
    startTopicBtn.addEventListener("click", () => {
      currentModeType = "topic";
      startExam();
    });
    nextBtn.addEventListener("click", proceedToNextQuestion);
  }

  // ========================================================================
  // 8. 保護式選項洗牌 & 詳解網址自動轉換
  // ========================================================================
  function shouldLockOptionOrder(options) {
    if (!Array.isArray(options)) return true;
    return options.some(optText => {
      const normalized = String(optText).replace(/\s+/g, "");
      return LOCK_ORDER_KEYWORDS.some(kw => normalized.includes(kw));
    });
  }

  function prepareQuestionOptions(q) {
    if (q.type === "TF" || !Array.isArray(q.options) || q.options.length <= 2) {
      return { displayOptions: [...q.options], correctAnswerLetter: String(q.answer).trim().toUpperCase(), isShuffled: false };
    }
    const origCorrectLetter = String(q.answer).trim().toUpperCase();
    const origCorrectIdx = origCorrectLetter.charCodeAt(0) - 65;
    if (shouldLockOptionOrder(q.options) || origCorrectIdx < 0 || origCorrectIdx >= q.options.length) {
      return { displayOptions: [...q.options], correctAnswerLetter: origCorrectLetter, isShuffled: false };
    }
    const paired = q.options.map((text, idx) => ({ text, isCorrect: idx === origCorrectIdx }));
    const shuffledPaired = shuffle(paired);
    const newCorrectIdx = shuffledPaired.findIndex(item => item.isCorrect);
    return { displayOptions: shuffledPaired.map(item => item.text), correctAnswerLetter: String.fromCharCode(65 + newCorrectIdx), isShuffled: true };
  }

  function formatExplanationHtml(rawText) {
    const safe = String(rawText || "本題無附加文字詳解，請參考上方標示之正確解答。")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return safe.replace(/(https?:\/\/[^\s<]+)/g, url => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="expl-ref-link">🔗 開啟參考資料來源</a>`;
    });
  }

  // ========================================================================
  // 9. 啟動測驗主流程
  // ========================================================================
  function startExam(customQuestionsPool = null) {
    const allQuestions = getRawQuestions();
    if (allQuestions.length === 0) { alert("未偵測到題庫資料，請確認 questions.js！"); return; }

    candidateName = ((candidateInput && candidateInput.value) || (topicCandidateInput && topicCandidateInput.value) || (document.getElementById("footer-candidate-name") && document.getElementById("footer-candidate-name").value) || "").trim() || "訪客考生";
    localStorage.setItem("candidate_name", candidateName);

    let chosenQuestions = [];
    let scopeLabel = "全範圍綜合";
    let timeInMinutes = Math.ceil((30 * 10) / 60);

    if (currentModeType === "wrong_review") {
      const pool = Array.isArray(customQuestionsPool) && customQuestionsPool.length > 0 ? customQuestionsPool : lastCustomWrongPool;
      lastCustomWrongPool = [...pool];
      chosenQuestions = shuffle(pool);
      scopeLabel = "🔥 歷屆錯題特訓";
      timeInMinutes = Math.max(1, Math.ceil((chosenQuestions.length * 10) / 60));
    } else if (currentModeType === "stage") {
      const stages = getAllStages();
      const stageObj = stages.find(s => s.stageNum === selectedStageNumber) || stages[0];
      selectedStageNumber = stageObj.stageNum;
      // 闖關模式維持該關卡「易 → 中 → 難」漸進順序，方便系統化通關
      chosenQuestions = [...stageObj.questions];
      scopeLabel = `🎮 第 ${stageObj.stageNum} 關（${stageObj.titleTopic}）`;
      timeInMinutes = stageObj.timeMinutes;
    } else if (currentModeType === "topic") {
      const basePool = allQuestions.filter(q => (q.chapter || "未分類") === selectedTopicChapter);
      const targetCount = parseInt(topicQCountInput.value, 10) || 20;
      timeInMinutes = Math.ceil((targetCount * 10) / 60);
      chosenQuestions = smartSelectQuestions(basePool, targetCount, selectedTopicDifficulty);
      scopeLabel = selectedTopicChapter;
      if (["易", "中", "難"].includes(selectedTopicDifficulty)) scopeLabel += ` (${selectedTopicDifficulty})`;
    } else if (currentModeType === "cert") {
      // 認證測驗固定採用 40%易 / 40%中 / 20%難 智慧配比抽 50 題
      chosenQuestions = smartSelectQuestions(allQuestions, 50, "SMART");
      scopeLabel = "🏆 認證測驗（智慧配比 50 題）";
      timeInMinutes = Math.ceil((50 * 10) / 60);
    } else if (currentModeType === "future") {
      const q2Pool = allQuestions.filter(q =>
        (Array.isArray(window.QUIZ_DATA2) && window.QUIZ_DATA2.includes(q)) ||
        String(q.id || "").startsWith("Q2-") ||
        String(q.id || "").startsWith("question2-")
      );
      chosenQuestions = smartSelectQuestions(q2Pool, 30, selectedDifficulty);
      scopeLabel = "🎈 question2 趣味挑戰";
      if (["易", "中", "難"].includes(selectedDifficulty)) scopeLabel += ` (${selectedDifficulty})`;
      timeInMinutes = calcAutoMinutes(chosenQuestions.length);
    } else {
      const targetCount = parseInt(customQCountInput.value, 10) || 20;
      timeInMinutes = Math.ceil((targetCount * 10) / 60);
      chosenQuestions = smartSelectQuestions(allQuestions, targetCount, selectedDifficulty);
      scopeLabel = selectedDifficulty === "SMART" ? "🧠 智慧綜合練習" : "自訂綜合練習";
      if (["易", "中", "難"].includes(selectedDifficulty)) scopeLabel += ` (${selectedDifficulty})`;
    }

    if (chosenQuestions.length === 0) {
      alert("目前篩選條件下沒有符合的題目，請調整難度或主題條件！");
      return;
    }

    currentExamQuestions = chosenQuestions;
    currentExamQuestions._scopeLabel = scopeLabel;

    currentIndex = 0;
    correctCount = 0;
    wrongCount = 0;
    sessionLogs = [];
    isAnswerLocked = false;
    isTimerPaused = false;
    activeSecondsElapsed = 0;
    totalTimeAllocated = timeInMinutes * 60;
    timeRemaining = totalTimeAllocated;

    const welcomeSec = document.getElementById("welcome-section");
    if (welcomeSec) welcomeSec.classList.add("hidden");
    mainTabsNav.classList.add("hidden");
    startSection.classList.add("hidden");
    stageSection.classList.add("hidden");
    topicSection.classList.add("hidden");
    historySection.classList.add("hidden");
    resultSection.classList.add("hidden");
    historyDetailSection.classList.add("hidden");
    quizSection.classList.remove("hidden");

    qCertBadge.classList.toggle("hidden", currentModeType !== "cert");
    qFutureBadge.classList.toggle("hidden", currentModeType !== "future");
    qStageBadge.classList.toggle("hidden", currentModeType !== "stage");
    qWrongBadge.classList.toggle("hidden", currentModeType !== "wrong_review");

    startOverallTimer();
    renderQuestion();
  }

  function startOverallTimer() {
    clearInterval(examTimer);
    isTimerPaused = false;
    updateTimerDisplay();
    examTimer = setInterval(() => {
      if (isTimerPaused) return;
      timeRemaining--;
      activeSecondsElapsed++;
      updateTimerDisplay();
      if (timeRemaining > 0 && timeRemaining <= 5) {
        SoundFX.playTick();
      }
      if (timeRemaining <= 0) {
        clearInterval(examTimer);
        alert("作答時間結束！系統將自動結算成績。");
        finishExam(true);
      }
    }, 1000);
  }

  function setTimerPaused(paused) {
    isTimerPaused = currentModeType === "cert" ? false : paused;
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
      if (timeRemaining <= totalTimeAllocated * 0.2) timerContainer.classList.add("urgent");
      else timerContainer.classList.remove("urgent");
    }
  }

  function renderQuestion() {
    isAnswerLocked = false;
    nextBtn.classList.add("hidden");
    explanationPanel.classList.add("hidden");
    setTimerPaused(false);

    const totalQ = currentExamQuestions.length;
    if (liveCorrectCnt) liveCorrectCnt.textContent = correctCount;
    if (liveWrongCnt) liveWrongCnt.textContent = wrongCount;
    if (quizLinearFill) {
      quizLinearFill.style.width = `${totalQ > 0 ? Math.round((currentIndex / totalQ) * 100) : 0}%`;
    }

    if (currentIndex >= totalQ) {
      finishExam(false);
      return;
    }

    const q = currentExamQuestions[currentIndex];
    currentQuestionPrepared = prepareQuestionOptions(q);

    qProgressText.textContent = `第 ${currentIndex + 1} 題 / 共 ${totalQ} 題`;
    qChapterText.textContent = q.chapter ? `分類單元：${q.chapter}` : "分類單元：一般題庫";
    qDiffBadge.textContent = q.difficulty || "混合";
    qDiffBadge.className = `badge-tag badge-difficulty-${q.difficulty || '易'}`;
    questionTitle.textContent = q.question;
    optionsList.innerHTML = "";

    currentQuestionPrepared.displayOptions.forEach((optText, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-item";
      let optLabel = "", displayHtml = "", ariaText = "";

      if (q.type === "TF") {
        optLabel = optText;
        const isTrueOpt = String(optText).trim().toUpperCase() === "O";
        displayHtml = isTrueOpt ? `<strong>⭕ 是（O）</strong>` : `<strong>❌ 否（X）</strong>`;
        ariaText = isTrueOpt ? "是（O）" : "否（X）";
      } else {
        optLabel = String.fromCharCode(65 + idx);
        displayHtml = `<strong>${optLabel}.</strong> ${optText}`;
        ariaText = `選項 ${optLabel}：${optText}`;
      }
      btn.dataset.val = optLabel;
      btn.dataset.text = optText;
      btn.setAttribute("aria-label", ariaText);
      btn.innerHTML = `<span>${displayHtml}</span><span class="option-status-icon"></span>`;
      btn.addEventListener("click", () => handleSelectAnswer(btn, optLabel, optText, currentQuestionPrepared.correctAnswerLetter, q));
      optionsList.appendChild(btn);
    });
    if (optionsList.firstElementChild) optionsList.firstElementChild.focus();
  }

  function handleSelectAnswer(selectedBtn, userVal, userText, correctVal, q) {
    if (isAnswerLocked) return;
    isAnswerLocked = true;
    const allButtons = optionsList.querySelectorAll(".option-item");
    allButtons.forEach(b => b.disabled = true);

    const normUser = String(userVal).trim().toUpperCase();
    const normCorrect = String(correctVal).trim().toUpperCase();
    const isCorrect = (normUser === normCorrect);
    const formatTf = val => val === "O" ? "是（O）" : (val === "X" ? "否（X）" : val);

    let correctFullText = normCorrect;
    allButtons.forEach(b => {
      if (b.dataset.val === normCorrect) {
        correctFullText = q.type === "TF" ? formatTf(normCorrect) : `${normCorrect}. ${b.dataset.text}`;
      }
    });
    const userFullText = q.type === "TF" ? formatTf(normUser) : `${normUser}. ${userText}`;

    sessionLogs.push({
      qNum: currentIndex + 1,
      questionId: q.id || "",
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
      if (liveCorrectCnt) liveCorrectCnt.textContent = correctCount;
      SoundFX.playCorrect();
      selectedBtn.classList.add("correct");
      selectedBtn.querySelector(".option-status-icon").textContent = "✔ 正確解答";
      setTimeout(() => { currentIndex++; renderQuestion(); }, 380);
    } else {
      wrongCount++;
      if (liveWrongCnt) liveWrongCnt.textContent = wrongCount;
      SoundFX.playWrong();
      selectedBtn.classList.add("wrong");
      selectedBtn.querySelector(".option-status-icon").textContent = "✖ 你的選擇";
      allButtons.forEach(b => {
        if (b.dataset.val === normCorrect) {
          b.classList.add("correct");
          b.querySelector(".option-status-icon").textContent = "✔ 正確解答";
        }
      });
      setTimerPaused(true);
      explanationContent.innerHTML = formatExplanationHtml(q.explanation);
      explanationPanel.classList.remove("hidden");
      nextBtn.classList.remove("hidden");
      nextBtn.focus();
    }
  }

  function proceedToNextQuestion() {
    currentIndex++;
    renderQuestion();
  }

  // 全鍵盤快捷鍵支援：1~4、A~D、O/X、Enter/Space 下一題
  document.addEventListener("keydown", (e) => {
    if (quizSection.classList.contains("hidden")) return;
    if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;

    const k = e.key.toUpperCase();
    if (!isAnswerLocked) {
      const btns = Array.from(optionsList.querySelectorAll(".option-item"));
      const q = currentExamQuestions[currentIndex];
      if (q && q.type === "TF") {
        if (k === "1" || k === "O" || k === "Y") { e.preventDefault(); const b = btns.find(x => x.dataset.val === "O"); if (b) b.click(); }
        if (k === "2" || k === "X" || k === "N") { e.preventDefault(); const b = btns.find(x => x.dataset.val === "X"); if (b) b.click(); }
      } else {
        if ((k === "1" || k === "A") && btns[0]) { e.preventDefault(); btns[0].click(); }
        if ((k === "2" || k === "B") && btns[1]) { e.preventDefault(); btns[1].click(); }
        if ((k === "3" || k === "C") && btns[2]) { e.preventDefault(); btns[2].click(); }
        if ((k === "4" || k === "D") && btns[3]) { e.preventDefault(); btns[3].click(); }
      }
    } else if ((e.key === "Enter" || e.key === " ") && !explanationPanel.classList.contains("hidden")) {
      e.preventDefault();
      proceedToNextQuestion();
    }
  });

  // ========================================================================
  // 10. 測驗結算與紀錄保存
  // ========================================================================
  function finishExam(isTimeout) {
    clearInterval(examTimer);
    if (quizLinearFill) quizLinearFill.style.width = "100%";

    quizSection.classList.add("hidden");
    resultSection.classList.remove("hidden");

    const totalQ = currentExamQuestions.length;
    const accNum = totalQ > 0 ? Math.round((correctCount / totalQ) * 1000) / 10 : 0;
    const accStr = accNum.toFixed(1);
    const isPerfect = (correctCount === totalQ && totalQ > 0 && !isTimeout);
    const timeSpent = Math.max(1, activeSecondsElapsed);

    // 標記本輪題目為「已作答」，供智慧選題優先抽未做過的新題
    markQuestionsAsSeen(currentExamQuestions);

    document.getElementById("res-total").textContent = totalQ;
    document.getElementById("res-correct").textContent = correctCount;
    document.getElementById("res-accuracy").textContent = isPerfect ? "100%" : `${accStr}%`;
    document.getElementById("res-time").textContent = formatTime(timeSpent);
    document.getElementById("res-avg-time").textContent = `${(timeSpent / totalQ).toFixed(1)} 秒`;
    perfectBanner.classList.toggle("hidden", !isPerfect);

    const mainHeading = document.getElementById("result-main-heading");
    const subHeading = document.getElementById("result-sub-heading");
    nextStageResultBtn.classList.add("hidden");

    let statusType = "practice";
    let statusLabel = isTimeout ? "練習(超時)" : (isPerfect ? "💯 滿分達成" : "練習完成");
    let isSuccessSound = isPerfect || accNum >= 80;

    if (currentModeType === "stage") {
      const isStagePassed = accNum >= STAGE_PASS_SCORE && !isTimeout;
      updateStageProgress(selectedStageNumber, isPerfect ? 100 : accNum, isPerfect, isTimeout);
      renderStageHub();

      if (isStagePassed) {
        statusType = "pass";
        statusLabel = isPerfect ? "★★★ 關卡滿分" : "★★☆ 關卡通關";
        mainHeading.textContent = isPerfect ? `🏆 第 ${selectedStageNumber} 關三星滿分通關！` : `🎉 第 ${selectedStageNumber} 關挑戰成功！`;
        subHeading.textContent = `達成 ${STAGE_PASS_SCORE}% 通關標準！成績已自動記錄至學習歷程。`;
      } else {
        statusType = "fail";
        statusLabel = isTimeout ? "❌ 闖關超時" : "❌ 未達80%過關";
        mainHeading.textContent = `💪 第 ${selectedStageNumber} 關尚未通關（需達 ${STAGE_PASS_SCORE}%）`;
        subHeading.textContent = "可查看下方詳解複習錯題，再挑戰一次即可過關！";
      }

      const allStages = getAllStages();
      if (selectedStageNumber < allStages.length) {
        const nextNum = selectedStageNumber + 1;
        nextStageResultBtn.textContent = `挑戰第 ${nextNum} 關 ➔`;
        nextStageResultBtn.classList.remove("hidden");
        nextStageResultBtn.onclick = () => {
          selectedStageNumber = nextNum;
          currentModeType = "stage";
          startExam();
        };
      }
      certificateBox.classList.add("hidden");
    } else if (currentModeType === "cert") {
      mainHeading.textContent = "🎉 認證測驗結算完成！";
      subHeading.textContent = "成績與明細已儲存至「學習歷程」。";
      if (accNum >= CERT_PASS_SCORE && !isTimeout) {
        statusType = "pass";
        statusLabel = isPerfect ? "🏆 認證滿分合格" : "🏆 認證合格";
        certificateBox.classList.remove("hidden");
        certCandidateDisplay.textContent = candidateName;
        certScoreDisplay.textContent = `${isPerfect ? "100" : accStr}%（答對 ${correctCount}/${totalQ}）`;
        certDateDisplay.textContent = new Date().toLocaleDateString("zh-TW");
      } else {
        statusType = "fail";
        statusLabel = isTimeout ? "❌ 未通過(超時)" : "❌ 未達80分";
        certificateBox.classList.add("hidden");
      }
    } else {
      mainHeading.textContent = "🎉 測驗結算完成！";
      subHeading.textContent = "成績與明細已儲存至「學習歷程」。";
      certificateBox.classList.add("hidden");
    }

    SoundFX.playFinish(isSuccessSound, isPerfect);

    const record = {
      id: "REC-" + Date.now(),
      date: new Date().toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
      candidate: candidateName,
      scope: currentExamQuestions._scopeLabel || "綜合",
      modeType: currentModeType,
      totalCount: totalQ,
      correctCount: correctCount,
      accuracyNum: isPerfect ? 100 : accNum,
      accuracy: isPerfect ? "100%" : `${accStr}%`,
      isPerfect: isPerfect,
      timeSpent: formatTime(timeSpent),
      statusType: statusType,
      statusLabel: statusLabel,
      logs: sessionLogs
    };

    latestFinishedRecord = record;
    saveHistoryRecord(record);
    renderSessionReview(sessionLogs, document.getElementById("session-review-list"), false, false);
  }

  function renderSessionReview(logs, containerEl, wrongOnly, enableCheckboxes = false) {
    containerEl.innerHTML = "";
    if (!logs || logs.length === 0) return containerEl.innerHTML = `<p style="color:var(--text-muted); padding:12px;">無明細紀錄。</p>`;
    const filtered = wrongOnly ? logs.filter(item => !item.isCorrect) : logs;
    if (filtered.length === 0) return containerEl.innerHTML = `<p style="color:var(--state-correct-text); font-weight:700; padding:12px;">🎉 全數答對無錯題！</p>`;

    filtered.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = `review-item-card ${item.isCorrect ? "" : "is-wrong"}`;
      const cbHtml = (!item.isCorrect && enableCheckboxes)
        ? `<label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer; color:var(--state-wrong-text); margin-right:8px;"><input type="checkbox" class="detail-wrong-cb" data-log-idx="${idx}" checked><span>重練</span></label>`
        : "";

      card.innerHTML = `<div class="review-item-header">
          <span>${cbHtml}第 ${item.qNum} 題 ｜ ${item.chapter}（${item.difficulty}）</span>
          <span style="color:${item.isCorrect ? 'var(--state-correct-text)' : 'var(--state-wrong-text)'}">${item.isCorrect ? '✔ 答對' : '✖ 答錯'}</span>
        </div>
        <div class="review-q-text">${item.question}</div>
        <div class="review-ans-row">
          <span><strong>你的作答：</strong><span style="color:${item.isCorrect ? 'var(--state-correct-text)' : 'var(--state-wrong-text)'}">${item.userAnswer}</span></span>
          ${!item.isCorrect ? `<span><strong>正確解答：</strong><span style="color:var(--state-correct-text); font-weight:700;">${item.correctAnswer}</span></span>` : ""}
        </div>
        ${!item.isCorrect && item.explanation ? `<div class="review-expl-text"><strong>📖 解析：</strong>${formatExplanationHtml(item.explanation)}</div>` : ""}`;
      containerEl.appendChild(card);
    });

    if (enableCheckboxes) {
      const updateDetailCount = () => {
        const cnt = document.querySelectorAll(".detail-wrong-cb:checked").length;
        const el = document.getElementById("detail-wrong-selected-count");
        if (el) el.textContent = cnt;
      };
      updateDetailCount();
      containerEl.querySelectorAll(".detail-wrong-cb").forEach(cb => cb.addEventListener("change", updateDetailCount));
    }
  }

  // ========================================================================
  // 11. 錯題重練與學習歷程管理
  // ========================================================================
  function resolveUniqueQuestionsFromLogs(wrongLogs) {
    const allQuestions = getRawQuestions();
    const byId = new Map(), byText = new Map();
    allQuestions.forEach(q => {
      if (q.id) byId.set(String(q.id).trim(), q);
      if (q.question) byText.set(String(q.question).trim(), q);
    });
    const uniqueMap = new Map();
    wrongLogs.forEach(log => {
      if (log.isCorrect) return;
      let matched = null;
      if (log.questionId && byId.has(String(log.questionId).trim())) matched = byId.get(String(log.questionId).trim());
      else if (log.question && byText.has(String(log.question).trim())) matched = byText.get(String(log.question).trim());
      if (matched) uniqueMap.set(matched.id || matched.question, matched);
    });
    return Array.from(uniqueMap.values());
  }

  function getSelectedHistoryWrongQuestions() {
    const chosen = getHistoryList().filter(item => selectedRecordIds.has(item.id));
    const allWrong = [];
    chosen.forEach(r => {
      if (Array.isArray(r.logs)) r.logs.forEach(l => { if (!l.isCorrect) allWrong.push(l); });
    });
    return resolveUniqueQuestionsFromLogs(allWrong);
  }

  function getHistoryList() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || "[]");
  }

  function saveHistoryRecord(rec) {
    const list = getHistoryList();
    list.unshift(rec);
    if (list.length > 50) list.pop();
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(list));
  }

  function renderLearningPortfolio() {
    const list = getHistoryList();
    let tTotal = 0, tCorr = 0, perfect = [];
    const chapMap = {};
    list.forEach(r => {
      tTotal += (r.totalCount || 0);
      tCorr += (r.correctCount || 0);
      if (r.isPerfect || r.accuracyNum === 100) perfect.push(r);
      if (Array.isArray(r.logs)) r.logs.forEach(l => {
        const c = l.chapter || "未分類";
        if (!chapMap[c]) chapMap[c] = { t: 0, c: 0 };
        chapMap[c].t++;
        if (l.isCorrect) chapMap[c].c++;
      });
    });

    document.getElementById("kpi-sessions").textContent = list.length;
    if (tabHistoryBadge) tabHistoryBadge.textContent = list.length;
    document.getElementById("kpi-total-q").textContent = tTotal;
    document.getElementById("kpi-overall-acc").textContent = tTotal > 0 ? ((tCorr / tTotal) * 100).toFixed(1) + "%" : "0%";
    document.getElementById("kpi-perfect-count").textContent = perfect.length;

    const statsList = document.getElementById("chapter-stats-list");
    statsList.innerHTML = "";
    Object.keys(chapMap).sort().forEach(ch => {
      const st = chapMap[ch], pct = Math.round((st.c / st.t) * 100);
      const div = document.createElement("div");
      div.className = "chapter-stat-item";
      div.innerHTML = `<div class="chapter-stat-top"><span>${ch}</span><span>${pct}% (${st.c}/${st.t})</span></div>
                       <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>`;
      statsList.appendChild(div);
    });

    const perfSec = document.getElementById("perfect-streak-section"), perfList = document.getElementById("perfect-horizontal-list");
    if (perfect.length === 0) perfSec.classList.add("hidden");
    else {
      perfSec.classList.remove("hidden");
      perfList.innerHTML = "";
      perfect.forEach((p, idx) => {
        const isCk = selectedRecordIds.has(p.id);
        const card = document.createElement("div");
        card.className = "perfect-chip-card";
        card.innerHTML = `<div class="perfect-chip-top"><span>💯 滿分 #${perfect.length - idx}</span>
          <label style="cursor:pointer;font-size:0.8rem;"><input type="checkbox" class="perfect-sync-cb" data-id="${p.id}" ${isCk ? "checked" : ""}> 勾選</label></div>
          <div class="perfect-chip-scope">${p.scope}</div>
          <div class="perfect-chip-meta"><span>${p.candidate} · ${p.totalCount}題</span><span>${p.date.split(" ")[0]}</span></div>`;
        perfList.appendChild(card);
      });
      perfList.querySelectorAll(".perfect-sync-cb").forEach(cb => cb.addEventListener("change", e => {
        e.target.checked ? selectedRecordIds.add(e.target.dataset.id) : selectedRecordIds.delete(e.target.dataset.id);
        syncCheckboxesUI();
      }));
    }

    historyTbody.innerHTML = list.length === 0 ? `<tr><td colspan="8" style="padding:16px;color:var(--text-muted)">尚無測驗紀錄</td></tr>` : "";
    list.forEach(item => {
      const tr = document.createElement("tr");
      const pClass = item.statusType === "pass" ? "status-pass" : item.statusType === "fail" ? "status-fail" : "status-practice";
      const wNum = Math.max(0, (item.totalCount || 0) - (item.correctCount || 0));
      const isCk = selectedRecordIds.has(item.id);
      tr.innerHTML = `<td><input type="checkbox" class="row-select-cb" data-id="${item.id}" ${isCk ? "checked" : ""}></td>
        <td>${item.date}</td><td><strong>${item.candidate || "訪客"}</strong></td><td>${item.scope}</td>
        <td>${item.correctCount}/${item.totalCount}${wNum > 0 ? `<span style="color:var(--state-wrong-text);font-weight:700;font-size:0.8rem;margin-left:4px;">(錯${wNum})</span>` : ""}</td>
        <td><span style="font-weight:800;color:var(--brand-primary)">${item.accuracy}</span></td><td>${item.timeSpent}</td>
        <td><div style="display:flex;align-items:center;justify-content:center;gap:6px;"><span class="status-pill ${pClass}">${item.statusLabel}</span><button class="btn-review-row" data-id="${item.id}">回顧</button></div></td>`;
      historyTbody.appendChild(tr);
    });
    historyTbody.querySelectorAll(".row-select-cb").forEach(cb => cb.addEventListener("change", e => {
      e.target.checked ? selectedRecordIds.add(e.target.dataset.id) : selectedRecordIds.delete(e.target.dataset.id);
      syncCheckboxesUI();
    }));
    historyTbody.querySelectorAll(".btn-review-row").forEach(btn => btn.addEventListener("click", e => openHistoryDetail(e.target.dataset.id)));
    syncCheckboxesUI();
  }

  function syncCheckboxesUI() {
    document.querySelectorAll(".row-select-cb, .perfect-sync-cb").forEach(cb => cb.checked = selectedRecordIds.has(cb.dataset.id));
    const list = getHistoryList();
    if (selectAllCheckbox) selectAllCheckbox.checked = list.length > 0 && list.every(i => selectedRecordIds.has(i.id));
    if (selectedCountBadge) selectedCountBadge.textContent = selectedRecordIds.size;
    if (selectedWrongCountBadge) selectedWrongCountBadge.textContent = getSelectedHistoryWrongQuestions().length;
  }

  function openHistoryDetail(id) {
    const rec = getHistoryList().find(r => r.id === id);
    if (!rec) return;
    activeDetailRecord = rec;
    document.querySelectorAll(".card:not(#history-detail-section)").forEach(e => e.classList.add("hidden"));
    const welcomeSec = document.getElementById("welcome-section");
    if (welcomeSec) welcomeSec.classList.add("hidden");
    mainTabsNav.classList.add("hidden");
    historyDetailSection.classList.remove("hidden");
    document.getElementById("detail-title").textContent = `📋 回顧：${rec.scope}`;
    document.getElementById("detail-subtitle").textContent = `作答者：${rec.candidate} ｜ 時間：${rec.date} ｜ 得分：${rec.correctCount}/${rec.totalCount} ｜ 狀態：${rec.statusLabel}`;

    const hasWrong = Array.isArray(rec.logs) && rec.logs.some(l => !l.isCorrect);
    document.getElementById("detail-practice-wrong-btn").classList.toggle("hidden", !hasWrong);
    renderSessionReview(rec.logs, document.getElementById("detail-review-list"), false, true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function printVerificationRecords(recs) {
    if (!recs || !recs.length) { alert("請先勾選紀錄！"); return; }
    const cName = candidateInput.value.trim() || recs[0].candidate || "訪客";
    const sumAcc = recs.reduce((sum, r) => sum + (typeof r.accuracyNum === "number" ? r.accuracyNum : parseFloat(r.accuracy) || 0), 0);
    document.getElementById("print-candidate-name").textContent = cName;
    document.getElementById("print-timestamp").textContent = new Date().toLocaleString("zh-TW");
    document.getElementById("print-record-count").textContent = recs.length;
    document.getElementById("print-avg-acc").textContent = (sumAcc / recs.length).toFixed(1) + "%";

    const tb = document.getElementById("print-tbody");
    tb.innerHTML = "";
    recs.forEach((r, i) => {
      tb.innerHTML += `<tr><td>${i + 1}</td><td>${r.date}</td><td>${r.candidate || cName}</td><td>${r.scope}</td><td>${r.correctCount}/${r.totalCount}</td><td><strong>${r.accuracy}</strong></td><td>${r.timeSpent}</td><td>${r.statusLabel}</td></tr>`;
    });
    document.getElementById("print-verify-hash").textContent = `${cName}-${recs.length}-${Date.now().toString(36).toUpperCase()}`;
    window.print();
  }

  // ========================================================================
  // 12. 啟動與頁面分頁切換
  // ========================================================================
  window.addEventListener("DOMContentLoaded", () => {
    // 首次彈窗邏輯
    const savedName = localStorage.getItem("candidate_name") || "";
    const modal = document.getElementById("welcome-modal-overlay");
    const modalInput = document.getElementById("modal-candidate-name");
    const modalBtn = document.getElementById("modal-start-btn");
    const modalSkipBtn = document.getElementById("modal-skip-btn");
    const modalHint = document.getElementById("modal-name-hint");

    if (!savedName && modal) {
      modal.classList.remove("hidden");
      if (modalInput) modalInput.focus();
    }

    if (modalBtn) {
      modalBtn.addEventListener("click", () => {
        const name = (modalInput ? modalInput.value : "").trim();
        if (name) {
          candidateName = name;
          syncAllCandidateInputs(name);
          if (modalHint) modalHint.textContent = "";
          if (modal) modal.classList.add("hidden");
        } else {
          if (modalHint) modalHint.textContent = "⚠️ 請先輸入姓名或座號（或點左側「先當訪客」）";
          if (modalInput) modalInput.focus();
        }
      });
    }
    if (modalSkipBtn) {
      modalSkipBtn.addEventListener("click", () => {
        candidateName = "訪客考生";
        syncAllCandidateInputs("訪客考生");
        if (modal) modal.classList.add("hidden");
      });
    }
    if (modalInput) {
      modalInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && modalBtn) modalBtn.click();
      });
    }

    initThemeAndSound();
    initModeSelection();
    updateUnseenBadge();
    renderStageHub();
    renderTopicCards();
    renderLearningPortfolio();

    const switchTab = (tgt) => {
      const welcomeSec = document.getElementById("welcome-section");
      mainTabsNav.classList.remove("hidden");
      [quizSection, resultSection, historyDetailSection, startSection, stageSection, topicSection, historySection].forEach(e => e.classList.add("hidden"));
      if (welcomeSec) welcomeSec.classList.add("hidden");
      [tabBtnPractice, tabBtnStage, tabBtnTopic, tabBtnHistory].forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });

      if (tgt === "stage") {
        tabBtnStage.classList.add("active");
        tabBtnStage.setAttribute("aria-selected", "true");
        stageSection.classList.remove("hidden");
        renderStageHub();
      } else if (tgt === "topic") {
        tabBtnTopic.classList.add("active");
        tabBtnTopic.setAttribute("aria-selected", "true");
        topicSection.classList.remove("hidden");
        renderTopicCards(topicSearchInput.value);
      } else if (tgt === "history") {
        tabBtnHistory.classList.add("active");
        tabBtnHistory.setAttribute("aria-selected", "true");
        historySection.classList.remove("hidden");
        renderLearningPortfolio();
      } else {
        tabBtnPractice.classList.add("active");
        tabBtnPractice.setAttribute("aria-selected", "true");
        if (welcomeSec) welcomeSec.classList.remove("hidden");
        startSection.classList.remove("hidden");
        updateUnseenBadge();
      }
    };

    const goHome = (tgt = "practice") => {
      if (!quizSection.classList.contains("hidden") && !confirm("測驗進行中，確定中斷？")) return;
      clearInterval(examTimer);
      switchTab(tgt);
    };

    tabBtnPractice.addEventListener("click", () => switchTab("practice"));
    tabBtnStage.addEventListener("click", () => switchTab("stage"));
    tabBtnTopic.addEventListener("click", () => switchTab("topic"));
    tabBtnHistory.addEventListener("click", () => switchTab("history"));
    document.getElementById("brand-home-btn").addEventListener("click", () => goHome("practice"));
    document.getElementById("retry-exam-btn").addEventListener("click", () => startExam());
    document.getElementById("back-home-btn").addEventListener("click", () => goHome(currentModeType === "stage" ? "stage" : "history"));
    document.getElementById("detail-back-btn").addEventListener("click", () => goHome("history"));

    document.getElementById("filter-wrong-only").addEventListener("change", e => renderSessionReview(sessionLogs, document.getElementById("session-review-list"), e.target.checked, false));
    document.getElementById("print-current-btn").addEventListener("click", () => { if (latestFinishedRecord) printVerificationRecords([latestFinishedRecord]); });
    document.getElementById("detail-print-btn").addEventListener("click", () => { if (activeDetailRecord) printVerificationRecords([activeDetailRecord]); });

    document.getElementById("detail-practice-wrong-btn").addEventListener("click", () => {
      const idxs = Array.from(document.querySelectorAll(".detail-wrong-cb:checked")).map(c => parseInt(c.dataset.logIdx, 10));
      const wPool = resolveUniqueQuestionsFromLogs(idxs.map(i => activeDetailRecord.logs[i]).filter(Boolean));
      if (!wPool.length) { alert("請勾選錯題！"); return; }
      currentModeType = "wrong_review";
      startExam(wPool);
    });

    const tcb = document.getElementById("toggle-chapter-stats-btn"), tcp = document.getElementById("chapter-stats-panel");
    tcb.addEventListener("click", () => {
      const hd = tcp.classList.toggle("hidden");
      tcb.textContent = hd ? "各主題答對率分析 ▾" : "收合分析 ▴";
    });

    if (selectAllCheckbox) selectAllCheckbox.addEventListener("change", e => {
      const list = getHistoryList();
      e.target.checked ? list.forEach(i => selectedRecordIds.add(i.id)) : selectedRecordIds.clear();
      syncCheckboxesUI();
    });

    document.getElementById("select-all-wrong-sessions-btn").addEventListener("click", () => {
      selectedRecordIds.clear();
      getHistoryList().forEach(i => { if ((i.totalCount - i.correctCount) > 0 || (i.logs && i.logs.some(l => !l.isCorrect))) selectedRecordIds.add(i.id); });
      syncCheckboxesUI();
    });
    document.getElementById("select-all-perfect-btn").addEventListener("click", () => {
      getHistoryList().forEach(i => { if (i.isPerfect || i.accuracyNum === 100) selectedRecordIds.add(i.id); });
      syncCheckboxesUI();
    });
    document.getElementById("select-all-cert-btn").addEventListener("click", () => {
      getHistoryList().forEach(i => { if (i.statusType === "pass") selectedRecordIds.add(i.id); });
      syncCheckboxesUI();
    });

    document.getElementById("practice-selected-wrong-btn").addEventListener("click", () => {
      if (!selectedRecordIds.size) { alert("請勾選包含錯題的測驗紀錄！"); return; }
      const pool = getSelectedHistoryWrongQuestions();
      if (!pool.length) { alert("勾選的紀錄中沒有錯題！"); return; }
      currentModeType = "wrong_review";
      startExam(pool);
    });

    document.getElementById("print-selected-btn").addEventListener("click", () => printVerificationRecords(getHistoryList().filter(i => selectedRecordIds.has(i.id))));
    document.getElementById("clear-history-btn").addEventListener("click", () => {
      if (confirm("確定清除所有學習歷程、關卡進度與已刷題紀錄？")) {
        localStorage.removeItem(STORAGE_KEY_HISTORY);
        localStorage.removeItem(STORAGE_KEY_SEEN);
        localStorage.removeItem(STORAGE_KEY_STAGES);
        selectedRecordIds.clear();
        updateUnseenBadge();
        renderStageHub();
        renderLearningPortfolio();
        renderTopicCards(topicSearchInput.value);
      }
    });
  });
})();
