-- مدة الدراسة: كلية الأمن السيبراني 4 سنوات، وكلية العلوم الأمنية 3 سنوات.
-- يُخفَّض الرقم فقط إن لم يوجد طالب أو مقرر في سنة أعلى منه (كي لا تتناقض البيانات القائمة).
UPDATE programs SET years = 3
 WHERE faculty_id = (SELECT id FROM faculties WHERE code = 'CSS') AND years > 3
   AND NOT EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.program_id = programs.id AND sp.study_level > 3)
   AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.program_id = programs.id AND c.level > 3);
UPDATE programs SET years = 4
 WHERE faculty_id = (SELECT id FROM faculties WHERE code = 'CCS') AND years <> 4;
