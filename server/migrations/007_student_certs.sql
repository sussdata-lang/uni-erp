-- شهادة تسجيل موقَّعة رقمياً لكل طالب (تُنشأ تلقائياً عند إنشاء حسابه)
CREATE TABLE student_certs (
  id               INTEGER PRIMARY KEY,
  student_id       INTEGER NOT NULL UNIQUE REFERENCES users(id),
  code             TEXT NOT NULL UNIQUE,            -- SC-XXXX-XXXX (رمز التحقق في QR)
  payload_json     TEXT NOT NULL,                   -- بيانات الشهادة التي تظهر في الوثيقة
  payload_sha256   TEXT NOT NULL,
  pdf_sha256       TEXT NOT NULL UNIQUE,            -- بصمة الملف النهائي كاملاً
  file             TEXT NOT NULL,
  created_at       INTEGER NOT NULL,                -- وقت إنشاء حساب الطالب
  signed_at        INTEGER NOT NULL,
  tsa_status       TEXT NOT NULL CHECK (tsa_status IN ('rfc3161', 'local', 'failed')),
  tsa_url          TEXT,
  tsa_time         INTEGER,
  cert_subject     TEXT NOT NULL,
  cert_fingerprint TEXT NOT NULL,
  cert_self_signed INTEGER NOT NULL
);
