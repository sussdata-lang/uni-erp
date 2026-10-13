/* الاستيراد من Excel / CSV / SQL: طلاب، مقررات، علامات. فحص بلا حفظ ثم اعتماد. */
(function () {
  const UA = window.UA, { S, api, esc, toast, can } = UA;
  const KINDS = [
    { k: 'students', perm: 'student:register', title: 'الطلاب', tpl: '/templates/students-template.xlsx', desc: 'أسماء الطلاب وبياناتهم الكاملة. يُولَّد لكل طالب اسم مستخدم بترميز الكلية (مثل CCS-2026-0001) وكلمة مرور مؤقتة تُسلَّم في ملف منفصل مرة واحدة.' },
    { k: 'courses', perm: 'course:manage', title: 'المقررات', tpl: '/templates/courses-template.xlsx', desc: 'مقررات الكليات والمعاهد (الجهة، السنة، الفصل، الاسم، الرمز، الساعات، المدرّس). المقرر الموجود يُحدَّث ولا يتكرر.' },
    { k: 'grades', perm: 'grade:manage', title: 'العلامات', tpl: '/templates/grades-template.xlsx', desc: 'علامات الطلاب (الرقم الجامعي، المقرر، العام الدراسي، النظري والعملي). استورد المقررات أولاً.' },
  ];
  const st = {};   // لكل نوع: { file, b64, name, res, busy }
  const prevReset = UA.reset; UA.reset = () => { if (prevReset) prevReset(); for (const k of Object.keys(st)) delete st[k]; };

  const b64 = async (file) => { const u = new Uint8Array(await file.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

  function card(K) {
    const s = st[K.k] ?? (st[K.k] = {}), r = s.res;
    let out = '';
    if (r) {
      const ok = r.errorCount === 0;
      out = `<div class="imp-sum"><div class="stat"><small>صفوف الملف</small><b>${r.total}</b></div><div class="stat"><small>${r.committed ? 'تم الاستيراد' : 'صالحة للاستيراد'}</small><b>${r.committed ? r.created + (r.updated || 0) : r.valid}</b></div><div class="stat"><small>مرفوضة</small><b>${r.errorCount}</b></div></div>
        ${r.committed ? `<p class="${ok ? 'ok-t' : 'reason'}">اكتمل الاستيراد${r.updated ? ` (${r.created} جديد، ${r.updated} محدَّث)` : ''}.</p>` : `<p class="hint">هذا فحص فقط: لم يُحفظ شيء بعد.${r.preview.length ? ` أمثلة: ${r.preview.slice(0, 3).map(esc).join('، ')}…` : ''}</p>`}
        ${r.unusedColumns && r.unusedColumns.length ? `<p class="small">أعمدة لم تُستخدم: ${r.unusedColumns.map(esc).join('، ')}</p>` : ''}
        ${r.errorCount ? `<div class="tbl-wrap" style="max-height:260px;overflow:auto"><table><thead><tr><th>الصف</th><th>سبب الرفض</th></tr></thead><tbody>${r.errors.map((e) => `<tr><td>${e.row}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>${r.errorCount > r.errors.length ? `<p class="small">يُعرض أول ${r.errors.length} خطأ فقط.</p>` : ''}` : ''}
        ${r.committed && r.credentialsXlsx ? `<div class="actions"><button class="btn pri" data-act="impcred" data-k="${K.k}">تحميل ملف بيانات الدخول (يظهر مرة واحدة)</button></div><p class="small">يحوي كلمات المرور المؤقتة؛ سلّمه للطلاب بالطريقة المعتمدة ثم احذفه. يُلزَم كل طالب بتغييرها عند أول دخول.</p>` : ''}
        ${!r.committed && r.valid > 0 ? `<div class="actions"><button class="btn pri" data-act="impgo" data-k="${K.k}"${s.busy ? ' disabled' : ''}>اعتماد الاستيراد (${r.valid} صف)</button></div>` : ''}`;
    }
    return `<section class="card"><h2>استيراد ${K.title}</h2><p class="hint" style="margin-top:0">${esc(K.desc)}</p>
      <div class="actions" style="margin-top:0"><a class="btn" href="${K.tpl}" download>تحميل قالب Excel</a></div>
      <div class="inline-form" style="margin-top:12px"><label>الملف (xlsx أو csv أو sql)<input type="file" id="imp-f-${K.k}" accept=".xlsx,.csv,.sql,.txt"></label><button class="btn" data-act="impcheck" data-k="${K.k}"${s.busy ? ' disabled' : ''}>${s.busy ? 'جارٍ المعالجة…' : 'فحص الملف'}</button></div>
      ${s.name ? `<p class="small">الملف المحدَّد: ${esc(s.name)}</p>` : ''}${out}</section>`;
  }

  UA.views.import = () => {
    const ks = KINDS.filter((K) => can(K.perm));
    return `<section class="card"><h2>الاستيراد الجماعي</h2><p class="hint" style="margin-top:0">حمّل القالب، عبّئه، ثم ارفعه. تُفحص الصفوف أولاً دون حفظ، وتُعرض الأخطاء برقم الصف، ثم تعتمد الاستيراد. ملفات <b>SQL</b> تُقرأ منها جمل <span dir="ltr" class="mono">INSERT</span> فقط ولا يُنفَّذ أي أمر SQL.</p></section><div class="stack" style="margin-top:16px">${ks.map(card).join('')}</div>`;
  };
  UA.loaders.import = async () => {};

  const run = async (K, commit) => {
    const s = st[K], inp = document.getElementById(`imp-f-${K}`), f = (inp && inp.files[0]) || null;
    if (f) { s.file = f; s.name = f.name; s.b64 = await b64(f); s.res = null; }
    if (!s.b64) { toast('اختر ملفاً أولاً'); return; }
    s.busy = true; UA.render();
    try { s.res = await api('POST', `/api/import/${K}`, { filename: s.name, data: s.b64, commit }); if (commit) s.b64 = null; }
    catch (e) { if (!e.status) throw e; s.res = null; toast(e.message); } finally { s.busy = false; UA.render(); }
  };
  Object.assign(UA.actions, {
    impcheck: (el, d) => run(d.k, false),
    impgo: (el, d) => { if (confirm('سيُحفظ الاستيراد في النظام. متابعة؟')) return run(d.k, true); },
    impcred: async (el, d) => {
      const r = st[d.k] && st[d.k].res; if (!r || !r.credentialsXlsx) return;
      const bin = atob(r.credentialsXlsx), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = 'student-credentials.xlsx'; a.click();
      delete r.credentialsXlsx; setTimeout(() => { URL.revokeObjectURL(a.href); UA.render(); }, 500);
    },
  });
})();
