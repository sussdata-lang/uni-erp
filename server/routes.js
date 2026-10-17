/* واجهة الطالب: الخدمات، تقديم الطلبات (تأجيل، انسحاب، تحويل، تظلّم)، والملف الشخصي */
(function () {
  const UA = window.UA, { S, api, esc, fmt, val, toast } = UA;
  const ST = { review: ['p-review', 'قيد المراجعة'], approved: ['p-approved', 'معتمد'], rejected: ['p-rejected', 'مرفوض'] };

  const A = { tab: 'services', services: [], requests: [], req: null, cert: null };
  const prevReset = UA.reset; UA.reset = () => { if (prevReset) prevReset(); Object.assign(A, { tab: 'services', requests: [], req: null, cert: null }); };

  const bar = (tabs, cur, act) => `<div class="sub-tabs no-print" role="tablist">${tabs.map((t) => `<button class="chip" role="tab" data-act="${act}" data-t="${t[0]}" aria-pressed="${cur === t[0]}">${t[1]}</button>`).join('')}</div>`;

  UA.loaders.student = async () => {
    const [sv, rq, ct] = await Promise.all([api('GET', '/api/services').then((r) => r.services), api('GET', '/api/requests').then((r) => r.requests), api('GET', '/api/me/certificate').then((r) => r.certificate).catch(() => null)]);
    A.services = sv; A.requests = rq; A.cert = ct;
  };

  function servicesTab() {
    const cards = A.services.map((s) => `<div class="req"><div class="req-h"><b>${esc(s.label)}</b><button class="btn sm pri" data-act="reqnew" data-code="${esc(s.code)}">طلب الخدمة</button></div>
      <p class="hint" style="margin:6px 0">${esc(s.description)}</p><div class="small">المدة المتوقعة للإنجاز: <b>${s.slaHours} ساعة</b>${s.requiresAttachment ? ' · يتطلب مرفقاً' : ''}</div></div>`).join('');
    return `<section class="card"><h2>الخدمات المتاحة</h2><p class="hint" style="margin-top:0">اختر الخدمة المطلوبة لتقديم طلب إلكتروني فوري.</p><div class="stack">${cards}</div></section>`;
  }

  function requestsTab() {
    const rows = A.requests.map((r) => {
      const st = ST[r.status] || ST.review;
      return `<tr class="row" tabindex="0" data-act="rqsel" data-id="${r.id}" aria-selected="${A.req && A.req.id === r.id}"><td class="mono">${esc(r.no)}</td><td>${esc(r.service.label)}</td><td><span class="pill ${st[0]}">${st[1]}</span></td><td class="hint nowrap">${fmt(r.createdAt)}</td></tr>`;
    }).join('');
    const sel = A.req;
    const det = sel ? `<dl class="kv"><dt>رقم الطلب</dt><dd class="mono">${esc(sel.no)}</dd><dt>الخدمة</dt><dd><b>${esc(sel.service.label)}</b></dd><dt>الحالة</dt><dd><span class="pill ${ST[sel.status][0]}">${ST[sel.status][1]}</span></dd><dt>تاريخ التقديم</dt><dd>${fmt(sel.createdAt)}</dd>
      ${sel.rejectReason ? `<dt>سبب الرفض</dt><dd class="reason">${esc(sel.rejectReason)}</dd>` : ''}
      ${sel.document ? `<dt>الوثيقة الصادرة</dt><dd><a class="btn sm pri" href="/api/documents/${esc(sel.document.code)}/pdf" target="_blank" rel="noopener">تحميل الوثيقة الموقَّعة (PDF)</a></dd>` : ''}
      <dt>سجل المراحل</dt><dd><ul class="events">${sel.events.map((e) => `<li><b>${esc(e.actor)}</b>: ${esc(e.text)} <small>${fmt(e.at)}</small></li>`).join('')}</ul></dd></dl>` : '<div class="empty">اختر طلباً من القائمة لعرض تفاصيله.</div>';
    return `<div class="grid2"><section class="card"><h2>طلباتي</h2><div class="tbl-wrap"><table><thead><tr><th>الرقم</th><th>الخدمة</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">لا توجد طلبات مقدمة.</td></tr>'}</tbody></table></div></section>
      <section class="card"><h2>تفاصيل الطلب</h2>${det}</section></div>`;
  }

  UA.views.student = () => bar([['services', 'الخدمات المتاحة'], ['requests', 'طلباتي']], A.tab || 'services', 'sttab') + ((A.tab || 'services') === 'services' ? servicesTab() : requestsTab());

  Object.assign(UA.actions, {
    sttab: async (el, d) => { A.tab = d.t; UA.render(); },
    reqnew: async (el, d) => {
      const s = A.services.find((x) => x.code === d.code); if (!s) return;
      const fieldsHtml = s.fields.map((f) => `<label>${esc(f.label)}${f.required ? ' *' : ''}${f.type === 'select' ? `<select name="f_${f.name}">${f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>` : `<input name="f_${f.name}" type="${f.type === 'date' ? 'date' : 'text'}" ${f.required ? 'required' : ''}>`}</label>`).join('');
      const html = `<h2 id="mttl">طلب ${esc(s.label)}</h2><form class="form" id="reqsub" style="border:0;padding:0;margin:0"><input type="hidden" id="rq-code" value="${esc(s.code)}">${fieldsHtml}
        <label>مرفق${s.requiresAttachment ? ' (إلزامي)' : ' (اختياري)'}<input id="rq-att" type="file" accept=".pdf,image/png,image/jpeg" ${s.requiresAttachment ? 'required' : ''}></label><div class="small">الأنواع المسموحة: PDF، PNG، JPG. الحجم الأقصى 2 ميغابايت.</div>
        <div class="actions"><button class="btn pri" type="submit">إرسال الطلب</button><button class="btn" type="button" data-act="mclose">إلغاء</button></div></form>`;
      UA.modal = { html }; UA.render();
    },
    rqsel: async (el, d) => { A.req = await api('GET', '/api/requests/' + d.id).then((r) => r.request); UA.render(); },
  });

  Object.assign(UA.forms, {
    reqsub: async () => {
      const code = val('rq-code'), s = A.services.find((x) => x.code === code); if (!s) return;
      const details = {};
      for (const f of s.fields) { const el = document.querySelector(`[name="f_${f.name}"]`); if (el) details[f.name] = el.value; }
      let att = null, fileInput = document.getElementById('rq-att');
      if (fileInput && fileInput.files[0]) {
        const fl = fileInput.files[0];
        if (fl.size > 2 * 1048576) { toast('حجم المرفق يتجاوز 2 ميغابايت'); return; }
        const u = new Uint8Array(await fl.arrayBuffer()); let b = ''; for (let i = 0; i < u.length; i += 0x8000) b += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
        att = { name: fl.name, data: b };
      }
      try {
        await api('POST', '/api/requests', { service: code, details, attachment: att });
        UA.modal = null; await UA.loaders.student(); A.tab = 'requests'; UA.render(); toast('أُرسل الطلب بنجاح');
      } catch (e) { if (!e.status) throw e; toast(e.message); }
    },
  });
})();
