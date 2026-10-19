/* تبويبا «هوية الموقع» و«الخدمات» في صفحة الإدارة (صلاحية rules:manage). المستخدمون يُدارون من «الحسابات والصلاحيات». */
(function () {
  const UA = window.UA, { S, api, esc, val, toast } = UA;
  const fresh = () => ({ site: null, services: [], sv: null });
  const B = fresh();
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); Object.assign(B, fresh()); };

  const TYPES = [['text', 'نص'], ['select', 'قائمة خيارات'], ['number', 'رقم'], ['date', 'تاريخ']];
  const $id = (id) => document.getElementById(id);
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

  UA.adminCfg = {
    tabs: [['identity', 'هوية الموقع'], ['services', 'الخدمات']],
    view: (t) => (t === 'services' ? (B.sv ? svEditor() : svList()) : identity()),
    load: async (t) => {
      if (t === 'services') { B.services = (await api('GET', '/api/admin/services')).services; B.sv = null; }
      else B.site = (await api('GET', '/api/admin/settings')).site;
    },
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
  A.savesite = async () => {
    const r = await api('PUT', '/api/admin/settings', { university: val('si-uni'), title: val('si-title'), department: val('si-dept') });
    B.site = r.site; UA.S.uni = /[\u0600-\u06FF]/.test(r.site.university) ? r.site.university : UA.S.uni; UA.render(); toast('حُفظت الإعدادات');
  };
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
    await UA.adminCfg.load('services'); UA.render(); toast(d.on === '1' ? 'فُعّلت الخدمة' : 'عُطّلت الخدمة');
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
    await UA.adminCfg.load('services'); UA.render(); toast('حُفظت الخدمة');
  };
})();
