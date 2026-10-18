-- بيانات إضافية اختيارية للطالب: قائمة {label, value} بحسب حاجة الجهة (مربعات نص مفتوحة عند التسجيل أو التعديل)
ALTER TABLE student_profiles ADD COLUMN extra_json TEXT;
