/* تنبيهات الجوال (Web Push): أخبار جديدة، علامات جديدة، ردود على الطلبات والشكاوى. تُفعَّل من قائمة الإشعارات في الأعلى. */
(function () {
  const UA = window.UA, { S, api, esc, toast } = UA;
  const P = { on: false, busy: false };
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const u8 = (b64u) => { const p = '='.repeat((4 - (b64u.length % 4)) % 4), b = atob((b64u + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };

  async function refresh() {
    if (!supported() || !S.me) { P.on = false; return; }
    try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); P.on = !!sub && Notification.permission === 'granted'; } catch { P.on = false; }
  }
  async function enable() {
    if (!supported()) throw new Error('متصفحك لا يدعم التنبيهات.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('لم يُسمح بالتنبيهات. فعّلها من إعدادات المتصفح للموقع.');
    const reg = await navigator.serviceWorker.ready, { key } = await api('GET', '/api/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(key) });
    const j = sub.toJSON();
    await api('POST', '/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys, ua: navigator.userAgent.slice(0, 100) });
    P.on = true;
  }
  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription();
    if (sub) { try { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }); } catch { /* */ } await sub.unsubscribe(); }
    P.on = false;
  }
  function panel() {
    if (!S.me || S.me.mustChange) return '';
    let body;
    if (!supported()) body = '<p class="small" style="margin:6px 0 0">متصفحك لا يدعم تنبيهات الجوال. على آيفون: أضف الموقع إلى الشاشة الرئيسية أولاً ثم افتحه منها.</p>';
    else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') body = '<p class="small" style="margin:6px 0 0">التنبيهات محظورة لهذا الموقع. فعّلها من إعدادات المتصفح ثم أعد المحاولة.</p>';
    else body = `<p class="small" style="margin:6px 0 8px">${S.me.role === 'student' ? 'تنبيه على جوالك عند نشر خبر جديد أو رصد علامة جديدة أو الرد على طلب أو شكوى.' : 'تنبيه على هذا الجهاز عند ورود أحداث جديدة.'}</p>
      <div class="actions" style="margin:0"><button class="btn ${P.on ? '' : 'pri'} sm" data-act="${P.on ? 'pushoff' : 'pushon'}"${P.busy ? ' disabled' : ''}>${P.on ? 'إيقاف التنبيهات على هذا الجهاز' : 'تفعيل تنبيهات الجوال'}</button>${P.on ? '<button class="btn sm" data-act="pushtest">إرسال تنبيه تجريبي</button>' : ''}</div>`;
    return `<div class="sx-push"><strong>${UA.icon('bell', 16)} تنبيهات الجوال</strong>${body}</div>`;
  }
  Object.assign(UA.actions, {
    pushon: async () => { P.busy = true; try { await enable(); toast('فُعّلت التنبيهات على هذا الجهاز'); } catch (e) { toast(e.message || 'تعذّر تفعيل التنبيهات'); } P.busy = false; UA.render(); },
    pushoff: async () => { await disable(); toast('أُوقفت التنبيهات على هذا الجهاز'); UA.render(); },
    pushtest: async () => { await api('POST', '/api/push/test', {}); toast('أُرسل تنبيه تجريبي'); },
  });
  UA.push = { panel, refresh, supported };
  // بعد تسجيل الدخول: اعرف حالة الاشتراك وحدّث الواجهة مرة واحدة
  let last = null;
  setInterval(async () => { const id = S.me ? S.me.id || S.me.name : null; if (id !== last) { last = id; if (id) { await refresh(); UA.render(); } } }, 1500);
  // تحديث الاشتراك إن غيّره المتصفح
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', async (e) => { if (e.data && e.data.type === 'push-resubscribe' && S.me) { try { await enable(); } catch { /* */ } } });
})();
