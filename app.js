/* 1915 South DC Smart Scheduler: app
   Firestore paths (project field-leader-1915):
     dcSettings/{dc}          standards, shift templates, markets, OT rules, blackout
     dcTeams/{dc}             roster (people[]) and leaderEmails[]
     dcWeeks/{dc}__{week}     volume, schedule, posted status   (week = Monday, YYYY-MM-DD)
   Shift codes in sched[id].days[7]: "" off, "PTO", template letters (D M N S R L), "X:6.5-15" custom (decimal hours). */
window.DCApp = (function () {
  "use strict";
  const C = window.DC_CONFIG || {};
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // DC weeks run Monday to Sunday
  const DC_NUM = { redhills: "9910", loxley: "9911", kernersville: "9912", covington: "9913" };
  const DCS = [
    { k: "redhills", n: "Red Hills", num: "9910" },
    { k: "loxley", n: "Loxley", num: "9911" },
    { k: "kernersville", n: "Kernersville", num: "9912" },
    { k: "covington", n: "Covington", num: "9913" }
  ];
  const DEPTS = [
    { k: "inbound", n: "Receiving", g: "wh" },
    { k: "pick", n: "Pick", g: "wh" },
    { k: "load", n: "Loading", g: "wh" },
    { k: "outbound", n: "Outbound", g: "wh" },
    { k: "returns", n: "Returns", g: "wh" },
    { k: "rewrap", n: "Rewrap", g: "wh" },
    { k: "recycle", n: "Recycle", g: "wh" },
    { k: "prep", n: "Prep and Assembly", g: "wh" },
    { k: "inventory", n: "Inventory", g: "wh" },
    { k: "flex", n: "Warehouse flex", g: "wh" },
    { k: "shop", n: "Shop", g: "shop" },
    { k: "delivery", n: "Delivery", g: "del" },
    { k: "linehaul", n: "Line-haul", g: "lh" }
  ];
  const DEPT = Object.fromEntries(DEPTS.map((d) => [d.k, d]));
  const WH_NEED = ["inbound", "pick", "load", "outbound", "returns", "rewrap", "recycle", "prep", "inventory"];
  const GROUPS = { wh: "Warehouse", shop: "Shop", del: "Delivery", lh: "Line-haul" };
  // shift templates that belong to a department, and the fixed headcount they carry
  const deptTpls = (st, k) => Object.entries(st.tpl).filter(([c, t]) => t.d === k);
  const fixedFor = (st, k) => deptTpls(st, k).reduce((a, [c, t]) => a + (+t.fixed || 0), 0);

  /* ---------------- defaults ---------------- */
  function defaultSettings(dc) {
    const rh = dc === "redhills", cov = dc === "covington";
    return {
      dc,
      trucks: { redhills: 25, loxley: 9, kernersville: 5, covington: 0 }[dc],
      hasDelivery: !cov,
      hasLinehaul: rh,
      useNightLoad: rh,
      markets: rh
        ? [
            { n: "Jacksonville", buf: 10, local: false },
            { n: "Brunswick", buf: 10, local: false },
            { n: "Columbus", buf: 10, local: false },
            { n: "Macon", buf: 10, local: false },
            { n: "Dothan", buf: 10, local: false },
            { n: "Panama City", buf: 10, local: false },
            { n: "Thomasville", buf: 0, local: true }
          ]
        : [{ n: cov ? "3PL" : "Local", buf: 0, local: true }],
      std: {
        stopsPerRoute: 12, crew: 2, piecesPerStop: 6,
        inboundHrsPerTrailer: 8, pickPPH: 18, loadPPH: 22,
        routesPerOutbound: 8, returnsPerHr: 6, shopPerHr: 1.5,
        boxesPerRun: 2, prodHrs: 8, inventoryFixed: 1
      },
      // Red Hills shifts confirmed by Frank Oct 6 2026 (loading, Sat load and line-haul still placeholders).
      // d = department the shift belongs to, fixed = people needed on that shift every warehouse day
      tpl: rh ? {
        RT: { n: "Returns", s: 4, e: 12.5, g: "wh", d: "returns" },
        W: { n: "Rewrap", s: 6, e: 14.5, g: "wh", d: "rewrap", fixed: 2 },
        Y1: { n: "Recycle AM", s: 4, e: 12.5, g: "wh", d: "recycle", fixed: 2 },
        Y2: { n: "Recycle PM", s: 7.5, e: 16, g: "wh", d: "recycle", fixed: 2 },
        P: { n: "Picking", s: 6, e: 14.5, g: "wh", d: "pick" },
        A: { n: "Prep and Assembly", s: 8, e: 16.5, g: "wh", d: "prep", fixed: 8 },
        V: { n: "Receiving", s: 10.5, e: 18, g: "wh", d: "inbound" },
        D: { n: "Day", s: 6, e: 14.5, g: "wh", d: "" },
        N: { n: "Night load", s: 14, e: 22.5, g: "wh", d: "load" },
        S: { n: "Sat load", s: 7, e: 13, g: "wh", d: "" },
        R: { n: "Route (7a to completion)", s: 7, e: 17, g: "del" },
        L: { n: "Line-haul", s: 20, e: 30, g: "lh" }
      } : {
        D: { n: "Day", s: 6, e: 14.5, g: "wh", d: "" },
        M: { n: "Mid", s: 9, e: 17.5, g: "wh", d: "" },
        N: { n: "Night load", s: 14, e: 22.5, g: "wh", d: "load" },
        S: { n: "Sat load", s: 7, e: 13, g: "wh", d: "" },
        R: { n: "Route (7a to completion)", s: 7, e: 17, g: "del" },
        L: { n: "Line-haul", s: 20, e: 30, g: "lh" }
      },
      lunch: { mins: 30, minShift: 6, early: 3, late: 5, share: 33, leaderCap: 1 },
      whDays: [1, 1, 1, 1, 1, 0, 0],
      routeDays: [0, 1, 1, 1, 1, 1, 0],
      ot: { amber: 38, red: 40, dayMax: 11, maxDays: 5 },
      blackout: { from: "2026-11-22", to: "2026-12-05" },
      leaderEveryShift: true,
      hoursConfirmed: false,
      settingsVersion: 2
    };
  }

  /* ---------------- state ---------------- */
  const S = { ctx: null, db: null, dc: "redhills", week: "", tab: "sched", settings: null, team: null, wk: null, hist: [], filter: "all", saveT: null, cache: {} };

  /* ---------------- utils ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => (v === "" || v == null || isNaN(+v) ? null : +v);
  const ceil = (x) => Math.ceil(Math.round(x * 1000) / 1000);
  const r1 = (x) => Math.round(x * 100) / 100;
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function weekStart(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; } // Monday
  function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
  function dayDate(i) { return addDays(S.week, i); }
  function md(s) { const d = parseISO(s); return (d.getMonth() + 1) + "/" + d.getDate(); }
  function fmtT(h) { h = ((h % 24) + 24) % 24; let hh = Math.floor(h), mm = Math.round((h - hh) * 60); const ap = hh < 12 ? "a" : "p"; hh = hh % 12 || 12; return hh + ":" + String(mm).padStart(2, "0") + ap; }
  function fmtH(h) { return (Math.round(h * 100) / 100).toString(); }
  function toast(t) { document.querySelectorAll(".toast").forEach((x) => x.remove()); const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2200); }
  const dcName = (k) => (DCS.find((d) => d.k === k) || {}).n || k;
  const wkPath = (dc, w) => "dcWeeks/" + dc + "__" + w;

  /* ---------------- shifts ---------------- */
  function shiftOf(code, st) {
    st = st || S.settings;
    if (!code || code === "PTO") return null;
    if (code.startsWith("X:")) {
      const [a, b] = code.slice(2).split("-").map(Number);
      if (isNaN(a) || isNaN(b)) return null;
      return { code, n: "Custom", s: a, e: b > a ? b : b + 24, custom: true };
    }
    const t = st.tpl[code];
    return t ? { code, n: t.n, s: t.s, e: t.e, g: t.g } : null;
  }
  function paid(sh, st) {
    if (!sh) return 0;
    st = st || S.settings;
    const dur = sh.e - sh.s;
    return Math.max(0, dur - (dur >= st.lunch.minShift ? st.lunch.mins / 60 : 0));
  }
  const working = (code) => !!code && code !== "PTO";

  /* ---------------- roster mapping (Paylocity) ---------------- */
  function mapPaylocity(row, dc) {
    const g = (k) => { for (const key of Object.keys(row)) if (key.toLowerCase().includes(k)) return String(row[key] || "").trim(); return ""; };
    const first = g("first"), last = g("last"), p = g("position"), dep = g("department"), loc = g("location");
    if (!first && !last) return null;
    const leader = /Supervisor|Manager|Director|Assistant D|Management/.test(p) || /Management|Supervisor|Director/.test(dep);
    let dept = "flex", market = "", role = "";
    if (/CDL/.test(p)) dept = "linehaul";
    else if (/^2 -/.test(dep) || /Driver|Helper/.test(p)) {
      dept = "delivery";
      const mk = { Jax: "Jacksonville", Brunswick: "Brunswick", Columbus: "Columbus", Dothan: "Dothan", Macon: "Macon", "Panama City": "Panama City", Thomasville: "Thomasville" };
      for (const k in mk) if (p.includes(k)) market = mk[k];
      if (/Jacksonville/.test(loc)) market = "Jacksonville";
      if (dc !== "redhills") market = "Local";
      if (dc === "covington") { dept = "flex"; market = ""; }
    } else if (p === "Picker") dept = "pick";
    else if (/Loader|Loading/.test(p)) dept = "load";
    else if (/Receiving/.test(p)) dept = "inbound";
    else if (p === "Tech" || /^5 -/.test(dep)) dept = "shop";
    else if (/Inventory/.test(p)) dept = "inventory";
    else if (/Outbound/.test(p)) dept = "outbound";
    else if (dc === "redhills" && /Wrapper/.test(p)) dept = "rewrap";
    else if (dc === "redhills" && /Assembly/.test(p)) dept = "prep";
    else if (dc === "redhills" && /Recycl/.test(p)) dept = "recycle";
    role = /Driver/.test(p) ? "Driver" : /Helper/.test(p) ? "Helper" : "";
    if (dc !== "redhills" && p === "DeliveryWhse") role = "Driver";
    const supv = g("supervisor"), empKey = Object.keys(row).find((k) => /employee ?(id|#|number)|^emp|^id$/i.test(k));
    return { name: first + " " + last, rosterName: last + ", " + first, pdept: dep, sup: supv.split(",")[0].trim(), emp: empKey ? String(row[empKey]).trim() : "", pos: p, dept, market, role, leader, salaried: leader && /Manager|Director|Assistant D$|WarehouseManagement/.test(p), active: true, loc };
  }
  function locToDC(loc) {
    loc = String(loc || "").toLowerCase();
    if (loc.includes("red hills")) return "redhills";
    if (loc.includes("loxley")) return "loxley";
    if (loc.includes("kernersville")) return "kernersville";
    if (loc.includes("covington")) return "covington";
    return null;
  }

  /* ---------------- volume, forecast, need ---------------- */
  const VFIELDS = [
    { k: "stops", n: "Stops", hint: "routes x stops/route if blank" },
    { k: "inbound", n: "Inbound trailers" },
    { k: "pick", n: "Pieces to pick", hint: "next-day stops x pieces/stop if blank" },
    { k: "load", n: "Pieces to load", hint: "next-day stops x pieces/stop if blank" },
    { k: "returns", n: "Returns" },
    { k: "shop", n: "Shop repairs" }
  ];
  function wkVol(wk, i) { return (wk && wk.volume && wk.volume.days && wk.volume.days[i]) || {}; }
  function histAvg(key, i, market) {
    const vals = [];
    for (const h of S.hist) {
      const v = wkVol(h, i);
      const x = market ? num(v.routes && v.routes[market]) : num(v[key]);
      if (x != null) vals.push(x);
    }
    return vals.length ? r1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }
  // Effective volume for the week: entered -> 4-week average -> auto/0
  function effVolume(st, wk) {
    st = st || S.settings; wk = wk || S.wk;
    const out = [];
    for (let i = 0; i < 7; i++) {
      const v = wkVol(wk, i), o = { routes: {}, src: {} };
      let rt = 0, rtRemote = 0;
      for (const m of st.markets) {
        let x = num(v.routes && v.routes[m.n]), src = "entered";
        if (x == null) { x = wk === S.wk ? histAvg(null, i, m.n) : null; src = "avg"; }
        if (x == null) { x = 0; src = "none"; }
        if (!st.routeDays[i] && src !== "entered") { x = 0; src = "none"; }
        x = src === "avg" ? Math.round(x) : x;
        o.routes[m.n] = x; o.src["r:" + m.n] = src; rt += x; if (!m.local) rtRemote += x;
      }
      o.routesTotal = rt; o.routesRemote = rtRemote;
      const sx = num(v.stops);
      o.stops = sx != null ? sx : rt * st.std.stopsPerRoute; o.src.stops = sx != null ? "entered" : "auto";
      for (const k of ["inbound", "returns", "shop"]) {
        let x = num(v[k]), src = "entered";
        if (x == null) { x = wk === S.wk ? histAvg(k, i) : null; src = "avg"; }
        if (x == null) { x = 0; src = "none"; }
        if (!st.whDays[i] && src !== "entered") { x = 0; src = "none"; }
        o[k] = src === "avg" ? Math.round(x) : x; o.src[k] = src;
      }
      out.push(o);
    }
    const nextMon = num(wk && wk.volume && wk.volume.nextMon) || 0;
    for (let i = 0; i < 7; i++) {
      const o = out[i], v = wkVol(wk, i);
      // Saturday (5) loads next week's Monday; Sunday night (6) line-hauls next Monday's boxes
      const nxtStops = i < 6 ? out[i + 1].stops + (i === 5 ? nextMon * st.std.stopsPerRoute : 0) : 0;
      const nxtRoutes = i < 6 ? out[i + 1].routesTotal + (i === 5 ? nextMon : 0) : 0;
      const nxtRemote = i < 6 ? out[i + 1].routesRemote : nextMon;
      o.nextStops = nxtStops; o.nextRoutes = nxtRoutes; o.nextRemote = nxtRemote;
      o.whActive = !!st.whDays[i] || (i === 5 && nextMon > 0);
      for (const k of ["pick", "load"]) {
        const x = num(v[k]);
        if (x != null) { o[k] = x; o.src[k] = "entered"; }
        else { o[k] = o.whActive ? nxtStops * st.std.piecesPerStop : 0; o.src[k] = "auto"; }
      }
    }
    out.nextMon = nextMon;
    return out;
  }
  function needs(st, vol) {
    st = st || S.settings; vol = vol || effVolume(st);
    const sd = st.std, ph = sd.prodHrs;
    return vol.map((o, i) => {
      const wa = o.whActive || ["inbound", "returns", "shop", "pick", "load"].some((k) => o.src[k] === "entered" && o[k] > 0);
      const n = {
        inbound: ceil((o.inbound * sd.inboundHrsPerTrailer) / ph),
        pick: ceil(o.pick / (sd.pickPPH * ph)),
        load: ceil(o.load / (sd.loadPPH * ph)),
        outbound: wa ? ceil(o.nextRoutes / sd.routesPerOutbound) : 0,
        returns: ceil(o.returns / (sd.returnsPerHr * ph)),
        inventory: wa && st.whDays[i] ? sd.inventoryFixed : 0,
        shop: ceil(o.shop / (sd.shopPerHr * ph)),
        delivery: {}, delTotal: 0, linehaul: 0
      };
      if (st.hasDelivery) {
        for (const m of st.markets) {
          const x = ceil(o.routes[m.n] * sd.crew * (1 + (m.buf || 0) / 100));
          n.delivery[m.n] = x; n.delTotal += x;
        }
      }
      if (st.hasLinehaul) n.linehaul = ceil(o.nextRemote / sd.boxesPerRun);
      for (const k of WH_NEED) {
        if (n[k] == null) n[k] = 0;
        const fx = fixedFor(st, k);
        if (fx && st.whDays[i] && wa) n[k] = Math.max(n[k], fx);
      }
      n.whTotal = WH_NEED.reduce((a, k) => a + n[k], 0);
      return n;
    });
  }

  /* ---------------- schedule math ---------------- */
  /* ---------------- lunches ----------------
     Each warehouse/shop shift long enough for a lunch gets a start time in 15-minute steps,
     between `early` and `late` hours into the shift. Within a position only `share`% can be at
     lunch at once (at least 1), and only `leaderCap` leaders at once. Drivers and line-haul take
     lunch on the road, so they are not scheduled. A lunch set by hand is locked. */
  function lunchKey(p, dept) { return p.leader ? "__leaders" : dept; }
  function lunchEligible(p, cell, st) {
    if (!working(cell.code)) return null;
    const sh = shiftOf(cell.code, st); if (!sh || sh.e - sh.s < st.lunch.minShift) return null;
    const dept = cell.dept || p.dept, g = DEPT[dept] ? DEPT[dept].g : "wh";
    if (g === "del" || g === "lh") return null;
    return { sh, dept, key: lunchKey(p, dept) };
  }
  function lunchGroups(st, wk, team, i) {
    const groups = {};
    for (const p of team.people) {
      if (!p.active) continue;
      const cell = cellOf(p.id, i, wk), x = lunchEligible(p, cell, st); if (!x) continue;
      (groups[x.key] = groups[x.key] || []).push({ p, sh: x.sh, r: wk.sched[p.id] });
    }
    return groups;
  }
  const lunchCap = (st, key, n) => (key === "__leaders" ? Math.max(1, +st.lunch.leaderCap || 1) : Math.max(1, Math.floor((n * (+st.lunch.share || 33)) / 100)));
  function planLunches(st, wk, team) {
    st = st || S.settings; wk = wk || S.wk; team = team || S.team;
    const L = st.lunch.mins / 60, ticks = Math.round(L * 4);
    for (const id in wk.sched) { const r = wk.sched[id]; r.lunch = r.lunch || [null, null, null, null, null, null, null]; r.lunchLock = r.lunchLock || [false, false, false, false, false, false, false]; }
    for (let i = 0; i < 7; i++) {
      // clear lunches on days that no longer qualify
      for (const p of team.people) { const r = wk.sched[p.id]; if (r && !lunchEligible(p, cellOf(p.id, i, wk), st)) { r.lunch[i] = null; r.lunchLock[i] = false; } }
      const groups = lunchGroups(st, wk, team, i);
      for (const key in groups) {
        const list = groups[key], cap = lunchCap(st, key, list.length), occ = {};
        const mark = (t) => { for (let k = 0; k < ticks; k++) { const q = Math.round(t * 4) + k; occ[q] = (occ[q] || 0) + 1; } };
        const load = (t) => { let mx = 0; for (let k = 0; k < ticks; k++) mx = Math.max(mx, occ[Math.round(t * 4) + k] || 0); return mx; };
        const free = [];
        for (const x of list) {
          const inShift = x.r.lunch[i] != null && x.r.lunch[i] >= x.sh.s && x.r.lunch[i] + L <= x.sh.e;
          if (x.r.lunchLock[i] && inShift) mark(x.r.lunch[i]); else { x.r.lunchLock[i] = false; free.push(x); }
        }
        const win = (x) => { const a = x.sh.s + st.lunch.early, b = Math.max(a, Math.min(x.sh.s + st.lunch.late, x.sh.e - L - 0.5)); return [a, b]; };
        free.sort((a, b) => win(a)[1] - win(b)[1] || a.sh.s - b.sh.s || a.p.name.localeCompare(b.p.name));
        for (const x of free) {
          const [a, b] = win(x); let best = null, bestLoad = 1e9;
          for (let t = a; t <= b + 0.001; t += 0.25) {
            const ld = load(t);
            if (ld < cap) { best = t; break; }
            if (ld < bestLoad) { bestLoad = ld; best = t; }
          }
          if (best == null) best = a;
          x.r.lunch[i] = Math.round(best * 4) / 4; mark(x.r.lunch[i]);
        }
      }
    }
  }
  // most people out at once per position, for the lunch board and flags
  function lunchReport(st, wk, team, i) {
    const L = st.lunch.mins / 60, out = [];
    const groups = lunchGroups(st, wk, team, i);
    for (const key in groups) {
      const list = groups[key], cap = lunchCap(st, key, list.length), occ = {}, times = {};
      for (const x of list) {
        const t = x.r && x.r.lunch ? x.r.lunch[i] : null; if (t == null) continue;
        times[t] = (times[t] || 0) + 1;
        for (let k = 0; k < Math.round(L * 4); k++) { const q = Math.round(t * 4) + k; occ[q] = (occ[q] || 0) + 1; }
      }
      const peak = Math.max(0, ...Object.values(occ));
      out.push({ key, name: key === "__leaders" ? "Leaders" : DEPT[key] ? DEPT[key].n : key, n: list.length, cap, peak, times: Object.keys(times).map(Number).sort((a, b) => a - b).map((t) => ({ t, c: times[t] })), missing: list.filter((x) => !x.r || !x.r.lunch || x.r.lunch[i] == null).length });
    }
    out.sort((a, b) => (a.key === "__leaders") - (b.key === "__leaders") || WH_NEED.indexOf(a.key) - WH_NEED.indexOf(b.key));
    return out;
  }
  function cellOf(id, i, wk) { wk = wk || S.wk; const r = wk.sched && wk.sched[id]; return { code: (r && r.days && r.days[i]) || "", dept: (r && r.dpt && r.dpt[i]) || "" }; }
  function personHours(p, st, wk) {
    st = st || S.settings; wk = wk || S.wk;
    let h = 0, days = 0, maxDay = 0;
    for (let i = 0; i < 7; i++) { const c = cellOf(p.id, i, wk).code; if (working(c)) { const x = paid(shiftOf(c, st), st); h += x; days++; maxDay = Math.max(maxDay, x); } }
    return { h: r1(h), days, maxDay };
  }
  function counts(st, wk, team) {
    st = st || S.settings; wk = wk || S.wk; team = team || S.team;
    const out = [];
    for (let i = 0; i < 7; i++) {
      const c = { flex: 0, delivery: {}, delTotal: 0, linehaul: 0, shop: 0, leaders: [] };
      WH_NEED.forEach((k) => (c[k] = 0));
      for (const p of team.people) {
        if (!p.active) continue;
        const cell = cellOf(p.id, i, wk);
        if (!working(cell.code)) continue;
        if (p.leader) { c.leaders.push({ p, sh: shiftOf(cell.code, st) }); continue; }
        const d = cell.dept || p.dept;
        if (d === "delivery") { const m = p.market || (st.markets[0] || {}).n; c.delivery[m] = (c.delivery[m] || 0) + 1; c.delTotal++; }
        else if (d === "linehaul") c.linehaul++;
        else if (d === "shop") c.shop++;
        else if (d === "flex") c.flex++;
        else if (c[d] != null) c[d]++;
      }
      c.whTotal = WH_NEED.reduce((a, k) => a + c[k], 0) + c.flex;
      out.push(c);
    }
    return out;
  }
  function analyze(st, wk, team) {
    st = st || S.settings; wk = wk || S.wk; team = team || S.team;
    const isCur = wk === S.wk;
    const vol = effVolume(st, wk), nd = needs(st, vol), ct = counts(st, wk, team);
    const flags = [];
    const add = (lvl, txt, who) => flags.push({ lvl, txt, who });
    let totalH = 0, otH = 0, amber = 0, red = 0;
    const ph = {};
    for (const p of team.people) {
      if (!p.active) continue;
      const x = personHours(p, st, wk); ph[p.id] = x; totalH += x.h;
      if (p.salaried) { /* salaried: no OT flags */ }
      else if (x.h > st.ot.red) { red++; otH += x.h - 40; add("bad", `${p.name}: ${fmtH(x.h)} hrs, ${fmtH(r1(x.h - 40))} OT`, p.id); }
      else if (x.h >= st.ot.amber) { amber++; add("warn", `${p.name}: ${fmtH(x.h)} hrs, close to OT`, p.id); }
      if (x.maxDay > st.ot.dayMax) add("warn", `${p.name}: a ${fmtH(x.maxDay)} hr day (over ${st.ot.dayMax})`, p.id);
      if (x.days > st.ot.maxDays) add("bad", `${p.name}: ${x.days} days scheduled, needs 2 days off`, p.id);
      for (let i = 0; i < 7; i++) {
        if (cellOf(p.id, i, wk).code === "PTO" && st.blackout && st.blackout.from && dayDate2(wk, i) >= st.blackout.from && dayDate2(wk, i) <= st.blackout.to)
          add("bad", `${p.name}: PTO on ${DAYS[i]} ${md(dayDate2(wk, i))} is inside the Black Friday blackout`, p.id);
      }
    }
    let gaps = 0, ldrGaps = 0;
    for (let i = 0; i < 7; i++) {
      const n = nd[i], c = ct[i];
      // warehouse: flex covers any warehouse department
      let flexLeft = c.flex, whShort = [];
      for (const k of WH_NEED) {
        const s = Math.max(0, n[k] - c[k]); const use = Math.min(s, flexLeft); flexLeft -= use;
        if (s - use > 0) whShort.push(`${DEPT[k].n} ${s - use}`);
      }
      if (whShort.length) { gaps += whShort.length; add("bad", `${DAYS[i]} warehouse short: ${whShort.join(", ")}`); }
      if (n.shop > c.shop) { gaps++; add("bad", `${DAYS[i]} shop short ${n.shop - c.shop}`); }
      if (st.hasDelivery) for (const m of st.markets) {
        const need = n.delivery[m.n] || 0, have = c.delivery[m.n] || 0;
        if (need > have) { gaps++; add("bad", `${DAYS[i]} ${m.n} delivery short ${need - have} (need ${need}${m.buf ? " incl " + m.buf + "% callout buffer" : ""}, have ${have})`); }
      }
      if (st.hasLinehaul && n.linehaul > c.linehaul) { gaps++; add("bad", `${DAYS[i]} night line-haul short ${n.linehaul - c.linehaul} (need ${n.linehaul})`); }
      if (st.hasDelivery && vol[i].routesTotal > st.trucks && st.trucks) add("warn", `${DAYS[i]}: ${vol[i].routesTotal} routes but only ${st.trucks} trucks`);
      // leader on every warehouse shift
      if (st.leaderEveryShift) {
        const shifts = {};
        for (const p of team.people) {
          if (!p.active || p.leader) continue;
          const cell = cellOf(p.id, i, wk); const d = cell.dept || p.dept;
          if (!working(cell.code) || DEPT[d] == null || (DEPT[d].g !== "wh" && DEPT[d].g !== "shop")) continue;
          const sh = shiftOf(cell.code, st); if (sh) shifts[cell.code] = sh;
        }
        for (const code in shifts) {
          const sh = shifts[code];
          const ok = c.leaders.some((l) => l.sh && Math.min(l.sh.e, sh.e) - Math.max(l.sh.s, sh.s) >= Math.min(4, (sh.e - sh.s) / 2));
          if (!ok) { ldrGaps++; add("bad", `${DAYS[i]} ${sh.n} (${fmtT(sh.s)} to ${fmtT(sh.e)}) has no leader on it`); }
        }
      }
    }
    for (let i = 0; i < 7; i++) for (const g of lunchReport(st, wk, team, i)) {
      if (g.peak > g.cap) add("warn", `${DAYS[i]} ${g.name}: ${g.peak} at lunch at once (limit ${g.cap}). Shift times leave no room to stagger.`);
      if (g.missing) add("warn", `${DAYS[i]} ${g.name}: ${g.missing} without a lunch time`);
    }
    // roll up "close to OT" warnings into one line so real problems stand out
    const near = flags.filter((f) => f.lvl === "warn" && / close to OT$/.test(f.txt));
    if (near.length > 3) {
      const names = near.map((f) => f.txt.split(":")[0]);
      for (const f of near) flags.splice(flags.indexOf(f), 1);
      add("warn", `${near.length} people at ${st.ot.amber} to ${st.ot.red} hrs (no room for a pickup shift): ${names.slice(0, 8).join(", ")}${names.length > 8 ? ` and ${names.length - 8} more` : ""}`);
    }
    if (vol.nextMon > 0 && ct[5].whTotal === 0) add("bad", `Routes run next Monday (${vol.nextMon}). Saturday needs a warehouse load crew.`);
    const mon = vol[0];
    if (isCur && mon.routesTotal > 0) add("info", `Monday has ${mon.routesTotal} routes. Those load the Saturday before, so check last week's Saturday crew.`);
    const rank = { bad: 0, warn: 1, info: 2 };
    flags.sort((a, b) => rank[a.lvl] - rank[b.lvl]);
    return { vol, nd, ct, flags, totalH: r1(totalH), otH: r1(otH), amber, red, gaps, ldrGaps, ph };
  }
  function dayDate2(wk, i) { return addDays(wk.week, i); }

  /* ---------------- auto fill ---------------- */
  function autoFill() {
    const st = S.settings, wk = S.wk, team = S.team.people.filter((p) => p.active);
    wk.sched = wk.sched || {};
    const A = analyze();
    const hrs = {}, days = {};
    team.forEach((p) => { const x = personHours(p); hrs[p.id] = x.h; days[p.id] = x.days; });
    const ensure = (id) => (wk.sched[id] = wk.sched[id] || { days: ["", "", "", "", "", "", ""], dpt: ["", "", "", "", "", "", ""] });
    const free = (p, i, code) => {
      const c = cellOf(p.id, i).code; if (c) return false; const rr = wk.sched[p.id]; if (rr && rr.lock && rr.lock[i]) return false;
      const h = paid(shiftOf(code)); return (p.salaried || hrs[p.id] + h <= st.ot.red + 0.01) && days[p.id] < st.ot.maxDays;
    };
    const put = (p, i, code, dept) => {
      const r = ensure(p.id); r.days[i] = code; r.dpt = r.dpt || ["", "", "", "", "", "", ""]; r.dpt[i] = dept && dept !== p.dept ? dept : "";
      hrs[p.id] += paid(shiftOf(code)); days[p.id]++; added++;
    };
    let added = 0;
    const pick = (list) => list.sort((a, b) => hrs[a.id] - hrs[b.id] || a.name.localeCompare(b.name))[0];
    for (let i = 0; i < 7; i++) {
      const n = A.nd[i], c = counts()[i];
      const satLoad = i === 5 && !st.whDays[5];
      const whCode = (dept) => {
        if (satLoad && st.tpl.S) return "S";
        const own = deptTpls(st, dept); if (own.length) return own[0][0];
        return dept === "load" && st.useNightLoad && st.tpl.N ? "N" : st.tpl.D ? "D" : Object.keys(st.tpl)[0];
      };
      const onCode = (k, code) => team.filter((x) => !x.leader && (cellOf(x.id, i).dept || x.dept) === k && cellOf(x.id, i).code === code).length;
      const fillOne = (k, code) => {
        let p = pick(team.filter((x) => !x.leader && x.dept === k && free(x, i, code)));
        if (!p) p = pick(team.filter((x) => !x.leader && x.dept === "flex" && free(x, i, code)));
        if (p) put(p, i, code, k);
        return !!p;
      };
      // warehouse departments: fixed shifts first (e.g. Recycle AM 2, PM 2), then volume need; home dept first, then flex
      for (const k of WH_NEED) {
        if (!satLoad) for (const [code, t] of deptTpls(st, k)) {
          let g = (+t.fixed || 0) - onCode(k, code);
          if (n[k] <= 0) g = 0;
          while (g > 0 && fillOne(k, code)) g--;
        }
        let gap = n[k] - counts()[i][k];
        while (gap > 0 && fillOne(k, whCode(k))) gap--;
      }
      // shop
      let g = n.shop - c.shop;
      while (g > 0) { const p = pick(team.filter((x) => !x.leader && x.dept === "shop" && free(x, i, "D"))); if (!p) break; put(p, i, "D"); g--; }
      // leaders work their regular week on warehouse days (Saturday handled by coverage below)
      if (A.vol[i].whActive && st.whDays[i]) {
        for (const l of team.filter((x) => x.leader && DEPT[x.dept] && (DEPT[x.dept].g === "wh" || DEPT[x.dept].g === "shop"))) {
          const code = l.shift && shiftOf(l.shift) ? l.shift : whCode(l.dept);
          if (free(l, i, code)) put(l, i, code);
        }
      }
      // leaders: one on every warehouse shift in use
      const used = {};
      for (const p of team) {
        if (p.leader) continue; const cell = cellOf(p.id, i); const d = cell.dept || p.dept;
        if (working(cell.code) && DEPT[d] && (DEPT[d].g === "wh" || DEPT[d].g === "shop")) used[cell.code] = true;
      }
      for (const code in used) {
        const sh = shiftOf(code);
        const covered = team.some((l) => { if (!l.leader) return false; const s2 = shiftOf(cellOf(l.id, i).code); return s2 && Math.min(s2.e, sh.e) - Math.max(s2.s, sh.s) >= Math.min(4, (sh.e - sh.s) / 2); });
        if (covered) continue;
        const ldrs = team.filter((l) => l.leader && DEPT[l.dept] && (DEPT[l.dept].g === "wh" || DEPT[l.dept].g === "shop") && free(l, i, code));
        const pref = ldrs.filter((l) => (code === "N" ? l.dept === "load" || l.dept === "outbound" : l.dept !== "load"));
        const p = pick(pref.length ? pref : ldrs);
        if (p) put(p, i, code);
      }
      // delivery leader on route days
      if (st.hasDelivery && (n.delTotal > 0)) {
        for (const l of team.filter((x) => x.leader && x.dept === "delivery")) if (free(l, i, "R")) put(l, i, "R");
      }
    }
    // delivery and line-haul: round-robin one slot per day at a time so short staff spreads evenly across the week
    const C2 = () => counts();
    if (st.hasDelivery) for (const m of st.markets) {
      const mk = (x) => (x.market || st.markets[0].n) === m.n;
      let progress = true;
      while (progress) {
        progress = false; const ct = C2();
        const order = [0, 1, 2, 3, 4, 5, 6].sort((x, y) => ((A.nd[y].delivery[m.n] || 0) - (ct[y].delivery[m.n] || 0)) - ((A.nd[x].delivery[m.n] || 0) - (ct[x].delivery[m.n] || 0)));
        for (const i of order) {
          if ((A.nd[i].delivery[m.n] || 0) - (C2()[i].delivery[m.n] || 0) <= 0) continue;
          const pool = team.filter((x) => !x.leader && x.dept === "delivery" && mk(x) && free(x, i, "R"));
          const drivers = pool.filter((x) => x.role === "Driver"), helpers = pool.filter((x) => x.role !== "Driver");
          const on = team.filter((x) => x.dept === "delivery" && !x.leader && mk(x) && working(cellOf(x.id, i).code));
          const haveD = on.filter((x) => x.role === "Driver").length, haveH = on.length - haveD;
          const p = haveD <= haveH ? pick(drivers) || pick(helpers) : pick(helpers) || pick(drivers);
          if (p) { put(p, i, "R"); progress = true; }
        }
      }
    }
    if (st.hasLinehaul) {
      let progress = true;
      while (progress) {
        progress = false;
        for (let i = 0; i < 7; i++) {
          if (A.nd[i].linehaul - C2()[i].linehaul <= 0) continue;
          const p = pick(team.filter((x) => !x.leader && x.dept === "linehaul" && free(x, i, "L")));
          if (p) { put(p, i, "L"); progress = true; }
        }
      }
    }
    return added;
  }

  /* ---------------- DC Field App link (dcschedule/{dcCode}_{weekStart}); weekStart is the Monday, days[] Monday first ---------------- */
  // Job keys the DC Field App PPH tracker understands. Other teams go out with job "".
  const FIELD_JOB = { pick: "pick", inbound: "put", rewrap: "rewrap", returns: "disp", shop: "repair" };
  const hhmm = (h) => { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0"); };
  function fieldDoc(posted) {
    const st = S.settings, wk = S.wk, people = [];
    for (const p of S.team.people) {
      if (!p.active) continue;
      const r = wk.sched[p.id];
      if (!r || !r.days || !r.days.some(Boolean)) continue;
      const days = r.days.map((c, i) => {
        if (!c) return { off: true };
        if (c === "PTO") return { pto: true };
        const sh = shiftOf(c); if (!sh) return { off: true };
        const dept = (r.dpt && r.dpt[i]) || p.dept, dur = sh.e - sh.s;
        const o = { start: hhmm(sh.s), end: hhmm(sh.e), lunch: dur >= st.lunch.minShift ? st.lunch.mins / 60 : 0, job: p.leader ? "" : FIELD_JOB[dept] || "" };
        if (sh.e > 24) o.nextDay = true; // ends after midnight (line-haul)
        if (r.lunch && r.lunch[i] != null) o.lunchStart = hhmm(r.lunch[i]);
        return o;
      });
      people.push({ name: p.rosterName || p.name, emp: p.emp || "", dept: p.pdept || "", sup: p.sup || "", job: p.leader ? "" : FIELD_JOB[p.dept] || "", team: DEPT[p.dept] ? DEPT[p.dept].n : p.dept, leader: !!p.leader, days });
    }
    return { dc: DC_NUM[S.dc], week: wk.week, weekStartsOn: "Mon", posted: !!posted, updatedAt: new Date().toISOString(), updatedBy: S.ctx.user.email, people };
  }
  async function syncField(posted) {
    try {
      await S.db.set("dcschedule/" + DC_NUM[S.dc] + "_" + S.wk.week, fieldDoc(posted));
      S.wk.fieldSyncAt = new Date().toISOString();
      return true;
    } catch (e) { toast("Saved here, but the DC Field App copy did not update: " + e.message); return false; }
  }

  /* ---------------- data load/save ---------------- */
  async function loadDC() {
    const db = S.db, dc = S.dc;
    S.settings = (await db.get("dcSettings/" + dc)) || null;
    if (!S.settings) { S.settings = defaultSettings(dc); if (S.ctx.role === "admin") await db.set("dcSettings/" + dc, S.settings); }
    S.settings = Object.assign(defaultSettings(dc), S.settings); S.settings.lunch = Object.assign({}, defaultSettings(dc).lunch, S.settings.lunch || {});
    S.team = (await db.get("dcTeams/" + dc)) || null;
    if (!S.team) {
      const seed = ((window.DC_SEED_ROSTER || {})[dc] || []).map((p) => Object.assign({}, p));
      S.team = { dc, people: seed, leaderEmails: [], source: "Paylocity Active Roster (Oct 2026)" };
      await db.set("dcTeams/" + dc, S.team);
    }
    await loadWeek();
  }
  async function loadWeek() {
    S.wk = (await S.db.get(wkPath(S.dc, S.week))) || { dc: S.dc, week: S.week, volume: { days: [{}, {}, {}, {}, {}, {}, {}], nextMon: "" }, sched: {}, posted: false };
    S.wk.volume = S.wk.volume || { days: [{}, {}, {}, {}, {}, {}, {}] };
    S.wk.volume.days = S.wk.volume.days || [{}, {}, {}, {}, {}, {}, {}];
    S.wk.sched = S.wk.sched || {};
    S.hist = [];
    for (let k = 1; k <= 4; k++) { const h = await S.db.get(wkPath(S.dc, addDays(S.week, -7 * k))); if (h) S.hist.push(h); }
  }
  function touch() {
    try { planLunches(); } catch (e) { console.error(e); }
    S.wk.updatedAt = new Date().toISOString(); S.wk.updatedBy = S.ctx.user.email;
    if (S.wk.posted) S.wk.changedSincePost = true;
    clearTimeout(S.saveT);
    S.saveT = setTimeout(async () => {
      try { if (!S.wk.posted) await syncField(false); await S.db.set(wkPath(S.dc, S.week), S.wk); }
      catch (e) { toast("Save failed: " + e.message); }
    }, 600);
  }
  async function saveTeam() { await S.db.set("dcTeams/" + S.dc, S.team); }
  async function saveSettings() { await S.db.set("dcSettings/" + S.dc, S.settings); }
  const isAdmin = () => S.ctx.role === "admin";
  const canPost = () => isAdmin() || C.openPosting || (S.team.leaderEmails || []).map((x) => x.toLowerCase()).includes(S.ctx.user.email);

  /* ---------------- demo seed ---------------- */
  async function seedDemo() {
    const sd = await S.db.get("demo/seeded");
    if (sd && sd.v === 4) return;
    for (const d of DCS) {
      await S.db.set("dcSettings/" + d.k, defaultSettings(d.k));
      await S.db.set("dcTeams/" + d.k, { dc: d.k, people: ((window.DC_SEED_ROSTER || {})[d.k] || []).map((p) => Object.assign({}, p)), leaderEmails: [], source: "Paylocity Active Roster (Oct 2026)" });
    }
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const base = {
      redhills: { routes: { Jacksonville: 8, Brunswick: 1, Columbus: 3, Macon: 1, Dothan: 2, "Panama City": 2, Thomasville: 4 }, inbound: 8, returns: 18, shop: 10 },
      loxley: { routes: { Local: 8 }, inbound: 3, returns: 6, shop: 4 },
      kernersville: { routes: { Local: 4 }, inbound: 2, returns: 4, shop: 3 },
      covington: { routes: { "3PL": 11 }, inbound: 5, returns: 8, shop: 9 }
    };
    const thisMon = iso(weekStart(new Date())); // this week's Monday
    for (const d of DCS) {
      const st = defaultSettings(d.k);
      for (let k = 1; k <= 5; k++) {
        const w = addDays(thisMon, -7 * (k - 1)); // this week and 4 back become history for next week
        const b = base[d.k];
        const days = [];
        for (let i = 0; i < 7; i++) {
          const o = {};
          if (st.routeDays[i]) { o.routes = {}; for (const m in b.routes) o.routes[m] = Math.max(0, b.routes[m] + Math.round((rnd() - 0.5) * 2)); }
          if (st.whDays[i]) { o.inbound = Math.max(0, b.inbound + Math.round((rnd() - 0.5) * 3)); o.returns = Math.max(0, b.returns + Math.round((rnd() - 0.5) * 6)); o.shop = Math.max(0, b.shop + Math.round((rnd() - 0.5) * 4)); }
          days.push(o);
        }
        await S.db.set(wkPath(d.k, w), { dc: d.k, week: w, volume: { days, nextMon: "" }, sched: {}, posted: k > 1, postedBy: "demo", demoHistory: true });
      }
    }
    await S.db.set("demo/seeded", { v: 4, at: new Date().toISOString() });
  }

  /* ---------------- shell ---------------- */
  function weekOptions() {
    const cur = weekStart(new Date()); const out = [];
    for (let k = -4; k <= 10; k++) { const d = new Date(cur); d.setDate(d.getDate() + 7 * k); const s = iso(d); out.push({ s, label: "Week of " + md(s) + "/" + String(d.getFullYear()).slice(2) + (k === 0 ? " (this week)" : k === 1 ? " (next week)" : "") }); }
    return out;
  }
  function shell() {
    const u = S.ctx.user;
    $("#app").innerHTML = `
      <div class="top"><div class="top-in">
        <div class="brand"><b>1915 SOUTH</b><span>DC Smart Scheduler</span></div>
        <select id="dcSel" aria-label="Distribution center">${DCS.map((d) => `<option value="${d.k}" ${d.k === S.dc ? "selected" : ""}>${d.n} (${d.num})</option>`).join("")}</select>
        <select id="wkSel" aria-label="Week">${weekOptions().map((w) => `<option value="${w.s}" ${w.s === S.week ? "selected" : ""}>${w.label}</option>`).join("")}</select>
        <div class="who">${S.ctx.demo ? '<span class="demo-tag">DEMO</span>' : ""}<span>${esc(u.email)}</span>${S.ctx.demo ? "" : '<button class="btn sm" id="outBtn">Sign out</button>'}</div>
      </div>
      <nav class="tabs">${[["sched", "Schedule"], ["vol", "Volume & Need"], ["team", "Team"], ["set", "Settings"], ["all", "All DCs"]].map(([k, n]) => `<button data-tab="${k}" class="${S.tab === k ? "on" : ""}">${n}</button>`).join("")}</nav></div>
      <main id="main"></main>`;
    $("#dcSel").onchange = async (e) => { S.dc = e.target.value; await loadDC(); render(); };
    $("#wkSel").onchange = async (e) => { S.week = e.target.value; await loadWeek(); render(); };
    document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b)); render(); }));
    const ob = $("#outBtn"); if (ob) ob.onclick = () => window.DCSignOut && window.DCSignOut();
  }
  function render() {
    const m = $("#main");
    ({ sched: renderSched, vol: renderVol, team: renderTeam, set: renderSettings, all: renderAll })[S.tab](m);
  }

  /* ---------------- schedule tab ---------------- */
  function cellClass(code) {
    if (!code) return "";
    if (code === "PTO") return "pto";
    const sh = shiftOf(code); if (!sh) return "";
    if (code === "N") return "n";
    if (sh.g === "del") return "r";
    if (sh.g === "lh") return "l";
    return "w";
  }
  function groupKey(p) { return p.dept === "delivery" ? "delivery:" + (p.market || "") : p.dept; }
  function renderSched(m) {
    const st = S.settings, A = analyze(), dcn = dcName(S.dc);
    const people = S.team.people.filter((p) => p.active);
    const fl = S.filter;
    const order = DEPTS.map((d) => d.k);
    const groups = {};
    for (const p of people) {
      const g = DEPT[p.dept] ? DEPT[p.dept].g : "wh";
      if (fl !== "all" && g !== fl) continue;
      (groups[groupKey(p)] = groups[groupKey(p)] || []).push(p);
    }
    const mkOrder = st.markets.map((x) => x.n);
    const gkeys = Object.keys(groups).sort((a, b) => {
      const [da, ma] = a.split(":"), [db, mb] = b.split(":");
      return order.indexOf(da) - order.indexOf(db) || mkOrder.indexOf(ma) - mkOrder.indexOf(mb);
    });
    const posted = S.wk.posted, changed = S.wk.changedSincePost;
    const bar = posted
      ? `<div class="posted-bar ${changed ? "changed" : ""}">${changed ? "Posted, then changed. Re-post so the team sees the latest." : "Posted"} ${S.wk.postedAt ? "· " + new Date(S.wk.postedAt).toLocaleString() : ""} ${S.wk.postedBy ? "by " + esc(S.wk.postedBy) : ""}${S.wk.postReason ? ` · Note: ${esc(S.wk.postReason)}` : ""}${S.wk.fieldSyncAt ? ` · In DC Field App` : ""}<span class="spacer"></span>${canPost() ? `<button class="btn sm ${changed ? "accent" : ""}" id="postBtn">${changed ? "Re-post week" : "Post again"}</button>` : ""}</div>`
      : `<div class="posted-bar draft">Draft. Not posted yet.<span class="spacer"></span>${canPost() ? `<button class="btn primary sm" id="postBtn">Post week</button>` : `<span class="muted">Only this DC's leaders can post</span>`}</div>`;
    const hrsCls = (h) => (h > st.ot.red ? "bad" : h >= st.ot.amber ? "warn" : "");
    const flagIds = new Set(A.flags.filter((f) => f.who && f.lvl === "bad").map((f) => f.who));
    const needCell = (need, have) => {
      if (!need && !have) return `<td class="needcell zero">0</td>`;
      const cls = have < need ? "short" : have > need ? "over" : "ok";
      return `<td class="needcell ${cls}" title="scheduled / needed">${have}/${need}</td>`;
    };
    let rows = "";
    let lastG = "";
    for (const gk of gkeys) {
      const [dk, mk] = gk.split(":");
      const g = DEPT[dk] ? DEPT[dk].g : "wh";
      if (g !== lastG) { rows += `<tr class="grp"><td class="sticky-col" colspan="1">${GROUPS[g]}</td><td colspan="9"></td></tr>`; lastG = g; }
      const label = dk === "delivery" ? `Delivery · ${mk || "Leader"}` : DEPT[dk] ? DEPT[dk].n : dk;
      rows += `<tr class="grp" style="opacity:.85"><td class="sticky-col" style="text-transform:none;letter-spacing:0">${esc(label)} <span class="muted">(${groups[gk].length})</span></td><td colspan="9"></td></tr>`;
      for (const p of groups[gk].sort((a, b) => (b.leader - a.leader) || a.name.localeCompare(b.name))) {
        const x = A.ph[p.id] || { h: 0, days: 0 };
        rows += `<tr><td class="sticky-col"><button class="namebtn" data-person="${p.id}" ${canPost() ? "" : "disabled"}><span class="pname">${esc(p.name)}${p.leader ? '<span class="ldr">LDR</span>' : ""}${p.salaried ? '<span class="ldr" style="background:var(--blue)">SAL</span>' : ""}</span></button><div class="pmeta">${esc(p.role || p.pos || "")}</div></td>`;
        for (let i = 0; i < 7; i++) {
          const c = cellOf(p.id, i), sh = shiftOf(c.code);
          const closed = !st.whDays[i] && !st.routeDays[i] && !(st.hasLinehaul && dk === "linehaul");
          rows += `<td class="cell daycol ${closed && !c.code ? "closed" : ""}"><button class="cellbtn ${cellClass(c.code)} ${flagIds.has(p.id) && c.code ? "flag" : ""} ${S.wk.sched[p.id] && S.wk.sched[p.id].lock && S.wk.sched[p.id].lock[i] ? "set" : ""}" data-p="${p.id}" data-d="${i}" ${canPost() ? "" : "disabled"}>
            ${c.code ? `<span class="c">${c.code === "PTO" ? "PTO" : sh && sh.custom ? "X" : esc(c.code)}</span>${sh ? `<span class="t">${fmtT(sh.s)}-${fmtT(sh.e)}</span>` : ""}${(() => { const r = S.wk.sched[p.id]; const lt = r && r.lunch ? r.lunch[i] : null; return lt != null && working(c.code) ? `<span class="t lunch">L ${fmtT(lt)}${r.lunchLock && r.lunchLock[i] ? " *" : ""}</span>` : ""; })()}${c.dept ? `<span class="dp">${esc(DEPT[c.dept] ? DEPT[c.dept].n : c.dept)}</span>` : ""}` : `<span class="muted">+</span>`}</button></td>`;
        }
        rows += `<td class="num"><span class="hrs ${hrsCls(x.h)}">${fmtH(x.h)}</span></td><td class="num">${x.days}</td></tr>`;
      }
      // need row for the department
      if (WH_NEED.includes(dk)) rows += `<tr class="need"><td class="sticky-col muted">${DEPT[dk].n} sched/need</td>${A.nd.map((n, i) => needCell(n[dk], A.ct[i][dk])).join("")}<td></td><td></td></tr>`;
      if (dk === "flex") rows += `<tr class="need"><td class="sticky-col muted">Warehouse total sched/need</td>${A.nd.map((n, i) => needCell(n.whTotal, A.ct[i].whTotal)).join("")}<td></td><td></td></tr>`;
      if (dk === "shop") rows += `<tr class="need"><td class="sticky-col muted">Shop sched/need</td>${A.nd.map((n, i) => needCell(n.shop, A.ct[i].shop)).join("")}<td></td><td></td></tr>`;
      if (dk === "delivery" && mk) rows += `<tr class="need"><td class="sticky-col muted">${esc(mk)} sched/need</td>${A.nd.map((n, i) => needCell(n.delivery[mk] || 0, A.ct[i].delivery[mk] || 0)).join("")}<td></td><td></td></tr>`;
      if (dk === "linehaul") rows += `<tr class="need"><td class="sticky-col muted">Line-haul sched/need</td>${A.nd.map((n, i) => needCell(n.linehaul, A.ct[i].linehaul)).join("")}<td></td><td></td></tr>`;
    }
    const bad = A.flags.filter((f) => f.lvl === "bad").length, warn = A.flags.filter((f) => f.lvl === "warn").length;
    m.innerHTML = `
      ${!st.hoursConfirmed ? `<div class="card" style="border-color:#F3C99B;background:var(--warnbg);color:var(--warn)"><b>Starting shift times and standards.</b> ${esc(dcn)}'s shift hours and productivity standards are placeholders until the DC confirms them on the Settings tab.</div>` : ""}
      ${bar}
      <div class="strip">
        <div class="stat"><div class="k">Scheduled hours</div><div class="v">${Math.round(A.totalH).toLocaleString()}</div><div class="d">${people.filter((p) => (A.ph[p.id] || {}).h > 0).length} of ${people.length} people</div></div>
        <div class="stat ${A.otH > 0 ? "bad" : "ok"}"><div class="k">Projected OT hours</div><div class="v">${fmtH(A.otH)}</div><div class="d">${A.red} over 40 · ${A.amber} at ${st.ot.amber}+</div></div>
        <div class="stat ${A.gaps ? "bad" : "ok"}"><div class="k">Coverage gaps</div><div class="v">${A.gaps}</div><div class="d">day and department shortfalls</div></div>
        <div class="stat ${A.ldrGaps ? "bad" : "ok"}"><div class="k">Shifts with no leader</div><div class="v">${A.ldrGaps}</div><div class="d">warehouse and shop</div></div>
        <div class="stat"><div class="k">Routes this week</div><div class="v">${A.vol.reduce((a, o) => a + o.routesTotal, 0)}</div><div class="d">${A.vol.reduce((a, o) => a + o.stops, 0).toLocaleString()} stops</div></div>
      </div>
      <div class="card">
        <div class="row">
          ${canPost() ? `<button class="btn primary" id="smartBtn" title="Rebuilds the week from volume and rules. Anything a leader set by hand stays.">Smart build week</button><button class="btn" id="fillBtn">Fill gaps only</button><button class="btn" id="copyBtn">Copy last week</button><button class="btn" id="clearBtn">Clear week</button>` : ""}
          <span class="spacer"></span>
          <label class="muted">Show <select class="inp sm" id="filt">${[["all", "All teams"], ["wh", "Warehouse"], ["shop", "Shop"], ["del", "Delivery"], ["lh", "Line-haul"]].filter(([k]) => k === "all" || (k === "del" ? st.hasDelivery : k === "lh" ? st.hasLinehaul : true)).map(([k, n]) => `<option value="${k}" ${fl === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        </div>
        <div class="legend">${Object.entries(st.tpl).filter(([k, t]) => (t.g === "del" ? st.hasDelivery : t.g === "lh" ? st.hasLinehaul : true)).map(([k, t]) => `<span><b>${k}</b> ${esc(t.n)} ${fmtT(t.s)}-${fmtT(t.e)}</span>`).join("")}<span><b>X</b> custom</span><span><b style="color:var(--orange)">●</b> set by a leader. Smart build keeps it. Tap a day to set position, time or lunch. Tap a name to change home position or usual shift.</span></div>
      </div>
      <div class="scroll grid" style="max-height:70vh"><table>
        <thead><tr><th class="sticky-col">Team member</th>${DAYS.map((d, i) => `<th style="text-align:center">${d}<div class="muted" style="font-weight:500">${md(dayDate(i))}</div></th>`).join("")}<th class="num">Hrs</th><th class="num">Days</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="10" class="muted">No one on this team yet. Add people on the Team tab.</td></tr>`}</tbody>
      </table></div>
      ${lunchBoard(st)}
      <div class="card" style="margin-top:16px">
        <h3>Before you post <span class="pill ${bad ? "bad" : "ok"}">${bad} to fix</span> <span class="pill ${warn ? "warn" : ""}">${warn} to watch</span></h3>
        <div class="sub">OT turns amber at ${st.ot.amber} hrs and red over ${st.ot.red}. Red items need a note to post.</div>
        ${A.flags.length ? `<ul class="flags">${A.flags.map((f) => `<li class="${f.lvl}"><span class="pill ${f.lvl === "info" ? "" : f.lvl}">${f.lvl === "bad" ? "Fix" : f.lvl === "warn" ? "Watch" : "Note"}</span><span>${esc(f.txt)}</span></li>`).join("")}</ul>` : `<div class="pill ok">Clean week. No OT risk and every need is covered.</div>`}
      </div>`;
    m.querySelectorAll(".cellbtn[data-p]").forEach((b) => (b.onclick = () => editCell(b.dataset.p, +b.dataset.d)));
    m.querySelectorAll("[data-person]").forEach((b) => (b.onclick = () => editPerson(b.dataset.person)));
    const f = $("#filt"); if (f) f.onchange = (e) => { S.filter = e.target.value; render(); };
    const sb = $("#smartBtn"); if (sb) sb.onclick = () => { const x = smartBuild(); touch(); render(); toast(`Built the week. Kept ${x.kept} leader changes.`); };
    const fb = $("#fillBtn"); if (fb) fb.onclick = () => { const n = autoFill(); touch(); render(); toast(n ? `Added ${n} shifts to cover need` : "Nothing to add. Needs are covered or no one is free without OT."); };
    const cb = $("#copyBtn"); if (cb) cb.onclick = copyLast;
    const xb = $("#clearBtn"); if (xb) xb.onclick = () => confirmBox("Clear every shift this week?", "Volume stays. Only the schedule is cleared.", () => { S.wk.sched = {}; touch(); render(); });
    const pb = $("#postBtn"); if (pb) pb.onclick = postWeek;
    m.querySelectorAll("[data-lday]").forEach((b) => (b.onclick = () => { S.lunchDay = +b.dataset.lday; render(); }));
    const rl = $("#reLunch"); if (rl) rl.onclick = () => { for (const id in S.wk.sched) { const r = S.wk.sched[id]; if (r.lunchLock) r.lunchLock = r.lunchLock.map(() => false); } touch(); render(); toast("Lunches re-staggered"); };
  }
  // Smart build: keep everything a leader set by hand, clear the rest, and rebuild from volume, rules and usual shifts
  function smartBuild() {
    let kept = 0;
    for (const id in S.wk.sched) {
      const r = S.wk.sched[id]; r.lock = r.lock || [false, false, false, false, false, false, false]; r.dpt = r.dpt || ["", "", "", "", "", "", ""];
      for (let i = 0; i < 7; i++) {
        if (r.lock[i]) { kept++; continue; }
        r.days[i] = ""; r.dpt[i] = "";
        if (r.lunchLock) r.lunchLock[i] = false;
      }
    }
    const added = autoFill();
    return { kept, added };
  }
  async function copyLast() {
    const prev = await S.db.get(wkPath(S.dc, addDays(S.week, -7)));
    if (!prev || !prev.sched || !Object.keys(prev.sched).length) return toast("Last week has no schedule to copy");
    S.wk.sched = JSON.parse(JSON.stringify(prev.sched));
    for (const id in S.wk.sched) { const r = S.wk.sched[id]; r.lock = r.days.map((c) => !!c && c !== "PTO"); }
    for (const id in S.wk.sched) S.wk.sched[id].days = S.wk.sched[id].days.map((c) => (c === "PTO" ? "" : c));
    touch(); render(); toast("Copied last week. PTO was not copied.");
  }

  function lunchBoard(st) {
    const days = DAYS.map((d, i) => i).filter((i) => lunchReport(st, S.wk, S.team, i).length);
    if (!days.length) return "";
    if (S.lunchDay == null || !days.includes(S.lunchDay)) S.lunchDay = days[0];
    const rep = lunchReport(st, S.wk, S.team, S.lunchDay);
    return `<div class="card" style="margin-top:16px">
      <div class="row"><div><h3>Lunch board</h3><div class="sub">${st.lunch.mins} min lunches start ${st.lunch.early} to ${st.lunch.late} hrs into the shift. No more than ${st.lunch.share}% of a position out at once, and ${st.lunch.leaderCap} leader at a time. Drivers and line-haul take lunch on the road.</div></div>
      <span class="spacer"></span>${canPost() ? `<button class="btn sm" id="reLunch">Re-stagger all lunches</button>` : ""}</div>
      <div class="chips">${days.map((i) => `<button class="chip ${i === S.lunchDay ? "on" : ""}" data-lday="${i}">${DAYS[i]} ${md(dayDate(i))}</button>`).join("")}</div>
      <div class="scroll"><table><thead><tr><th>Position</th><th class="num">On shift</th><th>Lunch starts</th><th class="num">Most out at once</th><th class="num">Limit</th></tr></thead><tbody>
      ${rep.map((g) => `<tr><td><b>${esc(g.name)}</b></td><td class="num">${g.n}</td><td>${g.times.map((x) => `<span class="pill" style="margin:2px">${fmtT(x.t)}${x.c > 1 ? " x" + x.c : ""}</span>`).join("")}</td><td class="num"><span class="hrs ${g.peak > g.cap ? "warn" : ""}">${g.peak}</span></td><td class="num">${g.cap}</td></tr>`).join("")}
      </tbody></table></div><div class="muted" style="margin-top:6px">* on a cell means the lunch was set by hand and stays put.</div></div>`;
  }

  /* ---------------- modals ---------------- */
  function modal(html, onMount) {
    const el = document.createElement("div"); el.className = "modal"; el.innerHTML = `<div class="box">${html}</div>`;
    el.addEventListener("click", (e) => { if (e.target === el) el.remove(); });
    document.body.appendChild(el); onMount && onMount(el, () => el.remove()); return el;
  }
  function confirmBox(title, body, ok) {
    modal(`<h3>${esc(title)}</h3><p>${esc(body)}</p><div class="row"><span class="spacer"></span><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Yes</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close; el.querySelector("[data-ok]").onclick = () => { close(); ok(); };
    });
  }
  function timeOpts(sel, max) {
    let o = ""; for (let h = 0; h <= (max || 23.75); h += 0.25) o += `<option value="${h}" ${Math.abs(h - sel) < 0.01 ? "selected" : ""}>${fmtT(h)}${h >= 24 ? " (next day)" : ""}</option>`; return o;
  }
  // positions this DC can use (Delivery and Line-haul only where the DC runs them)
  function positionsFor(st) { return DEPTS.filter((d) => (d.g === "del" ? st.hasDelivery : d.g === "lh" ? st.hasLinehaul : true)); }
  function tplDefault(st, p, dept) {
    const g = DEPT[dept] ? DEPT[dept].g : "wh";
    if (dept === p.dept && shiftOf(p.shift)) return shiftOf(p.shift);
    return (deptTpls(st, dept)[0] || [])[1] || st.tpl[g === "del" ? "R" : g === "lh" ? "L" : "D"] || { s: 7, e: 15.5 };
  }
  // pick the shift code for a start/end: the position's own template first, then any template with those times, else custom
  function codeForTimes(st, a, b, pos) {
    const same = Object.entries(st.tpl).filter(([k, t]) => Math.abs(t.s - a) < 0.01 && Math.abs(t.e - b) < 0.01);
    const own = same.find(([k, t]) => t.d === pos) || same.find(([k, t]) => !t.d) || same[0];
    return own ? own[0] : `X:${a}-${b}`;
  }
  function editCell(pid, i) {
    const st = S.settings, p = S.team.people.find((x) => x.id === pid); if (!p) return;
    const cur = cellOf(pid, i), sh = shiftOf(cur.code);
    const curDept = cur.dept || p.dept;
    const d0 = sh || tplDefault(st, p, curDept);
    const posOpts = positionsFor(st).map((d) => `<option value="${d.k}" ${d.k === curDept ? "selected" : ""}>${esc(d.n)}${d.k === p.dept ? " (home)" : ""}</option>`).join("");
    modal(`
      <h3>${esc(p.name)}</h3><div class="muted">${DAYS[i]} ${md(dayDate(i))} · home: ${esc(DEPT[p.dept] ? DEPT[p.dept].n : p.dept)}${p.market ? " · " + esc(p.market) : ""}</div>
      <div class="form" style="margin-top:12px;grid-template-columns:1fr">
        <label>Position<select id="ePos">${posOpts}</select></label>
      </div>
      <div style="margin-top:10px"><b style="color:var(--ink)">Shift time</b> <span class="muted">(15-minute steps)</span>
        <div class="row" style="margin-top:6px"><select class="inp sm" id="eIn">${timeOpts(d0.s % 24)}</select><span>to</span><select class="inp sm" id="eOut">${timeOpts(d0.e, 36)}</select><span class="muted" id="eHrs"></span></div>
        <div class="row" style="margin-top:8px"><b style="color:var(--ink)">Lunch</b><select class="inp sm" id="eLunch"></select><span class="muted">Auto staggers it with the team</span></div>
      </div>
      <div class="muted" style="margin-top:10px">Quick fill</div>
      <div class="chips" id="eChips"></div>
      <div style="display:grid;gap:6px;margin-top:4px">
        <label class="muted"><input type="checkbox" id="eWkPos"> Same position every day ${esc(p.name.split(" ")[0])} works this week</label>
        <label class="muted"><input type="checkbox" id="eWkTime"> Same time every day ${esc(p.name.split(" ")[0])} works this week</label>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn sm" data-code="PTO">PTO</button><button class="btn sm" data-code="">Off</button>
        <button class="btn sm ghost" id="eAuto" title="Clear the leader change and let Smart build decide this day">Let Smart build decide</button>
        <span class="spacer"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="eSave">Save</button></div>`, (el, close) => {
      const q = (x) => el.querySelector(x);
      const ensure = () => { const r = (S.wk.sched[pid] = S.wk.sched[pid] || { days: ["", "", "", "", "", "", ""], dpt: ["", "", "", "", "", "", ""] }); r.dpt = r.dpt || ["", "", "", "", "", "", ""]; r.lock = r.lock || [false, false, false, false, false, false, false]; return r; };
      const chips = () => {
        const pos = q("#ePos").value, g = DEPT[pos] ? DEPT[pos].g : "wh";
        const list = Object.entries(st.tpl).filter(([k, t]) => t.g === g || (g === "shop" && t.g === "wh")).sort((a, b) => (b[1].d === pos) - (a[1].d === pos));
        q("#eChips").innerHTML = list.map(([k, t]) => `<button class="chip" data-tp="${k}">${k} · ${esc(t.n)}<small>${fmtT(t.s)} to ${fmtT(t.e)}</small></button>`).join("");
        q("#eChips").querySelectorAll("[data-tp]").forEach((b) => (b.onclick = () => { const t = st.tpl[b.dataset.tp]; q("#eIn").value = String(t.s % 24); q("#eOut").value = String(t.e); upd(); }));
      };
      const curR = S.wk.sched[pid], curL = curR && curR.lunch ? curR.lunch[i] : null, curLock = !!(curR && curR.lunchLock && curR.lunchLock[i]);
      const upd = () => {
        const a = +q("#eIn").value, b = +q("#eOut").value; const e = b > a ? b : b + 24; q("#eHrs").textContent = fmtH(paid({ s: a, e })) + " paid hrs";
        const sel = q("#eLunch"), keep = sel.value || (curLock ? String(curL) : "auto");
        let o = `<option value="auto">Auto${curL != null && !curLock ? " (" + fmtT(curL) + ")" : ""}</option>`;
        if (e - a >= st.lunch.minShift) for (let t = a + 1; t + st.lunch.mins / 60 <= e - 0.5 + 0.001; t += 0.25) o += `<option value="${t}">${fmtT(t)}</option>`;
        else o = `<option value="auto">No lunch (short shift)</option>`;
        sel.innerHTML = o; if ([...sel.options].some((x) => x.value === keep)) sel.value = keep;
      };
      q("#eIn").onchange = upd; q("#eOut").onchange = upd; upd();
      q("#ePos").onchange = () => { const t = tplDefault(st, p, q("#ePos").value); if (!sh) { q("#eIn").value = String(t.s % 24); q("#eOut").value = String(t.e); upd(); } chips(); };
      chips();
      el.querySelectorAll("[data-code]").forEach((b) => (b.onclick = () => { const r = ensure(); r.days[i] = b.dataset.code; r.dpt[i] = ""; r.lock[i] = true; touch(); close(); render(); }));
      q("#eAuto").onclick = () => { const r = ensure(); r.lock[i] = false; r.days[i] = ""; r.dpt[i] = ""; if (r.lunchLock) r.lunchLock[i] = false; autoFill(); touch(); close(); render(); toast("Handed back to Smart build"); };
      q("[data-x]").onclick = close;
      q("#eSave").onclick = () => {
        const a = +q("#eIn").value; let b = +q("#eOut").value; if (b <= a) b += 24;
        const pos = q("#ePos").value, dpt = pos === p.dept ? "" : pos;
        const code = codeForTimes(st, a, b, pos);
        const r = ensure();
        r.days[i] = code; r.dpt[i] = dpt; r.lock[i] = true;
        r.lunch = r.lunch || [null, null, null, null, null, null, null]; r.lunchLock = r.lunchLock || [false, false, false, false, false, false, false];
        const lv = q("#eLunch").value;
        if (lv === "auto") r.lunchLock[i] = false; else { r.lunch[i] = +lv; r.lunchLock[i] = true; }
        for (let j = 0; j < 7; j++) {
          if (j === i || !working(r.days[j])) continue;
          if (q("#eWkPos").checked) r.dpt[j] = dpt;
          if (q("#eWkTime").checked) r.days[j] = code;
          if (q("#eWkPos").checked || q("#eWkTime").checked) r.lock[j] = true;
        }
        touch(); close(); render();
      };
    });
  }
  // click a name on the schedule: change home position, usual shift and flags
  function editPerson(pid) {
    const st = S.settings, p = S.team.people.find((x) => x.id === pid); if (!p || !canPost()) return;
    const us = shiftOf(p.shift) || tplDefault(st, Object.assign({}, p, { shift: "" }), p.dept);
    modal(`
      <h3>${esc(p.name)}</h3><div class="muted">${esc(p.pos || "")}</div>
      <div class="form" style="margin-top:12px">
        <label>Home position<select id="pPos">${positionsFor(st).map((d) => `<option value="${d.k}" ${d.k === p.dept ? "selected" : ""}>${esc(d.n)}</option>`).join("")}</select></label>
        ${st.hasDelivery ? `<label id="pMkW">Market<select id="pMk"><option value=""></option>${st.markets.map((x) => `<option ${x.n === p.market ? "selected" : ""}>${esc(x.n)}</option>`).join("")}</select></label>
        <label id="pRoleW">Role<select id="pRole">${["", "Driver", "Helper"].map((r) => `<option ${r === p.role ? "selected" : ""}>${r}</option>`).join("")}</select></label>` : ""}
      </div>
      <div style="margin-top:12px"><b style="color:var(--ink)">Usual shift</b> <span class="muted">used by Fill open needs</span>
        <div class="row" style="margin-top:6px"><label class="muted"><input type="checkbox" id="pUse" ${p.shift ? "checked" : ""}> Own shift</label>
        <select class="inp sm" id="pIn">${timeOpts(us.s % 24)}</select><span>to</span><select class="inp sm" id="pOut">${timeOpts(us.e, 36)}</select></div></div>
      <div class="row" style="margin-top:12px">
        <label class="muted"><input type="checkbox" id="pLdr" ${p.leader ? "checked" : ""}> Leader</label>
        <label class="muted"><input type="checkbox" id="pSal" ${p.salaried ? "checked" : ""}> Salaried (no OT flags)</label>
        <label class="muted"><input type="checkbox" id="pAct" ${p.active ? "checked" : ""}> Active</label></div>
      <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="pSave">Save</button></div>`, (el, close) => {
      const q = (x) => el.querySelector(x);
      const vis = () => { const d = q("#pPos").value === "delivery"; if (q("#pMkW")) { q("#pMkW").hidden = !d; q("#pRoleW").hidden = !d; } };
      q("#pPos").onchange = vis; vis();
      q("[data-x]").onclick = close;
      q("#pSave").onclick = async () => {
        p.dept = q("#pPos").value;
        if (q("#pMk")) { p.market = p.dept === "delivery" ? q("#pMk").value || (st.markets.find((x) => x.local) || st.markets[0]).n : ""; p.role = p.dept === "delivery" ? q("#pRole").value : p.role; }
        if (q("#pUse").checked) { const a = +q("#pIn").value; let b = +q("#pOut").value; if (b <= a) b += 24; p.shift = codeForTimes(st, a, b, p.dept); }
        else p.shift = "";
        p.leader = q("#pLdr").checked; p.salaried = q("#pSal").checked; p.active = q("#pAct").checked;
        await saveTeam(); close(); render(); toast("Saved " + p.name);
      };
    });
  }
  function postWeek() {
    const A = analyze(); const bad = A.flags.filter((f) => f.lvl === "bad");
    modal(`<h3>Post ${esc(dcName(S.dc))} · week of ${md(S.week)}</h3>
      <p>${Math.round(A.totalH)} scheduled hours · ${fmtH(A.otH)} projected OT hours.</p>
      ${bad.length ? `<div class="pill bad">${bad.length} items still red</div><ul class="flags" style="margin:10px 0;max-height:180px;overflow:auto">${bad.slice(0, 12).map((f) => `<li class="bad">${esc(f.txt)}</li>`).join("")}${bad.length > 12 ? `<li>and ${bad.length - 12} more</li>` : ""}</ul>
      <label class="muted" style="display:block">Why post with these? (required)<textarea id="pReason" class="inp" rows="3" style="width:100%"></textarea></label>` : `<div class="pill ok">No red flags. Good to post.</div>`}
      <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="pGo">Post week</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("#pGo").onclick = async () => {
        const r = el.querySelector("#pReason"); const reason = r ? r.value.trim() : "";
        if (bad.length && !reason) { r.focus(); r.style.borderColor = "var(--clay)"; return; }
        Object.assign(S.wk, { posted: true, postedAt: new Date().toISOString(), postedBy: S.ctx.user.email, postReason: reason, postedRed: bad.length, postedOT: A.otH, postedHours: A.totalH, changedSincePost: false });
        clearTimeout(S.saveT); const ok = await syncField(true); await S.db.set(wkPath(S.dc, S.week), S.wk); close(); render(); toast(ok ? "Week posted. DC Field App updated." : "Week posted here only");
      };
    });
  }

  /* ---------------- volume tab ---------------- */
  function renderVol(m) {
    const st = S.settings, vol = effVolume(), nd = needs(st, vol), ct = counts();
    const v = S.wk.volume;
    const srcLbl = { entered: "", avg: "4-wk avg", auto: "auto", none: "" };
    const inp = (i, key, val, src, market) => `<td class="num"><input type="number" min="0" step="1" data-i="${i}" data-k="${key}" ${market ? `data-m="${esc(market)}"` : ""} value="${src === "entered" ? val : ""}" placeholder="${src === "entered" ? "" : val}" class="${src === "entered" ? "" : "auto"}"><span class="src">${srcLbl[src] || ""}</span></td>`;
    let vrows = "";
    for (const mk of st.markets) vrows += `<tr><td class="sticky-col">Routes · ${esc(mk.n)}${mk.buf ? ` <span class="pill warn">+${mk.buf}% buffer</span>` : ""}</td>${vol.map((o, i) => inp(i, "routes", o.routes[mk.n], o.src["r:" + mk.n], mk.n)).join("")}</tr>`;
    for (const f of VFIELDS) vrows += `<tr><td class="sticky-col">${f.n}${f.hint ? `<span class="src">${f.hint}</span>` : ""}</td>${vol.map((o, i) => inp(i, f.k, o[f.k], o.src[f.k])).join("")}</tr>`;
    const nc = (need, have) => `<td class="needcell ${!need && !have ? "zero" : have < need ? "short" : have > need ? "over" : "ok"}">${need}<span class="src">sched ${have}</span></td>`;
    let nrows = "";
    nrows += `<tr class="grp"><td class="sticky-col">Warehouse</td><td colspan="7"></td></tr>`;
    for (const k of WH_NEED) nrows += `<tr><td class="sticky-col">${DEPT[k].n}</td>${nd.map((n, i) => nc(n[k], ct[i][k])).join("")}</tr>`;
    nrows += `<tr><td class="sticky-col"><b>Warehouse total</b><span class="src">flex counts here</span></td>${nd.map((n, i) => nc(n.whTotal, ct[i].whTotal)).join("")}</tr>`;
    nrows += `<tr><td class="sticky-col">Shop</td>${nd.map((n, i) => nc(n.shop, ct[i].shop)).join("")}</tr>`;
    if (st.hasDelivery) {
      nrows += `<tr class="grp"><td class="sticky-col">Delivery (driver + helper)</td><td colspan="7"></td></tr>`;
      for (const mk of st.markets) nrows += `<tr><td class="sticky-col">${esc(mk.n)}</td>${nd.map((n, i) => nc(n.delivery[mk.n] || 0, ct[i].delivery[mk.n] || 0)).join("")}</tr>`;
      nrows += `<tr><td class="sticky-col"><b>Delivery total</b></td>${nd.map((n, i) => nc(n.delTotal, ct[i].delTotal)).join("")}</tr>`;
    }
    if (st.hasLinehaul) nrows += `<tr class="grp"><td class="sticky-col">Line-haul</td><td colspan="7"></td></tr><tr><td class="sticky-col">CDL drivers (night before)</td>${nd.map((n, i) => nc(n.linehaul, ct[i].linehaul)).join("")}</tr>`;
    const sd = st.std;
    m.innerHTML = `
      <div class="card">
        <div class="row"><div><h3>Volume for the week of ${md(S.week)}</h3><div class="sub">Gray numbers are the 4-week average for that weekday (or auto-calculated). Type over any of them. Clear a box to go back to the average.</div></div>
        <span class="spacer"></span>${canPost() ? `<label class="btn">Upload Package.ai / Storis CSV<input type="file" id="csvIn" accept=".csv,.xlsx,.xls" hidden></label><button class="btn" id="volClear">Reset to averages</button>` : ""}</div>
        <div class="scroll vol"><table>
          <thead><tr><th class="sticky-col">Volume</th>${DAYS.map((d, i) => `<th class="num">${d} ${md(dayDate(i))}${st.routeDays[i] ? "" : ""}</th>`).join("")}</tr></thead>
          <tbody>${vrows}</tbody></table></div>
        <div class="row" style="margin-top:12px"><label class="muted">Routes running <b>next Monday</b> (Saturday load crew needed if more than 0): <input type="number" min="0" id="nextMon" class="inp sm" style="width:70px" value="${esc(v.nextMon || "")}" ${canPost() ? "" : "disabled"}></label></div>
      </div>
      <div class="card">
        <h3>Recommended headcount</h3>
        <div class="sub">Big number is the recommendation. Under it is who is scheduled. Red is short, amber is over.</div>
        <div class="scroll"><table><thead><tr><th class="sticky-col">Team</th>${DAYS.map((d) => `<th class="num">${d}</th>`).join("")}</tr></thead><tbody>${nrows}</tbody></table></div>
        <div class="legend" style="margin-top:10px">
          <span>Inbound: trailers x ${sd.inboundHrsPerTrailer} labor hrs ÷ ${sd.prodHrs}</span>
          <span>Pick: pieces ÷ (${sd.pickPPH}/hr x ${sd.prodHrs})</span>
          <span>Load: pieces ÷ (${sd.loadPPH}/hr x ${sd.prodHrs})</span>
          <span>Outbound: 1 per ${sd.routesPerOutbound} next-day routes</span>
          <span>Returns: ${sd.returnsPerHr}/hr</span><span>Shop: ${sd.shopPerHr} repairs/hr</span>
          ${st.hasDelivery ? `<span>Delivery: routes x ${sd.crew} + callout buffer</span>` : ""}
          ${st.hasLinehaul ? `<span>Line-haul: next-day remote routes ÷ ${sd.boxesPerRun} boxes per run</span>` : ""}
        </div>
      </div>`;
    m.querySelectorAll(".vol input[data-i]").forEach((el) => {
      if (!canPost()) el.disabled = true;
      el.onchange = () => {
        const i = +el.dataset.i, k = el.dataset.k, val = el.value === "" ? null : +el.value;
        const d = (v.days[i] = v.days[i] || {});
        if (k === "routes") { d.routes = d.routes || {}; if (val == null) delete d.routes[el.dataset.m]; else d.routes[el.dataset.m] = val; }
        else if (val == null) delete d[k]; else d[k] = val;
        touch(); renderVol(m);
      };
    });
    const nm = $("#nextMon"); if (nm) nm.onchange = () => { v.nextMon = nm.value; touch(); renderVol(m); };
    const vc = $("#volClear"); if (vc) vc.onclick = () => { v.days = [{}, {}, {}, {}, {}, {}, {}]; touch(); renderVol(m); };
    const ci = $("#csvIn"); if (ci) ci.onchange = (e) => importVolume(e.target.files[0]).then(() => renderVol(m));
  }
  async function readSheet(file) {
    if (/\.xlsx?$/i.test(file.name)) {
      if (!window.XLSX) throw new Error("Spreadsheet reader did not load");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    }
    const txt = await file.text();
    if (window.XLSX) { const wb = XLSX.read(txt, { type: "string", cellDates: true }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }); }
    const lines = txt.split(/\r?\n/).filter(Boolean); const hdr = lines[0].split(",").map((s) => s.trim());
    return lines.slice(1).map((l) => { const c = l.split(","); const o = {}; hdr.forEach((h, i) => (o[h] = (c[i] || "").trim())); return o; });
  }
  async function importVolume(file) {
    if (!file) return;
    try {
      const rows = await readSheet(file);
      if (!rows.length) return toast("No rows found");
      const keys = Object.keys(rows[0]);
      const find = (re) => keys.find((k) => re.test(k.toLowerCase()));
      const kDate = find(/date|day/), kStops = find(/stops?$|stop count|# ?stops/), kRoute = find(/route|truck|driver/), kMkt = find(/market|zone|region|hub|area/);
      if (!kDate) return toast("Need a date column in the file");
      const st = S.settings; const per = {};
      for (const r of rows) {
        let d = r[kDate]; d = d instanceof Date ? iso(d) : String(d).slice(0, 10);
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(d)) { const [a, b, c] = d.split("/"); d = (c.length === 2 ? "20" + c : c) + "-" + a.padStart(2, "0") + "-" + b.padStart(2, "0"); }
        const i = Math.round((parseISO(d) - parseISO(S.week)) / 864e5); if (!(i >= 0 && i < 7)) continue;
        const text = ((kMkt ? r[kMkt] : "") + " " + (kRoute ? r[kRoute] : "")).toLowerCase();
        const mk = (st.markets.find((x) => text.includes(x.n.toLowerCase())) || st.markets.find((x) => x.local) || st.markets[0]).n;
        const P = (per[i] = per[i] || { stops: 0, routes: {} });
        const rid = kRoute ? String(r[kRoute]) : "r" + Object.keys(P.routes).length;
        P.routes[mk] = P.routes[mk] || new Set(); P.routes[mk].add(rid);
        P.stops += kStops ? +r[kStops] || 0 : 1;
      }
      let n = 0;
      for (const i in per) {
        const d = (S.wk.volume.days[i] = S.wk.volume.days[i] || {}); d.routes = {};
        for (const mk in per[i].routes) d.routes[mk] = per[i].routes[mk].size;
        d.stops = per[i].stops; n++;
      }
      touch(); toast(n ? `Loaded routes and stops for ${n} days` : "No rows matched this week's dates");
    } catch (e) { toast("Could not read file: " + e.message); }
  }

  /* ---------------- team tab ---------------- */
  function renderTeam(m) {
    const st = S.settings, t = S.team, ed = canPost();
    const people = t.people.slice().sort((a, b) => DEPTS.findIndex((d) => d.k === a.dept) - DEPTS.findIndex((d) => d.k === b.dept) || (b.leader - a.leader) || a.name.localeCompare(b.name));
    const deptOpts = (v) => DEPTS.filter((d) => (d.g === "del" ? st.hasDelivery : d.g === "lh" ? st.hasLinehaul : true)).map((d) => `<option value="${d.k}" ${d.k === v ? "selected" : ""}>${d.n}</option>`).join("");
    const mkOpts = (v) => `<option value=""></option>` + st.markets.map((x) => `<option ${x.n === v ? "selected" : ""}>${esc(x.n)}</option>`).join("");
    m.innerHTML = `
      <div class="card"><div class="row"><div><h3>${esc(dcName(S.dc))} team · ${t.people.filter((p) => p.active).length} active</h3>
        <div class="sub">From ${esc(t.source || "manual entry")}. Set each person's home team. Flex warehouse people can be moved to any warehouse team day by day on the schedule.</div></div>
        <span class="spacer"></span>${ed ? `<label class="btn">Upload Paylocity roster<input type="file" id="rosIn" accept=".xlsx,.xls,.csv" hidden></label><button class="btn" id="addP">Add person</button>` : ""}${isAdmin() ? `<label class="btn" title="One-time setup: loads all 4 DCs from the starting roster file">Import starting roster<input type="file" id="seedIn" accept=".json" hidden></label>` : ""}</div>
        <label class="muted" style="display:block;max-width:640px">Leader emails that can sign in and post this DC (comma separated, @1915south.com). Adding someone here is how they get in. No email is sent.
          <input class="inp" id="ldrEm" value="${esc((t.leaderEmails || []).join(", "))}" ${isAdmin() ? "" : "disabled"}></label>
      </div>
      <div class="scroll"><table>
        <thead><tr><th class="sticky-col">Name</th><th>Paylocity position</th><th>Home team</th>${st.hasDelivery ? "<th>Market</th><th>Role</th>" : ""}<th>Usual shift</th><th>Leader</th><th title="Salaried leaders are not flagged for OT">Salaried</th><th>Active</th></tr></thead>
        <tbody>${people.map((p) => `<tr style="${p.active ? "" : "opacity:.5"}">
          <td class="sticky-col"><span class="pname">${esc(p.name)}</span>${p.note ? `<div class="pmeta">${esc(p.note)}</div>` : ""}</td>
          <td class="pmeta">${esc(p.pos || "")}</td>
          <td><select class="inp sm" data-id="${p.id}" data-f="dept" ${ed ? "" : "disabled"}>${deptOpts(p.dept)}</select></td>
          ${st.hasDelivery ? `<td>${p.dept === "delivery" ? `<select class="inp sm" data-id="${p.id}" data-f="market" ${ed ? "" : "disabled"}>${mkOpts(p.market)}</select>` : ""}</td>
          <td>${p.dept === "delivery" ? `<select class="inp sm" data-id="${p.id}" data-f="role" ${ed ? "" : "disabled"}>${["", "Driver", "Helper"].map((r) => `<option ${r === p.role ? "selected" : ""}>${r}</option>`).join("")}</select>` : ""}</td>` : ""}
          <td><select class="inp sm" data-id="${p.id}" data-f="shift" ${ed ? "" : "disabled"}><option value="">Team default</option>${Object.entries(st.tpl).map(([k, tt]) => `<option value="${k}" ${p.shift === k ? "selected" : ""}>${k} ${fmtT(tt.s)}-${fmtT(tt.e)}</option>`).join("")}${p.shift && p.shift.startsWith("X:") && shiftOf(p.shift) ? `<option value="${esc(p.shift)}" selected>${fmtT(shiftOf(p.shift).s)}-${fmtT(shiftOf(p.shift).e)}</option>` : ""}</select></td>
          <td><input type="checkbox" data-id="${p.id}" data-f="leader" ${p.leader ? "checked" : ""} ${ed ? "" : "disabled"}></td>
          <td><input type="checkbox" data-id="${p.id}" data-f="salaried" ${p.salaried ? "checked" : ""} ${ed ? "" : "disabled"}></td>
          <td><input type="checkbox" data-id="${p.id}" data-f="active" ${p.active ? "checked" : ""} ${ed ? "" : "disabled"}></td></tr>`).join("")}</tbody>
      </table></div>`;
    m.querySelectorAll("[data-f]").forEach((el) => (el.onchange = async () => {
      const p = t.people.find((x) => x.id === el.dataset.id); const f = el.dataset.f;
      p[f] = el.type === "checkbox" ? el.checked : el.value;
      if (f === "dept" && p.dept === "delivery" && !p.market) p.market = (st.markets.find((x) => x.local) || st.markets[0]).n;
      await saveTeam(); renderTeam(m);
    }));
    // Leader emails also go to dcAccess/{email}, the sign-in list the Firestore rules check (no emails sent)
    const le = $("#ldrEm"); if (le) le.onchange = async () => {
      const before = (t.leaderEmails || []).slice();
      t.leaderEmails = le.value.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => /@1915south\.com$/.test(x));
      le.value = t.leaderEmails.join(", ");
      try {
        for (const em of t.leaderEmails) await S.db.merge("dcAccess/" + em, { email: em, dcs: { [S.dc]: true }, addedBy: S.ctx.user.email, addedAt: new Date().toISOString() });
        for (const em of before.filter((x) => !t.leaderEmails.includes(x))) {
          const cur = (await S.db.get("dcAccess/" + em)) || {}; const dcs = Object.assign({}, cur.dcs); delete dcs[S.dc];
          if (Object.keys(dcs).length) await S.db.set("dcAccess/" + em, Object.assign(cur, { dcs })); else await S.db.del("dcAccess/" + em);
        }
        await saveTeam(); toast("Saved. They can sign in now.");
      } catch (e) { toast("Could not save access: " + e.message); }
    };
    const ap = $("#addP"); if (ap) ap.onclick = () => modal(`<h3>Add person</h3><div class="form"><label>Name<input id="nName"></label><label>Home team<select id="nDept">${deptOpts("flex")}</select></label><label><input type="checkbox" id="nLdr" style="display:inline;width:auto"> Leader</label></div><div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="nGo">Add</button></div>`, (el, close) => {
      el.querySelector("[data-x]").onclick = close;
      el.querySelector("#nGo").onclick = async () => { const n = el.querySelector("#nName").value.trim(); if (!n) return; const dept = el.querySelector("#nDept").value; t.people.push({ id: S.dc.slice(0, 2) + Date.now().toString(36), name: n, pos: "Added in app", dept, market: dept === "delivery" ? (st.markets.find((x) => x.local) || st.markets[0]).n : "", role: "", leader: el.querySelector("#nLdr").checked, active: true }); await saveTeam(); close(); renderTeam(m); };
    });
    const si = $("#seedIn"); if (si) si.onchange = async (e) => {
      try {
        const data = JSON.parse(await e.target.files[0].text());
        const dcs = DCS.filter((d) => Array.isArray(data[d.k]));
        if (!dcs.length) return toast("That file has no DC rosters in it");
        confirmBox("Load the starting roster?", `This replaces the team list for ${dcs.map((d) => d.n).join(", ")}. Schedules already saved are kept.`, async () => {
          for (const d of dcs) {
            const cur = (await S.db.get("dcTeams/" + d.k)) || {};
            await S.db.set("dcTeams/" + d.k, { dc: d.k, people: data[d.k], leaderEmails: cur.leaderEmails || [], source: "Starting roster (Paylocity Active Roster, Oct 2026)" });
          }
          S.team = await S.db.get("dcTeams/" + S.dc); renderTeam(m); toast(`Loaded ${dcs.map((d) => data[d.k].length).reduce((a, b) => a + b, 0)} people across ${dcs.length} DCs`);
        });
      } catch (err) { toast("Could not read that file: " + err.message); }
    };
    const ri = $("#rosIn"); if (ri) ri.onchange = async (e) => {
      try {
        const rows = await readSheet(e.target.files[0]);
        const mine = rows.map((r) => { const loc = Object.keys(r).find((k) => /location/i.test(k)); return { r, dc: loc ? locToDC(r[loc]) : S.dc }; }).filter((x) => x.dc === S.dc).map((x) => mapPaylocity(x.r, S.dc)).filter(Boolean);
        if (!mine.length) return toast("No rows for " + dcName(S.dc) + " in that file");
        const byName = {};
        for (const p of t.people) { byName[p.name.toLowerCase()] = p; if (p.rosterName) byName[p.rosterName.toLowerCase()] = p; }
        let added = 0, gone = 0;
        const seen = new Set();
        for (const n of mine) {
          const ex = byName[n.rosterName.toLowerCase()] || byName[n.name.toLowerCase()];
          seen.add(n.rosterName.toLowerCase()); seen.add(n.name.toLowerCase());
          if (ex) { Object.assign(ex, { pos: n.pos, rosterName: n.rosterName, pdept: n.pdept, sup: n.sup }); if (n.emp) ex.emp = n.emp; if (!ex.active) ex.active = true; }
          else { t.people.push(Object.assign({ id: S.dc.slice(0, 2) + Math.random().toString(36).slice(2, 8) }, n)); added++; }
        }
        for (const p of t.people) if (p.active && !seen.has(p.name.toLowerCase()) && !(p.rosterName && seen.has(p.rosterName.toLowerCase())) && !p.note) { p.active = false; gone++; }
        t.source = "Paylocity upload " + new Date().toLocaleDateString();
        await saveTeam(); renderTeam(m); toast(`${added} added, ${gone} set inactive`);
      } catch (err) { toast("Could not read roster: " + err.message); }
    };
  }

  /* ---------------- settings tab ---------------- */
  function renderSettings(m) {
    const st = S.settings, ed = isAdmin();
    const dis = ed ? "" : "disabled";
    const n = (path, label, small, step) => { const v = path.split(".").reduce((o, k) => o[k], st); return `<label>${label}${small ? `<small>${small}</small>` : ""}<input type="number" step="${step || "any"}" data-path="${path}" value="${v}" ${dis}></label>`; };
    m.innerHTML = `
      ${ed ? "" : `<div class="card">Only admins (Frank, Andrew) can change settings. You can see them here.</div>`}
      <div class="card"><h3>Shift templates</h3><div class="sub">Times in 15-minute steps. A shift ending after midnight runs into the next day. ${fmtH(st.lunch.mins)} min unpaid lunch on shifts of ${st.lunch.minShift}+ hrs.</div>
        <div class="scroll"><table><thead><tr><th>Code</th><th>Name</th><th>Team</th><th>Department</th><th class="num">People per day</th><th>Start</th><th>End</th><th class="num">Paid hrs</th></tr></thead><tbody>
        ${Object.entries(st.tpl).map(([k, t]) => `<tr><td><b>${k}</b></td><td><input class="inp sm" data-tpl="${k}" data-f="n" value="${esc(t.n)}" ${dis}></td><td>${GROUPS[t.g]}</td>
          <td>${t.g === "wh" ? `<select class="inp sm" data-tpl="${k}" data-f="d" ${dis}><option value="">Any</option>${WH_NEED.map((d) => `<option value="${d}" ${t.d === d ? "selected" : ""}>${DEPT[d].n}</option>`).join("")}</select>` : ""}</td>
          <td class="num">${t.g === "wh" ? `<input class="inp sm" style="width:60px" type="number" min="0" data-tpl="${k}" data-f="fixed" value="${t.fixed || ""}" placeholder="auto" ${dis}>` : ""}</td>
          <td><select class="inp sm" data-tpl="${k}" data-f="s" ${dis}>${timeOpts(t.s)}</select></td>
          <td><select class="inp sm" data-tpl="${k}" data-f="e" ${dis}>${timeOpts(t.e, 36)}</select></td><td class="num">${fmtH(paid(t))}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="sub" style="margin-top:8px">People per day sets a fixed crew on that shift every warehouse day (Recycle AM 2, PM 2). Leave it blank and the department is staffed from volume.</div>
        ${ed ? `<div class="row"><input class="inp sm" id="newCode" placeholder="Code" maxlength="3" style="width:70px"><input class="inp sm" id="newName" placeholder="Shift name"><select class="inp sm" id="newG">${Object.entries(GROUPS).filter(([g]) => g !== "shop").map(([g, n]) => `<option value="${g}">${n}</option>`).join("")}</select><button class="btn sm" id="addTpl">Add shift</button></div>` : ""}
        <div class="row" style="margin-top:10px">
          <label class="muted"><input type="checkbox" data-bool="useNightLoad" ${st.useNightLoad ? "checked" : ""} ${dis}> Loading works the night shift (N)</label>
          <label class="muted"><input type="checkbox" data-bool="leaderEveryShift" ${st.leaderEveryShift ? "checked" : ""} ${dis}> Require a leader on every warehouse shift</label>
          <label class="muted"><input type="checkbox" data-bool="hoursConfirmed" ${st.hoursConfirmed ? "checked" : ""} ${dis}> Shift hours and standards confirmed by the DC</label>
        </div>
      </div>
      <div class="card"><h3>Operating days</h3>
        <div class="row">${DAYS.map((d, i) => `<span class="pill" style="padding:6px 10px">${d}: <label><input type="checkbox" data-arr="whDays" data-i="${i}" ${st.whDays[i] ? "checked" : ""} ${dis}> warehouse</label> <label><input type="checkbox" data-arr="routeDays" data-i="${i}" ${st.routeDays[i] ? "checked" : ""} ${dis}> routes</label></span>`).join("")}</div>
        <div class="sub" style="margin-top:8px">Weeks run Monday to Sunday. Routes usually run Tue to Sat and the warehouse works Mon to Fri. When routes run Monday, enter them as "next Monday" on the week before and the scheduler asks for a Saturday load crew.</div>
      </div>
      <div class="card"><h3>Productivity standards</h3><div class="sub">Starting placeholders. Tune with real numbers from the recaps.</div>
        <div class="form">
          ${n("std.stopsPerRoute", "Stops per route")}${n("std.crew", "People per truck", "driver + helper")}${n("std.piecesPerStop", "Pieces per stop")}
          ${n("std.inboundHrsPerTrailer", "Labor hrs per inbound trailer")}${n("std.pickPPH", "Pick: pieces per labor hr")}${n("std.loadPPH", "Load: pieces per labor hr")}
          ${n("std.routesPerOutbound", "Next-day routes per outbound associate")}${n("std.returnsPerHr", "Returns per labor hr")}${n("std.shopPerHr", "Shop repairs per labor hr")}
          ${st.hasLinehaul ? n("std.boxesPerRun", "Boxes per line-haul run") : ""}${n("std.prodHrs", "Productive hrs per shift")}${n("std.inventoryFixed", "Inventory auditors per warehouse day")}
          ${st.hasDelivery ? n("trucks", "Trucks in fleet") : ""}
        </div></div>
      <div class="card"><h3>Lunch rules</h3><div class="sub">Lunches are staggered automatically every time the schedule changes. Set one by hand on a day cell to lock it.</div>
        <div class="form">${n("lunch.mins", "Lunch length (min)", "unpaid")}${n("lunch.minShift", "Lunch on shifts of (hrs) or more")}${n("lunch.early", "Earliest start (hrs into shift)")}${n("lunch.late", "Latest start (hrs into shift)")}${n("lunch.share", "Max % of a position at lunch at once")}${n("lunch.leaderCap", "Leaders at lunch at once")}</div></div>
      <div class="card"><h3>Overtime and coverage rules</h3>
        <div class="form">${n("ot.amber", "Amber at (weekly hrs)")}${n("ot.red", "Red over (weekly hrs)")}${n("ot.dayMax", "Flag a day over (hrs)")}${n("ot.maxDays", "Max days per week", "5 = 2 days off")}
          <label>Black Friday PTO blackout from<input type="date" data-path="blackout.from" value="${st.blackout.from}" ${dis}></label>
          <label>to<input type="date" data-path="blackout.to" value="${st.blackout.to}" ${dis}></label></div></div>
      ${st.hasDelivery ? `<div class="card"><h3>Delivery markets and callout buffer</h3><div class="sub">Extra crew scheduled on top of routes x crew to absorb callouts.</div>
        <div class="scroll"><table><thead><tr><th>Market</th><th class="num">Callout buffer %</th><th>Local (no line-haul)</th></tr></thead><tbody>
        ${st.markets.map((x, j) => `<tr><td>${esc(x.n)}</td><td class="num"><input class="inp sm" style="width:70px" type="number" data-mk="${j}" data-f="buf" value="${x.buf}" ${dis}></td><td><input type="checkbox" data-mk="${j}" data-f="local" ${x.local ? "checked" : ""} ${dis}></td></tr>`).join("")}
        </tbody></table></div></div>` : ""}`;
    if (!ed) return;
    const save = async () => { await saveSettings(); renderSettings(m); };
    m.querySelectorAll("[data-path]").forEach((el) => (el.onchange = () => { const ks = el.dataset.path.split("."); let o = st; while (ks.length > 1) o = o[ks.shift()]; o[ks[0]] = el.type === "number" ? +el.value : el.value; save(); }));
    m.querySelectorAll("[data-tpl]").forEach((el) => (el.onchange = () => { const t = st.tpl[el.dataset.tpl]; const f = el.dataset.f; t[f] = f === "n" || f === "d" ? el.value : +el.value; if (f === "e" && t.e <= t.s) t.e += 24; save(); }));
    const at = $("#addTpl"); if (at) at.onclick = () => {
      const code = $("#newCode").value.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9]{0,2}$/.test(code) || code === "X" || code === "PTO") return toast("Use a short code like W or Y3");
      if (st.tpl[code]) return toast(code + " is already used");
      st.tpl[code] = { n: $("#newName").value.trim() || code, s: 7, e: 15.5, g: $("#newG").value, d: "" }; save();
    };
    m.querySelectorAll("[data-bool]").forEach((el) => (el.onchange = () => { st[el.dataset.bool] = el.checked; save(); }));
    m.querySelectorAll("[data-arr]").forEach((el) => (el.onchange = () => { st[el.dataset.arr][+el.dataset.i] = el.checked ? 1 : 0; save(); }));
    m.querySelectorAll("[data-mk]").forEach((el) => (el.onchange = () => { const x = st.markets[+el.dataset.mk]; x[el.dataset.f] = el.type === "checkbox" ? el.checked : +el.value; save(); }));
  }

  /* ---------------- all DCs ---------------- */
  async function renderAll(m) {
    m.innerHTML = `<div class="card">Loading all four DCs…</div>`;
    const rows = [];
    for (const d of DCS) {
      const st = Object.assign(defaultSettings(d.k), (await S.db.get("dcSettings/" + d.k)) || {}); st.lunch = Object.assign({}, defaultSettings(d.k).lunch, st.lunch || {});
      const team = (await S.db.get("dcTeams/" + d.k)) || { people: ((window.DC_SEED_ROSTER || {})[d.k] || []) };
      const wk = (await S.db.get(wkPath(d.k, S.week))) || { week: S.week, volume: { days: [{}, {}, {}, {}, {}, {}, {}] }, sched: {} };
      wk.sched = wk.sched || {}; wk.volume = wk.volume || { days: [] }; wk.volume.days = wk.volume.days || [];
      const save = { settings: S.settings, hist: S.hist, wk: S.wk };
      S.settings = st; S.hist = [];
      for (let k = 1; k <= 4; k++) { const h = await S.db.get(wkPath(d.k, addDays(S.week, -7 * k))); if (h) S.hist.push(h); }
      S.wk = wk;
      const A = analyze(st, wk, team);
      Object.assign(S, save);
      const sum = (f) => A.nd.reduce((a, n) => a + f(n), 0), sumc = (f) => A.ct.reduce((a, c) => a + f(c), 0);
      rows.push({ d, st, wk, A, team, whN: sum((n) => n.whTotal), whC: sumc((c) => c.whTotal), dN: sum((n) => n.delTotal), dC: sumc((c) => c.delTotal), routes: A.vol.reduce((a, o) => a + o.routesTotal, 0) });
    }
    const tot = (f) => rows.reduce((a, r) => a + f(r), 0);
    const status = (r) => r.wk.posted ? (r.wk.changedSincePost ? `<span class="pill warn">Changed after post</span>` : `<span class="pill ok">Posted</span>`) : Object.keys(r.wk.sched).length ? `<span class="pill">Draft</span>` : `<span class="pill bad">Not started</span>`;
    const pct = (c, n) => (n ? Math.round((c / n) * 100) + "%" : "n/a");
    m.innerHTML = `
      <div class="strip">
        <div class="stat"><div class="k">Posted</div><div class="v">${rows.filter((r) => r.wk.posted).length} of 4</div><div class="d">week of ${md(S.week)}</div></div>
        <div class="stat"><div class="k">Scheduled hours</div><div class="v">${Math.round(tot((r) => r.A.totalH)).toLocaleString()}</div></div>
        <div class="stat ${tot((r) => r.A.otH) > 0 ? "bad" : "ok"}"><div class="k">Projected OT hours</div><div class="v">${fmtH(r1(tot((r) => r.A.otH)))}</div><div class="d">${tot((r) => r.A.red)} people over 40</div></div>
        <div class="stat ${tot((r) => r.A.gaps) ? "bad" : "ok"}"><div class="k">Coverage gaps</div><div class="v">${tot((r) => r.A.gaps)}</div></div>
        <div class="stat"><div class="k">Routes planned</div><div class="v">${tot((r) => r.routes)}</div></div>
      </div>
      <div class="scroll"><table>
        <thead><tr><th class="sticky-col">DC</th><th>Status</th><th class="num">Routes</th><th class="num">Sched hrs</th><th class="num">OT hrs</th><th class="num">At 38+</th><th class="num">Over 40</th><th class="num">Warehouse staffed</th><th class="num">Delivery staffed</th><th class="num">Gaps</th><th class="num">No-leader shifts</th><th>Post note</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="sticky-col"><a href="#" data-go="${r.d.k}"><b>${r.d.n}</b></a> <span class="muted">${r.d.num}</span></td><td>${status(r)}</td>
          <td class="num">${r.routes}</td><td class="num">${Math.round(r.A.totalH)}</td>
          <td class="num"><span class="hrs ${r.A.otH > 0 ? "bad" : ""}">${fmtH(r.A.otH)}</span></td><td class="num">${r.A.amber}</td><td class="num">${r.A.red}</td>
          <td class="num">${pct(r.whC, r.whN)} <span class="muted">${r.whC}/${r.whN}</span></td>
          <td class="num">${r.st.hasDelivery ? `${pct(r.dC, r.dN)} <span class="muted">${r.dC}/${r.dN}</span>` : `<span class="muted">3PL</span>`}</td>
          <td class="num">${r.A.gaps}</td><td class="num">${r.A.ldrGaps}</td><td class="pmeta">${esc(r.wk.postReason || "")}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="card" style="margin-top:16px"><h3>Delivery by market</h3><div class="sub">Crew-days needed (with callout buffer) vs scheduled this week.</div>
        <div class="scroll"><table><thead><tr><th class="sticky-col">Market</th><th>DC</th><th class="num">Buffer</th><th class="num">Needed</th><th class="num">Scheduled</th><th class="num">Gap</th></tr></thead><tbody>
        ${rows.filter((r) => r.st.hasDelivery).flatMap((r) => r.st.markets.map((mk) => { const n = r.A.nd.reduce((a, x) => a + (x.delivery[mk.n] || 0), 0), c = r.A.ct.reduce((a, x) => a + (x.delivery[mk.n] || 0), 0); return `<tr><td class="sticky-col">${esc(mk.n)}</td><td>${r.d.n}</td><td class="num">${mk.buf}%</td><td class="num">${n}</td><td class="num">${c}</td><td class="num"><span class="hrs ${c < n ? "bad" : ""}">${c - n}</span></td></tr>`; })).join("")}
        </tbody></table></div></div>`;
    m.querySelectorAll("[data-go]").forEach((a) => (a.onclick = async (e) => { e.preventDefault(); S.dc = a.dataset.go; S.tab = "sched"; await loadDC(); shell(); render(); }));
  }

  /* ---------------- start ---------------- */
  async function start(ctx) {
    S.ctx = ctx; S.db = ctx.db;
    const nxt = weekStart(new Date()); nxt.setDate(nxt.getDate() + 7); S.week = iso(nxt);
    try { const last = localStorage.getItem("dcss:lastDC"); if (last && DCS.some((d) => d.k === last)) S.dc = last; } catch (e) {}
    if (ctx.demo) await seedDemo();
    await loadDC(); shell(); render();
    window.addEventListener("beforeunload", () => { try { localStorage.setItem("dcss:lastDC", S.dc); } catch (e) {} });
  }
  return { start, _S: S, _analyze: analyze, _autoFill: autoFill };
})();
