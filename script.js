/* ATTENDANCE TRACKER — script.js
   Plain JS, no frameworks. */

// ===== PURE LOGIC (no DOM) =====
const TARGET = 75;   // target % for every subject (the formulas below assume 75)
const WARN = 65;     // below this = danger, between WARN and TARGET = warning
const KEY = "attendanceRegisterData";

const newId = () => "s_" + Math.random().toString(36).slice(2, 10);

// ERP table row: # | Code | Subject | Type | Present | OD | Makeup | Absent | %
const ERP_ROW = /^(\d+)\s+(\S+)\s+(.+?)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s*$/;

// Report title / column header lines are skipped silently
const isNoise = (l) =>
  /^attendance\s*report$/i.test(l) || (/subject\s*code/i.test(l) && /percentage/i.test(l));

// Returns {name, held, attended}, {error: line} or null (blank/noise)
function parseLine(raw) {
  const line = raw.trim();
  if (!line || isNoise(line)) return null;

  // 1) ERP table format: held = P+OD+Makeup+Absent, attended = P+OD+Makeup
  const m = line.match(ERP_ROW);
  if (m) {
    const [p, od, mk, ab] = m.slice(5, 9).map(Number);
    return { name: m[3].trim(), held: p + od + mk + ab, attended: p + od + mk };
  }

  // 2) Generic format: strip labels, take LAST two numbers as held, attended
  const clean = line
    .replace(/subject\s*:?|total\s*(classes)?\s*:?|held\s*:?|attended\s*:?|present\s*:?/gi, "")
    .trim();
  const tokens = (/[,\t]/.test(clean) ? clean.split(/[,\t]+/) : clean.split(/\s+/))
    .map((t) => t.trim())
    .filter(Boolean);
  const nums = tokens.flatMap((t, i) => (/^\d+$/.test(t) ? [i] : []));
  if (nums.length < 2) return { error: raw };

  const heldIdx = nums[nums.length - 2];
  const held = +tokens[heldIdx];
  const attended = +tokens[nums[nums.length - 1]];
  if (attended > held) return { error: raw + "  (attended can't exceed held)" };

  const name = tokens.slice(0, heldIdx).join(" ").replace(/[:,]+$/, "").trim() || "Untitled subject";
  return { name, held, attended };
}

function parseAttendanceText(text) {
  const parsed = [], skipped = [];
  text.split(/\r?\n/).forEach((l) => {
    const r = parseLine(l);
    if (!r) return;
    if (r.error) skipped.push(r.error);
    else parsed.push({ id: newId(), ...r });
  });
  return { parsed, skipped };
}

const percentOf = (a, h) => (h === 0 ? 0 : (a / h) * 100);

// Integer comparisons (no floating-point surprises right at 75% / 65%)
const statusFor = (a, h) =>
  h === 0 || a * 100 >= h * TARGET ? "safe" : a * 100 >= h * WARN ? "warn" : "danger";

const plural = (n) => `class${n === 1 ? "" : "es"}`;

// (attended + x) / (held + x) >= 0.75  =>  x >= 3*held - 4*attended
const classesNeeded = (h, a) => Math.max(0, 3 * h - 4 * a);
// attended / (held + x) >= 0.75  =>  x <= (4*attended - 3*held) / 3
const classesSafeToSkip = (h, a) => Math.max(0, Math.floor((4 * a - 3 * h) / 3));

function targetMessage(h, a) {
  if (h === 0) return "No classes held yet";
  if (statusFor(a, h) === "safe") {
    const skip = classesSafeToSkip(h, a);
    return skip > 0
      ? `You can skip up to ${skip} ${plural(skip)} and stay ≥ 75%`
      : "At the edge — skipping any class drops you below 75%";
  }
  const need = classesNeeded(h, a);
  return `Attend the next ${need} ${plural(need)} in a row to reach 75%`;
}
// ===== END PURE LOGIC =====


