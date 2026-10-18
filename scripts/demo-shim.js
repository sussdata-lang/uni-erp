/* خادم وهمي داخل المتصفح لملف العرض المستقل. يُحقن بعد qr.js (makeQr/qrSvg متاحتان) وقبل سكربتات الواجهة.
   يطبّق ما تحتاجه واجهتا الطالب والموظف، والبيانات مشتركة بينهما: ما يقدّمه الطالب يراه الموظف، وما يعتمده الموظف يراه الطالب. */
(function () {
  const D = window.__DEMO__, now = () => Date.now();
  const st = { students: D.students, requests: D.requests, docs: D.docs, news: D.news, courses: D.courses, grades: D.grades, complaints: D.complaints, programs: D.programs };
  let role = 'student';
  const me = () => st.students.find((s) => s.id === D.saraId);
  const LV = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'];
  const err = (status, message, error, field) => ({ __err: true, status, body: { error: error || 'error', message, field } });
  const staffOnly = () => { if (role !== 'staff') throw err(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden'); };
  const full = (p) => [p.first_name, p.father_name, p.last_name].filter(Boolean).join(' ');
  const prog = (id) => st.programs.find((x) => x.id === Number(id));
  const tmpPw = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)]; return s + '7a'; };
  const maskCard = (s) => ({ id: s.id, studentNo: s.studentNo, name: s.name, status: s.status, statusLabel: s.statusLabel, program: s.program, level: s.level, levelLabel: s.levelLabel, enrollYear: s.enrollYear, phone: s.phone, nationalId: s.nationalId.length <= 4 ? s.nationalId : '•'.repeat(s.nationalId.length - 4) + s.nationalId.slice(-4) });
  const fields = D.options.sections.flatMap((s) => s.fields);
  const nextId = (arr) => Math.max(0, ...arr.map((x) => x.id)) + 1;
  const canonical = (v) => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : (v && typeof v === 'object') ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
  async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  const newCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', p = () => Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join(''); return `UV-${p()}-${p()}`; };

  /* ---- الطلاب (تسجيل وتعديل) ---- */
  function buildStudent(id, no, raw, prev) {
    const p = {};
    for (const f of fields) {
      let v = raw[f.name];
      if ((v === undefined || v === '' || v === null) && f.default !== undefined && !prev) v = f.default;
      if (v === undefined || v === '' || v === null) { if (f.required && !(f.editOnly && !prev)) throw err(400, `الحقل «${f.label}» مطلوب.`, 'validation', f.name); p[f.name] = prev && prev.profile[f.name] !== undefined && f.editOnly ? prev.profile[f.name] : null; continue; }
      if (['int', 'num', 'program'].includes(f.type) || f.name === 'study_level') { v = Number(v); if (Number.isNaN(v)) throw err(400, `قيمة غير صالحة في «${f.label}».`, 'validation', f.name); } else v = String(v).trim();
      p[f.name] = v;
    }
    if (!p.status) p.status = 'active';
    const o = st.students.find((s) => s.profile.national_id === p.national_id && s.id !== id);
    if (o) throw err(409, `الرقم الوطني مسجَّل مسبقاً للطالب ذي الرقم الجامعي ${o.studentNo}.`, 'duplicate', 'national_id');
    const g = prog(p.program_id), t = now();
    return { id, studentNo: no, name: full(p), status: p.status, statusLabel: D.options.statuses[p.status], program: { id: g.id, faculty: g.faculty, name: g.name, degree: g.degree }, level: p.study_level, levelLabel: 'السنة ' + LV[p.study_level - 1],
      enrollYear: p.enroll_year, phone: p.phone, nationalId: p.national_id, profile: p, username: no, mustChangePassword: !prev,
      createdAt: prev ? prev.createdAt : t, updatedAt: t, activeHolds: 0 };
  }

  /* ---- العلامات والمواد ---- */
  const gview = (g) => ({ id: g.id, course: g.course, courseId: g.course_id, level: g.level, semester: g.semester, academicYear: g.academic_year, hours: g.hours, theory: g.theory_mark, practical: g.practical_mark, total: g.mark, passed: g.mark >= 60, instructor: g.instructor ?? null });
  function gradesFor(studentId, level) {
    const rows = st.grades.filter((g) => g.student_id === studentId && (!level || g.level === Number(level)))
      .sort((a, b) => a.semester - b.semester || a.course.localeCompare(b.course, 'ar') || b.academic_year.localeCompare(a.academic_year));
    const by = new Map();
    for (const g of rows) { const k = g.course_id ?? 'x' + g.id; if (!by.has(k)) by.set(k, { ...gview(g), previous: [] }); else by.get(k).previous.push(gview(g)); }
    const list = [...by.values()], hrs = list.reduce((s, g) => s + g.hours, 0);
    return { grades: list, summary: { count: list.length, passed: list.filter((g) => g.passed).length, failed: list.filter((g) => !g.passed).length, average: hrs ? Math.round(list.reduce((s, g) => s + g.hours * g.total, 0) / hrs * 10) / 10 : null }, passMark: 60 };
  }

  /* ---- الطلبات والوثائق ---- */
  const svcOf = (code) => D.services.find((s) => s.code === code);
  const viewReq = (r) => JSON.parse(JSON.stringify(r));
  function validateDetails(svc, input) {
    const out = {};
    for (const f of svc.fields) {
      let v = input && input[f.name]; if (v === undefined || v === null || v === '') v = f.default;
      if (v === undefined || v === '') { if (f.required) throw err(400, `الحقل «${f.label}» مطلوب.`, 'validation'); continue; }
      if (f.type === 'select' && !f.options.includes(v)) throw err(400, `قيمة غير صالحة في «${f.label}».`, 'validation');
      if (f.type === 'number') { v = Number(v); if (!Number.isInteger(v) || v < (f.min ?? 0) || v > (f.max ?? 1000)) throw err(400, `قيمة غير صالحة في «${f.label}».`, 'validation'); }
      out[f.name] = v;
    }
    return out;
  }
  async function issueDoc(r) {
    const s = me(), svc = svcOf(r.service.code);
    const stu = st.students.find((x) => x.id === r.student.id);
    let code; do { code = newCode(); } while (st.docs[code]);
    const payload = { university: D.university, code, requestNo: r.no, service: { code: svc.code, label: svc.label }, student: { name: stu.name, studentNo: stu.studentNo, program: `${stu.program.degree} ${stu.program.name}` }, details: r.details, issuedAt: now() };
    if (svc.code === 'transcript') {
      const g = st.grades.filter((x) => x.student_id === stu.id).sort((a, b) => a.id - b.id).map((x) => ({ term: x.term, course: x.course, hours: x.hours, mark: x.mark })), h = g.reduce((a, x) => a + x.hours, 0);
      payload.transcript = { grades: g, average: h ? Math.round(g.reduce((a, x) => a + x.hours * x.mark, 0) / h * 10) / 10 : null };
    }
    const hash = await sha256(canonical(payload));
    st.docs[code] = { code, issuedAt: payload.issuedAt, hash, payload };
    return code;
  }

  async function route(method, url, body) {
    const u = new URL(url, 'http://x'), path = u.pathname, q = u.searchParams;
    const m = (re) => path.match(re);
    if (path === '/api/me') return { user: window.__demoLoggedOut ? null : D.users[role], transcriptTemplate: window.__trTpl || 'classic' };
    if (path === '/api/auth/login') { const n = String(body.username || '').toLowerCase(); role = /staff|admin|موظف/.test(n) ? 'staff' : 'student'; window.__demoLoggedOut = false; return { user: D.users[role] }; }
    if (path === '/api/auth/logout') { window.__demoLoggedOut = true; return { ok: true }; }
    if (path === '/api/auth/change-password') return { ok: true };
    if (path === '/api/services') return { services: D.services };
    if (path === '/api/programs') return { programs: st.programs };
    if (path === '/api/units/targets') return { targets: [] };
    if (path === '/api/analytics') { staffOnly(); return D.analytics; }
    if (path === '/api/registration/options') return D.options;
    if (path === '/api/news' && method === 'GET') return { news: st.news.slice().sort((a, b) => (b.pinned - a.pinned) || (b.publishedAt - a.publishedAt) || b.id - a.id) };
    if (path === '/api/news' && method === 'POST') { staffOnly(); const t = String(body.title || '').trim(), b = String(body.body || '').trim(); if (t.length < 3) throw err(400, '«العنوان» يجب أن يكون بين 3 و150 حرفاً.', 'validation'); if (b.length < 3) throw err(400, '«النص» يجب أن يكون بين 3 و4000 حرف.', 'validation'); const id = nextId(st.news); st.news.push({ id, title: t, body: b, pinned: !!body.pinned, publishedAt: now() }); return { __status: 201, id }; }
    let x = m(/^\/api\/news\/(\d+)$/); if (x && method === 'DELETE') { staffOnly(); st.news = st.news.filter((n) => n.id !== Number(x[1])); return { ok: true }; }

    /* الملف الشخصي والعلامات (الطالب) */
    if (path === '/api/transcript-template' && method === 'PUT') { window.__trTpl = body.template; return { transcriptTemplate: body.template }; }
    if (path === '/api/me/profile' && method === 'GET') { const s = JSON.parse(JSON.stringify(me())); delete s.profile.notes; return { profile: s }; }
    if (path === '/api/me/profile' && method === 'PUT') {
      const s = me(), p = s.profile;
      for (const k of ['phone', 'email', 'governorate', 'city', 'address', 'emergency_phone']) { const v = body[k]; p[k] = v === undefined || v === '' ? null : String(v).trim(); }
      if (!p.phone || !p.governorate || !p.city || !p.address) throw err(400, 'أكمل الحقول الإلزامية.', 'validation');
      s.phone = p.phone; s.updatedAt = now(); const c = JSON.parse(JSON.stringify(s)); delete c.profile.notes; return { profile: c };
    }
    if (path === '/api/me/grades') { const s = me(), level = Number(q.get('level')) || s.level; return { ...gradesFor(s.id, level), level }; }

    /* دليل المواد */
    if (path === '/api/courses' && method === 'GET') {
      let l = st.courses;
      if (role === 'student') { const s = me(); l = l.filter((c) => c.programId === s.program.id && c.active); const lv = Number(q.get('level')) || s.level; l = l.filter((c) => c.level === lv); }
      else { if (q.get('program')) l = l.filter((c) => c.programId === Number(q.get('program'))); if (q.get('level')) l = l.filter((c) => c.level === Number(q.get('level'))); }
      if (q.get('semester')) l = l.filter((c) => c.semester === Number(q.get('semester')));
      if (role !== 'student') l = l.map((c) => { const g = prog(c.programId) || {}; return { ...c, faculty: g.faculty, facultyId: g.facultyId, facultyCode: g.facultyCode, program: g.name, years: g.years, grades: st.grades.filter((x) => x.course_id === c.id).length }; });
      return { courses: l.slice().sort((a, b) => a.level - b.level || a.semester - b.semester || a.name.localeCompare(b.name, 'ar')), level: q.get('level') ? Number(q.get('level')) : (role === 'student' ? (Number(q.get('level')) || me().level) : null) };
    }
    if (path === '/api/courses' && method === 'POST') {
      staffOnly(); const g = prog(body.programId); if (!g) throw err(400, 'البرنامج غير موجود.', 'validation');
      const name = String(body.name || '').trim(); if (name.length < 2) throw err(400, '«اسم المقرر» يجب أن يكون بين 2 و100 حرف.', 'validation');
      if (st.courses.some((c) => c.programId === g.id && c.level === Number(body.level) && c.semester === Number(body.semester) && c.name === name)) throw err(409, 'المقرر موجود مسبقاً في هذه السنة والفصل.', 'conflict');
      const c = { id: nextId(st.courses), programId: g.id, level: Number(body.level), semester: Number(body.semester), name, code: body.code || null, hours: Number(body.hours ?? 3), instructor: body.instructor || null, active: true };
      st.courses.push(c); return { __status: 201, course: c };
    }
    x = m(/^\/api\/courses\/(\d+)\/toggle$/); if (x && method === 'POST') { staffOnly(); const c = st.courses.find((k) => k.id === Number(x[1])); c.active = !!body.enabled; return { ok: true }; }
    x = m(/^\/api\/students\/(\d+)\/grades$/);
    if (x && method === 'GET') { staffOnly(); return gradesFor(Number(x[1]), null); }
    if (x && method === 'POST') {
      staffOnly(); const sid = Number(x[1]), s = st.students.find((k) => k.id === sid), c = st.courses.find((k) => k.id === Number(body.courseId));
      if (!c || c.programId !== s.program.id) throw err(400, 'المقرر غير موجود في برنامج هذا الطالب.', 'validation');
      const ay = String(body.academicYear || ''), mm = /^(\d{4})\/(\d{4})$/.exec(ay); if (!mm || Number(mm[2]) !== Number(mm[1]) + 1) throw err(400, 'العام الدراسي بصيغة 2025/2026.', 'validation');
      const th = Number(body.theory), pr = body.practical === '' || body.practical == null ? null : Number(body.practical);
      if (!Number.isInteger(th) || th < 0 || th > 100) throw err(400, '«العلامة النظرية» يجب أن تكون عدداً صحيحاً بين 0 و100.', 'validation');
      if (pr !== null && (!Number.isInteger(pr) || pr < 0 || pr > 100)) throw err(400, '«العلامة العملية» يجب أن تكون عدداً صحيحاً بين 0 و100.', 'validation');
      if (th + (pr || 0) > 100) throw err(400, 'مجموع العلامتين لا يتجاوز 100.', 'validation');
      const ex = st.grades.find((g) => g.student_id === sid && g.course_id === c.id && g.academic_year === ay);
      if (ex) { ex.theory_mark = th; ex.practical_mark = pr; ex.mark = th + (pr || 0); }
      else st.grades.push({ id: nextId(st.grades), student_id: sid, term: `${ay}-${c.semester === 1 ? 'الفصل الأول' : 'الفصل الثاني'}`, course: c.name, hours: c.hours, mark: th + (pr || 0), course_id: c.id, level: c.level, semester: c.semester, academic_year: ay, theory_mark: th, practical_mark: pr, instructor: c.instructor });
      return gradesFor(sid, null);
    }

    /* جدول العلامات الكامل (تصفية وترتيب وصفحات) */
    if (path === '/api/grades' && method === 'GET') {
      staffOnly(); const nq = (v) => String(v || '').replace(/[\u064B-\u065F\u0640]/g, '').trim().toLowerCase(), term = nq(q.get('q'));
      let rows = st.grades.map((g) => { const u = st.students.find((k) => k.id === g.student_id) || {}, p = u.program || {}, c = st.courses.find((k) => k.id === g.course_id) || {};
        return { id: g.id, studentId: g.student_id, studentNo: u.studentNo || '', studentName: u.name || '', faculty: p.faculty || '—', facultyId: p.facultyId || null, programId: p.id || null, program: p.name || '—', courseId: g.course_id, course: g.course, code: c.code || null, level: g.level, semester: g.semester, academicYear: g.academic_year, theory: g.theory_mark, practical: g.practical_mark, total: g.mark, passed: g.mark >= 60, enteredAt: g.entered_at || g.id }; });
      if (term) rows = rows.filter((r) => [r.studentNo, r.studentName, r.faculty, r.program, r.course, r.code].some((x) => nq(x).includes(term)));
      if (q.get('faculty')) rows = rows.filter((r) => String(r.facultyId) === q.get('faculty')); if (q.get('level')) rows = rows.filter((r) => String(r.level) === q.get('level')); if (q.get('semester')) rows = rows.filter((r) => String(r.semester) === q.get('semester'));
      if (q.get('year')) rows = rows.filter((r) => r.academicYear === q.get('year')); if (q.get('status')) rows = rows.filter((r) => r.passed === (q.get('status') === 'pass'));
      const sk = { studentNo: 'studentNo', studentName: 'studentName', faculty: 'faculty', course: 'course', level: 'level', academicYear: 'academicYear', total: 'total', theory: 'theory', practical: 'practical', status: 'total', enteredAt: 'enteredAt' }[q.get('sort')] || 'enteredAt', dir = q.get('dir') === 'asc' ? 1 : -1;
      rows.sort((a, b) => ((typeof a[sk] === 'number' ? a[sk] - b[sk] : String(a[sk] ?? '').localeCompare(String(b[sk] ?? ''), 'ar')) * dir) || b.id - a.id);
      const size = Math.min(100, Math.max(5, Number(q.get('size')) || 25)), pages = Math.max(1, Math.ceil(rows.length / size)), page = Math.min(pages, Math.max(1, Number(q.get('page')) || 1)), n = rows.length;
      return { total: n, page, pages, size, options: { faculties: st.programs.filter((p) => p.facultyId).map((p) => ({ id: p.facultyId, name: p.faculty })).filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i), years: [...new Set(st.grades.map((g) => g.academic_year).filter(Boolean))].sort().reverse() },
        summary: { count: n, students: new Set(rows.map((r) => r.studentId)).size, average: n ? Math.round((rows.reduce((a, r) => a + r.total, 0) / n) * 10) / 10 : null, passRate: n ? Math.round((rows.filter((r) => r.passed).length / n) * 1000) / 10 : null }, rows: rows.slice((page - 1) * size, page * size) };
    }

    /* الشكاوى */
    if (path === '/api/complaints' && method === 'GET') { let l = role === 'staff' ? st.complaints : st.complaints.filter((c) => !c.student || c.student.studentNo === me().studentNo); if (q.get('status')) l = l.filter((c) => c.status === q.get('status')); return { complaints: l.slice().sort((a, b) => b.createdAt - a.createdAt).map((c) => (role === 'staff' ? c : { ...c, student: undefined })) }; }
    if (path === '/api/complaints' && method === 'POST') {
      const s = String(body.subject || '').trim(), b = String(body.body || '').trim();
      if (s.length < 3) throw err(400, '«الموضوع» يجب أن يكون بين 3 و120 حرفاً.', 'validation'); if (b.length < 10) throw err(400, '«نص الشكوى» يجب أن يكون بين 10 و2000 حرف.', 'validation');
      const id = nextId(st.complaints), c = { id, no: `CMP-${new Date().getFullYear()}-${String(id).padStart(5, '0')}`, subject: s, body: b, status: 'open', response: null, createdAt: now(), respondedAt: null, student: { name: me().name, studentNo: me().studentNo } };
      st.complaints.push(c); return { __status: 201, complaint: { ...c, student: undefined } };
    }
    x = m(/^\/api\/complaints\/(\d+)\/respond$/);
    if (x) { staffOnly(); const c = st.complaints.find((k) => k.id === Number(x[1])); const r = String(body.response || '').trim(); if (r.length < 3) throw err(400, '«الرد» يجب أن يكون بين 3 و1000 حرف.', 'validation'); c.response = r; c.status = body.close ? 'closed' : 'answered'; c.respondedAt = now(); return { complaint: c }; }

    /* الطلبات */
    if (path === '/api/requests' && method === 'GET') { let l = st.requests; if (role === 'student') l = l.filter((r) => r.student.id === D.saraId); if (q.get('status')) l = l.filter((r) => r.status === q.get('status')); return { requests: l.slice().sort((a, b) => b.createdAt - a.createdAt).map(viewReq) }; }
    if (path === '/api/requests' && method === 'POST') {
      if (role !== 'student') throw err(403, 'لا تملك صلاحية هذا الإجراء.', 'forbidden');
      const svc = svcOf(body.service); if (!svc) throw err(400, 'خدمة غير معروفة.', 'validation');
      const details = validateDetails(svc, body.details);
      if (svc.requiresAttachment && !body.attachment) throw err(400, 'هذه الخدمة تتطلب مرفقاً.', 'validation');
      const s = me(), id = nextId(st.requests), t = now(), bad = svc.code !== 'transcript' && s.status !== 'active';
      const r = { id, no: `REQ-${new Date().getFullYear()}-${String(id).padStart(5, '0')}`, service: { code: svc.code, label: svc.label, sla_hours: svc.slaHours }, details, status: bad ? 'rejected' : 'review',
        rejectReason: bad ? 'حالة قيدك الحالية لا تسمح بهذه الخدمة؛ يرجى مراجعة قسم شؤون الطلاب.' : null, rejectedBy: bad ? 'auto' : null, createdAt: t, decidedAt: bad ? t : null,
        attachment: body.attachment ? { id: id, name: String(body.attachment.name || 'attachment').slice(0, 100), size: Math.round(String(body.attachment.data || '').length * 0.75) } : null, document: null,
        events: [{ at: t, actor: s.name, text: 'تقديم الطلب' }, { at: t, actor: 'النظام', text: bad ? 'الفحص الآلي: رُفض الطلب تلقائياً' : 'الفحص الآلي: اجتاز القواعد، أُحيل لمراجعة الموظف' }], student: { id: s.id, name: s.name, studentNo: s.studentNo } };
      st.requests.push(r); return { __status: 201, request: viewReq(r) };
    }
    x = m(/^\/api\/requests\/(\d+)\/(approve|reject)$/);
    if (x) {
      staffOnly(); const r = st.requests.find((k) => k.id === Number(x[1])); if (!r) throw err(404, 'الطلب غير موجود.', 'not_found'); if (r.status !== 'review') throw err(409, 'تم البت في هذا الطلب مسبقاً.', 'conflict');
      const t = now(), who = D.users.staff.name;
      if (x[2] === 'approve') {
        let code = null; if (svcOf(r.service.code).issuesDocument) code = await issueDoc(r);
        r.status = 'approved'; r.decidedAt = t; if (code) r.document = { code, issuedAt: t };
        r.events.push({ at: t, actor: who, text: code ? `اعتماد الطلب وإصدار وثيقة موقعة برمز ${code}` : 'اعتماد الطلب' });
      } else {
        const why = String(body.reason || '').trim(); if (why.length < 3 || why.length > 300) throw err(400, 'سبب الرفض مطلوب (3-300 حرفاً) ويظهر للطالب.', 'validation');
        r.status = 'rejected'; r.rejectedBy = 'staff'; r.rejectReason = why; r.decidedAt = t; r.events.push({ at: t, actor: who, text: `رفض الطلب: ${why}` });
      }
      return { request: viewReq(r) };
    }
    x = m(/^\/api\/requests\/(\d+)$/); if (x) { const r = st.requests.find((k) => k.id === Number(x[1])); if (!r) throw err(404, 'الطلب غير موجود.', 'not_found'); return { request: viewReq(r) }; }
    if (path === '/api/stats') { staffOnly(); const c = (s) => st.requests.filter((r) => r.status === s).length, ap = st.requests.filter((r) => r.status === 'approved' && r.decidedAt); return { stats: { review: c('review'), approved: c('approved'), rejected: c('rejected'), avgApprovalMs: ap.length ? Math.round(ap.reduce((a, r) => a + (r.decidedAt - r.createdAt), 0) / ap.length) : null, slaBreaches: 0 } }; }

    /* الوثائق والتحقق */
    x = m(/^\/api\/documents\/([A-Za-z0-9-]+)$/); if (x) { const d = st.docs[x[1].toUpperCase()]; if (!d) throw err(404, 'الوثيقة غير موجودة.', 'not_found'); return { document: d }; }
    x = m(/^\/api\/verify\/(.+)$/);
    if (x) {
      const code = decodeURIComponent(x[1]).trim().toUpperCase(); if (!/^UV-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) return { valid: false, reason: 'malformed' };
      const d = st.docs[code]; if (!d) return { valid: false, reason: 'not_found' };
      const p = d.payload, parts = p.student.name.split(' ');
      return { valid: true, code, service: p.service.label, student: parts[0] + (parts[1] ? ` ${parts[1][0]}.` : ''), issuedAt: d.issuedAt, hashPrefix: d.hash.slice(0, 16), university: p.university };
    }

    /* الطلاب (الموظف) */
    if (path === '/api/students' && method === 'GET') {
      staffOnly(); let l = st.students.slice().reverse(); const t = (q.get('q') || '').trim();
      if (t) l = l.filter((s) => [s.studentNo, s.name, s.profile.national_id, s.phone].some((v) => String(v).includes(t)));
      if (q.get('program')) l = l.filter((s) => String(s.program.id) === q.get('program')); if (q.get('status')) l = l.filter((s) => s.status === q.get('status'));
      return { total: l.length, students: l.map(maskCard) };
    }
    if (path === '/api/students' && method === 'POST') {
      staffOnly(); const year = Number(body.enroll_year), g0 = prog(body.program_id), prefix = `${g0 ? g0.facultyCode : 'GEN'}-${year}-`;   // الترميز: رمز الكلية-السنة-تسلسل
      const last = Math.max(0, ...st.students.filter((s) => s.studentNo.startsWith(prefix)).map((s) => Number(s.studentNo.slice(prefix.length))));
      const no = `${prefix}${String(last + 1).padStart(4, '0')}`, s = buildStudent(nextId(st.students) + 10, no, body, null); st.students.push(s);
      return { __status: 201, student: s, credentials: { username: no, tempPassword: tmpPw() } };
    }
    x = m(/^\/api\/students\/(\d+)$/);
    if (x) {
      staffOnly(); const i = st.students.findIndex((s) => s.id === Number(x[1])); if (i < 0) throw err(404, 'الطالب غير موجود.', 'not_found');
      if (method === 'GET') return { student: st.students[i] };
      if (method === 'PUT') { st.students[i] = buildStudent(st.students[i].id, st.students[i].studentNo, body, st.students[i]); return { student: st.students[i] }; }
    }
    x = m(/^\/api\/students\/(\d+)\/reset-password$/); if (x && method === 'POST') { staffOnly(); const s = st.students.find((k) => k.id === Number(x[1])); return { credentials: { username: s.username, tempPassword: tmpPw() } }; }
    throw err(404, 'هذه الميزة غير متاحة في نسخة العرض.', 'not_found');
  }

  window.fetch = async (url, opt = {}) => {
    const method = (opt.method || 'GET').toUpperCase();
    let r, status = 200;
    try { r = await route(method, String(url), opt.body ? JSON.parse(opt.body) : {}); if (r && r.__status) { status = r.__status; delete r.__status; } }
    catch (e) { if (!e.__err) { console.error(e); r = { error: 'internal', message: 'خطأ في نسخة العرض.' }; status = 500; } else { r = e.body; status = e.status; } }
    return new Response(JSON.stringify(r), { status, headers: { 'Content-Type': 'application/json' } });
  };

  /* رموز QR: الواجهة تضع <img src="/api/documents/CODE/qr.svg">؛ نستبدل المصدر بصورة مولّدة محلياً قبل أن يحلّلها المتصفح */
  const qrData = (code) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qrSvg(`https://university.example/?verify=${code.toUpperCase()}`));
  const ih = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { ...ih, set(v) { ih.set.call(this, typeof v === 'string' ? v.replace(/\/api\/documents\/([A-Za-z0-9-]+)\/qr\.svg/g, (_, c) => qrData(decodeURIComponent(c))) : v); } });

  /* شريط العرض وتبديل الدور (طالب/موظف) */
  function bar() {
    const b = document.createElement('div'); b.className = 'demo-bar'; b.setAttribute('role', 'note');
    b.innerHTML = '<span>نسخة عرض تجريبية — بيانات خيالية في الذاكرة فقط وتزول عند إغلاق الصفحة. جرّب: قدّم معاملة كطالب، ثم اعتمدها كموظف.</span><button data-r="student" aria-pressed="true">عرض كطالب</button><button data-r="staff" aria-pressed="false">عرض كموظف</button>';
    document.body.prepend(b);
    b.addEventListener('click', (e) => {
      const r = e.target.dataset && e.target.dataset.r; if (!r) return;
      b.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.r === r)));
      document.body.classList.toggle('demo-desktop', r === 'staff');
      const lo = document.createElement('button'); lo.dataset.act = 'logout'; lo.hidden = true; document.body.append(lo); lo.click(); lo.remove();
      const t0 = Date.now(), iv = setInterval(() => {
        const f = document.getElementById('loginform');
        if (f) { clearInterval(iv); document.getElementById('lg-u').value = r === 'staff' ? 'staff' : 'student'; document.getElementById('lg-p').value = 'demo'; f.requestSubmit(); }
        else if (Date.now() - t0 > 4000) clearInterval(iv);
      }, 60);
    });
  }
  document.addEventListener('DOMContentLoaded', bar);
})();
