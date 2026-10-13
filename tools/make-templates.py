# يولّد قوالب Excel للاستيراد (طلاب، مقررات، علامات) من تعريف النموذج الفعلي.
# الاستخدام: node tools/dump-forms.mjs > /tmp/forms.json  ثم  python3 tools/make-templates.py /tmp/forms.json public/templates
import json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter as L

forms = json.load(open(sys.argv[1], encoding='utf-8')); out = sys.argv[2]
GREEN, GOLD, LIGHT = '054239', 'C9A24B', 'E2EEE9'
hfont = Font(bold=True, color='FFFFFF', name='Calibri', size=11); hfill = PatternFill('solid', fgColor=GREEN); reqfill = PatternFill('solid', fgColor='7A5C12')
thin = Side(style='thin', color='DCE3DD'); border = Border(left=thin, right=thin, top=thin, bottom=thin)
FAC = [f['name'] for f in forms['faculties']]
LEVELS = ['السنة الأولى', 'السنة الثانية', 'السنة الثالثة', 'السنة الرابعة', 'السنة الخامسة', 'السنة السادسة', 'السنة السابعة']

def build(fname, cols, lists, instructions_title, notes):
    # cols: [{h, req, kind:'text'|'list', list, width, fmt, help, allowed, example}]
    wb = Workbook(); ws = wb.active; ws.title = 'البيانات'; ws.sheet_view.rightToLeft = True
    lst = wb.create_sheet('القوائم'); ins = wb.create_sheet('التعليمات', 1); ins.sheet_view.rightToLeft = True; lst.sheet_state = 'hidden'
    li = 1
    ref = {}
    for name, vals in lists.items():
        lst.cell(1, li, name)
        for i, v in enumerate(vals): lst.cell(i + 2, li, v)
        ref[name] = f"'القوائم'!${L(li)}$2:${L(li)}${len(vals) + 1}"; li += 1
    for ci, c in enumerate(cols, 1):
        cell = ws.cell(1, ci, c['h'] + (' *' if c.get('req') else ''))
        cell.font = hfont; cell.fill = reqfill if c.get('req') else hfill; cell.border = border
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        ws.column_dimensions[L(ci)].width = c.get('width', 18)
        if c.get('text'):
            for r in range(2, 2002): ws.cell(r, ci).number_format = '@'
        if c.get('list'):
            dv = DataValidation(type='list', formula1='=' + ref[c['list']], allow_blank=True, showErrorMessage=True, errorTitle='قيمة غير مسموحة', error='اختر من القائمة المنسدلة.')
            dv.promptTitle = c['h']; dv.prompt = c.get('help', '')[:250]; dv.showInputMessage = bool(c.get('help')); ws.add_data_validation(dv); dv.add(f'{L(ci)}2:{L(ci)}2001')
        elif c.get('help'):
            dv = DataValidation(type='custom', formula1='TRUE', allow_blank=True); dv.promptTitle = c['h']; dv.prompt = c['help'][:250]; dv.showInputMessage = True; ws.add_data_validation(dv); dv.add(f'{L(ci)}2:{L(ci)}2001')
    ws.row_dimensions[1].height = 34; ws.freeze_panes = 'A2'; ws.auto_filter.ref = f'A1:{L(len(cols))}1'
    # التعليمات
    ins['A1'] = instructions_title; ins['A1'].font = Font(bold=True, size=14, color=GREEN)
    r = 3
    for n in notes:
        ins.cell(r, 1, n).alignment = Alignment(wrap_text=True, vertical='top'); ins.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5); ins.row_dimensions[r].height = 32; r += 1
    r += 1
    for ci, h in enumerate(['العمود', 'إلزامي', 'الصيغة / القيم المسموحة', 'مثال', 'ملاحظة'], 1):
        c = ins.cell(r, ci, h); c.font = hfont; c.fill = hfill; c.border = border; c.alignment = Alignment(horizontal='center')
    for c in cols:
        r += 1
        allowed = c.get('allowed') or (('، '.join(lists[c['list']])[:300]) if c.get('list') else c.get('fmt', 'نص'))
        for ci, v in enumerate([c['h'], 'نعم' if c.get('req') else 'لا', allowed, c.get('example', ''), c.get('note', '')], 1):
            cell = ins.cell(r, ci, v); cell.border = border; cell.alignment = Alignment(wrap_text=True, vertical='top')
    for col, w in zip('ABCDE', [26, 9, 50, 26, 40]): ins.column_dimensions[col].width = w
    wb.save(f'{out}/{fname}')

