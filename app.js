/**
 * Habit Tracker — local-first gamified habit dashboard
 * Data: habits[], completions[], wellness[]  ·  Persistence: localStorage
 */
(function () {
  "use strict";

  const STORAGE_KEY = "habit-tracker-v1";
  const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const DAY_NAMES_MON = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]; // display Mon-first

  // —— State ——
  let state = {
    habits: [],
    completions: [], // {habitId, date, completed}
    wellness: [],    // {date, mood, sleepHours}
    viewYear: null,
    viewMonth: null, // 0-11
  };

  let charts = { daily: null, weekly: null, donut: null, wellness: null };
  let editingHabitId = null;

  // —— Seed ——
  const SEED_HABITS = [
    { name: "Wake up at 05:00", emoji: "⏰", category: "Routine" },
    { name: "Gym", emoji: "🏋️‍♂️", category: "Health" },
    { name: "Reading / Learning", emoji: "📚", category: "Growth" },
    { name: "Day Planning", emoji: "📋", category: "Focus" },
    { name: "Project Work", emoji: "💻", category: "Focus" },
    { name: "No Alcohol", emoji: "🚫", category: "Discipline" },
    { name: "Social Media Detox", emoji: "📵", category: "Discipline" },
    { name: "Goal Journaling", emoji: "📝", category: "Growth" },
    { name: "Stretching", emoji: "🤸‍♂️", category: "Health" },
    { name: "Cold Shower", emoji: "🚿", category: "Health" },
  ];

  function uid() {
    return "h_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function todayStr() {
    return formatDate(new Date());
  }

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function daysInMonth(year, month) {
    return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
  }

  function monthLabel(year, month) {
    return new Date(year, month, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  }

  /** Monday-based week index within month: days 1..n → week 1..5 (or 6) */
  function weekOfMonth(dayOfMonth, year, month) {
    // Align to calendar weeks starting Monday that overlap this month
    const first = new Date(year, month, 1);
    let dow = first.getDay(); // 0=Su
    const mondayOffset = dow === 0 ? 6 : dow - 1; // days before first Monday-ish
    // Week number: group by Mon–Su blocks containing the day
    return Math.floor((dayOfMonth - 1 + mondayOffset) / 7) + 1;
  }

  function getMonthDays(year, month) {
    const n = daysInMonth(year, month);
    const days = [];
    for (let d = 1; d <= n; d++) {
      const date = new Date(year, month, d);
      days.push({
        day: d,
        date,
        dateStr: formatDate(date),
        dow: date.getDay(), // 0=Su
        dowLabel: DAY_NAMES[date.getDay()],
        week: weekOfMonth(d, year, month),
      });
    }
    return days;
  }

  // —— Habit schedule helpers ——
  function getScheduleDays(habit) {
    if (!habit.schedule || habit.schedule.type === "everyday") {
      return [0, 1, 2, 3, 4, 5, 6];
    }
    if (habit.schedule.type === "weekdays") return [1, 2, 3, 4, 5];
    if (habit.schedule.type === "weekends") return [0, 6];
    if (habit.schedule.type === "custom") return habit.schedule.days || [1, 2, 3, 4, 5];
    return [0, 1, 2, 3, 4, 5, 6];
  }

  function isHabitApplicable(habit, dateStr) {
    if (!habit.enabled) return false;
    const d = parseDate(dateStr);
    if (habit.startDate && dateStr < habit.startDate) return false;
    if (habit.endDate && dateStr > habit.endDate) return false;
    const days = getScheduleDays(habit);
    return days.includes(d.getDay());
  }

  function isCompleted(habitId, dateStr) {
    return state.completions.some(
      (c) => c.habitId === habitId && c.date === dateStr && c.completed
    );
  }

  function setCompletion(habitId, dateStr, completed) {
    const idx = state.completions.findIndex(
      (c) => c.habitId === habitId && c.date === dateStr
    );
    if (completed) {
      if (idx >= 0) state.completions[idx].completed = true;
      else state.completions.push({ habitId, date: dateStr, completed: true });
    } else {
      if (idx >= 0) state.completions.splice(idx, 1);
    }
    save();
  }

  // —— Stats ——
  function enabledHabits() {
    return state.habits.filter((h) => h.enabled).sort((a, b) => a.order - b.order);
  }

  function monthBounds(year, month) {
    const start = formatDate(new Date(year, month, 1));
    const end = formatDate(new Date(year, month, daysInMonth(year, month)));
    return { start, end };
  }

  function habitStatsForRange(habit, startStr, endStr) {
    let goal = 0;
    let actual = 0;
    const start = parseDate(startStr);
    const end = parseDate(endStr);
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      const d = new Date(t);
      const ds = formatDate(d);
      if (!isHabitApplicable(habit, ds)) continue;
      // Don't count future days toward goal for "left" fairness — still count as goal
      // for monthly target. Completed only if checked.
      goal++;
      if (isCompleted(habit.id, ds)) actual++;
    }
    const left = Math.max(0, goal - actual);
    const pct = goal === 0 ? 0 : Math.round((actual / goal) * 100);
    return { goal, actual, left, pct };
  }

  function overallStats(year, month) {
    const { start, end } = monthBounds(year, month);
    const today = todayStr();
    let goal = 0;
    let completed = 0;
    // Only count days up to today for "current progress" feel, but include full month goal
    // Reference shows Goal/Completed/Left for the period — use full month applicable slots
    for (const h of enabledHabits()) {
      const s = habitStatsForRange(h, start, end);
      goal += s.goal;
      completed += s.actual;
    }
    const left = Math.max(0, goal - completed);
    const pct = goal === 0 ? 0 : Math.round((completed / goal) * 100);
    return { goal, completed, left, pct };
  }

  function dailyPercents(year, month) {
    const days = getMonthDays(year, month);
    return days.map((day) => {
      let applicable = 0;
      let done = 0;
      for (const h of enabledHabits()) {
        if (!isHabitApplicable(h, day.dateStr)) continue;
        applicable++;
        if (isCompleted(h.id, day.dateStr)) done++;
      }
      const pct = applicable === 0 ? 0 : Math.round((done / applicable) * 100);
      return { dateStr: day.dateStr, day: day.day, pct, done, applicable };
    });
  }

  function weeklyPercents(year, month) {
    const days = getMonthDays(year, month);
    const weeks = {};
    for (const day of days) {
      if (!weeks[day.week]) weeks[day.week] = { done: 0, applicable: 0 };
      for (const h of enabledHabits()) {
        if (!isHabitApplicable(h, day.dateStr)) continue;
        weeks[day.week].applicable++;
        if (isCompleted(h.id, day.dateStr)) weeks[day.week].done++;
      }
    }
    const maxWeek = Math.max(...days.map((d) => d.week), 1);
    const result = [];
    for (let w = 1; w <= maxWeek; w++) {
      const rec = weeks[w] || { done: 0, applicable: 0 };
      const pct = rec.applicable === 0 ? 0 : Math.round((rec.done / rec.applicable) * 100);
      result.push({ week: w, pct, ...rec });
    }
    return result;
  }

  function currentStreak() {
    const habits = enabledHabits();
    if (!habits.length) return 0;
    let streak = 0;
    const d = new Date();
    // Walk backwards from yesterday/today
    for (let i = 0; i < 400; i++) {
      const ds = formatDate(d);
      let applicable = 0;
      let done = 0;
      for (const h of habits) {
        if (!isHabitApplicable(h, ds)) continue;
        applicable++;
        if (isCompleted(h.id, ds)) done++;
      }
      if (applicable === 0) {
        // no habits that day — skip without breaking if looking at future? today might be empty
        if (ds === todayStr() && streak === 0) {
          d.setDate(d.getDate() - 1);
          continue;
        }
        d.setDate(d.getDate() - 1);
        continue;
      }
      if (done === applicable) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else if (ds === todayStr() && done < applicable) {
        // today incomplete — don't break, look at yesterday
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  function xpAndLevel() {
    const totalDone = state.completions.filter((c) => c.completed).length;
    const xpPerLevel = 50;
    const level = Math.floor(totalDone / xpPerLevel) + 1;
    const xpInto = totalDone % xpPerLevel;
    const pct = Math.round((xpInto / xpPerLevel) * 100);
    return { level, xpInto, xpPerLevel, pct, totalDone };
  }

  function todayDailyPct() {
    const t = todayStr();
    let applicable = 0;
    let done = 0;
    for (const h of enabledHabits()) {
      if (!isHabitApplicable(h, t)) continue;
      applicable++;
      if (isCompleted(h.id, t)) done++;
    }
    return applicable === 0 ? 0 : Math.round((done / applicable) * 100);
  }

  function currentWeekPct() {
    const now = new Date();
    const days = getMonthDays(now.getFullYear(), now.getMonth());
    const todayDay = days.find((d) => d.dateStr === todayStr());
    if (!todayDay) {
      const wp = weeklyPercents(state.viewYear, state.viewMonth);
      return wp.length ? wp[wp.length - 1].pct : 0;
    }
    const wp = weeklyPercents(now.getFullYear(), now.getMonth());
    const w = wp.find((x) => x.week === todayDay.week);
    return w ? w.pct : 0;
  }

  // —— Persistence ——
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      habits: state.habits,
      completions: state.completions,
      wellness: state.wellness,
    }));
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      state.habits = data.habits || [];
      state.completions = data.completions || [];
      state.wellness = data.wellness || [];
      return state.habits.length > 0;
    } catch {
      return false;
    }
  }

  function seedIfNeeded() {
    if (load()) return;
    state.habits = SEED_HABITS.map((h, i) => ({
      id: uid(),
      name: h.name,
      emoji: h.emoji,
      category: h.category,
      schedule: { type: "everyday" },
      startDate: null,
      endDate: null,
      enabled: true,
      order: i,
    }));
    state.completions = [];
    state.wellness = [];
    save();
  }

  // —— Toast ——
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // —— Render grid ——
  function renderSheet() {
    const year = state.viewYear;
    const month = state.viewMonth;
    const days = getMonthDays(year, month);
    const habits = [...state.habits].sort((a, b) => a.order - b.order);
    const today = todayStr();
    const maxWeek = Math.max(...days.map((d) => d.week));

    // Group days by week for colspan headers
    const weekGroups = [];
    for (let w = 1; w <= maxWeek; w++) {
      weekGroups.push({ week: w, days: days.filter((d) => d.week === w) });
    }

    const sheet = document.getElementById("habitSheet");
    let html = "<thead>";

    // Week row
    html += '<tr class="week-row">';
    html += '<th class="habit-col">My Habits</th>';
    for (const g of weekGroups) {
      html += `<th class="week-label week-span" colspan="${g.days.length}">Week ${g.week}</th>`;
    }
    html += "</tr>";

    // Day names
    html += '<tr class="day-row">';
    html += '<th class="habit-col"></th>';
    for (const day of days) {
      const isToday = day.dateStr === today;
      html += `<th class="${isToday ? "today-header" : ""}">${day.dowLabel}</th>`;
    }
    html += "</tr>";

    // Dates
    html += '<tr class="date-row">';
    html += '<th class="habit-col"></th>';
    for (const day of days) {
      const isToday = day.dateStr === today;
      html += `<th class="${isToday ? "today-header" : ""}">${day.day}</th>`;
    }
    html += "</tr></thead><tbody>";

    for (const habit of habits) {
      const dis = habit.enabled ? "" : " habit-disabled";
      html += `<tr class="${dis}" data-habit-id="${habit.id}">`;
      html += `<td class="habit-col"><div class="habit-cell-inner">
        <span class="habit-emoji">${escapeHtml(habit.emoji)}</span>
        <span class="habit-name" title="${escapeAttr(habit.name)}">${escapeHtml(habit.name)}</span>
        <span class="habit-actions">
          <button type="button" class="icon-btn" data-action="up" title="Move up">▲</button>
          <button type="button" class="icon-btn" data-action="down" title="Move down">▼</button>
          <button type="button" class="icon-btn" data-action="edit" title="Edit">✎</button>
        </span>
      </div></td>`;

      for (const day of days) {
        const applicable = isHabitApplicable(habit, day.dateStr);
        const done = isCompleted(habit.id, day.dateStr);
        const isToday = day.dateStr === today;
        let cls = "cell";
        if (!applicable) cls += " na";
        else if (done) cls += " done";
        else if (day.dateStr < today) cls += " miss";
        if (isToday) cls += " today-col";

        if (!applicable) {
          html += `<td class="${cls}"><span style="opacity:.3">·</span></td>`;
        } else {
          html += `<td class="${cls}">
            <input type="checkbox" class="cb" data-habit="${habit.id}" data-date="${day.dateStr}"
              ${done ? "checked" : ""} aria-label="${escapeAttr(habit.name)} ${day.dateStr}" />
          </td>`;
        }
      }
      html += "</tr>";
    }
    html += "</tbody>";
    sheet.innerHTML = html;

    document.getElementById("monthLabel").textContent = monthLabel(year, month);
    document.getElementById("gridHint").textContent =
      `Week 1–${maxWeek} · ${daysInMonth(year, month)} days · Mo–Su`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  // —— Charts ——
  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#1a1f2a",
        titleFont: { family: "Inter" },
        bodyFont: { family: "JetBrains Mono" },
      },
    },
  };

  function ensureCharts() {
    const dailyCtx = document.getElementById("dailyChart").getContext("2d");
    const weeklyCtx = document.getElementById("weeklyChart").getContext("2d");
    const donutCtx = document.getElementById("overallDonut").getContext("2d");
    const wellCtx = document.getElementById("wellnessChart").getContext("2d");

    if (!charts.daily) {
      charts.daily = new Chart(dailyCtx, {
        type: "bar",
        data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderRadius: 3, borderSkipped: false }] },
        options: {
          ...chartDefaults,
          scales: {
            x: {
              ticks: { color: "#8b93a7", font: { size: 9, family: "JetBrains Mono" }, maxRotation: 0 },
              grid: { display: false },
            },
            y: {
              min: 0, max: 100,
              ticks: { color: "#8b93a7", font: { size: 9 }, callback: (v) => v + "%" },
              grid: { color: "rgba(42,49,64,.8)" },
            },
          },
        },
      });
    }
    if (!charts.weekly) {
      charts.weekly = new Chart(weeklyCtx, {
        type: "bar",
        data: { labels: [], datasets: [{ data: [], backgroundColor: "#5b8cff", borderRadius: 4 }] },
        options: {
          ...chartDefaults,
          scales: {
            x: { ticks: { color: "#8b93a7", font: { size: 10 } }, grid: { display: false } },
            y: {
              min: 0, max: 100,
              ticks: { color: "#8b93a7", font: { size: 9 }, callback: (v) => v + "%" },
              grid: { color: "rgba(42,49,64,.8)" },
            },
          },
        },
      });
    }
    if (!charts.donut) {
      charts.donut = new Chart(donutCtx, {
        type: "doughnut",
        data: {
          labels: ["Done", "Left"],
          datasets: [{
            data: [80, 20],
            backgroundColor: ["#6ee7a8", "#2a3140"],
            borderWidth: 0,
            cutout: "72%",
          }],
        },
        options: {
          ...chartDefaults,
          plugins: { ...chartDefaults.plugins, tooltip: { enabled: true } },
        },
      });
    }
    if (!charts.wellness) {
      charts.wellness = new Chart(wellCtx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Mood",
              data: [],
              borderColor: "#c084fc",
              backgroundColor: "rgba(192,132,252,.15)",
              tension: 0.3,
              yAxisID: "y",
              pointRadius: 3,
            },
            {
              label: "Sleep h",
              data: [],
              borderColor: "#5b8cff",
              backgroundColor: "rgba(91,140,255,.1)",
              tension: 0.3,
              yAxisID: "y1",
              pointRadius: 3,
            },
          ],
        },
        options: {
          ...chartDefaults,
          plugins: {
            ...chartDefaults.plugins,
            legend: { display: true, labels: { color: "#8b93a7", boxWidth: 10, font: { size: 10 } } },
          },
          scales: {
            x: { ticks: { color: "#8b93a7", font: { size: 8 } }, grid: { display: false } },
            y: {
              min: 0, max: 5, position: "left",
              ticks: { color: "#c084fc", font: { size: 8 }, stepSize: 1 },
              grid: { color: "rgba(42,49,64,.5)" },
              title: { display: true, text: "Mood", color: "#c084fc", font: { size: 9 } },
            },
            y1: {
              min: 0, max: 12, position: "right",
              ticks: { color: "#5b8cff", font: { size: 8 } },
              grid: { drawOnChartArea: false },
              title: { display: true, text: "Sleep", color: "#5b8cff", font: { size: 9 } },
            },
          },
        },
      });
    }
  }

  function updateCharts() {
    ensureCharts();
    const year = state.viewYear;
    const month = state.viewMonth;
    const daily = dailyPercents(year, month);
    const weekly = weeklyPercents(year, month);
    const overall = overallStats(year, month);

    // Daily
    charts.daily.data.labels = daily.map((d) => String(d.day));
    charts.daily.data.datasets[0].data = daily.map((d) => d.pct);
    charts.daily.data.datasets[0].backgroundColor = daily.map((d) => {
      if (d.pct >= 80) return "#6ee7a8";
      if (d.pct >= 50) return "#5b8cff";
      if (d.pct > 0) return "#f5c542";
      return "#3d4658";
    });
    charts.daily.update("none");

    // Weekly
    charts.weekly.data.labels = weekly.map((w) => `W${w.week}`);
    charts.weekly.data.datasets[0].data = weekly.map((w) => w.pct);
    charts.weekly.data.datasets[0].backgroundColor = weekly.map((w) =>
      w.pct >= 80 ? "#6ee7a8" : w.pct >= 50 ? "#5b8cff" : "#f5c542"
    );
    charts.weekly.update("none");

    // Donut
    const left = Math.max(0, overall.left);
    charts.donut.data.datasets[0].data = [overall.completed, left || (overall.goal === 0 ? 1 : 0)];
    charts.donut.update("none");
    document.getElementById("donutCenter").textContent = overall.pct + "%";
    document.getElementById("statGoal").textContent = overall.goal;
    document.getElementById("statDone").textContent = overall.completed;
    document.getElementById("statLeft").textContent = overall.left;

    // Wellness chart for viewed month
    const { start, end } = monthBounds(year, month);
    const days = getMonthDays(year, month);
    const wellMap = Object.fromEntries(
      state.wellness.filter((w) => w.date >= start && w.date <= end).map((w) => [w.date, w])
    );
    // Show only days that have data, or sample all days compactly
    const labeled = days.filter((d) => wellMap[d.dateStr]);
    const useDays = labeled.length ? labeled : days.filter((_, i) => i % 3 === 0);
    charts.wellness.data.labels = useDays.map((d) => String(d.day));
    charts.wellness.data.datasets[0].data = useDays.map((d) =>
      wellMap[d.dateStr] && wellMap[d.dateStr].mood != null ? Number(wellMap[d.dateStr].mood) : null
    );
    charts.wellness.data.datasets[1].data = useDays.map((d) =>
      wellMap[d.dateStr] && wellMap[d.dateStr].sleepHours != null
        ? Number(wellMap[d.dateStr].sleepHours)
        : null
    );
    charts.wellness.update("none");
  }

  function renderAnalysis() {
    const { start, end } = monthBounds(state.viewYear, state.viewMonth);
    const tbody = document.querySelector("#analysisTable tbody");
    const habits = enabledHabits();
    const rows = habits.map((h) => {
      const s = habitStatsForRange(h, start, end);
      return { habit: h, ...s };
    });
    tbody.innerHTML = rows
      .map(
        (r) => `<tr>
        <td>${escapeHtml(r.habit.emoji)} ${escapeHtml(r.habit.name)}</td>
        <td>${r.goal}</td>
        <td>${r.actual}</td>
        <td>${r.left}</td>
        <td class="prog-cell">
          <div class="prog-bar"><div class="prog-fill" style="width:${r.pct}%"></div></div>
          <span class="prog-pct">${r.pct}%</span>
        </td>
      </tr>`
      )
      .join("");

    // Leaderboard TOP 10 by % then actual
    const ranked = [...rows].sort((a, b) => b.pct - a.pct || b.actual - a.actual).slice(0, 10);
    const lb = document.getElementById("leaderboard");
    lb.innerHTML = ranked
      .map(
        (r) => `<li>
        <span class="lb-name">${escapeHtml(r.habit.emoji)} ${escapeHtml(r.habit.name)}</span>
        <span class="lb-pct">${r.pct}%</span>
      </li>`
      )
      .join("") || "<li style='color:var(--text-dim)'>No habits yet</li>";
  }

  function renderTopbarAndScores() {
    const overall = overallStats(state.viewYear, state.viewMonth);
    const xp = xpAndLevel();
    const streak = currentStreak();
    const dailyPct = todayDailyPct();
    const weekPct = currentWeekPct();

    document.getElementById("topbarStats").innerHTML = `
      <div class="mini-stat">Month progress<strong>${overall.pct}%</strong></div>
      <div class="mini-stat">Checks<strong>${overall.completed}/${overall.goal}</strong></div>
      <div class="mini-stat">Habits<strong>${enabledHabits().length}</strong></div>
    `;

    document.getElementById("levelText").textContent = `Lv ${xp.level}`;
    document.getElementById("levelRing").style.setProperty("--xp-pct", xp.pct + "%");
    document.getElementById("levelBadge").title =
      `Level ${xp.level} · ${xp.xpInto}/${xp.xpPerLevel} XP (${xp.totalDone} total checks)`;

    document.getElementById("dailyScorePill").textContent = `Daily: ${dailyPct}%`;
    document.getElementById("weeklyScorePill").textContent = `Week: ${weekPct}%`;
    document.getElementById("streakPill").textContent = `🔥 ${streak} day streak`;
  }

  function renderAll() {
    renderSheet();
    updateCharts();
    renderAnalysis();
    renderTopbarAndScores();
    loadWellnessForm();
  }

  // —— Wellness ——
  function loadWellnessForm() {
    const dateInput = document.getElementById("wellnessDate");
    if (!dateInput.value) dateInput.value = todayStr();
    const ds = dateInput.value;
    const rec = state.wellness.find((w) => w.date === ds);
    document.getElementById("moodSelect").value = rec && rec.mood != null ? String(rec.mood) : "";
    document.getElementById("sleepInput").value =
      rec && rec.sleepHours != null ? String(rec.sleepHours) : "";
  }

  function saveWellness() {
    const date = document.getElementById("wellnessDate").value;
    if (!date) return;
    const moodRaw = document.getElementById("moodSelect").value;
    const sleepRaw = document.getElementById("sleepInput").value;
    const mood = moodRaw === "" ? null : Number(moodRaw);
    const sleepHours = sleepRaw === "" ? null : Number(sleepRaw);
    if (sleepHours != null && (sleepHours < 0 || sleepHours > 24 || Number.isNaN(sleepHours))) {
      toast("Sleep hours must be 0–24");
      return;
    }
    const idx = state.wellness.findIndex((w) => w.date === date);
    const rec = { date, mood, sleepHours };
    if (mood == null && sleepHours == null) {
      if (idx >= 0) state.wellness.splice(idx, 1);
    } else if (idx >= 0) {
      state.wellness[idx] = rec;
    } else {
      state.wellness.push(rec);
    }
    save();
    updateCharts();
    toast("Wellness saved");
  }

  // —— Habit CRUD ——
  function openHabitModal(habit) {
    const modal = document.getElementById("habitModal");
    editingHabitId = habit ? habit.id : null;
    document.getElementById("habitModalTitle").textContent = habit ? "Edit Habit" : "Add Habit";
    document.getElementById("habitId").value = habit ? habit.id : "";
    document.getElementById("habitEmoji").value = habit ? habit.emoji : "✨";
    document.getElementById("habitName").value = habit ? habit.name : "";
    document.getElementById("habitCategory").value = habit ? habit.category || "" : "";
    document.getElementById("habitEnabled").checked = habit ? habit.enabled : true;
    document.getElementById("habitStart").value = habit && habit.startDate ? habit.startDate : "";
    document.getElementById("habitEnd").value = habit && habit.endDate ? habit.endDate : "";

    const sched = habit && habit.schedule ? habit.schedule : { type: "everyday" };
    document.getElementById("habitSchedule").value = sched.type || "everyday";
    const picker = document.getElementById("weekdayPicker");
    picker.hidden = sched.type !== "custom";
    const days = sched.days || [1, 2, 3, 4, 5];
    picker.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = days.map(String).includes(cb.value);
    });

    document.getElementById("btnDeleteHabit").hidden = !habit;
    modal.showModal();
  }

  function saveHabitFromForm(e) {
    e.preventDefault();
    const name = document.getElementById("habitName").value.trim();
    const emoji = document.getElementById("habitEmoji").value.trim() || "✅";
    if (!name) return;

    const scheduleType = document.getElementById("habitSchedule").value;
    let schedule = { type: scheduleType };
    if (scheduleType === "custom") {
      const days = [...document.querySelectorAll("#weekdayPicker input:checked")].map((c) =>
        Number(c.value)
      );
      if (!days.length) {
        toast("Pick at least one weekday");
        return;
      }
      schedule.days = days;
    }

    const payload = {
      name,
      emoji,
      category: document.getElementById("habitCategory").value.trim() || null,
      schedule,
      startDate: document.getElementById("habitStart").value || null,
      endDate: document.getElementById("habitEnd").value || null,
      enabled: document.getElementById("habitEnabled").checked,
    };

    if (editingHabitId) {
      const h = state.habits.find((x) => x.id === editingHabitId);
      if (h) Object.assign(h, payload);
      toast("Habit updated");
    } else {
      const maxOrder = state.habits.reduce((m, h) => Math.max(m, h.order), -1);
      state.habits.push({ id: uid(), order: maxOrder + 1, ...payload });
      toast("Habit added");
    }
    save();
    document.getElementById("habitModal").close();
    renderAll();
  }

  function deleteHabit() {
    if (!editingHabitId) return;
    const h = state.habits.find((x) => x.id === editingHabitId);
    if (!h) return;
    if (!confirm(`Delete "${h.name}"? Completions for this habit will be removed.`)) return;
    state.habits = state.habits.filter((x) => x.id !== editingHabitId);
    state.completions = state.completions.filter((c) => c.habitId !== editingHabitId);
    save();
    document.getElementById("habitModal").close();
    toast("Habit deleted");
    renderAll();
  }

  function reorderHabit(id, dir) {
    const sorted = [...state.habits].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((h) => h.id === id);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= sorted.length) return;
    const a = sorted[idx].order;
    sorted[idx].order = sorted[swap].order;
    sorted[swap].order = a;
    // Normalize
    sorted.sort((x, y) => x.order - y.order).forEach((h, i) => { h.order = i; });
    save();
    renderAll();
  }

  // —— Import / Export ——
  function exportJson() {
    const blob = new Blob(
      [JSON.stringify(buildBackupPayload(), null, 2)],
      { type: "application/json" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `habit-tracker-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Exported JSON");
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        if (file.name.toLowerCase().endsWith(".csv")) {
          importCsv(text);
        } else {
          const data = JSON.parse(text);
          if (applyBackupData(data, file.name)) {
            toast("Imported JSON");
          }
        }
      } catch (err) {
        toast("Import failed: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  function importCsv(text) {
    // Simple CSV: habitId,date,completed OR date,mood,sleepHours with header
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error("Empty CSV");
    const header = lines[0].toLowerCase();
    if (header.includes("habit")) {
      for (let i = 1; i < lines.length; i++) {
        const [habitId, date, completed] = lines[i].split(",").map((s) => s.trim());
        if (!habitId || !date) continue;
        setCompletion(habitId, date, completed === "1" || completed === "true");
      }
      toast("Imported completions CSV");
    } else {
      throw new Error("Unrecognized CSV format");
    }
    renderAll();
  }

  // Also offer CSV export of completions
  function exportCsv() {
    const lines = ["habitId,date,completed"];
    for (const c of state.completions) {
      lines.push(`${c.habitId},${c.date},${c.completed ? 1 : 0}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `habit-completions-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }


  function buildBackupPayload() {
    return {
      habits: state.habits,
      completions: state.completions,
      wellness: state.wellness,
      exportedAt: new Date().toISOString(),
      version: 1,
    };
  }

  function applyBackupData(data, sourceLabel) {
    if (!data || !Array.isArray(data.habits)) {
      throw new Error("Invalid backup: missing habits[]");
    }
    const nH = data.habits.length;
    const nC = Array.isArray(data.completions) ? data.completions.length : 0;
    const nW = Array.isArray(data.wellness) ? data.wellness.length : 0;
    if (!confirm(
      `Replace all local data with this backup?\n\n` +
      `${nH} habits · ${nC} completions · ${nW} wellness entries` +
      (sourceLabel ? `\nSource: ${sourceLabel}` : "")
    )) {
      return false;
    }
    state.habits = data.habits;
    state.completions = Array.isArray(data.completions) ? data.completions : [];
    state.wellness = Array.isArray(data.wellness) ? data.wellness : [];
    save();
    renderAll();
    return true;
  }

  async function copyBackupToClipboard() {
    const text = JSON.stringify(buildBackupPayload(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast("Backup copied — paste on your other device");
    } catch (err) {
      // Fallback: select textarea
      const area = document.getElementById("pasteBackupArea");
      area.value = text;
      area.focus();
      area.select();
      try {
        document.execCommand("copy");
        toast("Backup copied (fallback)");
      } catch (e2) {
        toast("Copy failed — select & copy from the box below");
      }
    }
  }

  async function pasteBackupFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        toast("Clipboard is empty");
        return;
      }
      document.getElementById("pasteBackupArea").value = text.trim();
      const data = JSON.parse(text);
      if (applyBackupData(data, "clipboard")) {
        toast("Backup restored from clipboard");
        document.getElementById("syncModal").close();
      }
    } catch (err) {
      if (err.name === "NotAllowedError" || err.name === "SecurityError") {
        toast("Clipboard blocked — paste into the box manually");
        document.getElementById("pasteBackupArea").focus();
      } else {
        toast("Paste failed: " + err.message);
      }
    }
  }

  function applyPastedBackup() {
    const text = document.getElementById("pasteBackupArea").value.trim();
    if (!text) {
      toast("Paste JSON into the box first");
      return;
    }
    try {
      const data = JSON.parse(text);
      if (applyBackupData(data, "textarea")) {
        toast("Backup restored");
        document.getElementById("syncModal").close();
      }
    } catch (err) {
      toast("Invalid JSON: " + err.message);
    }
  }

  // —— Events ——
  function bindEvents() {
    document.getElementById("btnPrevMonth").addEventListener("click", () => {
      state.viewMonth--;
      if (state.viewMonth < 0) {
        state.viewMonth = 11;
        state.viewYear--;
      }
      renderAll();
    });
    document.getElementById("btnNextMonth").addEventListener("click", () => {
      state.viewMonth++;
      if (state.viewMonth > 11) {
        state.viewMonth = 0;
        state.viewYear++;
      }
      renderAll();
    });
    document.getElementById("btnToday").addEventListener("click", () => {
      const n = new Date();
      state.viewYear = n.getFullYear();
      state.viewMonth = n.getMonth();
      renderAll();
    });

    document.getElementById("habitSheet").addEventListener("change", (e) => {
      const t = e.target;
      if (!t.classList.contains("cb")) return;
      setCompletion(t.dataset.habit, t.dataset.date, t.checked);
      // Lightweight re-render of stats without full sheet rebuild for speed
      const cell = t.closest("td");
      cell.classList.toggle("done", t.checked);
      cell.classList.toggle("miss", !t.checked && t.dataset.date < todayStr());
      updateCharts();
      renderAnalysis();
      renderTopbarAndScores();
    });

    document.getElementById("habitSheet").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const row = btn.closest("tr");
      const id = row && row.dataset.habitId;
      if (!id) return;
      const action = btn.dataset.action;
      if (action === "edit") {
        openHabitModal(state.habits.find((h) => h.id === id));
      } else if (action === "up") {
        reorderHabit(id, -1);
      } else if (action === "down") {
        reorderHabit(id, 1);
      }
    });

    document.getElementById("btnAddHabit").addEventListener("click", () => openHabitModal(null));
    document.getElementById("btnCancelHabit").addEventListener("click", () => {
      document.getElementById("habitModal").close();
    });
    document.getElementById("habitForm").addEventListener("submit", saveHabitFromForm);
    document.getElementById("btnDeleteHabit").addEventListener("click", deleteHabit);
    document.getElementById("habitSchedule").addEventListener("change", (e) => {
      document.getElementById("weekdayPicker").hidden = e.target.value !== "custom";
    });

    document.getElementById("btnSaveWellness").addEventListener("click", saveWellness);
    document.getElementById("wellnessDate").addEventListener("change", loadWellnessForm);


    document.getElementById("btnSync").addEventListener("click", () => {
      document.getElementById("pasteBackupArea").value = "";
      document.getElementById("syncModal").showModal();
    });
    document.getElementById("btnCloseSync").addEventListener("click", () => {
      document.getElementById("syncModal").close();
    });
    document.getElementById("btnCopyBackup").addEventListener("click", () => {
      copyBackupToClipboard();
    });
    document.getElementById("btnPasteBackup").addEventListener("click", () => {
      pasteBackupFromClipboard();
    });
    document.getElementById("btnApplyPaste").addEventListener("click", () => {
      applyPastedBackup();
    });

    document.getElementById("btnExport").addEventListener("click", (e) => {
      if (e.shiftKey) exportCsv();
      else exportJson();
    });
    document.getElementById("btnImport").addEventListener("click", () => {
      document.getElementById("importFile").click();
    });
    document.getElementById("importFile").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importFile(f);
      e.target.value = "";
    });
  }

  // —— Boot ——
  function init() {
    const now = new Date();
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
    seedIfNeeded();
    bindEvents();
    document.getElementById("wellnessDate").value = todayStr();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose for console QA
  window.HabitTracker = {
    getState: () => state,
    renderAll,
    exportJson,
    exportCsv,
    copyBackupToClipboard,
    applyPastedBackup,
    reset: () => {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    },
  };
})();