// ============ DOM ============
if (typeof document !== "undefined") {

  const $ = (id) => document.getElementById(id);
  const rawInput = $("rawInput"), parseWarning = $("parseWarning");
  const sampleToggle = $("sampleToggle"), sampleBox = $("sampleBox");
  const resultsSection = $("resultsSection"), overallRing = $("overallRing");
  const subjectList = $("subjectList"), rowTemplate = $("rowTemplate");
  const sortSelect = $("sortSelect"), emptyMsg = $("emptyMsg");
  const chips = [...document.querySelectorAll(".chip")];

  const STATUS_TEXT = { safe: "Safe", warn: "Warning", danger: "Danger" };
  let subjects = []; // { id, name, held, attended }
  let filter = "all";

  const totals = () => {
    const held = subjects.reduce((s, x) => s + x.held, 0);
    const attended = subjects.reduce((s, x) => s + x.attended, 0);
    return { held, attended, pct: percentOf(attended, held) };
  };

  // ---------- rendering ----------
  function render() {
    resultsSection.hidden = subjects.length === 0;
    if (subjects.length === 0) return;

    const t = totals();
    const status = statusFor(t.attended, t.held);
    $("totalHeld").textContent = t.held;
    $("totalAttended").textContent = t.attended;
    $("subjectCount").textContent = subjects.length;
    $("belowCount").textContent = subjects.filter((s) => statusFor(s.attended, s.held) !== "safe").length;
    $("overallPct").textContent = `${t.pct.toFixed(1)}%`;
    $("overallLabel").textContent = STATUS_TEXT[status].toUpperCase();
    $("overallMsg").textContent = targetMessage(t.held, t.attended);

    overallRing.style.setProperty("--p", Math.min(100, t.pct).toFixed(1));
    overallRing.classList.remove("status-safe", "status-warn", "status-danger");
    overallRing.classList.add(`status-${status}`);

    // filter chip counts
    const count = (f) => subjects.filter((s) => f === "all" || statusFor(s.attended, s.held) === f).length;
    chips.forEach((c) => {
      const f = c.dataset.filter;
      const label = f === "all" ? "All" : STATUS_TEXT[f];
      c.textContent = `${label} (${count(f)})`;
    });

    renderList();
    save();
  }

  function renderList() {
    subjectList.innerHTML = "";
    let list = subjects.filter((s) => filter === "all" || statusFor(s.attended, s.held) === filter);

    if (sortSelect.value === "low") list.sort((a, b) => percentOf(a.attended, a.held) - percentOf(b.attended, b.held));
    if (sortSelect.value === "high") list.sort((a, b) => percentOf(b.attended, b.held) - percentOf(a.attended, a.held));

    list.forEach((s) => subjectList.appendChild(buildCard(s)));
    emptyMsg.hidden = list.length > 0;
  }

  function buildCard(s) {
    const frag = rowTemplate.content.cloneNode(true);
    const q = (sel) => frag.querySelector(sel);
    const card = q(".subject-card");
    card.dataset.id = s.id;

    const nameIn = q(".subject-name"), heldIn = q(".held-input"), attIn = q(".attended-input");
    nameIn.value = s.name;
    heldIn.value = s.held;
    attIn.value = s.attended;

    const pct = percentOf(s.attended, s.held);
    const status = statusFor(s.attended, s.held);
    card.classList.add(`status-${status}`);
    q(".pct-text").textContent = s.held === 0 ? "—" : `${pct.toFixed(1)}%`;
    q(".bar-fill").style.width = `${Math.min(100, pct)}%`;
    q(".status-pill").textContent = STATUS_TEXT[status];
    q(".target-msg").textContent = targetMessage(s.held, s.attended);

    // manual edits
    nameIn.addEventListener("change", () => {
      s.name = nameIn.value.trim() || "Untitled subject";
      save();
    });
    heldIn.addEventListener("change", () => {
      s.held = clampInt(heldIn.value, s.attended);
      render();
    });
    attIn.addEventListener("change", () => {
      s.attended = Math.min(clampInt(attIn.value, 0), s.held);
      render();
    });

    // what-if buttons
    q(".sim-attend").addEventListener("click", () => { s.held++; s.attended++; render(); });
    q(".sim-absent").addEventListener("click", () => { s.held++; render(); });
    q(".sim-remove").addEventListener("click", () => {
      subjects = subjects.filter((x) => x.id !== s.id);
      render();
    });

    return frag;
  }

  function clampInt(value, min) {
    const n = parseInt(value, 10);
    return isNaN(n) || n < min ? min : n;
  }

  // ---------- summary text (copy + share) ----------
  function summaryText() {
    const t = totals();
    return [
      `ATTENDANCE SUMMARY — Overall: ${t.pct.toFixed(1)}% (${t.attended}/${t.held})`,
      "",
      ...subjects.map((s) => {
        const p = percentOf(s.attended, s.held);
        return `${s.name}: ${s.attended}/${s.held} (${p.toFixed(1)}%) — ${statusFor(s.attended, s.held).toUpperCase()}`;
      }),
    ].join("\n");
  }

  // ---------- events ----------
  $("calculateBtn").addEventListener("click", () => {
    const { parsed, skipped } = parseAttendanceText(rawInput.value);

    if (parsed.length === 0) {
      parseWarning.hidden = false;
      parseWarning.textContent =
        "Couldn't find any valid subject rows. Check the sample format above and make sure each line has a subject name followed by two numbers (held, attended).";
      return;
    }

    subjects = parsed;
    filter = "all";
    chips.forEach((c) => c.classList.toggle("active", c.dataset.filter === "all"));

    parseWarning.hidden = skipped.length === 0;
    if (skipped.length) {
      parseWarning.textContent = `Parsed ${parsed.length} subject(s). Skipped ${skipped.length} line(s) that didn't match a known format — you can add those manually if needed.`;
    }

    render();
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("resetBtn").addEventListener("click", () => {
    if (subjects.length > 0 && !confirm("Clear all data and start over?")) return;
    subjects = [];
    rawInput.value = "";
    parseWarning.hidden = true;
    try { localStorage.removeItem(KEY); } catch {}
    render();
  });

  sampleToggle.addEventListener("click", () => {
    const wasHidden = sampleBox.hidden;
    sampleBox.hidden = !wasHidden;
    sampleToggle.setAttribute("aria-expanded", String(wasHidden));
    sampleToggle.textContent = wasHidden ? "Hide sample format ▴" : "Show sample format ▾";
  });

  sortSelect.addEventListener("change", renderList);

  chips.forEach((c) =>
    c.addEventListener("click", () => {
      filter = c.dataset.filter;
      chips.forEach((x) => x.classList.toggle("active", x === c));
      renderList();
    })
  );

  $("copySummaryBtn").addEventListener("click", async () => {
    const btn = $("copySummaryBtn");
    const text = summaryText();
    try {
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = old), 1500);
    } catch {
      window.prompt("Copy this summary:", text); // fallback
    }
  });

  $("shareBtn").addEventListener("click", () => {
    const t = totals();
    const text = `My attendance is ${t.pct.toFixed(1)}% (${t.attended}/${t.held}).\n\n${summaryText().split("\n").slice(2).join("\n")}`;
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
  });

  $("printBtn").addEventListener("click", () => window.print());

  // ---------- storage ----------
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(subjects)); } catch {}
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(data) && data.length) subjects = data;
    } catch {}
  }

  // ---------- init ----------
  load();
  render();
}
