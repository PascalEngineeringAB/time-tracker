/* Consultant Time Tracker - web version.
 *
 * Mirrors the Tkinter desktop app (app.py): monthly data, users/projects with
 * hourly rates, editable time entries, and a formatted Excel export whose
 * Detail + Summary sheets match the desktop layout.
 *
 * Storage: browser localStorage, one key per month ("timetracker:YYYY-MM"),
 * holding the exact same JSON shape the desktop app writes to
 * time_data_YYYY-MM.json  ->  { users:[str], projects:[{name,rate}], entries:[
 *   {id,date,user,project,hours,description} ] }
 */
(function () {
  "use strict";

  var KEY_PREFIX = "timetracker:";
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MONTH_RE = /^\d{4}-\d{2}$/;
  var MAX_HOURS = 24;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ------------------------------------------------------------------ helpers
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function currentMonth() { return todayISO().slice(0, 7); }
  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function g(n) { return String(+Number(n).toFixed(2)); } // trim trailing zeros, like python :g
  function cmp(a, b) { return String(a).toLowerCase() < String(b).toLowerCase() ? -1 : String(a).toLowerCase() > String(b).toLowerCase() ? 1 : 0; }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function parseDate(value) {
    value = String(value == null ? "" : value).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) throw new Error("Date must be a valid date in YYYY-MM-DD format.");
    var y = +m[1], mo = +m[2], da = +m[3];
    var d = new Date(y, mo - 1, da);   // local components, no timezone shift
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da)
      throw new Error("Date must be a valid date in YYYY-MM-DD format.");
    return value;
  }
  function parseHours(value) {
    var h = parseFloat(String(value).trim().replace(",", "."));
    if (isNaN(h) || h <= 0 || h > MAX_HOURS)
      throw new Error("Hours must be greater than 0 and at most " + MAX_HOURS + ".");
    return round2(h);
  }
  function validateEntryFields(date, user, project, hours, description) {
    var normDate = parseDate(date);
    if (!user) throw new Error("Please select a user.");
    if (!project) throw new Error("Please select a project.");
    var h = parseHours(hours);
    description = String(description || "").trim();
    if (!description) throw new Error("Please enter a description of what the hours were spent on.");
    return { date: normDate, user: user, project: project, hours: h, description: description };
  }

  // ---------------------------------------------------------------- data layer
  function emptyData() { return { users: [], projects: [], entries: [] }; }

  function normalizeProjects(raw) {
    var out = [], seen = {};
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (item) {
      var name, rate;
      if (typeof item === "string") { name = item.trim(); rate = 0; }
      else if (item && typeof item === "object") {
        name = String(item.name == null ? "" : item.name).trim();
        rate = parseFloat(item.rate); if (isNaN(rate)) rate = 0;
      } else return;
      if (!name || seen[name]) return;
      seen[name] = true;
      out.push({ name: name, rate: Math.max(rate, 0) });
    });
    out.sort(function (a, b) { return cmp(a.name, b.name); });
    return out;
  }
  function normalizeEntry(item) {
    if (!item || typeof item !== "object") return null;
    var hours = parseFloat(item.hours);
    if (isNaN(hours)) return null;
    return {
      id: String(item.id || uid()),
      date: String(item.date == null ? "" : item.date),
      user: String(item.user == null ? "" : item.user),
      project: String(item.project == null ? "" : item.project),
      hours: hours,
      description: String(item.description == null ? "" : item.description)
    };
  }
  function normalizeData(raw) {
    var data = emptyData();
    if (!raw || typeof raw !== "object") return data;
    if (Array.isArray(raw.users)) {
      var u = {};
      raw.users.forEach(function (x) { x = String(x).trim(); if (x) u[x] = true; });
      data.users = Object.keys(u).sort(cmp);
    }
    data.projects = normalizeProjects(raw.projects);
    if (Array.isArray(raw.entries))
      raw.entries.forEach(function (it) { var e = normalizeEntry(it); if (e) data.entries.push(e); });
    return data;
  }

  function monthsWithData() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(KEY_PREFIX) === 0) {
        var m = k.slice(KEY_PREFIX.length);
        if (MONTH_RE.test(m)) out.push(m);
      }
    }
    return out.sort();
  }
  function loadMonth(month) {
    var raw = localStorage.getItem(KEY_PREFIX + month);
    if (raw != null) {
      try { return normalizeData(JSON.parse(raw)); }
      catch (e) { return emptyData(); }
    }
    // new month: seed users + projects from the newest earlier month
    var seed = emptyData();
    var earlier = monthsWithData().filter(function (m) { return m < month; });
    if (earlier.length) {
      var prev = normalizeData(JSON.parse(localStorage.getItem(KEY_PREFIX + earlier[earlier.length - 1]) || "{}"));
      seed.users = prev.users.slice();
      seed.projects = prev.projects.map(function (p) { return { name: p.name, rate: p.rate }; });
    }
    return seed;
  }
  function saveMonth(month, data) {
    localStorage.setItem(KEY_PREFIX + month, JSON.stringify(data, null, 2));
  }

  function projectNames(data) { return data.projects.map(function (p) { return p.name; }); }
  function projectRate(data, name) {
    for (var i = 0; i < data.projects.length; i++)
      if (data.projects[i].name === name) return Number(data.projects[i].rate) || 0;
    return 0;
  }

  // -------------------------------------------------------------------- state
  var state = {
    month: currentMonth(),
    data: emptyData(),
    sort: { col: "date", desc: false },
    selected: {},        // entry id -> true (Log tab)
    editingId: null,
    manageUserSel: {},   // name -> true
    manageProjSel: {},   // name -> true
    exUserSel: {},
    exProjSel: {}
  };

  function persist() { saveMonth(state.month, state.data); }

  // --------------------------------------------------------------- Excel export
  function filterEntries(entries, users, projects, dateFrom, dateTo) {
    var uset = users ? toSet(users) : null;
    var pset = projects ? toSet(projects) : null;
    return entries.filter(function (e) {
      if (uset && !uset[e.user]) return false;
      if (pset && !pset[e.project]) return false;
      if (dateFrom && e.date < dateFrom) return false;
      if (dateTo && e.date > dateTo) return false;
      return true;
    });
  }
  function toSet(arr) { var s = {}; arr.forEach(function (x) { s[x] = true; }); return s; }

  var HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } };
  var HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  var TITLE_FONT = { bold: true, size: 12 };
  var TOP_LEFT = { horizontal: "left", vertical: "top" };
  var TOP_LEFT_WRAP = { horizontal: "left", vertical: "top", wrapText: true };
  var DESC_WIDTH = 45;

  function styleHeaderRow(ws, rowNum, ncols) {
    var row = ws.getRow(rowNum);
    for (var j = 1; j <= ncols; j++) {
      var c = row.getCell(j);
      c.font = HEADER_FONT;
      c.fill = HEADER_FILL;
    }
  }
  function alignAll(ws) {
    ws.eachRow({ includeEmpty: true }, function (row) {
      row.eachCell({ includeEmpty: true }, function (cell) { cell.alignment = TOP_LEFT; });
    });
  }
  function autosize(ws, wrapCols) {
    wrapCols = wrapCols || {};
    ws.columns.forEach(function (col, idx) {
      var letterIdx = idx + 1;
      if (wrapCols[letterIdx]) {
        col.width = DESC_WIDTH;
        col.eachCell({ includeEmpty: false }, function (cell, rowNumber) {
          if (rowNumber > 1) cell.alignment = TOP_LEFT_WRAP;
        });
        return;
      }
      var longest = 0;
      col.eachCell({ includeEmpty: false }, function (cell) {
        if (cell.value == null) return;
        String(cell.value).split("\n").forEach(function (s) { if (s.length > longest) longest = s.length; });
      });
      col.width = Math.min(Math.max(longest + 2, 10), DESC_WIDTH);
    });
  }

  function buildExcel(entries, opts) {
    // opts: {includeDetail, includeSummary, projectRates, users, projects, dateFrom, dateTo}
    if (typeof ExcelJS === "undefined")
      throw new Error("The Excel library did not load. Connect to the internet once so it can be cached, then retry.");
    if (opts.includeIncome) opts.includeSummary = true;
    if (!(opts.includeDetail || opts.includeSummary))
      throw new Error("Select at least one sheet to export.");

    var rows = filterEntries(entries, opts.users || null, opts.projects || null, opts.dateFrom || null, opts.dateTo || null);
    if (!rows.length) throw new Error("No time entries match the selected filters.");

    var rateMap = opts.projectRates || {};
    var rateOf = function (name) { return Number(rateMap[name]) || 0; };

    var base = rows.map(function (e) {
      return {
        Date: e.date, User: e.user, Project: e.project,
        Hours: round2(e.hours),
        Rate: round2(rateOf(e.project)),
        Income: round2(Number(e.hours) * rateOf(e.project)),
        Description: e.description
      };
    }).sort(function (a, b) {
      return (a.Date + " " + a.User + " " + a.Project)
        .localeCompare(b.Date + " " + b.User + " " + b.Project);
    });

    var wb = new ExcelJS.Workbook();

    if (opts.includeDetail) {
      var ws = wb.addWorksheet("Detail");
      ws.addRow(["Date", "User", "Project", "Hours", "Description"]);
      base.forEach(function (r) { ws.addRow([r.Date, r.User, r.Project, r.Hours, r.Description]); });
      styleHeaderRow(ws, 1, 5);
      ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
      ws.getColumn(4).eachCell({ includeEmpty: false }, function (cell, rn) {
        if (rn > 1 && typeof cell.value === "number") cell.numFmt = "0.00";
      });
      alignAll(ws);
      autosize(ws, { 5: true });
    }

    if (opts.includeSummary) {
      var s = wb.addWorksheet("Summary");
      var users = uniqSorted(base.map(function (r) { return r.User; }));
      var projs = uniqSorted(base.map(function (r) { return r.Project; }));
      var sum = {};
      users.forEach(function (u) { sum[u] = {}; projs.forEach(function (p) { sum[u][p] = 0; }); });
      base.forEach(function (r) { sum[r.User][r.Project] += r.Hours; });

      var titleRows = [], headerRows = [], boldRows = [];

      titleRows.push(s.addRow(["Hours by user and project"]).number);
      headerRows.push([s.addRow(["User"].concat(projs, ["Total"])).number, projs.length + 2]);
      users.forEach(function (u) {
        var vals = projs.map(function (p) { return round2(sum[u][p]); });
        var rt = round2(vals.reduce(function (a, b) { return a + b; }, 0));
        var rr = s.addRow([u].concat(vals, [rt]));
        rr.eachCell(function (c) { if (typeof c.value === "number") c.numFmt = "0.00"; });
      });
      var colT = projs.map(function (p) {
        return round2(users.reduce(function (a, u) { return a + sum[u][p]; }, 0));
      });
      var grand = round2(colT.reduce(function (a, b) { return a + b; }, 0));
      var totRow = s.addRow(["Total"].concat(colT, [grand]));
      totRow.eachCell(function (c) { c.font = { bold: true }; if (typeof c.value === "number") c.numFmt = "0.00"; });
      boldRows.push(totRow.number);
      s.addRow([]);

      // income by user
      var grp = {};
      base.forEach(function (r) {
        grp[r.User] = grp[r.User] || { h: 0, i: 0 };
        grp[r.User].h += r.Hours; grp[r.User].i += r.Income;
      });
      var totH = 0, totI = 0;
      Object.keys(grp).forEach(function (u) { totH += grp[u].h; totI += grp[u].i; });

      titleRows.push(s.addRow(["Income by user  (project rate × hours)"]).number);
      headerRows.push([s.addRow(["User", "Hours", "Income", "Avg rate / h"]).number, 4]);
      Object.keys(grp).sort(function (a, b) { return a.localeCompare(b); }).forEach(function (u) {
        var gh = grp[u].h, gi = grp[u].i;
        var rr = s.addRow([u, round2(gh), round2(gi), gh ? round2(gi / gh) : 0]);
        rr.getCell(2).numFmt = "0.00"; rr.getCell(3).numFmt = "#,##0.00"; rr.getCell(4).numFmt = "#,##0.00";
      });
      var incTot = s.addRow(["Total (all included users)", round2(totH), round2(totI), totH ? round2(totI / totH) : 0]);
      incTot.eachCell(function (c) { c.font = { bold: true }; });
      incTot.getCell(2).numFmt = "0.00"; incTot.getCell(3).numFmt = "#,##0.00"; incTot.getCell(4).numFmt = "#,##0.00";
      boldRows.push(incTot.number);
      s.addRow([]);

      // project rates
      titleRows.push(s.addRow(["Project rates"]).number);
      headerRows.push([s.addRow(["Project", "Rate / h"]).number, 2]);
      projs.forEach(function (p) {
        var rr = s.addRow([p, round2(rateOf(p))]);
        rr.getCell(2).numFmt = "#,##0.00";
      });

      titleRows.forEach(function (n) { s.getRow(n).getCell(1).font = TITLE_FONT; });
      headerRows.forEach(function (hr) { styleHeaderRow(s, hr[0], hr[1]); });
      alignAll(s);
      autosize(s);
      s.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
    }

    return { workbook: wb, count: rows.length };
  }

  function uniqSorted(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (!seen[x]) { seen[x] = true; out.push(x); } });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }

  // ---------------------------------------------------------------------- UI
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function fillSelect(sel, values, keepValue) {
    var cur = keepValue ? sel.value : "";
    sel.innerHTML = '<option value="">—</option>' +
      values.map(function (v) { return '<option>' + escapeHtml(v) + '</option>'; }).join("");
    if (cur && values.indexOf(cur) !== -1) sel.value = cur;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ----- month bar -----
  function refreshMonths() {
    var choices = {};
    monthsWithData().forEach(function (m) { choices[m] = true; });
    choices[state.month] = true;
    choices[currentMonth()] = true;
    var list = Object.keys(choices).sort();
    var sel = $("#monthSelect");
    sel.innerHTML = list.map(function (m) { return '<option>' + m + '</option>'; }).join("");
    sel.value = state.month;
  }

  function openMonth(month) {
    state.month = month;
    state.data = loadMonth(month);
    persist();
    state.selected = {};
    refreshAll();
  }

  // ----- Log tab -----
  function sortedEntries() {
    var col = state.sort.col, desc = state.sort.desc;
    var arr = state.data.entries.slice();
    arr.sort(function (a, b) {
      var x = a[col], y = b[col];
      if (col === "hours") { x = Number(x); y = Number(y); }
      else { x = String(x).toLowerCase(); y = String(y).toLowerCase(); }
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
    });
    return arr;
  }

  function refreshEntries() {
    var body = $("#entryBody");
    var arr = sortedEntries();
    body.innerHTML = arr.map(function (e) {
      var sel = state.selected[e.id] ? " selected" : "";
      return '<tr data-id="' + e.id + '" class="' + sel.trim() + '">' +
        '<td class="chkcol"><input type="checkbox" ' + (state.selected[e.id] ? "checked" : "") + '></td>' +
        '<td>' + escapeHtml(e.date) + '</td>' +
        '<td>' + escapeHtml(e.user) + '</td>' +
        '<td>' + escapeHtml(e.project) + '</td>' +
        '<td class="num">' + g(e.hours) + '</td>' +
        '<td class="desc">' + escapeHtml(e.description) + '</td>' +
        '</tr>';
    }).join("");

    var total = state.data.entries.reduce(function (a, e) { return a + Number(e.hours); }, 0);
    $("#grandTotal").textContent = state.data.entries.length + " entries  |  " + g(total) + " h total";

    var perPerson = {};
    state.data.entries.forEach(function (e) { perPerson[e.user] = (perPerson[e.user] || 0) + Number(e.hours); });
    var names = Object.keys(perPerson).sort(cmp);
    $("#perPerson").textContent = names.length
      ? "Hours per person (" + state.month + "):   " + names.map(function (u) { return u + ": " + g(perPerson[u]) + " h"; }).join("   ")
      : "";

    $$("th[data-sort]").forEach(function (th) {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.getAttribute("data-sort") === state.sort.col)
        th.classList.add(state.sort.desc ? "sorted-desc" : "sorted-asc");
    });
    updateSelectionTotal();
  }

  function selectedEntries() {
    return state.data.entries.filter(function (e) { return state.selected[e.id]; });
  }
  function updateSelectionTotal() {
    var rows = selectedEntries();
    var allChk = $("#selAll");
    var visible = state.data.entries.length;
    allChk.checked = visible > 0 && rows.length === visible;
    $("#selTotal").textContent = rows.length > 1
      ? "selected: " + rows.length + " rows  |  " + g(rows.reduce(function (a, e) { return a + Number(e.hours); }, 0)) + " h"
      : "";
  }

  function addEntry(ev) {
    ev.preventDefault();
    try {
      var f = validateEntryFields($("#f_date").value, $("#f_user").value, $("#f_project").value,
        $("#f_hours").value, $("#f_desc").value);
    } catch (e) { toast(e.message); return; }
    f.id = uid();
    state.data.entries.push(f);
    persist();
    $("#f_hours").value = ""; $("#f_desc").value = "";
    refreshEntries();
  }

  function openEditModal() {
    var rows = selectedEntries();
    if (!rows.length) { toast("Select an entry first."); return; }
    if (rows.length > 1) { toast("Select a single entry to edit."); return; }
    var e = rows[0];
    state.editingId = e.id;
    fillSelect($("#m_user"), state.data.users);
    fillSelect($("#m_project"), projectNames(state.data));
    $("#m_date").value = e.date;
    $("#m_user").value = e.user;
    $("#m_project").value = e.project;
    $("#m_hours").value = g(e.hours);
    $("#m_desc").value = e.description;
    $("#modal").hidden = false;
    $("#m_date").focus();
  }
  function closeModal() { $("#modal").hidden = true; state.editingId = null; }
  function saveModal(ev) {
    ev.preventDefault();
    try {
      var f = validateEntryFields($("#m_date").value, $("#m_user").value, $("#m_project").value,
        $("#m_hours").value, $("#m_desc").value);
    } catch (e) { toast(e.message); return; }
    var e = state.data.entries.filter(function (x) { return x.id === state.editingId; })[0];
    if (e) { e.date = f.date; e.user = f.user; e.project = f.project; e.hours = f.hours; e.description = f.description; persist(); }
    closeModal();
    refreshEntries();
  }

  function deleteEntries() {
    var rows = selectedEntries();
    if (!rows.length) { toast("Select one or more entries first."); return; }
    if (!confirm("Delete " + rows.length + " selected time " + (rows.length === 1 ? "entry" : "entries") + "?")) return;
    var kill = toSet(rows.map(function (e) { return e.id; }));
    state.data.entries = state.data.entries.filter(function (e) { return !kill[e.id]; });
    state.selected = {};
    persist();
    refreshEntries();
  }

  // ----- Manage tab -----
  function refreshManage() {
    var ul = $("#userList");
    ul.innerHTML = state.data.users.map(function (n) {
      return '<li data-name="' + escapeHtml(n) + '"' + (state.manageUserSel[n] ? ' class="selected"' : "") + '>' + escapeHtml(n) + '</li>';
    }).join("");
    var pl = $("#projectList");
    pl.innerHTML = state.data.projects.map(function (p) {
      return '<li data-name="' + escapeHtml(p.name) + '"' + (state.manageProjSel[p.name] ? ' class="selected"' : "") + '>' +
        escapeHtml(p.name) + '  <span class="muted">— ' + g(p.rate) + ' / h</span></li>';
    }).join("");
  }
  function manageSelNames(map) { return Object.keys(map).filter(function (k) { return map[k]; }); }

  function addUser() {
    var name = prompt("New user name:");
    if (name == null) return;
    name = name.trim();
    if (!name) { toast("Name cannot be blank."); return; }
    if (state.data.users.indexOf(name) !== -1) { toast("'" + name + "' already exists."); return; }
    state.data.users.push(name); state.data.users.sort(cmp);
    persist(); refreshAll();
  }
  function renameUser() {
    var names = manageSelNames(state.manageUserSel);
    if (names.length !== 1) { toast("Select a single user to rename."); return; }
    var old = names[0];
    var neu = prompt("New name for '" + old + "':", old);
    if (neu == null) return;
    neu = neu.trim();
    if (!neu || neu === old) return;
    if (state.data.users.indexOf(neu) !== -1) { toast("'" + neu + "' already exists."); return; }
    state.data.users = state.data.users.map(function (n) { return n === old ? neu : n; }).sort(cmp);
    state.data.entries.forEach(function (e) { if (e.user === old) e.user = neu; });
    state.manageUserSel = {};
    persist(); refreshAll();
  }
  function removeUser() {
    var names = manageSelNames(state.manageUserSel);
    if (!names.length) { toast("Select one or more users first."); return; }
    var rm = toSet(names);
    var used = state.data.entries.filter(function (e) { return rm[e.user]; }).length;
    if (used && !confirm("The selected user(s) are used by " + used + " time " + (used === 1 ? "entry" : "entries") +
      ".\nThose entries are kept but the user(s) are no longer selectable.\nRemove anyway?")) return;
    state.data.users = state.data.users.filter(function (n) { return !rm[n]; });
    state.manageUserSel = {};
    persist(); refreshAll();
  }

  function askRate(name, current) {
    var v = prompt("Hourly rate for '" + name + "':", current == null ? "0" : String(current));
    if (v == null) return null;
    var r = parseFloat(String(v).replace(",", "."));
    if (isNaN(r) || r < 0) { toast("Rate must be a number ≥ 0."); return null; }
    return r;
  }
  function addProject() {
    var name = prompt("New project name:");
    if (name == null) return;
    name = name.trim();
    if (!name) { toast("Name cannot be blank."); return; }
    if (projectNames(state.data).indexOf(name) !== -1) { toast("'" + name + "' already exists."); return; }
    var rate = askRate(name, 0);
    if (rate == null) return;
    state.data.projects.push({ name: name, rate: rate });
    state.data.projects.sort(function (a, b) { return cmp(a.name, b.name); });
    persist(); refreshAll();
  }
  function editProject() {
    var names = manageSelNames(state.manageProjSel);
    if (names.length !== 1) { toast("Select a single project to edit."); return; }
    var old = names[0];
    var cur = projectRate(state.data, old);
    var neu = prompt("Project name:", old);
    if (neu == null) return;
    neu = neu.trim();
    if (!neu) { toast("Name cannot be blank."); return; }
    if (neu !== old && projectNames(state.data).indexOf(neu) !== -1) { toast("'" + neu + "' already exists."); return; }
    var rate = askRate(neu, cur);
    if (rate == null) return;
    state.data.projects.forEach(function (p) { if (p.name === old) { p.name = neu; p.rate = rate; } });
    if (neu !== old) state.data.entries.forEach(function (e) { if (e.project === old) e.project = neu; });
    state.data.projects.sort(function (a, b) { return cmp(a.name, b.name); });
    state.manageProjSel = {};
    persist(); refreshAll();
  }
  function removeProject() {
    var names = manageSelNames(state.manageProjSel);
    if (!names.length) { toast("Select one or more projects first."); return; }
    var rm = toSet(names);
    var used = state.data.entries.filter(function (e) { return rm[e.project]; }).length;
    if (used && !confirm("The selected project(s) are used by " + used + " time " + (used === 1 ? "entry" : "entries") +
      ".\nThose entries are kept but the project(s) are no longer selectable.\nRemove anyway?")) return;
    state.data.projects = state.data.projects.filter(function (p) { return !rm[p.name]; });
    state.manageProjSel = {};
    persist(); refreshAll();
  }

  // ----- Export tab -----
  function refreshExportLists() {
    var ul = $("#exUserList");
    ul.innerHTML = state.data.users.map(function (n) {
      return '<li data-name="' + escapeHtml(n) + '"' + (state.exUserSel[n] ? ' class="selected"' : "") + '>' + escapeHtml(n) + '</li>';
    }).join("");
    var pl = $("#exProjectList");
    pl.innerHTML = projectNames(state.data).map(function (n) {
      return '<li data-name="' + escapeHtml(n) + '"' + (state.exProjSel[n] ? ' class="selected"' : "") + '>' + escapeHtml(n) + '</li>';
    }).join("");
  }

  function doExport() {
    if (!state.data.entries.length) { toast("There are no time entries yet."); return; }
    var wantDetail = $("#wantDetail").checked, wantSummary = $("#wantSummary").checked;
    if (!(wantDetail || wantSummary)) { toast("Choose at least one of Detail / Summary."); return; }

    var users = null;
    if (!$("#allUsers").checked) {
      users = manageSelNames(state.exUserSel);
      if (!users.length) { toast("Select one or more users, or tick 'All users'."); return; }
    }
    var projects = null;
    if (!$("#allProjects").checked) {
      projects = manageSelNames(state.exProjSel);
      if (!projects.length) { toast("Select one or more projects, or tick 'All projects'."); return; }
    }

    var df = $("#dateFrom").value.trim() || null;
    var dt = $("#dateTo").value.trim() || null;
    try { if (df) df = parseDate(df); if (dt) dt = parseDate(dt); }
    catch (e) { toast("Dates must be in YYYY-MM-DD format."); return; }

    var rates = {};
    state.data.projects.forEach(function (p) { rates[p.name] = p.rate; });

    try {
      var res = buildExcel(state.data.entries, {
        includeDetail: wantDetail, includeSummary: wantSummary,
        projectRates: rates, users: users, projects: projects, dateFrom: df, dateTo: dt
      });
      res.workbook.xlsx.writeBuffer().then(function (buf) {
        downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          "time_report_" + state.month + ".xlsx");
        toast("Exported " + res.count + " " + (res.count === 1 ? "entry" : "entries") + ".");
      }).catch(function (e) { toast("Export failed: " + e.message); });
    } catch (e) { toast(e.message); }
  }

  // ----- JSON import / export -----
  function exportJson() {
    downloadBlob(new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" }),
      "time_data_" + state.month + ".json");
  }
  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { toast("That file is not valid JSON."); return; }
      if (!confirm("Replace ALL users, projects and entries for " + state.month + " with the contents of this file?")) return;
      state.data = normalizeData(parsed);
      state.selected = {};
      persist();
      refreshAll();
      toast("Loaded " + state.data.entries.length + " entries, " + state.data.users.length +
        " users, " + state.data.projects.length + " projects.");
    };
    reader.readAsText(file);
  }

  // ----- refresh everything -----
  function refreshAll() {
    refreshMonths();
    $("#monthSelect").value = state.month;
    fillSelect($("#f_user"), state.data.users, true);
    fillSelect($("#f_project"), projectNames(state.data), true);
    refreshEntries();
    refreshManage();
    refreshExportLists();
  }

  // --------------------------------------------------------------- wiring
  function togglePick(map, name, single) {
    if (single) {
      var was = map[name];
      Object.keys(map).forEach(function (k) { delete map[k]; });
      if (!was) map[name] = true;
    } else {
      if (map[name]) delete map[name]; else map[name] = true;
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    // tabs
    $$(".tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$(".tab").forEach(function (b) { b.classList.remove("active"); });
        $$(".tabpane").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        $("#tab-" + btn.getAttribute("data-tab")).classList.add("active");
      });
    });

    $("#f_date").value = todayISO();

    // month bar
    $("#monthSelect").addEventListener("change", function () { openMonth(this.value); });
    $("#newMonthBtn").addEventListener("click", function () {
      var m = prompt("Month (YYYY-MM):", currentMonth());
      if (m == null) return;
      m = m.trim();
      if (!MONTH_RE.test(m)) { toast("Use the format YYYY-MM."); return; }
      openMonth(m);
    });
    $("#exportJsonBtn").addEventListener("click", exportJson);
    $("#importBtn").addEventListener("click", function () { $("#importFile").click(); });
    $("#importFile").addEventListener("change", function () {
      if (this.files && this.files[0]) importJson(this.files[0]);
      this.value = "";
    });

    // log tab
    $("#addForm").addEventListener("submit", addEntry);
    $("#editBtn").addEventListener("click", openEditModal);
    $("#deleteBtn").addEventListener("click", deleteEntries);
    $("#selAll").addEventListener("change", function () {
      state.selected = {};
      if (this.checked) state.data.entries.forEach(function (e) { state.selected[e.id] = true; });
      refreshEntries();
    });
    $("#entryBody").addEventListener("click", function (ev) {
      var tr = ev.target.closest("tr");
      if (!tr) return;
      var id = tr.getAttribute("data-id");
      if (state.selected[id]) delete state.selected[id]; else state.selected[id] = true;
      refreshEntries();
    });
    $("#entryBody").addEventListener("dblclick", function (ev) {
      var tr = ev.target.closest("tr");
      if (!tr) return;
      state.selected = {}; state.selected[tr.getAttribute("data-id")] = true;
      openEditModal();
    });
    $$("th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var col = th.getAttribute("data-sort");
        if (state.sort.col === col) state.sort.desc = !state.sort.desc;
        else { state.sort.col = col; state.sort.desc = false; }
        refreshEntries();
      });
    });

    // modal
    $("#editForm").addEventListener("submit", saveModal);
    $("#modalCancel").addEventListener("click", closeModal);
    $("#modal").addEventListener("click", function (ev) { if (ev.target === this) closeModal(); });
    document.addEventListener("keydown", function (ev) {
      if ($("#modal").hidden) return;
      if (ev.key === "Escape") closeModal();
      else if (ev.key === "Enter" && ev.target.tagName !== "TEXTAREA") { ev.preventDefault(); saveModal(ev); }
    });

    // manage tab
    $("#userList").addEventListener("click", function (ev) {
      var li = ev.target.closest("li"); if (!li) return;
      togglePick(state.manageUserSel, li.getAttribute("data-name"), false);
      refreshManage();
    });
    $("#projectList").addEventListener("click", function (ev) {
      var li = ev.target.closest("li"); if (!li) return;
      togglePick(state.manageProjSel, li.getAttribute("data-name"), false);
      refreshManage();
    });
    $("#addUserBtn").addEventListener("click", addUser);
    $("#renameUserBtn").addEventListener("click", renameUser);
    $("#removeUserBtn").addEventListener("click", removeUser);
    $("#addProjectBtn").addEventListener("click", addProject);
    $("#editProjectBtn").addEventListener("click", editProject);
    $("#removeProjectBtn").addEventListener("click", removeProject);

    // export tab
    $("#exUserList").addEventListener("click", function (ev) {
      var li = ev.target.closest("li"); if (!li) return;
      togglePick(state.exUserSel, li.getAttribute("data-name"), false);
      $("#allUsers").checked = manageSelNames(state.exUserSel).length === 0;
      refreshExportLists();
    });
    $("#exProjectList").addEventListener("click", function (ev) {
      var li = ev.target.closest("li"); if (!li) return;
      togglePick(state.exProjSel, li.getAttribute("data-name"), false);
      $("#allProjects").checked = manageSelNames(state.exProjSel).length === 0;
      refreshExportLists();
    });
    $("#allUsers").addEventListener("change", function () {
      if (this.checked) { state.exUserSel = {}; refreshExportLists(); }
    });
    $("#allProjects").addEventListener("change", function () {
      if (this.checked) { state.exProjSel = {}; refreshExportLists(); }
    });
    $("#doExportBtn").addEventListener("click", doExport);

    // boot
    openMonth(state.month);
  });
})();
