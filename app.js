/*
 * 年次有給休暇管理簿 画面（GitHub Pages に置くファイル）
 * - データは持たない。表示・登録・出力はすべてサーバー（Apps Script）に問い合わせ、
 *   サーバー側で本人確認と関与先ごとの権限確認を行う。
 * - ログイン状態（セッション番号）はタブを閉じると消える sessionStorage に置く。
 */
(function () {
  "use strict";
  var CFG = window.YUKYU_CONFIG || {};
  var KIND = { day: "1日", am: "半日（午前）", pm: "半日（午後）", hour: "時間" };
  var WD = ["日", "月", "火", "水", "木", "金", "土"];
  var S = { session: null, me: null, companyId: null, view: "list", empId: null, pIdx: {}, sel: {}, msg: null, cache: {} };

  /* ---------- 小道具 ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var d2n = function (s) { var p = s.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / 864e5; };
  var n2d = function (n) { return new Date(n * 864e5).toISOString().slice(0, 10); };
  var addDays = function (s, k) { return n2d(d2n(s) + k); };
  var dow = function (s) { return new Date(d2n(s) * 864e5).getUTCDay(); };
  var slash = function (s) { return s ? s.replace(/-/g, "/") : ""; };
  var jpDate = function (s) { var p = s.split("-").map(Number); return p[0] + "年" + p[1] + "月" + p[2] + "日（" + WD[dow(s)] + "）"; };
  var chipText = function (lv) { return lv.kind === "day" ? "全" : lv.kind === "am" ? "前" : lv.kind === "pm" ? "後" : lv.hours + "h"; };
  try { S.session = sessionStorage.getItem("yukyu_session"); } catch (e) {}

  function setMsg(type, text, extra) { S.msg = { type: type, text: text, extra: extra || null }; renderMsg(); }
  function renderMsg() {
    var m = S.msg;
    if (!m) { $("msg").innerHTML = ""; return; }
    if (m.type === "halt") { $("msg").innerHTML = haltBox(m.extra); return; }
    $("msg").innerHTML = '<div class="notice ' + m.type + '">' + esc(m.text).replace(/\n/g, "<br>") + "</div>";
  }
  function haltBox(h) {
    return '<div class="halt" role="alert"><strong>未確定の計算があるため、保存していません。</strong><span>管理者の対応が必要です。</span>' +
      (h && h.message ? "<span>理由：" + esc(h.message) + "</span>" : "") + (h && h.date ? "<span>対象日：" + esc(jpDate(h.date)) + "</span>" : "") + "</div>";
  }

  /* ---------- サーバーとの通信 ---------- */
  // 接続先は https のみ（手元の試験用に 127.0.0.1 / localhost の http だけ許可）
  function configured() { return /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)/.test(CFG.API_URL || "") && /apps\.googleusercontent\.com$/.test(CFG.GOOGLE_CLIENT_ID || ""); }
  function api(op, args) {
    return fetch(CFG.API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ op: op, session: S.session, args: args || {} }), redirect: "follow" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: "network", message: "サーバーに接続できませんでした。インターネット接続を確認して、もう一度お試しください。" }; })
      .then(function (res) {
        if (!res.ok && res.error === "not_logged_in") { logoutLocal(); showLogin(res.message); throw res; }
        return res;
      });
  }
  function logoutLocal() { S.session = null; S.me = null; try { sessionStorage.removeItem("yukyu_session"); } catch (e) {} }

  /* ---------- ログイン ---------- */
  function showLogin(note) {
    $("banner").innerHTML = ""; $("who").innerHTML = "";
    if (!configured()) {
      $("main").innerHTML = '<section class="panel login"><h2>設定が完了していません</h2><p>config.js に、Apps Script のウェブアプリURLと OAuth クライアントIDを設定してください。設定手順書の「5. 画面の公開」を参照してください。</p></section>';
      return;
    }
    $("main").innerHTML = '<section class="panel login" aria-labelledby="h-login"><h2 id="h-login">ログイン</h2>' +
      "<p>管理者から利用を許可されたGoogleアカウントでログインしてください。</p>" +
      (note ? '<div class="notice info">' + esc(note) + "</div>" : "") +
      '<div id="gbtn"></div><p class="muted" style="margin:0;font-size:.9rem">ログインすると、Googleアカウントの名前・メールアドレス・アカウントIDがこのシステムに送られ、本人確認に使われます。</p></section>';
    waitGis(function () {
      google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onCredential, auto_select: false, ux_mode: "popup" });
      google.accounts.id.renderButton($("gbtn"), { theme: "outline", size: "large", text: "signin_with", locale: "ja" });
    });
  }
  function waitGis(fn, n) {
    n = n || 0;
    if (window.google && google.accounts && google.accounts.id) return fn();
    if (n > 100) { $("gbtn").innerHTML = '<div class="notice err">Googleのログイン部品を読み込めませんでした。ページを再読み込みしてください。</div>'; return; }
    setTimeout(function () { waitGis(fn, n + 1); }, 100);
  }
  function onCredential(resp) {
    fetch(CFG.API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ op: "login", idToken: resp.credential }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          S.session = res.session; try { sessionStorage.setItem("yukyu_session", res.session); } catch (e) {}
          start();
        } else if (res.error === "pending_approval") showLogin("ログインを受け付けました。管理者が承認するまでお待ちください。承認後に、もう一度ログインしてください。");
        else showLogin("このGoogleアカウントでは利用できません。利用を許可されたアカウントでログインしてください。");
      })
      .catch(function () { showLogin("サーバーに接続できませんでした。時間をおいてもう一度お試しください。"); });
  }

  /* ---------- 開始 ---------- */
  function start() {
    api("whoami").then(function (r) {
      if (!r.ok) { showLogin(r.message); return; }
      S.me = r.data;
      if (!S.companyId || !S.me.companies.some(function (c) { return c.companyId === S.companyId; })) S.companyId = S.me.companies[0] ? S.me.companies[0].companyId : null;
      renderChrome(); route();
    }).catch(function () {});
  }
  function isAdmin() { return S.me && S.me.user.role === "admin"; }
  function renderChrome() {
    var m = S.me;
    var verify = m.mode !== "production";
    var b = '<div class="mode ' + (verify ? "verify" : "prod") + '">' +
      (verify ? "<span>検証モード：本番運用は開始していません。" + (m.dataKind === "demo" ? "入っているのは架空データです。" : "") + "</span>" : "<span>本番運用中</span>") +
      (isAdmin() && m.unresolved.length ? "<span>未確定の計算（該当する登録は保存されず、管理者の対応が必要になります）：</span><ul>" + m.unresolved.map(function (x) { return "<li>" + esc(x.text) + "</li>"; }).join("") + "</ul>" : "") +
      "</div>";
    $("banner").innerHTML = b;
    var comp = m.companies.length > 1 ? '<label for="sel-comp" class="muted">関与先</label><select id="sel-comp">' + m.companies.map(function (c) { return '<option value="' + esc(c.companyId) + '"' + (c.companyId === S.companyId ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") + "</select>"
      : (m.companies[0] ? "<span>" + esc(m.companies[0].name) + "</span>" : "");
    $("who").innerHTML = comp + "<span><b>" + esc(m.user.name) + "</b>（" + esc(m.user.roleLabel) + "）</span>" + '<button class="btn sec" id="logout">ログアウト</button>';
  }
  var TABS = [["list", "職員一覧"], ["ledger", "管理簿・カレンダー"], ["confirm", "予定の確定"], ["audit", "変更履歴"], ["selftest", "接続確認"]];
  var ADMIN_TABS = [["approve", "付与予定の承認"], ["jobs", "自動処理"], ["users", "利用者"], ["backup", "バックアップ"]];
  function tabs() {
    var all = TABS.concat(isAdmin() ? ADMIN_TABS : []);
    return '<nav class="tabs" role="tablist">' + all.map(function (t) { return '<button role="tab" data-view="' + t[0] + '" aria-selected="' + (S.view === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</nav>";
  }
  function route() {
    renderMsg();
    var v = S.view, f = { list: viewList, ledger: viewLedger, confirm: viewConfirm, audit: viewAudit, selftest: viewSelfTest, approve: viewApprove, jobs: viewJobs, users: viewUsers, backup: viewBackup }[v] || viewList;
    if (!S.companyId && v !== "users" && v !== "backup" && v !== "jobs") { $("main").innerHTML = tabs() + '<section class="panel">担当する関与先が設定されていません。管理者に連絡してください。</section>'; return; }
    $("main").innerHTML = tabs() + '<section class="panel"><p class="muted">読み込んでいます…</p></section>';
    f().then(function (html) { if (S.view === v) $("main").innerHTML = tabs() + html; }).catch(function (e) { if (e && e.error !== "not_logged_in") setMsg("err", (e && e.message) || "読み込みに失敗しました。"); });
  }
  function need(r) { if (!r.ok) throw r; return r.data; }

  /* ---------- 職員一覧 ---------- */
  function viewList() {
    return api("listEmployees", { companyId: S.companyId }).then(need).then(function (rows) {
      S.cache.emps = rows;
      var tr = rows.map(function (e) {
        return '<tr class="click" data-open="' + esc(e.employeeId) + '" tabindex="0"><td class="num">' + esc(e.no) + "</td><td><b>" + esc(e.name) + "</b></td><td>" + esc(e.dept) + "</td>" +
          '<td class="num">' + (e.period ? slash(e.period.start) : "—") + '</td><td class="num">' + slash(e.nextGrantDate) + "</td>" +
          '<td class="r num">' + (e.grant ? esc(e.grant.text) + (e.grant.projected ? "（見込み）" : "") : "—") + '</td><td class="r num">' + esc(e.taken || "—") + '</td><td class="r num">' + esc(e.planned || "—") + "</td>" +
          '<td class="r num"><b>' + (e.halt ? "計算停止" : esc(e.balanceTaken || "—")) + '</b></td><td class="r num">' + (e.halt ? "計算停止" : esc(e.balanceWithPlanned || "—")) + "</td>" +
          "<td>" + (e.halt ? '<span class="pill warn">管理者の対応が必要</span>' : e.unconfirmed ? '<span class="pill warn">未確定 ' + e.unconfirmed + "件</span>" : '<span class="pill ok">なし</span>') + "</td></tr>";
      }).join("") || '<tr><td colspan="11" class="muted">職員が登録されていません。</td></tr>';
      return '<section class="panel" style="display:flex;flex-direction:column;gap:12px"><h2>職員一覧（現在の管理期間）</h2><p class="muted" style="margin:0">行をクリックすると、その職員の管理簿とカレンダーを開きます。</p>' +
        '<div class="tablebox"><table class="list"><thead><tr><th>職員番号</th><th>氏名</th><th>所属</th><th>今回付与日</th><th>次回付与日</th><th class="r">今回付与数</th><th class="r">取得済み</th><th class="r">予定</th><th class="r">残数（取得済み反映）</th><th class="r">残数（予定も差引）</th><th>未確定の予定</th></tr></thead><tbody>' + tr + "</tbody></table></div></section>";
    });
  }

  /* ---------- 管理簿 ---------- */
  function ensureEmp() {
    if (S.empId) return Promise.resolve();
    return api("listEmployees", { companyId: S.companyId }).then(need).then(function (rows) { S.cache.emps = rows; S.empId = rows[0] ? rows[0].employeeId : null; });
  }
  function viewLedger() {
    return ensureEmp().then(function () {
      if (!S.empId) return '<section class="panel">職員が登録されていません。</section>';
      var args = { employeeId: S.empId }; if (S.pIdx[S.empId] !== undefined) args.index = S.pIdx[S.empId];
      return Promise.all([api("getLedger", args).then(need), S.cache.emps ? Promise.resolve(S.cache.emps) : api("listEmployees", { companyId: S.companyId }).then(need)]);
    }).then(function (x) {
      if (typeof x === "string") return x;
      var L = x[0], emps = x[1]; S.cache.emps = emps; S.cache.ledger = L;
      if (!L.periods.length) return '<section class="panel">この職員には、まだ管理期間がありません（付与の記録がありません）。</section>';
      S.pIdx[S.empId] = L.index;
      var e = L.employee, p = L.periods[L.index], s = L.summary, i = L.index, ci = L.currentIndex;
      var opts = emps.map(function (o) { return '<option value="' + esc(o.employeeId) + '"' + (o.employeeId === e.employeeId ? " selected" : "") + ">" + esc(o.no) + "　" + esc(o.name) + "（" + esc(o.dept) + "）</option>"; }).join("");
      var status = i === ci ? '<span class="pill ok">現在の期間</span>' : p.projected ? '<span class="pill warn">次の期間（付与前）</span>' : i < ci ? '<span class="pill mute">過去の期間</span>' : "";
      var nextGrant = L.periods[i + 1] ? L.periods[i + 1].start : addDays(p.end, 1);
      var g = s.grant;
      var grantHtml = g ? '<b class="num">' + esc(g.text) + "</b><small>" + (g.projected ? "見込み・" + ({ pending: "承認待ち", approved: "承認済み", excluded: "付与しない（8割未満）" }[g.approval] || "") : esc(g.kind)) + "・" + slash(g.expiry) + "まで有効</small>" : "—";
      var carryHtml = s.carry.length ? s.carry.map(function (c) { return '<b class="num">' + esc(c.text) + "</b><small>" + slash(c.grantDate) + "付与・" + slash(c.expiry) + "まで有効</small>"; }).join("") : "<b>なし</b>";
      var bd = function (c) { return '1日 <b class="num">' + c.day + "回</b>／半日 <b class=\"num\">" + (c.am + c.pm) + "回</b>（午前" + c.am + "・午後" + c.pm + "）／時間 <b class=\"num\">" + c.hours + "時間</b>（" + c.hourN + "回）"; };
      var refLabel = s.future ? "付与日（" + slash(s.ref) + "）時点" : s.ref === L.today ? "本日時点" : "期間末（" + slash(s.ref) + "）時点";
      var bal = function (b) { return b ? esc(b.text) : "計算停止"; };
      var five = s.fiveDay ? '<div class="fact"><dt>年5日の取得義務（半日0.5日・時間は含まず）</dt><dd class="num">' + s.fiveDay.taken + "日 <small>予定込み " + s.fiveDay.withPlanned + "日／期限 " + slash(s.fiveDay.deadline) + "</small></dd></div>" : "";
      var cond = L.condition ? "所定" + L.condition.scheduledHours + "時間（時間単位の1日＝" + L.condition.dayHours + "時間）" : "";
      return '<section class="panel" style="display:flex;flex-direction:column;gap:14px">' +
        '<div class="who"><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><label for="sel-emp">職員</label><select id="sel-emp">' + opts + "</select></div>" +
        '<div class="pnav"><button class="btn sec" id="p-prev"' + (i === 0 ? " disabled" : "") + '>◀ 前の期間</button><span class="cur num">' + slash(p.start) + "～" + slash(p.end) + '</span><button class="btn sec" id="p-next"' + (i === L.periods.length - 1 ? " disabled" : "") + '>次の期間 ▶</button><button class="btn sec" id="p-cur"' + (i === ci ? " disabled" : "") + ">現在の期間へ</button></div></div>" +
        "<div>" + status + ' <span class="muted">' + esc(cond) + (e.hourly ? "" : "・時間単位年休なし") + "</span>" + (i === 0 ? ' <span class="muted">／これより前の管理期間はありません</span>' : "") + "</div>" +
        (s.halt ? haltBox(s.halt) : "") +
        (s.planShortage ? '<div class="notice err">予定が残数を超えています（' + jpDate(s.planShortage) + "）。予定を見直してください。</div>" : "") +
        '<dl class="facts" style="margin:0">' +
        '<div class="fact"><dt>氏名</dt><dd>' + esc(e.name) + "<small>職員番号 " + esc(e.no) + "・" + esc(e.dept) + "</small></dd></div>" +
        '<div class="fact"><dt>管理期間</dt><dd class="num">' + slash(p.start) + "～" + slash(p.end) + "</dd></div>" +
        '<div class="fact"><dt>今回付与日</dt><dd class="num">' + slash(p.start) + "</dd></div>" +
        '<div class="fact"><dt>次回付与日</dt><dd class="num">' + slash(nextGrant) + "</dd></div>" +
        '<div class="fact"><dt>繰越分</dt><dd>' + carryHtml + "</dd></div>" +
        '<div class="fact"><dt>今回付与分</dt><dd>' + grantHtml + "</dd></div>" +
        '<div class="fact"><dt>取得実績（この期間）</dt><dd class="two"><div><span class="l">取得済み</span><span class="num">' + esc(s.taken.text) + '</span></div><div class="breakdown">' + bd(s.taken) + '</div><div><span class="l">予定</span><span class="num">' + esc(s.planned.text) + '</span></div><div class="breakdown">' + bd(s.planned) + "</div></dd></div>" +
        '<div class="fact big"><dt>残数（' + refLabel + '）</dt><dd class="two"><div><span class="l">取得済みを反映</span><span class="num">' + bal(s.balanceTaken) + '</span></div><div><span class="l">予定も差し引き</span><span class="num">' + bal(s.balanceWithPlanned) + "</span></div></dd></div>" +
        five + "</dl>" +
        '<div class="toolbar no-print"><button class="btn sec" id="do-print">印刷・PDF保存</button><button class="btn sec" id="do-csv">CSVを保存</button><span class="muted">PDFは印刷画面で「PDFに保存」を選びます。</span></div>' +
        '<div class="legend"><span class="item"><span class="chip day" style="width:34px">全</span>1日</span><span class="item"><span class="chip am" style="width:34px">前</span>半日 午前</span><span class="item"><span class="chip pm" style="width:34px">後</span>半日 午後</span><span class="item"><span class="chip hour" style="width:34px">2h</span>時間</span><span class="item"><span class="chip plan day" style="width:46px">全</span>予定（枠線のみ）</span><span class="item"><span class="sw hol"></span>休日</span><span class="item"><span class="sw out"></span>管理期間外</span></div>' +
        '<p class="muted no-print" style="margin:0">日付をクリックすると、取得の登録・修正・取消ができます。</p>' +
        calendar(L, p) + lotsTable(L) + "</section>";
    });
  }
  function calendar(L, p) {
    var e = L.employee, hol = {}, by = {};
    L.holidays.forEach(function (h) { hol[h.date] = h.name; });
    L.leaves.forEach(function (lv) { (by[lv.date] = by[lv.date] || []).push(lv); });
    var months = [], y = +p.start.slice(0, 4), m = +p.start.slice(5, 7), ey = +p.end.slice(0, 4), em = +p.end.slice(5, 7);
    while (y < ey || (y === ey && m <= em)) { months.push([y, m]); m++; if (m > 12) { m = 1; y++; } }
    var html = months.map(function (ym) {
      var y = ym[0], m = ym[1], mm = ("0" + m).slice(-2), first = y + "-" + mm + "-01", nd = new Date(Date.UTC(y, m, 0)).getUTCDate();
      var cells = WD.map(function (w, k) { return '<div class="wd ' + (k === 0 ? "sun" : k === 6 ? "sat" : "") + '">' + w + "</div>"; }).join("");
      for (var k = 0; k < dow(first); k++) cells += '<div class="cell blank" aria-hidden="true"></div>';
      for (var d = 1; d <= nd; d++) {
        var ds = y + "-" + mm + "-" + ("0" + d).slice(-2), out = ds < p.start || ds > p.end, w = dow(ds);
        var off = !hol[ds] && e.workdays.indexOf(w) < 0;
        var cls = ["cell", w === 0 ? "sun" : w === 6 ? "sat" : "", hol[ds] ? "hol" : "", off ? "off" : "", out ? "out" : "", ds === L.today ? "today" : ""].filter(Boolean).join(" ");
        var lvs = (by[ds] || []).slice().sort(function (a, b) { return ({ am: 0, day: 0, pm: 1, hour: 2 })[a.kind] - ({ am: 0, day: 0, pm: 1, hour: 2 })[b.kind]; });
        var chips = lvs.map(function (lv) { return '<span class="chip ' + lv.kind + (lv.status === "planned" ? " plan" : "") + '">' + chipText(lv) + "</span>"; }).join("");
        var label = jpDate(ds) + (hol[ds] ? "・" + hol[ds] : off ? "・所定休日" : "") + (out ? "・管理期間外" : "") + lvs.map(function (lv) { return "・" + KIND[lv.kind] + (lv.kind === "hour" ? lv.hours + "時間" : "") + (lv.status === "planned" ? "（予定）" : "（取得済み）"); }).join("");
        var gm = L.grantDates.indexOf(ds) >= 0 ? '<span class="gmark">付与</span>' : "";
        cells += '<button class="' + cls + '" data-date="' + ds + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + gm + '<span class="dn">' + d + "</span>" + chips + "</button>";
      }
      var partial = first < p.start || (y + "-" + mm + "-" + nd) > p.end;
      return '<div class="month"><h3><span>' + y + "年" + m + "月</span>" + (partial ? "<small>一部が期間外</small>" : "") + '</h3><div class="grid7">' + cells + "</div></div>";
    }).join("");
    return '<div><h2 style="margin-bottom:8px">年間カレンダー <span class="muted" style="font-size:.9rem;font-weight:400">（' + months.length + 'か月の枠）</span></h2><div class="months">' + html + "</div></div>";
  }
  function lotsTable(L) {
    if (L.lotsHalt) return haltBox(L.lotsHalt);
    var st = { expired: '<span class="pill mute">期限切れ</span>', future: '<span class="pill warn">未到来</span>', active: '<span class="pill ok">使用可</span>' };
    var rows = L.lots.map(function (l) {
      var al = l.allocations.length ? '<ul class="alloc">' + l.allocations.map(function (a) { return "<li>" + slash(a.date) + " " + KIND[a.kind] + "：" + esc(a.amount) + (a.brokeDays ? "（1日＝" + a.basis + "時間で" + a.brokeDays + "日を時間に崩して充当）" : "") + "</li>"; }).join("") + "</ul>" : "";
      var conv = l.convs && l.convs.length ? '<ul class="alloc">' + l.convs.map(function (c) { return "<li>" + slash(c.date) + " 所定変更：端数" + c.before + "時間 → " + c.after + "時間（1日" + c.oldBasis + "→" + c.newBasis + "時間）</li>"; }).join("") + "</ul>" : "";
      return '<tr><td class="num">' + slash(l.grantDate) + "</td><td>" + esc(l.kind) + al + conv + '</td><td class="r num">' + esc(l.granted) + '</td><td class="num">' + slash(l.expiry) + '</td><td class="r num">' + esc(l.used) + (l.adjusted ? "<br><small>調整 " + esc(l.adjusted) + "</small>" : "") + '</td><td class="r num">' + (esc(l.remaining) || "—") + '</td><td class="r num">' + (esc(l.expired) || "—") + "</td><td>" + st[l.state] + "</td></tr>";
    }).join("");
    var ng = L.nextGrant ? '<tr><td class="num">' + slash(L.nextGrant.grantDate) + '</td><td>付与予定（見込み）</td><td class="r num">' + L.nextGrant.days + '日</td><td class="num">' + slash(L.nextGrant.expiry) + '</td><td class="r">—</td><td class="r">—</td><td class="r">—</td><td><span class="pill ' + (L.nextGrant.approval === "approved" ? "ok" : "warn") + '">' + ({ pending: "承認待ち", approved: "承認済み", excluded: "付与しない" }[L.nextGrant.approval] || "") + "</span></td></tr>" : "";
    return '<details class="lots" open><summary>付与ごとの明細と充当明細（取得済みのみ反映・本日時点）</summary><div class="tablebox"><table class="list"><thead><tr><th>付与日</th><th>区分・充当明細</th><th class="r">付与数</th><th>有効期限</th><th class="r">使用数</th><th class="r">残数</th><th class="r">失効数</th><th>状態</th></tr></thead><tbody>' + rows + ng + "</tbody></table></div>" +
      '<p class="muted" style="margin:6px 0 0;font-size:.88rem">古い付与分から順に充てています。半日は0.5日として扱い、時間に換算しません。時間単位の取得で1日を崩した場合、崩した残りは「時間」として表示されます。</p></details>';
  }

  /* ---------- 取得登録ダイアログ ---------- */
  var dlg = null;
  function openDialog(date) {
    var L = S.cache.ledger;
    dlg = { date: date, editId: null, version: null, kind: "day", hours: 1, armed: null, err: null, halt: null, busy: false };
    $("overlay").hidden = false; renderDialog();
    setTimeout(function () { var f = $("dialog").querySelector("input,button"); if (f) f.focus(); }, 0);
    void L;
  }
  function closeDialog() { dlg = null; $("overlay").hidden = true; }
  function renderDialog() {
    var L = S.cache.ledger, e = L.employee, d = dlg.date, hol = (L.holidays.filter(function (h) { return h.date === d; })[0] || {}).name;
    var work = !hol && e.workdays.indexOf(dow(d)) >= 0;
    var B = L.condition ? L.condition.dayHours : 8;
    var recs = L.leaves.filter(function (lv) { return lv.date === d; });
    var recHtml = recs.length ? recs.map(function (lv) {
      return '<div class="rec' + (dlg.editId === lv.leaveId ? " editing" : "") + '"><span><span class="chip ' + lv.kind + (lv.status === "planned" ? " plan" : "") + '" style="display:inline-block;min-width:38px;margin-right:6px">' + chipText(lv) + "</span><b>" + KIND[lv.kind] + (lv.kind === "hour" ? "（" + lv.hours + "時間）" : "") + "</b>　" +
        (lv.status === "planned" ? '<span class="pill warn">予定</span>' : '<span class="pill ok">取得済み</span>') + '</span><span class="acts"><button class="btn sec" data-edit="' + lv.leaveId + '">修正</button><button class="btn danger' + (dlg.armed === lv.leaveId ? " armed" : "") + '" data-cancel="' + lv.leaveId + '">' + (dlg.armed === lv.leaveId ? "もう一度押すと取り消します" : "取り消す") + "</button></span></div>";
    }).join("") : '<p class="muted" style="margin:0">この日の登録はありません。</p>';
    var kinds = ["day", "am", "pm", "hour"].map(function (k) {
      var dis = !work || (k === "hour" && !e.hourly);
      return '<label class="' + (dis ? "dis" : "") + '"><input type="radio" name="kind" value="' + k + '"' + (dlg.kind === k ? " checked" : "") + (dis ? " disabled" : "") + ">" + KIND[k] + "</label>";
    }).join("");
    var hopts = ""; for (var h = 1; h <= B; h++) hopts += '<option value="' + h + '"' + (dlg.hours === h ? " selected" : "") + ">" + h + "時間</option>";
    $("dialog").innerHTML = '<div class="dhead"><div><h2 id="dlg-title">' + jpDate(d) + "</h2><p>" + esc(e.name) + "　" + (hol ? esc(hol) : work ? "出勤日" : "所定休日") + '</p></div><button class="btn sec" id="dlg-x">閉じる</button></div>' +
      '<div><h3 style="font-size:1rem;margin-bottom:6px">この日の登録</h3><div class="existing">' + recHtml + "</div></div>" +
      (work ? '<form id="dlg-form" style="display:flex;flex-direction:column;gap:12px"><fieldset><legend>' + (dlg.editId ? "取得方法を修正" : "取得予定を新しく登録") + '</legend><div class="kinds">' + kinds + "</div>" +
        '<div class="hrs"' + (dlg.kind === "hour" ? "" : " hidden") + '><label for="dlg-hours"><b>取得する時間数</b></label><select id="dlg-hours">' + hopts + '</select><span class="muted">1日＝' + B + "時間で換算</span></div>" +
        (!e.hourly ? '<p class="muted" style="margin:8px 0 0">この職員は時間単位年休を利用できない設定です。</p>' : "") + "</fieldset>" +
        (dlg.halt ? haltBox(dlg.halt) : "") + (dlg.err ? '<div class="notice err">' + esc(dlg.err).replace(/\n/g, "<br>") + "</div>" : "") +
        '<div class="dfoot">' + (dlg.editId ? '<button type="button" class="btn sec" id="dlg-new">修正をやめる</button>' : "") + '<button type="submit" class="btn"' + (dlg.busy ? " disabled" : "") + ">" + (dlg.busy ? "保存しています…" : dlg.editId ? "修正を保存する" : "予定として登録する") + "</button></div></form>"
        : '<div class="notice info">' + (hol ? esc(hol) : "この職員の所定休日") + "のため、取得は登録できません。</div>") +
      (dlg.halt && !work ? haltBox(dlg.halt) : "") + (dlg.err && !work ? '<div class="notice err">' + esc(dlg.err) + "</div>" : "");
  }
  function afterSave(text) { closeDialog(); setMsg("ok", text); route(); }
  function saveFromDialog() {
    var L = S.cache.ledger, args = { employeeId: L.employee.employeeId, date: dlg.date, kind: dlg.kind, hours: dlg.kind === "hour" ? dlg.hours : 0 };
    if (dlg.editId) { args.leaveId = dlg.editId; args.version = dlg.version; }
    dlg.busy = true; dlg.err = null; dlg.halt = null; renderDialog();
    api("saveLeave", args).then(function (r) {
      if (!dlg) return;
      dlg.busy = false;
      if (r.ok) return afterSave(jpDate(args.date) + "に" + KIND[args.kind] + (args.kind === "hour" ? "（" + args.hours + "時間）" : "") + "を" + (args.leaveId ? "修正しました。" : "予定として登録しました。"));
      if (r.error === "halted") dlg.halt = r.extra || {}; else dlg.err = r.message || "保存できませんでした。";
      renderDialog();
    }).catch(function () {});
  }

  /* ---------- 予定の確定 ---------- */
  function viewConfirm() {
    return api("listPlanned", { companyId: S.companyId }).then(need).then(function (rows) {
      S.cache.planned = rows;
      Object.keys(S.sel).forEach(function (id) { if (!rows.some(function (r) { return r.leaveId === id && r.canConfirm; })) delete S.sel[id]; });
      var n = Object.keys(S.sel).length;
      var tr = rows.map(function (r) {
        return '<tr class="' + (r.canConfirm ? "" : "future") + '"><td>' + (r.canConfirm ? '<input type="checkbox" class="ck" id="ck-' + r.leaveId + '" data-ck="' + r.leaveId + '"' + (S.sel[r.leaveId] ? " checked" : "") + ' aria-label="' + esc(r.name + " " + jpDate(r.date)) + 'を選択">' : "") + "</td>" +
          '<td><label for="ck-' + r.leaveId + '">' + esc(r.name) + '</label></td><td class="num">' + jpDate(r.date) + "</td><td>" + KIND[r.kind] + (r.kind === "hour" ? "（" + r.hours + "時間）" : "") + "</td><td>" + (r.canConfirm ? '<span class="pill warn">確定できます</span>' : '<span class="pill mute">日付前のため確定不可</span>') + "</td></tr>";
      }).join("") || '<tr><td colspan="5" class="muted">取得予定はありません。</td></tr>';
      return '<section class="panel" style="display:flex;flex-direction:column;gap:12px"><h2>取得予定の確認と確定</h2><p class="muted" style="margin:0">実際に休んだことを確認した予定にチェックを入れ、「取得済みにする」を押してください。日付が過ぎても自動では取得済みになりません。</p>' +
        '<div class="ctl"><div class="grp"><button class="btn sec" id="cf-all">日付が過ぎた予定をすべて選ぶ</button><button class="btn sec" id="cf-none"' + (n ? "" : " disabled") + '>選択を外す</button><button class="btn" id="cf-go"' + (n ? "" : " disabled") + ">選択した " + n + " 件を取得済みにする</button></div></div>" +
        '<div class="tablebox"><table class="list"><thead><tr><th>選択</th><th>氏名</th><th>日付</th><th>取得方法</th><th>状態</th></tr></thead><tbody>' + tr + "</tbody></table></div></section>";
    });
  }

  /* ---------- 変更履歴 ---------- */
  var OPN = { login: "ログイン", saveLeave: "取得の登録・修正", cancelLeave: "取得の取消", confirmLeaves: "予定の確定", exportCsv: "CSV出力", decideApproval: "付与の承認", adjustBalance: "残数の手動調整", inviteUser: "利用者の招待", approveUser: "利用者の承認", disableUser: "利用者の停止", runJobsNow: "自動処理の実行", rerunJobs: "自動処理の再実行", createBackup: "バックアップ作成", restoreBackup: "バックアップ復元", setOperationMode: "運用モード変更", selfTest: "接続確認", bootstrap_admin: "管理者の初回登録" };
  var RES = { ok: "完了", denied: "拒否", halted: "停止（保存せず）" };
  function viewAudit() {
    return api("readAudit", { companyId: S.companyId }).then(need).then(function (rows) {
      var tr = rows.slice(0, 200).map(function (r) { return '<tr><td class="num">' + esc(r.at.replace("T", " ")) + "</td><td>" + esc(r.email || "—") + "</td><td>" + esc(OPN[r.op] || r.op) + "</td><td>" + esc(r.companyId) + "</td><td>" + esc(r.target) + "</td><td>" + (r.result === "ok" ? '<span class="pill ok">' : '<span class="pill warn">') + esc(RES[r.result] || r.result) + "</span></td></tr>"; }).join("") || '<tr><td colspan="6" class="muted">履歴はありません。</td></tr>';
      return '<section class="panel" style="display:flex;flex-direction:column;gap:12px"><h2>変更履歴（新しい順・最大200件）</h2>' + (isAdmin() ? "" : '<p class="muted" style="margin:0">担当する関与先の、取得の登録・修正・取消・確定・出力の履歴を表示しています。</p>') +
        '<div class="tablebox"><table class="list"><thead><tr><th>日時</th><th>操作した人</th><th>操作</th><th>関与先</th><th>対象</th><th>結果</th></tr></thead><tbody>' + tr + "</tbody></table></div></section>";
    });
  }

  /* ---------- 接続確認 ---------- */
  function viewSelfTest() {
    return api("selfTest").then(need).then(function (rows) {
      var ok = rows.every(function (r) { return r.pass; });
      var tr = rows.map(function (r) { return "<tr><td>" + esc(r.label) + "</td><td>" + esc(r.expected) + "</td><td>" + esc(r.actual) + '</td><td class="passfail ' + (r.pass ? "pass" : "fail") + '"><b>' + (r.pass ? "合格" : "不合格") + "</b></td></tr>"; }).join("");
      return '<section class="panel" style="display:flex;flex-direction:column;gap:12px"><h2>接続確認</h2>' +
        '<div class="notice ' + (ok ? "ok" : "err") + '">' + (ok ? "サーバーに接続でき、ログインした人の権限が設計どおりに制限されています（" + rows.length + "項目すべて合格）。" : "設計どおりでない項目があります。管理者に連絡してください。") + "</div>" +
        '<dl class="facts" style="margin:0"><div class="fact"><dt>ログイン中</dt><dd>' + esc(S.me.user.name) + "<small>" + esc(S.me.user.email) + "・" + esc(S.me.user.roleLabel) + '</small></dd></div><div class="fact"><dt>トークンの署名検証</dt><dd>' + (S.me.verifyMethod === "rs256-bigint" ? "サーバー側で実施" : "実施できません（管理者に連絡）") + '</dd></div><div class="fact"><dt>サーバーの本日</dt><dd class="num">' + slash(S.me.today) + "</dd></div></dl>" +
        '<div class="tablebox"><table class="list"><thead><tr><th>試した操作</th><th>設計</th><th>結果</th><th>判定</th></tr></thead><tbody>' + tr + "</tbody></table></div></section>";
    });
  }

  /* ---------- 管理者：付与予定の承認 ---------- */
  var APS = { pending: "承認待ち", approved: "承認済み", excluded: "付与しない（8割未満）" };
  function viewApprove() {
    return api("listApprovals").then(need).then(function (rows) {
      var tr = rows.map(function (r) {
        return "<tr><td><b>" + esc(r.name) + '</b><br><span class="muted" style="font-size:.85rem">' + esc(r.company) + "・" + esc(r.dept) + '</span></td><td class="num">' + slash(r.grantDate) + '<br><span class="muted" style="font-size:.85rem">' + (r.daysUntil >= 0 ? "あと" + r.daysUntil + "日" : -r.daysUntil + "日経過") + '</span></td><td class="r num">' + r.days + "日</td><td>" + (r.ruleType === "比例" ? "比例付与（週" + r.weeklyDays + "日）" : "通常付与") + '<br><span class="muted" style="font-size:.85rem">入社 ' + slash(r.hired) + '</span></td><td><span class="pill ' + (r.status === "approved" ? "ok" : r.status === "excluded" ? "mute" : "warn") + '">' + APS[r.status] + '</span></td><td><div style="display:flex;flex-wrap:wrap;gap:6px">' +
          (r.status !== "approved" ? '<button class="btn" data-ap="approved" data-emp="' + r.employeeId + '" data-gd="' + r.grantDate + '">承認する</button>' : "") +
          (r.status !== "excluded" ? '<button class="btn sec" data-ap="excluded" data-emp="' + r.employeeId + '" data-gd="' + r.grantDate + '">付与しない</button>' : "") +
          (r.status !== "pending" ? '<button class="btn sec" data-ap="pending" data-emp="' + r.employeeId + '" data-gd="' + r.grantDate + '">承認待ちに戻す</button>' : "") + "</div></td></tr>";
      }).join("");
      return '<section class="panel" style="display:flex;flex-direction:column;gap:12px"><h2>付与予定の承認</h2><p class="muted" style="margin:0">出勤率8割以上を確認した職員を「承認する」と、付与日に自動で付与されます。承認されていない付与は行われず、「自動処理」画面に承認待ちとして表示されます。付与日数は法定の日数表から計算しています。</p>' +
        '<div class="tablebox"><table class="list"><thead><tr><th>職員</th><th>付与予定日</th><th class="r">付与日数</th><th>区分</th><th>状態</th><th>操作</th></tr></thead><tbody>' + tr + "</tbody></table></div></section>";
    });
  }

  /* ---------- 管理者：自動処理 ---------- */
  var JT = { GRANT: "付与", PERIOD: "管理期間の切替", EXPIRE: "失効の記録" };
  var JS = { pending: "未処理", failed: "失敗", waiting_approval: "承認待ち" };
  function viewJobs() {
    return api("jobStatus").then(need).then(function (d) {
      var it = d.items.map(function (x) { return "<tr><td>" + esc(x.name) + "</td><td>" + JT[x.type] + '</td><td class="num">' + slash(x.targetDate) + '</td><td><span class="pill ' + (x.status === "failed" ? "warn" : "mute") + '">' + (JS[x.status] || x.status) + "</span></td><td>" + esc(x.lastError) + "</td><td>" + x.attempts + '</td><td><button class="btn sec" data-rerun="' + x.employeeId + '">この職員を再実行</button></td></tr>'; }).join("") || '<tr><td colspan="7" class="muted">未処理・失敗・承認待ちの処理はありません。</td></tr>';
      var rn = d.runs.map(function (r) { return '<tr><td class="num">' + esc(r.startedAt.replace("T", " ")) + "</td><td>" + esc(r.trigger) + '</td><td class="r num">' + r.done + '</td><td class="r num">' + r.failed + '</td><td class="r num">' + r.waiting + "</td><td>" + esc(r.note) + "</td></tr>"; }).join("") || '<tr><td colspan="6" class="muted">まだ実行されていません。</td></tr>';
      return '<section class="panel" style="display:flex;flex-direction:column;gap:12px"><h2>自動処理</h2><p class="muted" style="margin:0">毎日午前2時台に、付与・管理期間の切替・失効の記録を行います。最後に全件完了した日：<b class="num">' + (d.lastProcessed ? slash(d.lastProcessed) : "まだありません") + "</b></p>" +
        '<div class="toolbar"><button class="btn" id="job-run">今すぐ実行する</button></div><h3>未処理・失敗・承認待ち</h3><div class="tablebox"><table class="list"><thead><tr><th>職員</th><th>処理</th><th>対象日</th><th>状態</th><th>理由</th><th>試行</th><th>操作</th></tr></thead><tbody>' + it + "</tbody></table></div>" +
        '<h3>実行の記録（新しい順）</h3><div class="tablebox"><table class="list"><thead><tr><th>開始</th><th>きっかけ</th><th class="r">完了</th><th class="r">失敗</th><th class="r">承認待ち</th><th>備考</th></tr></thead><tbody>' + rn + "</tbody></table></div></section>";
    });
  }

  /* ---------- 管理者：利用者 ---------- */
  var US = { invited: "招待中（未ログイン）", pending: "承認待ち", active: "利用中", disabled: "停止" };
  function viewUsers() {
    return api("listUsers").then(need).then(function (rows) {
      var tr = rows.map(function (u) { return "<tr><td>" + esc(u.name) + "</td><td>" + esc(u.email) + "</td><td>" + (u.role === "admin" ? "管理者" : "関与先担当者") + "</td><td>" + esc(u.companies) + '</td><td><span class="pill ' + (u.status === "active" ? "ok" : "warn") + '">' + US[u.status] + "</span></td><td>" + (u.status === "pending" ? '<button class="btn" data-uap="' + u.userId + '">承認する</button> ' : "") + (u.status !== "disabled" && u.role !== "admin" ? '<button class="btn danger" data-udis="' + u.userId + '">停止する</button>' : "") + "</td></tr>"; }).join("");
      var comps = S.me.companies.map(function (c) { return '<label class="check"><input type="checkbox" name="inv-comp" value="' + esc(c.companyId) + '">' + esc(c.name) + "</label>"; }).join("");
      return '<section class="panel" style="display:flex;flex-direction:column;gap:12px"><h2>利用者</h2><div class="tablebox"><table class="list"><thead><tr><th>名前</th><th>メール</th><th>役割</th><th>担当する関与先</th><th>状態</th><th>操作</th></tr></thead><tbody>' + tr + "</tbody></table></div>" +
        '<h3>関与先担当者を招待する</h3><p class="muted" style="margin:0">招待した人が一度ログインすると「承認待ち」になります。本人のアカウントか確認してから承認してください。</p><form id="inv-form" class="form-grid"><label>名前<input id="inv-name" required></label><label>Googleアカウントのメール<input id="inv-email" type="email" required></label><div><b>担当する関与先</b>' + comps + '</div><div style="align-self:end"><button class="btn" type="submit">招待する</button></div></form></section>';
    });
  }

  /* ---------- 管理者：バックアップ ---------- */
  function viewBackup() {
    return api("listBackups").then(need).then(function (rows) {
      var tr = rows.map(function (b) { return '<tr><td class="num">' + esc(b.createdAt.replace("T", " ")) + "</td><td>" + esc(b.name) + "</td><td>" + esc(b.createdBy) + '</td><td><button class="btn sec" data-restore="' + b.backupId + '">この時点に復元</button></td></tr>'; }).join("") || '<tr><td colspan="4" class="muted">バックアップはまだありません。</td></tr>';
      return '<section class="panel" style="display:flex;flex-direction:column;gap:12px"><h2>バックアップ</h2><p class="muted" style="margin:0">バックアップは管理者のGoogleドライブ内（フォルダ「年休管理簿_バックアップ」）にだけ保存されます。復元すると、復元前の状態も自動でバックアップされます。変更履歴は復元しても消えません。</p>' +
        '<div class="toolbar"><button class="btn" id="bk-new">今すぐバックアップする</button></div><div id="bk-confirm"></div>' +
        '<div class="tablebox"><table class="list"><thead><tr><th>作成日時</th><th>名前</th><th>作成者</th><th>操作</th></tr></thead><tbody>' + tr + "</tbody></table></div></section>";
    });
  }

  /* ---------- 操作 ---------- */
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("button,tr[data-open]");
    if (!t) return;
    if (t.id === "logout") { api("logout").catch(function () {}); logoutLocal(); S.msg = null; showLogin("ログアウトしました。"); return; }
    if (t.dataset.view) { S.view = t.dataset.view; S.msg = null; route(); return; }
    if (t.dataset.open) { S.empId = t.dataset.open; S.view = "ledger"; S.msg = null; route(); return; }
    if (t.id === "p-prev" || t.id === "p-next" || t.id === "p-cur") {
      var L = S.cache.ledger; S.pIdx[S.empId] = t.id === "p-cur" ? L.currentIndex : L.index + (t.id === "p-next" ? 1 : -1); S.msg = null; route(); return;
    }
    if (t.id === "do-print") { window.print(); return; }
    if (t.id === "do-csv") {
      api("exportCsv", { employeeId: S.empId }).then(function (r) {
        if (!r.ok) { r.error === "halted" ? setMsg("halt", "", r.extra) : setMsg("err", r.message || "出力できませんでした。"); return; }
        var blob = new Blob(["﻿" + r.data.csv], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = r.data.filename; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        setMsg("ok", "CSVを保存しました（" + r.data.filename + "）。");
      }).catch(function () {});
      return;
    }
    if (t.dataset.date && !t.closest("#dialog")) {
      var Lg = S.cache.ledger, p = Lg.periods[Lg.index], d = t.dataset.date;
      if (d < p.start || d > p.end) {
        var j = -1; Lg.periods.forEach(function (q, k) { if (q.start <= d && d <= q.end) j = k; });
        if (j < 0) { setMsg("info", jpDate(d) + "を含む管理期間はありません。"); return; }
        S.msg = { type: "info", text: jpDate(d) + "は" + (d < p.start ? "前" : "次") + "の管理期間（" + slash(Lg.periods[j].start) + "～" + slash(Lg.periods[j].end) + "）の日付です。", switchTo: j };
        $("msg").innerHTML = '<div class="notice info" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between"><span>' + esc(S.msg.text) + '</span><button class="btn sec" id="go-period">その期間に切り替える</button></div>';
        return;
      }
      openDialog(d); return;
    }
    if (t.id === "go-period") { S.pIdx[S.empId] = S.msg.switchTo; S.msg = null; route(); return; }
    if (t.id === "dlg-x") { closeDialog(); return; }
    if (t.id === "dlg-new") { dlg.editId = null; dlg.kind = "day"; dlg.hours = 1; dlg.err = null; dlg.halt = null; renderDialog(); return; }
    if (t.dataset.edit) { var lv = S.cache.ledger.leaves.filter(function (x) { return x.leaveId === t.dataset.edit; })[0]; dlg.editId = lv.leaveId; dlg.version = lv.version; dlg.kind = lv.kind; dlg.hours = lv.hours || 1; dlg.armed = null; dlg.err = null; dlg.halt = null; renderDialog(); return; }
    if (t.dataset.cancel) {
      if (dlg.armed !== t.dataset.cancel) { dlg.armed = t.dataset.cancel; renderDialog(); return; }
      var lc = S.cache.ledger.leaves.filter(function (x) { return x.leaveId === t.dataset.cancel; })[0];
      api("cancelLeave", { leaveId: lc.leaveId, version: lc.version }).then(function (r) {
        if (r.ok) return afterSave(jpDate(lc.date) + "の" + KIND[lc.kind] + "を取り消しました。");
        dlg.armed = null; if (r.error === "halted") dlg.halt = r.extra || {}; else dlg.err = r.message || "取り消せませんでした。"; renderDialog();
      }).catch(function () {});
      return;
    }
    if (t.id === "cf-all") { (S.cache.planned || []).forEach(function (r) { if (r.canConfirm) S.sel[r.leaveId] = 1; }); route(); return; }
    if (t.id === "cf-none") { S.sel = {}; route(); return; }
    if (t.id === "cf-go") {
      var ids = Object.keys(S.sel); t.disabled = true;
      api("confirmLeaves", { companyId: S.companyId, leaveIds: ids }).then(function (r) { S.sel = {}; r.ok ? setMsg("ok", r.data.confirmed + "件を取得済みにしました。") : setMsg("err", r.message || "確定できませんでした。"); route(); }).catch(function () {});
      return;
    }
    if (t.dataset.ap) {
      api("decideApproval", { employeeId: t.dataset.emp, grantDate: t.dataset.gd, decision: t.dataset.ap }).then(function (r) { r.ok ? setMsg("ok", "「" + APS[t.dataset.ap] + "」にしました。") : setMsg("err", r.message || "変更できませんでした。"); route(); }).catch(function () {});
      return;
    }
    if (t.id === "job-run" || t.dataset.rerun) {
      t.disabled = true;
      var pr = t.dataset.rerun ? api("rerunJobs", { employeeId: t.dataset.rerun }) : api("runJobsNow");
      pr.then(function (r) { r.ok ? setMsg(r.data.failed ? "err" : "ok", "自動処理を実行しました：完了 " + r.data.done + "件・失敗 " + r.data.failed + "件・承認待ち " + r.data.waiting + "件") : setMsg("err", r.message || "実行できませんでした。"); route(); }).catch(function () {});
      return;
    }
    if (t.dataset.uap || t.dataset.udis) {
      api(t.dataset.uap ? "approveUser" : "disableUser", { userId: t.dataset.uap || t.dataset.udis }).then(function (r) { r.ok ? setMsg("ok", t.dataset.uap ? "承認しました。" : "停止しました。") : setMsg("err", r.message || "変更できませんでした。"); route(); }).catch(function () {});
      return;
    }
    if (t.id === "bk-new") { t.disabled = true; api("createBackup", { note: "手動" }).then(function (r) { r.ok ? setMsg("ok", "バックアップを作成しました。") : setMsg("err", r.message || "作成できませんでした。"); route(); }).catch(function () {}); return; }
    if (t.dataset.restore) {
      $("bk-confirm").innerHTML = '<form id="rs-form" class="halt" data-id="' + t.dataset.restore + '"><strong>この時点に復元しますか？</strong><span>現在の登録内容はバックアップの時点に戻ります（復元前の状態は自動でバックアップされます）。</span><label>確認のため「復元する」と入力してください <input id="rs-text" style="font:inherit;padding:6px 8px"></label><div class="toolbar"><button class="btn danger" type="submit">復元する</button><button class="btn sec" type="button" data-view="backup">やめる</button></div></form>';
      return;
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && dlg) { closeDialog(); return; }
    var tr = ev.target.closest && ev.target.closest("tr[data-open]");
    if (tr && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); tr.click(); }
  });
  document.addEventListener("change", function (ev) {
    var t = ev.target;
    if (t.id === "sel-comp") { S.companyId = t.value; S.empId = null; S.cache = {}; S.sel = {}; S.msg = null; route(); return; }
    if (t.id === "sel-emp") { S.empId = t.value; S.msg = null; route(); return; }
    if (t.dataset && t.dataset.ck) { if (t.checked) S.sel[t.dataset.ck] = 1; else delete S.sel[t.dataset.ck]; route(); return; }
    if (t.name === "kind" && dlg) { dlg.kind = t.value; dlg.err = null; dlg.halt = null; renderDialog(); return; }
    if (t.id === "dlg-hours" && dlg) { dlg.hours = Number(t.value); renderDialog(); return; }
  });
  document.addEventListener("submit", function (ev) {
    var f = ev.target; ev.preventDefault();
    if (f.id === "dlg-form") { saveFromDialog(); return; }
    if (f.id === "inv-form") {
      var comps = Array.prototype.map.call(f.querySelectorAll('input[name="inv-comp"]:checked'), function (x) { return x.value; });
      api("inviteUser", { name: $("inv-name").value, email: $("inv-email").value, companies: comps }).then(function (r) { r.ok ? setMsg("ok", "招待しました。招待した人にログインしてもらってください。") : setMsg("err", r.message || "招待できませんでした。"); route(); }).catch(function () {});
      return;
    }
    if (f.id === "rs-form") {
      api("restoreBackup", { backupId: f.dataset.id, confirmText: $("rs-text").value }).then(function (r) { r.ok ? setMsg("ok", "復元しました（" + r.data.restored + "）。") : setMsg("err", r.message || "復元できませんでした。"); route(); }).catch(function () {});
    }
  });
  $("overlay").addEventListener("click", function (ev) { if (ev.target.id === "overlay") closeDialog(); });

  if (S.session && configured()) start(); else showLogin();
})();