# ---------- الطلاب ----------
cols = [dict(h='الكلية / المعهد', req=True, list='الكليات', width=30, help='اختر الجهة من القائمة (أو رمزها: CSS, CCS ...).', example=FAC[1], note='يحدّد بادئة اسم المستخدم: مثل CSS-2026-0001')]
cols.append(dict(h='البرنامج', width=22, fmt='اتركه فارغاً إن كان للجهة برنامج واحد', example='', note='يُملأ فقط إن كان للجهة عدة برامج'))
lists = {'الكليات': FAC}
samples = {'first_name': 'ليلى', 'father_name': 'أحمد', 'grandfather_name': 'محمود', 'last_name': 'الحسن', 'mother_name': 'سعاد الخطيب', 'name_en': 'Layla Alhasan', 'national_id': '01234567890', 'gender': 'أنثى', 'birth_date': '2006-03-14', 'birth_place': 'دمشق', 'nationality': 'سورية', 'phone': '0944123456', 'governorate': 'دمشق', 'city': 'المزة', 'address': 'شارع الجلاء - بناء 5', 'hs_type': None, 'hs_year': '2024', 'hs_score': '2100', 'hs_max': '2400', 'enroll_year': '2026', 'guardian_name': 'أحمد الحسن', 'guardian_phone': '0933111222'}
for s in forms['secs']:
    for f in s['fields']:
        if f['type'] == 'program': continue
        c = dict(h=f['label'], req=f['required'], width=max(16, min(34, len(f['label']) + 8)), help=f['hint'], note=f['hint'])
        t = f['type']
        if t == 'select':
            key = 'ق_' + f['name']; lists[key] = f['options']; c.update(list=key, width=26)
            c['example'] = samples.get(f['name']) or (f['options'][0] if f['options'] else '')
        else:
            c['fmt'] = {'name': 'حروف عربية', 'latin': 'حروف لاتينية', 'nid': 'أرقام (11 رقماً)', 'date': 'YYYY-MM-DD (مثل 2006-03-14)', 'tel': 'رقم هاتف (09xxxxxxxx)', 'email': 'بريد إلكتروني', 'int': 'رقم صحيح', 'num': 'رقم', 'text': 'نص', 'longtext': 'نص'}.get(t, 'نص')
            c['example'] = samples.get(f['name'], '')
            if t in ('nid', 'tel', 'date') or f['name'] == 'ministerial_no': c['text'] = True
        if f['name'] == 'study_level': c['list'] = 'مستويات'; lists['مستويات'] = LEVELS; lists.pop('ق_study_level', None); c['example'] = 'السنة الأولى'
        if f['name'] == 'notes': c['note'] = 'ملاحظات داخلية للموظف'
        cols.append(c)
build('students-template.xlsx', cols, lists, 'قالب استيراد الطلاب', [
    'عبّئ ورقة «البيانات» صفاً لكل طالب. الأعمدة المعلَّمة بـ * إلزامية. لا تغيّر نص صف العناوين ولا تحذفه.',
    'الكلية / المعهد من القائمة المنسدلة؛ يُولَّد اسم المستخدم والرقم الجامعي تلقائياً: رمز الكلية-سنة القيد-تسلسل (مثل CSS-2026-0001).',
    'الأرقام الوطنية والهواتف والتواريخ أعمدتها بصيغة نص حتى لا يحذف Excel الأصفار الأولى. التاريخ: 2006-03-14.',
    'يرفض النظام الصف المخالف وحده ويبلّغ برقم الصف وسببه، ويستورد بقية الصفوف. تُسلَّم كلمات المرور المؤقتة في ملف منفصل مرة واحدة.',
    'بعد الرفع تظهر نتيجة «فحص» دون حفظ شيء؛ ثم تضغط «اعتماد الاستيراد».'])

# ---------- المقررات ----------
cc = [dict(h='الكلية / المعهد', req=True, list='الكليات', width=30, example=FAC[1]), dict(h='البرنامج', width=22, fmt='اتركه فارغاً إن كان للجهة برنامج واحد'),
      dict(h='السنة الدراسية', req=True, list='سنوات', width=14, example='1', allowed='1 إلى 7 (لا تتجاوز مدة البرنامج)'), dict(h='الفصل', req=True, list='فصول', width=10, example='1', allowed='1 أو 2'),
      dict(h='اسم المقرر', req=True, width=36, example='مدخل إلى الأمن السيبراني'), dict(h='رمز المقرر', width=14, example='CYB101', note='يُستخدم لمطابقة العلامات'),
      dict(h='الساعات', width=10, fmt='0 إلى 12 (الافتراضي 3)', example='3'), dict(h='المدرّس', width=26, example='د. سامر العلي')]
build('courses-template.xlsx', cc, {'الكليات': FAC, 'سنوات': [str(i) for i in range(1, 8)], 'فصول': ['1', '2']}, 'قالب استيراد المقررات', [
    'صف لكل مقرر. إن وُجد المقرر مسبقاً (نفس الجهة والسنة والفصل والاسم) فيُحدَّث رمزه وساعاته ومدرّسه ولا يتكرر.',
    'السنة الدراسية لا تتجاوز مدة البرنامج (الكليات 4 سنوات، المعاهد 2 افتراضياً؛ عدّلها من شاشة الكليات والبرامج).'])

# ---------- العلامات ----------
gc = [dict(h='الرقم الجامعي', req=True, width=20, text=True, example='CSS-2026-0001', note='اسم المستخدم للطالب'), dict(h='اسم المقرر', req=True, width=36, example='مدخل إلى الأمن السيبراني', note='أو اتركه فارغاً وضع رمز المقرر'),
      dict(h='رمز المقرر', width=14, example='CYB101', note='اختياري، يغني عن الاسم'), dict(h='العام الدراسي', req=True, width=16, text=True, example='2025/2026', fmt='YYYY/YYYY'),
      dict(h='الفصل', width=10, list='فصول', example='1', note='يلزم فقط إن تكرر اسم المقرر في أكثر من فصل'), dict(h='السنة الدراسية للمقرر', width=16, list='سنوات', example='1', note='يلزم فقط عند تكرار الاسم'),
      dict(h='العلامة النظرية', req=True, width=14, fmt='0 إلى 100', example='42'), dict(h='العلامة العملية', width=14, fmt='0 إلى 100 (فارغ إن لا عملي)', example='30')]
build('grades-template.xlsx', gc, {'فصول': ['1', '2'], 'سنوات': [str(i) for i in range(1, 8)]}, 'قالب استيراد العلامات', [
    'صف لكل علامة طالب في مقرر. المقرر يجب أن يكون مسجَّلاً في برنامج الطالب (استورد المقررات أولاً).',
    'مجموع العلامتين لا يتجاوز 100. إن وُجدت علامة لنفس الطالب والمقرر والعام فتُحدَّث.'])
print('ok')
