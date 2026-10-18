/* بطاقة الطالب (باركود + بيانات الدخول) + طباعة آمنة + صورة الطالب (رفع ملف / تصوير بالكاميرا) */
(function () {
  const UA = window.UA, { esc, S, api, toast } = UA;

  /* ---------- طباعة عنصر واحد: ننسخه إلى جذر طباعة مستقل بدل إخفاء الصفحة (الإخفاء كان يقصّ البطاقة داخل النوافذ المنبثقة) ---------- */
  UA.printHtml = function (html) {
    let root = document.getElementById('printroot');
    if (!root) { root = document.createElement('div'); root.id = 'printroot'; document.body.appendChild(root); }
    root.innerHTML = html;
    document.body.classList.add('print-root');
    const done = () => { document.body.classList.remove('print-root'); root.innerHTML = ''; };
    window.addEventListener('afterprint', done, { once: true });
    setTimeout(() => { try { window.print(); } catch { done(); } }, 80);
  };

  /* ---------- البطاقة ---------- */
  const photoOf = (files) => (files || []).filter((f) => f.kind === 'photo').pop() || null;
  function card(st, o = {}) {
    const prog = (st.program && (st.program.label || st.program.name)) || o.program || '';
    const lvl = st.levelLabel || o.level || '';
    const ph = o.photoUrl || (photoOf(o.files) || {}).url;
    const uni = String(S.uni || 'الجامعة السورية للعلوم الأمنية');
    const cred = o.cred
      ? `<dl class="idc-k"><div><dt>اسم المستخدم</dt><dd dir="ltr">${esc(o.cred.username)}</dd></div><div><dt>كلمة المرور المؤقتة</dt><dd dir="ltr">${esc(o.cred.tempPassword)}</dd></div></dl>
         <p class="idc-note">كلمة المرور المؤقتة تُعرض مرة واحدة فقط، ويُطلب من الطالب تغييرها عند أول دخول.</p>` : '';
    return `<div class="idc" id="idcard">
      <div class="idc-h"><img src="/brand/crest.svg" alt="" width="40" height="48"><div><b>${esc(uni)}</b><span>وزارة الداخلية — قسم شؤون الطلاب</span></div></div>
      <div class="idc-t">${o.cred ? 'بطاقة بيانات الطالب' : 'بطاقة الطالب'}</div>
      <div class="idc-b">
        <div class="idc-who">${ph ? `<img class="idc-ph" src="${esc(ph)}" alt="">` : ''}<div><div class="idc-n">${esc(st.name)}</div><div class="idc-s">${esc(prog)}${lvl ? ' · ' + esc(lvl) : ''}</div></div></div>
        <div class="idc-bc">${UA.code128 ? UA.code128(st.studentNo) : ''}<span dir="ltr">${esc(st.studentNo)}</span></div>
        ${cred}
      </div>
      <div class="idc-f">${esc(uni)}</div>
    </div>`;
  }
  UA.idCard = card;

  /* ---------- الكاميرا ---------- */
  function camera(onFile) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('المتصفح لا يدعم الكاميرا؛ استخدم رفع ملف.'); return; }
    const ov = document.createElement('div');
    ov.className = 'overlay cam-ov'; ov.setAttribute('dir', 'rtl'); ov.style.zIndex = '70';
    ov.innerHTML = `<div class="sheet cam-sheet" role="dialog" aria-modal="true" aria-label="تصوير الصورة الشخصية">
      <div class="sheet-bar"><b>تصوير الصورة الشخصية</b><button class="btn sm" data-cam="close">إغلاق</button></div>
      <div class="cam-box"><video autoplay playsinline muted></video><img alt="" hidden><div class="cam-frame" aria-hidden="true"></div></div>
      <p class="hint cam-msg" role="status">جارٍ تشغيل الكاميرا…</p>
      <div class="actions"><button class="btn pri" data-cam="shot" disabled>التقاط</button><button class="btn" data-cam="again" hidden>إعادة التقاط</button><button class="btn pri" data-cam="use" hidden>استخدام الصورة</button></div></div>`;
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s), video = $('video'), prev = $('.cam-box img'), msg = $('.cam-msg');
    let stream = null, blob = null;
    const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    const close = () => { stop(); ov.remove(); };
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false });
        video.srcObject = stream; await video.play().catch(() => {});
        msg.textContent = 'ضع وجه الطالب داخل الإطار ثم اضغط «التقاط».'; $('[data-cam=shot]').disabled = false;
      } catch (e) { msg.textContent = e && e.name === 'NotAllowedError' ? 'لم يُسمح بالوصول إلى الكاميرا. فعّل الإذن من إعدادات المتصفح ثم أعد المحاولة.' : 'تعذّر تشغيل الكاميرا على هذا الجهاز؛ استخدم رفع ملف.'; }
    };
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cam]'); if (!b) { if (e.target === ov) close(); return; }
      e.stopPropagation();
      const a = b.dataset.cam;
      if (a === 'close') close();
      else if (a === 'shot') {
        const w = video.videoWidth || 720, h = video.videoHeight || 960;
        // قصّ بنسبة 3:4 (صورة شخصية مستطيلة)
        let cw = w, ch = Math.round((w * 4) / 3); if (ch > h) { ch = h; cw = Math.round((h * 3) / 4); }
        const cv = document.createElement('canvas'); cv.width = Math.min(cw, 900); cv.height = Math.round(cv.width * 4 / 3);
        cv.getContext('2d').drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cv.width, cv.height);
        cv.toBlob((bl) => { blob = bl; prev.src = URL.createObjectURL(bl); prev.hidden = false; video.hidden = true; stop();
          $('[data-cam=shot]').hidden = true; $('[data-cam=again]').hidden = false; $('[data-cam=use]').hidden = false; msg.textContent = 'تحقّق من الصورة ثم اضغط «استخدام الصورة».'; }, 'image/jpeg', 0.9);
      } else if (a === 'again') { blob = null; prev.hidden = true; video.hidden = false; $('[data-cam=shot]').hidden = false; $('[data-cam=again]').hidden = true; $('[data-cam=use]').hidden = true; start(); }
      else if (a === 'use' && blob) { const f = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }); close(); onFile(f); }
    });
    document.addEventListener('keydown', function esc1(e) { if (!document.body.contains(ov)) { document.removeEventListener('keydown', esc1); return; } if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc1); } });
    start();
  }
  UA.camera = camera;

  /* ---------- صورة الطالب في أعلى سجله (مستطيلة) ---------- */
  UA.photoBox = function (st) {
    const ph = photoOf(S.stFiles);
    return `<div class="phb"><div class="phb-img">${ph ? `<a href="${esc(ph.url)}" target="_blank" rel="noopener"><img src="${esc(ph.url)}" alt="الصورة الشخصية"></a>` : `<span class="phb-ph" aria-hidden="true">${esc(String(st.name || '؟').trim()[0] || '؟')}</span>`}</div>
      <div class="phb-a no-print"><button class="btn sm" type="button" data-act="phfile" data-id="${st.id}">${ph ? 'تغيير' : 'رفع صورة'}</button><button class="btn sm" type="button" data-act="phcam" data-id="${st.id}">كاميرا</button>
      <input type="file" class="phb-in" id="phb-in-${st.id}" accept="image/jpeg,image/png,image/webp" hidden></div></div>`;
  };
  async function sendPhoto(id, file) {
    try {
      await UA.upload(`/api/students/${id}/files?kind=photo&name=${encodeURIComponent(file.name)}`, file);
      S.stFiles = (await api('GET', `/api/students/${id}/files`)).files;
      toast('حُفظت الصورة الشخصية'); UA.render();
      if (UA.studentsTable) { if (UA.studentsTable.paint) UA.studentsTable.paint(); if (UA.studentsTable.refresh) UA.studentsTable.refresh(); }
    } catch (e) { toast(e && e.status ? e.message : 'تعذّر رفع الصورة'); }
  }
  Object.assign(UA.actions, {
    phfile: (el, d) => { const i = document.getElementById('phb-in-' + d.id); if (!i) return; i.onchange = () => { if (i.files[0]) sendPhoto(d.id, i.files[0]); }; i.click(); },
    phcam: (el, d) => camera((f) => sendPhoto(d.id, f)),
    // في نموذج التسجيل/التعديل: نضع الملف الملتقَط في حقل الصورة نفسه
    formcam: () => camera((f) => {
      const inp = document.getElementById('att-photo'); if (!inp) return;
      try { const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; } catch { toast('تعذّر إرفاق الصورة؛ استخدم رفع ملف.'); return; }
      const m = document.getElementById('formcam-msg'); if (m) m.textContent = 'ستُرفَق الصورة الملتقَطة عند الحفظ.';
    }),
    credprint: () => { if (!S.cred) return; UA.printHtml(card({ name: S.cred.name, studentNo: S.cred.username, program: S.cred.program, levelLabel: S.cred.level }, { cred: S.cred, files: S.cred.files })); },
    bcprint: () => { const st = S.stSel; if (st) UA.printHtml(card(st, { files: S.stFiles })); },
  });
})();
