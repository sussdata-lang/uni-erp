-- (1) حذف «طلب تسجيل سنة امتياز»: تُحذف الخدمة وقواعدها، وإن وُجدت عليها طلبات قديمة تُعطَّل بدل الحذف حفاظاً على السجل
DELETE FROM rules WHERE service_code = 'excellence_year';
DELETE FROM service_types WHERE code = 'excellence_year' AND NOT EXISTS (SELECT 1 FROM requests WHERE service_code = 'excellence_year');
UPDATE service_types SET enabled = 0 WHERE code = 'excellence_year';

-- (2) «طلب حياة جامعية» بلا خيارات، وخياراته القديمة تنتقل إلى خدمة جديدة «طلب احتياج» تقبل طلبات أخرى وتوصيفها
INSERT INTO service_types (code, label, description, sla_hours, requires_attachment, issues_document, fields_json) VALUES
('needs_request', 'طلب احتياج', 'طلب احتياج (سكن جامعي، تغذية، أو أي احتياج آخر) مع توصيف الطلب.', 72, 0, 0,
 '[{"name":"need_type","label":"نوع الاحتياج","type":"select","options":["السكن الجامعي","التغذية","السكن والتغذية","أخرى"],"required":true},{"name":"reason","label":"سبب الطلب","type":"select","options":["الإقامة خارج مدينة الجامعة","ظرف اجتماعي","أخرى"],"required":true},{"name":"description","label":"توصيف الطلب","type":"text","required":true}]');
INSERT INTO rules (service_code, kind, params_json, message) VALUES
('needs_request', 'student_status', '{"allowed":["active"]}', 'حالة قيدك الحالية لا تسمح بتقديم طلب احتياج؛ يرجى مراجعة قسم شؤون الطلاب.');

-- الطلبات القديمة التي كانت تحمل الخيارات القديمة تنتقل إلى «طلب احتياج» مع بقاء بياناتها
UPDATE requests SET service_code = 'needs_request',
  details_json = json_object('need_type', COALESCE(json_extract(details_json, '$.kind'), 'أخرى'), 'reason', COALESCE(json_extract(details_json, '$.reason'), 'أخرى'), 'description', 'منقول من طلب الحياة الجامعية القديم')
WHERE service_code = 'campus_life' AND json_extract(details_json, '$.kind') IS NOT NULL;

UPDATE service_types SET description = 'طلب الاستفادة من خدمات الحياة الجامعية.', fields_json = '[]' WHERE code = 'campus_life';

-- (3) وسائط الأخبار: صور وفيديو مرفوعة، أو روابط (صورة مباشرة / فيديو مباشر / يوتيوب / فيميو)
CREATE TABLE news_media (
  id         INTEGER PRIMARY KEY,
  news_id    INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  source     TEXT NOT NULL CHECK (source IN ('upload', 'url', 'embed')),
  file       TEXT,              -- اسم الملف المخزَّن (upload)
  mime       TEXT,
  size       INTEGER,
  url        TEXT,              -- رابط https مباشر (url)
  provider   TEXT,              -- youtube | vimeo (embed)
  ref        TEXT,              -- معرّف الفيديو (embed)
  caption    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_news_media ON news_media(news_id, id);
