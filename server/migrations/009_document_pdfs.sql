-- بصمات ملفات PDF التي صدرت لوثائق الطلبات المعتمدة: تتيح التحقق العام بفحص الملف نفسه (SHA-256)
CREATE TABLE IF NOT EXISTS document_pdfs (
  pdf_sha256 TEXT PRIMARY KEY,
  code       TEXT NOT NULL REFERENCES documents(code),
  created_at INTEGER NOT NULL
);
