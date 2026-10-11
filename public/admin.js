/* إدارة الموقع وإدارة الخدمات (للمدير): تُضاف إلى نواة app.js عبر UA */
(function () {
  const UA = window.UA, { S, api, esc, val, toast } = UA;
  const fresh = () => ({ tab: 'identity', site: null, users: [], uedit: null, cred: null, services: [], sv: null });
  const B = fresh();
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); Object.assign(B, fresh()); };

  const ROLE = { staff: 'موظف', auditor: 'مدقق', admin: 'مدير' };
  const TYPES = [['text', 'نص'], ['select', 'قائمة خيارات'], ['number', 'رقم'], ['date', 'تاريخ']];
  const $id = (id) => document.getElementById(id);
  const bar = (tabs, cur, act) => `<div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="${act}" data-t="${t[0]}" aria-pressed="${cur === t[0]}">${t[1]}</button>`).join('')}</div>`;
  const splitOpts = (t) => String(t || '').split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);

  /* ---------- إدارة الموقع ---------- */
  function identity() {
    const s = B.site || {};
    return `<section class="card"><h2>هوية الموقع</h2>
      <p class="hint">تظهر في شاشة الدخول والرأس والوثائق الجديدة. الوثائق الصادرة سابقاً لا تتغير لأنها موقَّعة.</p>
      <div class="inline-form">
        <label>اسم الجامعة<input id="si-uni" maxlength="120" value="${esc(s.university)}"></label>
        <label>اسم البوابة<input id="si-title" maxlength="60" value="${esc(s.title)}"></label>
        <label>اسم القسم<input id="si-dept" maxlength="80" value="${esc(s.department)}"></label>
        <button class="btn pri" data-act="savesite">حفظ</button></div>
      <p class="small">اسم التطبيق على شاشة الهاتف (بعد تثبيته) وشعاره وألوانه ثابتة حالياً.</p></section>`;
  }

  function users() {
    const cred = B.cred ? `<section class="card"><h2>كلمة مرور مؤقتة</h2><div class="cred-box"><div>المستخدم: <b class="mono">${esc(B.cred.username)}</b></div><div>كلمة المرور: <b class="mono">${esc(B.cred.tempPassword)}</b></div></div>
      <p class="small">تظهر مرة واحدة فقط. سيُطلب من المستخدم تغييرها عند أول دخول، وقد أُنهيت جلساته وفُكّ قفل حسابه.</p>
      <button class="btn" data-act="bucopy">نسخ</button> <button class="btn" data-act="bucredx">إخفاء</button></section>` : '';
    const rows = B.users.filter((u) => u.role !== 'student').map((u) => {
      if (B.uedit === u.id) {
        return `<tr><td class="mono">${esc(u.username)}</td><td><input id="bu-ed-name" value="${esc(u.name)}" maxlength="100" aria-label="الاسم"></td>
          <td><select id="bu-ed-role" aria-label="الدور">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}"${k === u.role ? ' selected' : ''}>${v}</option>`).join('')}</select></td><td></td>
          <td><button class="btn sm pri" data-act="busave" data-id="${u.id}">حفظ</button> <button class="btn sm" data-act="bucancel">إلغاء</button></td></tr>`;
      }
      return `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.name)}</td><td>${ROLE[u.role] || ''}</td>
        <td>${u.active ? '<span class="ok-t">فعّال</span>' : '<span class="bad-t">معطّل</span>'}</td>
        <td><button class="btn sm" data-act="buedit" data-id="${u.id}">تعديل</button> <button class="btn sm" data-act="bupw" data-id="${u.id}">كلمة مرور جديدة</button>
        <button class="btn sm" data-act="buactive" data-id="${u.id}" data-on="${u.active ? 0 : 1}">${u.active ? 'تعطيل' : 'تفعيل'}</button></td></tr>`;
    }).join('');
    return `${cred}<section class="card"><h2>مستخدم جديد</h2><div class="inline-form">
        <label>اسم المستخدم<input id="bu-name" autocomplete="off" class="mono"></label><label>الاسم الكامل<input id="bu-disp"></label>
        <label>الدور<select id="bu-role"><option value="staff">موظف</option><option value="auditor">مدقق</option><option value="admin">مدير</option></select></label>
        <label>كلمة مرور مؤقتة<input id="bu-pw" type="password" autocomplete="new-password"></label><button class="btn pri" data-act="buadd">إنشاء</button></div>
      <p class="small">اسم المستخدم بحروف لاتينية. كلمة المرور 10 أحرف على الأقل وتحوي حروفاً وأرقاماً. حسابات الطلاب تُدار من «شؤون الطلاب».</p></section>
      <section class="card" style="margin-top:16px"><h2>العاملون</h2><p class="hint">«كلمة مرور جديدة» تفك القفل أيضاً عند كثرة المحاولات الفاشلة.</p>
      <div class="tbl-wrap"><table><thead><tr><th>المستخدم</th><th>الاسم</th><th>الدور</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  UA.views.site = () => bar([['identity', 'هوية الموقع'], ['users', 'المستخدمون']], B.tab, 'btab') + (B.tab === 'users' ? users() : identity());
  UA.loaders.site = async () => {
    const [s, u] = await Promise.all([api('GET', '/api/admin/settings'), api('GET', '/api/admin/users')]);
    B.site = s.site; B.users = u.users;
  };

  /* ---------- إدارة الخدمات ---------- */
  function svList() {
    const rows = B.services.map((s) => `<tr><td><b>${esc(s.label)}</b> <span class="small mono">${esc(s.code)}</span>${s.builtin ? ' <span class="small">(أساسية)</span>' : ''}<div class="small">${esc(s.description)}</div></td>
      <td>${s.slaHours} ساعة</td><td>${s.issuesDocument ? '✓' : '—'}</td><td>${s.requiresAttachment ? '✓' : '—'}</td><td>${s.requests}</td>
      <td>${s.enabled ? '<span class="ok-t">مفعّلة</span>' : '<span class="bad-t">معطّلة</span>'}</td>
      <td><button class="btn sm" data-act="svedit" data-c="${esc(s.code)}">تعديل</button> <button class="btn sm" data-act="svtoggle" data-c="${esc(s.code)}" data-on="${s.enabled ? 0 : 1}">${s.enabled ? 'تعطيل' : 'تفعيل'}</button></td></tr>`).join('');
    return `<section class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0">الخدمات</h2><button class="btn pri" data-act="svnew">خدمة جديدة</button></div>
      <p class="hint">الخدمات المعطَّلة تختفي من نموذج الطالب وتبقى طلباتها السابقة. لا يمكن حذف الخدمة حفاظاً على السجل.</p>
      <div class="tbl-wrap"><table><thead><tr><th>الخدمة</th><th>المدة</th><th>وثيقة</th><th>مرفق إلزامي</th><th>الطلبات</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  const fieldRow = (f, i) => `<div class="fld"><input id="fl-l-${i}" placeholder="اسم الحقل" maxlength="60" value="${esc(f.label)}" aria-label="اسم الحقل">
    <select id="fl-t-${i}" aria-label="النوع">${TYPES.map(([k, v]) => `<option value="${k}"${f.type === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <label class="chk"><input type="checkbox" id="fl-r-${i}"${f.required ? ' checked' : ''}> مطلوب</label>
    ${f.type === 'select' ? `<input id="fl-o-${i}" placeholder="الخيارات مفصولة بفاصلة" value="${esc(f.optionsText || '')}" aria-label="الخيارات">` : '<span></span>'}
    <button class="btn sm" data-act="svdelf" data-i="${i}">حذف</button></div>`;

  function svEditor() {
    const d = B.sv, ro = d.builtin;
    const fields = ro
      ? `<p class="hint">حقول الخدمات الأساسية ثابتة لارتباطها بقوالب الوثائق: ${d.fields.map((f) => esc(f.label)).join('، ')}.</p>`
      : `${d.fields.map(fieldRow).join('') || '<p class="hint">لا حقول بعد.</p>'}<button class="btn sm" data-act="svaddf">إضافة حقل</button>`;
    return `<section class="card"><h2>${d.mode === 'new' ? 'خدمة جديدة' : 'تعديل: ' + esc(d.label0)}</h2>
      <div class="inline-form">
        <label>الرمز (لاتيني، لا يُغيَّر لاحقاً)${d.mode === 'new' ? `<input id="sv-code" class="mono" maxlength="30" value="${esc(d.code)}" placeholder="lib_card">` : `<input class="mono" value="${esc(d.code)}" disabled>`}</label>
        <label>اسم الخدمة<input id="sv-label" maxlength="80" value="${esc(d.label)}"></label>
        <label>مدة الإنجاز (ساعات)<input id="sv-sla" type="number" min="1" max="720" value="${esc(d.slaHours)}"></label></div>
      <label style="display:block;margin-top:10px">وصف يظهر للطالب<textarea id="sv-desc" maxlength="300" rows="2">${esc(d.description)}</textarea></label>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin:10px 0">
        <label class="chk"><input type="checkbox" id="sv-att"${d.requiresAttachment ? ' checked' : ''}> يتطلب مرفقاً</label>
        ${ro ? `<span class="small">${d.issuesDocument ? 'تُصدر وثيقة موقَّعة' : 'لا تُصدر وثيقة'} (ثابت)</span>` : `<label class="chk"><input type="checkbox" id="sv-doc"${d.issuesDocument ? ' checked' : ''}> تُصدر وثيقة موقَّعة عند الاعتماد</label>`}
        <label class="chk"><input type="checkbox" id="sv-en"${d.enabled ? ' checked' : ''}> مفعّلة (تظهر للطلاب)</label></div>
      <h3 style="margin:14px 0 4px;font-size:15px">حقول نموذج الطلب</h3>${fields}
      ${ro ? '' : '<p class="small">الحقل الرقمي عدد صحيح من 0 إلى 1000. تعديل الحقول لا يغيّر الطلبات المقدَّمة سابقاً.</p>'}
      <div style="margin-top:12px"><button class="btn pri" data-act="svsave">حفظ</button> <button class="btn" data-act="svcancel">إلغاء</button></div></section>`;
  }

  UA.views.services = () => (B.sv ? svEditor() : svList());
  UA.loaders.services = async () => { B.services = (await api('GET', '/api/admin/services')).services; B.sv = null; };

  // يقرأ ما كُتب في النموذج إلى المسودة قبل أي إعادة رسم كي لا يضيع
  function readDraft() {
    const d = B.sv;
    if (!d || !$id('sv-label')) return;
    d.label = $id('sv-label').value; d.description = $id('sv-desc').value; d.slaHours = $id('sv-sla').value;
    d.requiresAttachment = $id('sv-att').checked; d.enabled = $id('sv-en').checked;
    if (d.mode === 'new') d.code = $id('sv-code').value;
    if (!d.builtin) {
      d.issuesDocument = $id('sv-doc').checked;
      d.fields.forEach((f, i) => {
        f.label = $id('fl-l-' + i).value; f.type = $id('fl-t-' + i).value; f.required = $id('fl-r-' + i).checked;
        const o = $id('fl-o-' + i); if (o) f.optionsText = o.value;
      });
    }
  }
  const draftOf = (s) => ({
    mode: 'edit', code: s.code, label: s.label, label0: s.label, description: s.description, slaHours: s.slaHours,
    requiresAttachment: s.requiresAttachment, issuesDocument: s.issuesDocument, enabled: s.enabled, builtin: s.builtin,
    fields: s.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, required: !!f.required, optionsText: (f.options || []).join('، ') })),
  });

  document.addEventListener('change', (e) => {
    if (B.sv && e.target.id && e.target.id.startsWith('fl-t-')) { readDraft(); UA.render(); }
  });

  /* ---------- الإجراءات ---------- */
  const A = UA.actions;
  A.btab = (el, d) => { B.tab = d.t; B.cred = null; B.uedit = null; UA.render(); };
  A.savesite = async () => {
    const r = await api('PUT', '/api/admin/settings', { university: val('si-uni'), title: val('si-title'), department: val('si-dept') });
    B.site = r.site; UA.applySite(r.site); UA.render(); toast('حُفظت الإعدادات');
  };
  A.buadd = async () => {
    await api('POST', '/api/admin/users', { username: val('bu-name'), displayName: val('bu-disp'), role: val('bu-role'), password: val('bu-pw') });
    await UA.loadFor('site'); UA.render(); toast('أُنشئ المستخدم');
  };
  A.buedit = (el, d) => { B.uedit = Number(d.id); B.cred = null; UA.render(); };
  A.bucancel = () => { B.uedit = null; UA.render(); };
  A.busave = async (el, d) => {
    await api('PUT', `/api/admin/users/${d.id}`, { displayName: val('bu-ed-name'), role: val('bu-ed-role') });
    B.uedit = null; await UA.loadFor('site'); UA.render(); toast('حُفظ التعديل');
  };
  A.buactive = async (el, d) => {
    await api('POST', `/api/admin/users/${d.id}/active`, { active: d.on === '1' });
    await UA.loadFor('site'); UA.render(); toast(d.on === '1' ? 'تم التفعيل' : 'تم التعطيل');
  };
  A.bupw = async (el, d) => {
    if (!confirm('ستُنشأ كلمة مرور مؤقتة جديدة، وتُنهى جلسات المستخدم ويُفك قفل حسابه. متابعة؟')) return;
    B.cred = (await api('POST', `/api/admin/users/${d.id}/reset-password`, {})).credentials;
    UA.render(); window.scrollTo(0, 0);
  };
  A.bucopy = async () => { try { await navigator.clipboard.writeText(`${B.cred.username}\n${B.cred.tempPassword}`); toast('تم النسخ'); } catch { toast('تعذّر النسخ؛ انسخ يدوياً'); } };
  A.bucredx = () => { B.cred = null; UA.render(); };

  A.svnew = () => {
    B.sv = { mode: 'new', code: '', label: '', label0: '', description: '', slaHours: 48, requiresAttachment: false, issuesDocument: true, enabled: true, builtin: false, fields: [] };
    UA.render(); window.scrollTo(0, 0);
  };
  A.svedit = (el, d) => { const s = B.services.find((x) => x.code === d.c); if (s) { B.sv = draftOf(s); UA.render(); window.scrollTo(0, 0); } };
  A.svcancel = () => { B.sv = null; UA.render(); };
  A.svaddf = () => { readDraft(); B.sv.fields.push({ name: null, label: '', type: 'text', required: false, optionsText: '' }); UA.render(); };
  A.svdelf = (el, d) => { readDraft(); B.sv.fields.splice(Number(d.i), 1); UA.render(); };
  A.svtoggle = async (el, d) => {
    const s = B.services.find((x) => x.code === d.c); if (!s) return;
    await api('PUT', `/api/admin/services/${s.code}`, { label: s.label, description: s.description, slaHours: s.slaHours, requiresAttachment: s.requiresAttachment, issuesDocument: s.issuesDocument, enabled: d.on === '1' });
    await UA.loadFor('services'); UA.render(); toast(d.on === '1' ? 'فُعّلت الخدمة' : 'عُطّلت الخدمة');
  };
  A.svsave = async () => {
    readDraft();
    const d = B.sv;
    const body = { label: d.label, description: d.description, slaHours: Number(d.slaHours), requiresAttachment: d.requiresAttachment, enabled: d.enabled };
    if (!d.builtin) {
      body.issuesDocument = d.issuesDocument;
      body.fields = d.fields.map((f) => ({ ...(f.name ? { name: f.name } : {}), label: f.label, type: f.type, required: !!f.required, ...(f.type === 'select' ? { options: splitOpts(f.optionsText) } : {}) }));
    }
    if (d.mode === 'new') await api('POST', '/api/admin/services', { ...body, code: d.code.trim() });
    else await api('PUT', `/api/admin/services/${d.code}`, body);
    await UA.loadFor('services'); UA.render(); toast('حُفظت الخدمة');
  };
})();
