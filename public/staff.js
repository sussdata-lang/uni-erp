(() => {
  const names = ['002_student_registration.sql', 'students.js', 'transcript.js', 'documents.js', 'docpdf.js', 'academics.js', 'staff.js', 'access.js', 'importer.js', 'import.js', 'requests.js', 'student.js', 'routes.js', 'db.js'];
  const blocks = [...document.querySelectorAll('pre code')].filter(b => b.innerText.length > 800).slice(-14);
  blocks.forEach((b, i) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([b.innerText], { type: 'text/plain;charset=utf-8' }));
    a.download = names[i] || `file-${i}.js`;
    setTimeout(() => a.click(), i * 350);
  });
})();
