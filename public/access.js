/* الحسابات والصلاحيات: الحسابات الإدارية، الأدوار المخصّصة، الوحدات وروابطها، ومصفوفة الصلاحيات. تُضاف إلى نواة app.js عبر UA */
(function () {
  const UA = window.UA, { S, api, esc, val, toast } = UA;
  const fresh = () => ({ tab: null, data: null, edit: null, cred: null, rsel: null });
  const X = fresh();
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); Object.assign(X, fresh()); };

  const $id = (id) => document.getElementById(id);
  const mine = () => new Set((S.me && S.me.permissions) || []);
  const bar = (tabs, cur, act) => `<div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="${act}" data-t="${t[0]}" aria-pressed="${cur === t[0]}">${t[1]}</button>`).join('')}</div>`;
  const unitName = (id) => { const u = X.data.units.find((x) => x.id === id); return u ? u.name : '—'; };
  const covers = (perms) => { const m = mine(); return perms.every((p) => m.has(p)); };
  const KIND = { university: 'الإدارة العليا', sector: 'قطاع', college: 'كلية', department: 'إدارة / قسم', office: 'مكتب' };

  function genPw() {
    const L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ', D = '23456789', ALL = L + D;
    const r = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
    const out = [L[r(L.length)], D[r(D.length)], ...Array.from({ length: 10 }, () => ALL[r(ALL.length)])];
    for (let i = out.length - 1; i > 0; i--) { const j = r(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
    return out.join('');
  }

  function tabsAvail() {
    const t = [];
    if (X.data.canManageUsers) t.push(['users', 'الحسابات الإدارية']);
    if (X.data.canManageRoles) t.push(['roles', 'الأدوار والصلاحيات'], ['units', 'الوحدات والترابط']);
    t.push(['matrix', 'مصفوفة الصلاحيات']);
    return t;
  }

  /* ---------- الحسابات ---------- */
  const roleOpts = (sel) => X.data.roles.filter((r) => r.active && covers(r.permissions)).map((r) => `<option value="${esc(r.key)}"${r.key === sel ? ' selected' : ''}>${esc(r.label)}${r.builtin ? '' : ' (مخصّص)'}</option>`).join('');
  const unitOpts = (sel) => `<option value="">— بلا وحدة —</option>` + X.data.units.filter((u) => u.active).map((u) => `<option value="${u.id}"${u.id === sel ? ' selected' : ''}>${esc(u.name)}</option>`).join('');

  function usersTab() {
    const c = X.cred ? `<section class="card cred"><h2>كلمة مرور مؤقتة</h2><p class="hint" style="margin-top:0">المستخدم: <b class="mono">${esc(X.cred.username)}</b> · كلمة المرور: <b class="mono" dir="ltr">${esc(X.cred.tempPassword)}</b></p>
      <p class="small">تظهر مرة واحدة فقط. سيُطلب من المستخدم تغييرها عند أول دخول.</p><div class="actions"><button class="btn pri" data-act="xcopy">نسخ</button><button class="btn" data-act="xcredx">إخفاء</button></div></section>` : '';
    const rows = X.data.users.map((u) => {
      if (X.edit === u.id) {
        return `<tr><td class="mono">${esc(u.username)}</td><td><input id="xe-name" value="${esc(u.name)}" maxlength="100" aria-label="الاسم"></td><td><select id="xe-role" aria-label="الدور">${roleOpts(u.roleKey)}</select></td>
          <td><select id="xe-unit" aria-label="الوحدة">${unitOpts(u.unit && u.unit.id)}</select></td><td></td><td><button class="btn sm pri" data-act="xusave" data-id="${u.id}">حفظ</button> <button class="btn sm" data-act="xucancel">إلغاء</button></td></tr>`;
      }
      const self = S.me && u.id === S.me.id;
      return `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.name)}</td><td>${esc(u.roleLabel)}</td><td>${u.unit ? esc(u.unit.name) : '<span class="hint">—</span>'}</td>
        <td>${u.active ? '<span class="ok-t">فعّال</span>' : '<span class="bad-t">معطّل</span>'}${u.locked ? ' <span class="small">(مقفل)</span>' : ''}${u.mustChange ? ' <span class="small">(بانتظار تغيير كلمة المرور)</span>' : ''}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-act="xuedit" data-id="${u.id}">تعديل</button> <button class="btn sm" data-act="xupw" data-id="${u.id}">كلمة مرور جديدة</button>${self ? '' : ` <button class="btn sm" data-act="xuactive" data-id="${u.id}" data-on="${u.active ? 0 : 1}">${u.active ? 'تعطيل' : 'تفعيل'}</button>`}</td></tr>`;
    }).join('');
    return `${c}<section class="card"><h2>حساب إداري جديد</h2>
      <form class="inline-form" id="xuser"><label>اسم المستخدم<input id="xn-name" autocomplete="off" dir="ltr" class="mono" required></label><label>الاسم الكامل<input id="xn-disp" maxlength="100" required></label>
        <label>الدور<select id="xn-role">${roleOpts('staff')}</select></label><label>الوحدة<select id="xn-unit">${unitOpts(null)}</select></label>
        <label>كلمة مرور مؤقتة<input id="xn-pw" type="text" dir="ltr" class="mono" autocomplete="new-password" required></label>
        <div class="actions" style="margin:0"><button class="btn" type="button" data-act="xgen">توليد</button><button class="btn pri" type="submit">إنشاء</button></div></form>
      <p class="small">اسم المستخدم بحروف لاتينية وأرقام. كلمة المرور 10 أحرف على الأقل وتحوي حروفاً وأرقاماً، ويُلزَم صاحب الحساب بتغييرها عند أول دخول. لا يظهر في قائمة الأدوار إلا ما تملك صلاحياته أنت: لا يجوز منح أوسع من صلاحياتك.</p></section>
      <section class="card" style="margin-top:16px"><h2>الحسابات الإدارية <span class="small">(${X.data.users.length})</span></h2><p class="hint">حسابات الطلاب تُدار من «شؤون الطلاب». «كلمة مرور جديدة» تُنهي جلسات المستخدم وتفك قفل حسابه.</p>
      <div class="tbl-wrap"><table><thead><tr><th>المستخدم</th><th>الاسم</th><th>الدور</th><th>الوحدة</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  /* ---------- الأدوار ---------- */
  function permBoxes(sel, locked) {
    const m = mine();
    return X.data.catalog.map((g) => `<fieldset class="perm-g"><legend>${esc(g.group)}</legend>${g.items.map((i) => {
      const ok = m.has(i.key) && !locked;
      return `<label class="perm${ok ? '' : ' off'}"><input type="checkbox" data-perm="${esc(i.key)}"${sel.includes(i.key) ? ' checked' : ''}${ok ? '' : ' disabled'}> <span>${esc(i.label)}</span><span class="mono small" dir="ltr">${esc(i.key)}</span></label>`;
    }).join('')}</fieldset>`).join('');
  }

  function rolesTab() {
    const d = X.data, cur = X.rsel === 'new' ? null : d.roles.find((r) => r.key === X.rsel);
    const rows = d.roles.map((r) => `<tr class="row" tabindex="0" data-act="xrsel" data-k="${esc(r.key)}" aria-selected="${X.rsel === r.key}"><td><b>${esc(r.label)}</b> <span class="mono small">${esc(r.key)}</span></td><td>${r.builtin ? 'أساسي' : 'مخصّص'}</td><td>${r.permissions.length}</td><td>${r.users}</td><td>${r.active ? '<span class="ok-t">فعّال</span>' : '<span class="bad-t">معطّل</span>'}</td></tr>`).join('');
    let side;
    if (X.rsel === 'new') {
      side = `<h2>دور جديد</h2><form class="form" id="xrole" style="border:0;margin:0;padding:0"><div class="inline-form"><label>الرمز (لاتيني)<input id="xr-key" dir="ltr" class="mono" maxlength="30" placeholder="logistics_officer" required></label><label>الاسم<input id="xr-label" maxlength="60" required></label></div>
        <label>الوصف<input id="xr-desc" maxlength="200"></label>${permBoxes([], false)}<div class="actions" style="margin:0"><button class="btn pri" type="submit">إنشاء الدور</button><button class="btn" type="button" data-act="xrcancel">إلغاء</button></div></form>`;
    } else if (cur && cur.builtin) {
      side = `<h2>${esc(cur.label)} <span class="small">(دور أساسي، ثابت)</span></h2><p class="hint">${esc(cur.description)}</p>${permBoxes(cur.permissions, true)}`;
    } else if (cur) {
      const ok = covers(cur.permissions);
      side = `<h2>${esc(cur.label)}</h2><form class="form" id="xrole" style="border:0;margin:0;padding:0"><div class="inline-form"><label>الاسم<input id="xr-label" maxlength="60" value="${esc(cur.label)}" required></label><label>الرمز<input value="${esc(cur.key)}" class="mono" dir="ltr" disabled></label></div>
        <label>الوصف<input id="xr-desc" maxlength="200" value="${esc(cur.description)}"></label>${permBoxes(cur.permissions, !ok)}
        <p class="small">تعديل الصلاحيات أو التعطيل يُنهي جلسات أصحاب هذا الدور فيدخلون من جديد بالصلاحيات الجديدة.</p>
        ${ok ? `<div class="actions" style="margin:0"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="xractive" data-k="${esc(cur.key)}" data-on="${cur.active ? 0 : 1}">${cur.active ? 'تعطيل الدور' : 'تفعيل الدور'}</button><button class="btn bad" type="button" data-act="xrdel" data-k="${esc(cur.key)}">حذف</button></div>` : '<p class="reason">هذا الدور أوسع من صلاحياتك؛ لا يمكنك تعديله.</p>'}</form>`;
    } else side = '<h2>الدور</h2><div class="empty">اختر دوراً لعرض صلاحياته، أو أنشئ دوراً جديداً.</div>';
    return `<div class="grid2"><section class="card"><h2>الأدوار</h2><div class="actions" style="margin-top:0"><button class="btn pri" data-act="xrnew">دور جديد</button></div>
      <div class="tbl-wrap"><table><thead><tr><th>الدور</th><th>النوع</th><th>الصلاحيات</th><th>الحسابات</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small">الأدوار الأساسية (مدير، موظف شؤون الطلاب، مدقق) ثابتة. الأدوار المخصّصة تُبنى من فهرس الصلاحيات، وتُسنَد للحسابات مع وحدة إدارية.</p></section>
      <section class="card">${side}</section></div>`;
  }

  /* ---------- الوحدات ---------- */
  function unitsTab() {
    const d = X.data, kids = (p) => d.units.filter((u) => (u.parentId ?? null) === p);
    const tree = (p, depth) => kids(p).map((u) => `<tr${u.active ? '' : ' style="opacity:.55"'}><td style="padding-inline-start:${12 + depth * 22}px">${depth ? '↳ ' : ''}<b>${esc(u.name)}</b> <span class="small">${KIND[u.kind] || ''}</span></td><td>${u.users}</td><td>${u.pending}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="xurename" data-id="${u.id}">إعادة تسمية</button> <button class="btn sm" data-act="xuntoggle" data-id="${u.id}" data-on="${u.active ? 0 : 1}">${u.active ? 'تعطيل' : 'تفعيل'}</button></td></tr>${tree(u.id, depth + 1)}`).join('');
    const uOpt = (sel) => d.units.filter((u) => u.active).map((u) => `<option value="${u.id}"${u.id === sel ? ' selected' : ''}>${esc(u.name)}</option>`).join('');
    const links = d.links.map((l) => `<li><span><b>${esc(unitName(l.from))}</b> ${l.twoWay ? '↔' : '←'} <b>${esc(unitName(l.to))}</b> <span class="small">${l.twoWay ? '(في الاتجاهين)' : `(الإحالة من ${esc(unitName(l.from))} إلى ${esc(unitName(l.to))} فقط)`}</span></span> <button class="btn sm bad" data-act="xldel" data-id="${l.id}">حذف</button></li>`).join('');
    return `<div class="stack"><section class="card"><h2>الوحدات الإدارية</h2><div class="tbl-wrap"><table><thead><tr><th>الوحدة</th><th>الحسابات</th><th>طلبات معلّقة</th><th></th></tr></thead><tbody>${tree(null, 0)}</tbody></table></div>
      <h2 style="margin-top:18px">وحدة جديدة</h2><form class="inline-form" id="xunit"><label>الاسم<input id="xun-name" maxlength="80" required></label><label>النوع<select id="xun-kind"><option value="department">إدارة / قسم</option><option value="office">مكتب</option><option value="college">كلية</option><option value="sector">قطاع</option></select></label>
        <label>تتبع<select id="xun-parent"><option value="">— بلا —</option>${uOpt(null)}</select></label><button class="btn pri" type="submit">إضافة</button></form></section>
      <section class="card"><h2>الترابط بين الوحدات</h2><p class="hint" style="margin-top:0">الرابط يتيح لموظفي وحدة أن <b>يحيلوا الطلبات</b> إلى الوحدة الأخرى (وبالعكس إن كان في الاتجاهين). لا تُحال الطلبات إلا عبر رابط قائم، وتُسجَّل كل إحالة في سجل الطلب وفي التدقيق.</p>
      <ul class="mini-list link-list">${links || '<li class="empty">لا روابط.</li>'}</ul>
      <h2 style="margin-top:18px">رابط جديد</h2><form class="inline-form" id="xlink"><label>من<select id="xl-from">${uOpt(null)}</select></label><label>إلى<select id="xl-to">${uOpt(null)}</select></label>
        <label class="chk"><input id="xl-two" type="checkbox" checked> في الاتجاهين</label><button class="btn pri" type="submit">ربط</button></form></section></div>`;
  }

  /* ---------- المصفوفة ---------- */
  function matrixTab() {
    const roles = X.data.roles.filter((r) => r.active);
    const head = `<tr><th>الصلاحية</th>${roles.map((r) => `<th class="mx">${esc(r.label)}${r.builtin ? '' : '<div class="small">مخصّص</div>'}</th>`).join('')}</tr>`;
    const body = X.data.catalog.map((g) => `<tr class="mx-g"><td colspan="${roles.length + 1}">${esc(g.group)}</td></tr>` + g.items.map((i) => `<tr><td>${esc(i.label)} <span class="mono small" dir="ltr">${esc(i.key)}</span></td>${roles.map((r) => `<td class="mx">${r.permissions.includes(i.key) ? '<span class="ok-t" aria-label="مسموح">✓</span>' : '<span class="hint" aria-label="غير مسموح">·</span>'}</td>`).join('')}</tr>`).join('')).join('');
    const desc = roles.filter((r) => r.builtin).map((r) => `<li><b>${esc(r.label)}:</b> ${esc(r.description)}</li>`).join('');
    return `<section class="card"><h2>مصفوفة الصلاحيات</h2><ul class="mini-list" style="margin-bottom:14px">${desc}</ul>
      <div class="tbl-wrap"><table class="matrix"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <p class="small">«عرض كل الطلبات» يتقدّم على «عرض طلبات وحدته فقط». حسابات الطلاب لها صلاحياتها الخاصة وليست جزءاً من هذه المصفوفة.</p></section>`;
  }

  UA.views.access = () => {
    if (!X.data) return '<div class="empty">جارٍ التحميل…</div>';
    const tabs = tabsAvail();
    if (!tabs.some((t) => t[0] === X.tab)) X.tab = tabs[0][0];
    return bar(tabs, X.tab, 'xtab') + ({ users: usersTab, roles: rolesTab, units: unitsTab, matrix: matrixTab }[X.tab])();
  };
  UA.loaders.access = async () => { X.data = await api('GET', '/api/admin/access'); };
  const reload = async () => { await UA.loaders.access(); UA.render(); };
  const run = async (fn) => { try { await fn(); } catch (e) { if (!e.status) throw e; toast(e.message); } };
  const checked = () => [...document.querySelectorAll('input[data-perm]:checked')].map((e) => e.dataset.perm);

  Object.assign(UA.actions, {
    xtab: async (el, d) => { X.tab = d.t; X.edit = null; UA.render(); },
    xgen: async () => { $id('xn-pw').value = genPw(); },
    xcredx: async () => { X.cred = null; UA.render(); },
    xcopy: async () => { try { await navigator.clipboard.writeText(`${X.cred.username}\n${X.cred.tempPassword}`); toast('تم النسخ'); } catch { toast('تعذّر النسخ؛ انسخ يدوياً'); } },
    xuedit: async (el, d) => { X.edit = Number(d.id); UA.render(); },
    xucancel: async () => { X.edit = null; UA.render(); },
    xusave: (el, d) => run(async () => { await api('PUT', `/api/admin/users/${d.id}`, { displayName: val('xe-name'), role: val('xe-role'), unitId: val('xe-unit') || null }); X.edit = null; await reload(); toast('حُفظ التعديل'); }),
    xupw: (el, d) => run(async () => {
      if (!confirm('ستُنشأ كلمة مرور مؤقتة جديدة وتُنهى جلسات هذا المستخدم. متابعة؟')) return;
      X.cred = (await api('POST', `/api/admin/users/${d.id}/reset-password`, {})).credentials; await reload(); window.scrollTo(0, 0);
    }),
    xuactive: (el, d) => run(async () => { await api('POST', `/api/admin/users/${d.id}/active`, { active: d.on === '1' }); await reload(); }),
    xrnew: async () => { X.rsel = 'new'; UA.render(); },
    xrcancel: async () => { X.rsel = null; UA.render(); },
    xrsel: async (el, d) => { X.rsel = d.k; UA.render(); },
    xractive: (el, d) => run(async () => { await api('PUT', `/api/admin/roles/${d.k}`, { active: d.on === '1' }); await reload(); toast(d.on === '1' ? 'فُعّل الدور' : 'عُطّل الدور'); }),
    xrdel: (el, d) => run(async () => { if (!confirm('حذف هذا الدور نهائياً؟')) return; await api('DELETE', `/api/admin/roles/${d.k}`); X.rsel = null; await reload(); toast('حُذف الدور'); }),
    xurename: (el, d) => run(async () => {
      const cur = X.data.units.find((u) => u.id === Number(d.id)); const name = prompt('الاسم الجديد للوحدة', cur.name); if (!name || name === cur.name) return;
      await api('PUT', `/api/admin/units/${d.id}`, { name }); await reload();
    }),
    xuntoggle: (el, d) => run(async () => { await api('PUT', `/api/admin/units/${d.id}`, { active: d.on === '1' }); await reload(); }),
    xldel: (el, d) => run(async () => { if (!confirm('حذف هذا الرابط؟ لن تُحال الطلبات بين الوحدتين بعدها.')) return; await api('DELETE', `/api/admin/links/${d.id}`); await reload(); }),
  });
  Object.assign(UA.forms, {
    xuser: () => run(async () => {
      const r = await api('POST', '/api/admin/users', { username: val('xn-name'), displayName: val('xn-disp'), role: val('xn-role'), unitId: val('xn-unit') || null, password: val('xn-pw') });
      X.cred = { username: val('xn-name'), tempPassword: val('xn-pw') }; await reload(); toast('أُنشئ الحساب'); window.scrollTo(0, 0); return r;
    }),
    xrole: () => run(async () => {
      if (X.rsel === 'new') { const key = val('xr-key').trim(); await api('POST', '/api/admin/roles', { key, label: val('xr-label'), description: val('xr-desc'), permissions: checked() }); X.rsel = key; toast('أُنشئ الدور'); }
      else { await api('PUT', `/api/admin/roles/${X.rsel}`, { label: val('xr-label'), description: val('xr-desc'), permissions: checked() }); toast('حُفظ الدور'); }
      await reload();
    }),
    xunit: () => run(async () => { await api('POST', '/api/admin/units', { name: val('xun-name'), kind: val('xun-kind'), parentId: val('xun-parent') || null }); await reload(); toast('أُضيفت الوحدة'); }),
    xlink: () => run(async () => { await api('POST', '/api/admin/links', { from: Number(val('xl-from')), to: Number(val('xl-to')), twoWay: $id('xl-two').checked }); await reload(); toast('رُبطت الوحدتان'); }),
  });
})();
