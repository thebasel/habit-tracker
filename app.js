/**
 * Habit Tracker — local-first gamified habit dashboard
 * Data: habits[], completions[], wellness[], notes[]
 * Persistence: localStorage, plus optional multi-device sync via telegra.ph
 * (anonymous account + page; the Sync code is the page path, no API key).
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
    notes: [],       // {id, text, at, date} — raw dumps, no required labels
    updatedAt: 0,
    viewYear: null,
    viewMonth: null, // 0-11
  };

  let charts = { daily: null, weekly: null, donut: null, wellness: null };
  let editingHabitId = null;

  // —— Seed ——
  const SEED_HABITS = [
    { name: "Wake 05:00", emoji: "⏰", category: "Routine" },
    { name: "Gym", emoji: "🏋️‍♂️", category: "Health" },
    { name: "Reading/Learning", emoji: "📚", category: "Growth" },
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
  function save(opts) {
    const touch = !opts || opts.touch !== false;
    if (touch) state.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      habits: state.habits,
      completions: state.completions,
      wellness: state.wellness,
      notes: state.notes,
      updatedAt: state.updatedAt || 0,
    }));
    if (touch) schedulePush();
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      state.habits = data.habits || [];
      state.completions = data.completions || [];
      state.wellness = data.wellness || [];
      state.notes = Array.isArray(data.notes) ? data.notes : [];
      if (data.updatedAt == null) {
        const dirty = state.completions.length > 0 || state.wellness.length > 0;
        state.updatedAt = dirty ? Date.now() : 0;
      } else {
        state.updatedAt = Number(data.updatedAt) || 0;
      }
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
    state.notes = [];
    state.updatedAt = 0;
    save({ touch: false });
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

    html += wellnessSheetRow("Mood", "mood", days, today);
    html += wellnessSheetRow("Hours of Sleep", "sleep", days, today);
    html += "</tbody>";
    sheet.innerHTML = html;

    document.getElementById("monthLabel").textContent = monthLabel(year, month);
    document.getElementById("gridHint").textContent =
      `Week 1–${maxWeek} · ${daysInMonth(year, month)} days · Mo–Su`;
  }


  function wellnessOn(dateStr) {
    return state.wellness.find((w) => w.date === dateStr) || null;
  }

  function wellnessSheetRow(label, kind, days, today) {
    const emoji = kind === "mood" ? "🙂" : "😴";
    let html = `<tr class="wellness-sheet-row" data-wellness="${kind}">`;
    html += `<td class="habit-col"><div class="habit-cell-inner">
      <span class="habit-emoji">${emoji}</span>
      <span class="habit-name">${escapeHtml(label)}</span>
    </div></td>`;
    for (const day of days) {
      const rec = wellnessOn(day.dateStr);
      const isToday = day.dateStr === today ? " today-col" : "";
      if (kind === "mood") {
        const mood = rec && rec.mood != null ? String(rec.mood) : "";
        const opts = ["", "1", "2", "3", "4", "5"].map((v) => {
          const sel = v === mood ? " selected" : "";
          const lab = v === "" ? "·" : v;
          return `<option value="${v}"${sel}>${lab}</option>`;
        }).join("");
        html += `<td class="cell${isToday}"><select class="cell-input mood-input" data-date="${day.dateStr}" aria-label="Mood ${day.dateStr}">${opts}</select></td>`;
      } else {
        const sleep = rec && rec.sleepHours != null ? String(rec.sleepHours) : "";
        html += `<td class="cell${isToday}"><input class="cell-input sleep-input" type="number" min="0" max="24" step="0.5" inputmode="decimal" data-date="${day.dateStr}" value="${escapeAttr(sleep)}" aria-label="Hours of Sleep ${day.dateStr}" /></td>`;
      }
    }
    html += "</tr>";
    return html;
  }

  function upsertWellness(date, patch) {
    const idx = state.wellness.findIndex((w) => w.date === date);
    const prev = idx >= 0 ? state.wellness[idx] : { date, mood: null, sleepHours: null };
    const rec = Object.assign({}, prev, patch, { date });
    const empty = rec.mood == null && (rec.sleepHours == null || rec.sleepHours === "");
    if (empty) {
      if (idx >= 0) state.wellness.splice(idx, 1);
    } else if (idx >= 0) {
      state.wellness[idx] = rec;
    } else {
      state.wellness.push(rec);
    }
    save();
    updateCharts();
    const formDate = document.getElementById("wellnessDate").value;
    if (formDate === date) loadWellnessForm();
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
    renderNotes();
  }


  // —— Notes (fast dump; labels happen later, not here) ——
  function renderNotes() {
    const list = document.getElementById("noteList");
    if (!list) return;
    const notes = [...(state.notes || [])].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 8);
    if (!notes.length) {
      list.innerHTML = '<li class="note-empty">Nothing dumped yet.</li>';
      return;
    }
    list.innerHTML = notes.map((n) => {
      const when = n.date || "";
      const text = String(n.text || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
      return `<li><time>${when}</time><span>${text}</span></li>`;
    }).join("");
  }

  function addNote(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    state.notes = state.notes || [];
    state.notes.push({ id: uid(), text: clean, at: Date.now(), date: todayStr() });
    save();
    renderNotes();
    toast("Saved");
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
    const payload = {
      habits: state.habits,
      completions: state.completions,
      wellness: state.wellness,
      notes: state.notes,
      updatedAt: state.updatedAt || 0,
      exportedAt: new Date().toISOString(),
      version: 1,
    };
    if (syncMeta.token && syncMeta.path) {
      payload.sync = { token: syncMeta.token, path: syncMeta.path, title: syncMeta.title || "" };
    }
    return payload;
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
    state.notes = Array.isArray(data.notes) ? data.notes : [];
    if (data.sync && data.sync.token && data.sync.path) {
      syncMeta.token = String(data.sync.token);
      syncMeta.path = String(data.sync.path);
      syncMeta.title = data.sync.title ? String(data.sync.title) : syncMeta.title;
      saveSyncMeta();
    }
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


  // —— Cloud sync (telegra.ph, no API key) ——
  // Each sync space is an anonymous Telegraph account. The Sync code is the
  // public page path. The access token lives in the page JSON and in
  // localStorage so a second device can edit. Last-write-wins via updatedAt.
  const SYNC_META_KEY = "habit-tracker-sync-v1";
  const TG_API = "https://api.telegra.ph/";
  const SYNC_DEBOUNCE_MS = 800;
  const SYNC_POLL_MS = 15000;

  let syncMeta = { token: "", path: "", title: "" };
  let syncTimer = null;
  let syncChain = Promise.resolve();
  let syncStatus = "local";

  function loadSyncMeta() {
    try {
      const raw = localStorage.getItem(SYNC_META_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      syncMeta = {
        token: data.token || "",
        path: data.path || "",
        title: data.title || "",
      };
    } catch {
      syncMeta = { token: "", path: "", title: "" };
    }
  }

  function saveSyncMeta() {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta));
  }

  function setSyncStatus(stateName, detail) {
    syncStatus = stateName;
    const el = document.getElementById("syncStatus");
    if (!el) return;
    const labels = {
      local: "Local only",
      offline: "Offline",
      syncing: "Syncing",
      synced: "Synced",
      error: "Sync error",
    };
    el.dataset.state = stateName;
    if (stateName === "error") {
      const reason = String(detail || "unknown error").replace(/^Sync error:?\s*/i, "");
      el.textContent = "Sync error: " + reason;
    } else {
      el.textContent = labels[stateName] || stateName;
    }
    el.title = detail || labels[stateName] || "";
    refreshSyncHeader();
  }

  function refreshSyncHeader() {
    const chip = document.getElementById("syncCodeChip");
    const codeEl = document.getElementById("syncCodeHeader");
    if (!chip || !codeEl) return;
    if (syncMeta.path) {
      codeEl.textContent = syncMeta.path;
      chip.hidden = false;
      chip.dataset.state = syncStatus;
    } else {
      codeEl.textContent = "";
      chip.hidden = true;
      delete chip.dataset.state;
    }
  }

  function refreshSyncModal() {
    const linked = !!(syncMeta.token && syncMeta.path);
    document.getElementById("syncLinkedBox").hidden = !linked;
    document.getElementById("syncUnlinkedBox").hidden = linked;
    if (linked) {
      document.getElementById("syncCodeDisplay").value = syncMeta.path;
      document.getElementById("syncLinkedHint").textContent =
        "Open this site on another device → Sync → Join, and paste this code. Newer updatedAt wins.";
    }
  }

  function enqueueSync(fn) {
    const run = syncChain.then(fn, fn);
    syncChain = run.then(() => {}, () => {});
    return run;
  }

  function schedulePush() {
    if (!syncMeta.token || !syncMeta.path) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      enqueueSync(() => pushRemote());
    }, SYNC_DEBOUNCE_MS);
  }

  function buildRemotePayload() {
    return {
      version: 1,
      app: "habit-tracker",
      updatedAt: state.updatedAt || 0,
      accessToken: syncMeta.token,
      habits: state.habits,
      completions: state.completions,
      wellness: state.wellness,
      notes: state.notes,
    };
  }

  function encodeContent(payload) {
    return JSON.stringify([{ tag: "pre", children: [JSON.stringify(payload)] }]);
  }

  function decodeContent(nodes) {
    const text = nodes && nodes[0] && nodes[0].children && nodes[0].children[0];
    if (typeof text !== "string") throw new Error("Remote page has no habit data");
    const data = JSON.parse(text);
    if (!data || data.app !== "habit-tracker" || !Array.isArray(data.habits)) {
      throw new Error("That code is not a Habit Tracker sync page");
    }
    return data;
  }

  async function tgGet(method, params) {
    const url = TG_API + method + "?" + new URLSearchParams(params);
    const res = await fetch(url);
    if (!res.ok) throw new Error(method + " HTTP " + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || method + " failed");
    return json;
  }

  async function tgPost(method, params) {
    const res = await fetch(TG_API + method, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams(params),
    });
    if (!res.ok) throw new Error(method + " HTTP " + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || method + " failed");
    return json;
  }

  function normalizeSyncCode(raw) {
    let code = String(raw || "").trim();
    code = code.replace(/^https?:\/\/telegra\.ph\//i, "");
    code = code.split(/[?#]/)[0].replace(/\/+$/, "");
    return code;
  }

  function applyRemoteState(remote) {
    state.habits = remote.habits || [];
    state.completions = Array.isArray(remote.completions) ? remote.completions : [];
    state.wellness = Array.isArray(remote.wellness) ? remote.wellness : [];
    state.notes = Array.isArray(remote.notes) ? remote.notes : [];
    state.updatedAt = Number(remote.updatedAt) || 0;
    if (remote.accessToken && !syncMeta.token) syncMeta.token = remote.accessToken;
    save({ touch: false });
    renderAll();
  }

  async function pushRemote() {
    if (!syncMeta.token || !syncMeta.path) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSyncStatus("offline", "Offline — changes stay on this device until you reconnect");
      return;
    }
    const sentAt = state.updatedAt || 0;
    setSyncStatus("syncing");
    try {
      const edited = await tgPost("editPage", {
        access_token: syncMeta.token,
        path: syncMeta.path,
        title: syncMeta.title || "ht",
        content: encodeContent(buildRemotePayload()),
        return_content: "false",
      });
      if (edited.result && edited.result.path && edited.result.path !== syncMeta.path) {
        syncMeta.path = edited.result.path;
        saveSyncMeta();
        refreshSyncModal();
      }
      if ((state.updatedAt || 0) !== sentAt) {
        schedulePush();
      } else {
        setSyncStatus("synced", "Synced · " + syncMeta.path);
      }
    } catch (err) {
      const reason = (err && err.message) || "Upload failed";
      setSyncStatus("error", reason);
    }
  }

  async function pullRemote() {
    if (!syncMeta.path) {
      setSyncStatus(navigator.onLine === false ? "offline" : "local");
      return;
    }
    if (navigator.onLine === false) {
      setSyncStatus("offline", "Offline — showing saved data on this device");
      return;
    }
    // Background polls stay on Synced so the badge does not flash every 15s.
    if (syncStatus !== "synced") setSyncStatus("syncing");
    let remote;
    let page;
    try {
      page = await tgGet("getPage", { path: syncMeta.path, return_content: "true" });
      remote = decodeContent(page.result && page.result.content);
    } catch (err) {
      const reason = (err && err.message) || "Download failed";
      setSyncStatus("error", reason);
      return;
    }
    if (page.result && page.result.title) syncMeta.title = page.result.title;
    if (remote.accessToken) syncMeta.token = remote.accessToken;
    saveSyncMeta();
    const rAt = Number(remote.updatedAt) || 0;
    const lAt = Number(state.updatedAt) || 0;
    if (rAt > lAt) {
      applyRemoteState(remote);
      setSyncStatus("synced", "Synced · remote was newer");
    } else if (lAt > rAt) {
      await pushRemote();
    } else {
      setSyncStatus("synced", "Synced · " + syncMeta.path);
    }
  }

  async function createSyncCode() {
    if (syncMeta.path && syncMeta.token) {
      refreshSyncModal();
      toast("Already syncing");
      return syncMeta.path;
    }
    if (navigator.onLine === false) {
      setSyncStatus("offline");
      toast("You are offline");
      return "";
    }
    setSyncStatus("syncing");
    try {
      const acc = await tgGet("createAccount", { short_name: "HabitTracker", author_name: "Habit" });
      const token = acc.result.access_token;
      const rand = Math.random().toString(36).slice(2, 10);
      const title = "ht " + rand;
      syncMeta = { token, path: "", title };
      // Do not stamp Date.now() onto untouched local data. A later Join
      // compares updatedAt; a fresh seed must not look newer than a real tracker.
      const created = await tgPost("createPage", {
        access_token: token,
        title,
        content: encodeContent(buildRemotePayload()),
        return_content: "false",
      });
      syncMeta.path = created.result.path;
      syncMeta.title = (created.result && created.result.title) || title;
      saveSyncMeta();
      save({ touch: false });
      refreshSyncModal();
      setSyncStatus("synced", "Synced · " + syncMeta.path);
      toast("Sync code ready");
      return syncMeta.path;
    } catch (err) {
      syncMeta = { token: "", path: "", title: "" };
      const reason = (err && err.message) || "Could not create sync code";
      setSyncStatus("error", reason);
      toast("Sync error: " + reason);
      return "";
    }
  }

  async function joinSyncCode(raw) {
    const path = normalizeSyncCode(raw);
    if (!path || !/^[A-Za-z0-9-]{4,120}$/.test(path)) {
      toast("Enter the Sync code from the other device");
      return false;
    }
    if (navigator.onLine === false) {
      setSyncStatus("offline");
      toast("You are offline");
      return false;
    }
    setSyncStatus("syncing");
    try {
      const page = await tgGet("getPage", { path, return_content: "true" });
      const remote = decodeContent(page.result && page.result.content);
      if (!remote.accessToken) throw new Error("Sync page is missing its edit key");
      syncMeta = {
        token: remote.accessToken,
        path,
        title: (page.result && page.result.title) || syncMeta.title || "ht",
      };
      saveSyncMeta();
      const rAt = Number(remote.updatedAt) || 0;
      const lAt = Number(state.updatedAt) || 0;
      if (rAt > lAt) applyRemoteState(remote);
      else if (lAt > rAt) await pushRemote();
      else setSyncStatus("synced", "Synced · " + path);
      refreshSyncModal();
      if (syncStatus !== "error") {
        setSyncStatus("synced", "Synced · " + path);
        toast("Joined " + path);
      }
      return true;
    } catch (err) {
      const reason = (err && err.message) || "Could not join";
      setSyncStatus("error", reason);
      toast("Sync error: " + reason);
      return false;
    }
  }

  function stopSync() {
    if (!confirm("Stop syncing on this device? Your Sync code keeps working on other devices. Data stays in this browser.")) return;
    clearTimeout(syncTimer);
    syncMeta = { token: "", path: "", title: "" };
    localStorage.removeItem(SYNC_META_KEY);
    setSyncStatus(navigator.onLine === false ? "offline" : "local");
    refreshSyncModal();
    toast("Sync stopped on this device");
  }

  async function copySyncCode() {
    const code = syncMeta.path || "";
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast("Sync code copied");
    } catch {
      const input = document.getElementById("syncCodeDisplay");
      input.focus();
      input.select();
      toast("Copy the code manually");
    }
  }

  function pull() {
    return enqueueSync(() => pullRemote());
  }

  function ensureSyncCode() {
    if (syncMeta.token && syncMeta.path) return Promise.resolve(syncMeta.path);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSyncStatus("offline", "Offline — a sync code will be created when you reconnect");
      return Promise.resolve("");
    }
    return enqueueSync(() => createSyncCode());
  }

  function startSyncLoop() {
    if (navigator.onLine === false) {
      setSyncStatus("offline", syncMeta.path
        ? "Offline — showing saved data on this device"
        : "Offline — a sync code will be created when you reconnect");
    } else if (syncMeta.path) {
      setSyncStatus("syncing");
    } else {
      setSyncStatus("syncing", "Creating a sync code…");
    }

    if (syncMeta.path) pull();
    else ensureSyncCode();

    setInterval(() => {
      if (syncMeta.path) pull();
    }, SYNC_POLL_MS);
    window.addEventListener("focus", () => {
      if (syncMeta.path) pull();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && syncMeta.path) pull();
    });
    window.addEventListener("online", () => {
      if (syncMeta.path) pull();
      else ensureSyncCode();
    });
    window.addEventListener("offline", () => {
      setSyncStatus("offline", "Offline — changes stay on this device");
    });
  }

  // —— Events ——
  function bindEvents() {
    const noteForm = document.getElementById("noteForm");
    if (noteForm) {
      noteForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("noteInput");
        addNote(input.value);
        input.value = "";
        input.focus();
      });
    }
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
      if (t.classList.contains("mood-input")) {
        const mood = t.value === "" ? null : Number(t.value);
        upsertWellness(t.dataset.date, { mood });
        return;
      }
      if (t.classList.contains("sleep-input")) {
        const raw = t.value.trim();
        if (raw === "") {
          upsertWellness(t.dataset.date, { sleepHours: null });
          return;
        }
        const sleepHours = Number(raw);
        if (Number.isNaN(sleepHours) || sleepHours < 0 || sleepHours > 24) {
          toast("Sleep hours must be 0–24");
          loadWellnessForm();
          renderSheet();
          return;
        }
        upsertWellness(t.dataset.date, { sleepHours });
        return;
      }
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


    document.getElementById("btnCopyHeaderCode").addEventListener("click", () => {
      copySyncCode();
    });
    document.getElementById("btnSync").addEventListener("click", () => {
      document.getElementById("pasteBackupArea").value = "";
      refreshSyncModal();
      document.getElementById("syncModal").showModal();
    });
    document.getElementById("btnCreateSync").addEventListener("click", () => {
      createSyncCode();
    });
    document.getElementById("btnJoinSync").addEventListener("click", () => {
      joinSyncCode(document.getElementById("syncCodeInput").value);
    });
    document.getElementById("syncCodeInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        joinSyncCode(document.getElementById("syncCodeInput").value);
      }
    });
    document.getElementById("btnCopySyncCode").addEventListener("click", () => {
      copySyncCode();
    });
    document.getElementById("btnSyncNow").addEventListener("click", () => {
      pull({ forcePushIfNewer: true });
    });
    document.getElementById("btnStopSync").addEventListener("click", () => {
      stopSync();
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
    loadSyncMeta();
    seedIfNeeded();
    bindEvents();
    document.getElementById("wellnessDate").value = todayStr();
    renderAll();
    startSyncLoop();
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
    createSyncCode,
    joinSyncCode,
    pull,
    getSyncCode: () => syncMeta.path || "",
    reset: () => {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SYNC_META_KEY);
      location.reload();
    },
  };
})();
