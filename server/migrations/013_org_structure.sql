-- الهيكل التنظيمي: رمز ووصف اختصاصات ووحدة النظام المقابلة لكل جهة (يُملأ بـ ensureStructure ويمكن تعديله)
ALTER TABLE org_units ADD COLUMN code TEXT;
ALTER TABLE org_units ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE org_units ADD COLUMN module TEXT;
CREATE UNIQUE INDEX idx_org_units_code ON org_units(code) WHERE code IS NOT NULL;
