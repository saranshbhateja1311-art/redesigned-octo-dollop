// Stage only APEX OS admissions app assets for Capacitor.
'use strict';
const fs = require('fs');
const path = require('path');
const root = __dirname;
const out = path.join(root, 'www');
const files = ['index.html', 'app.js', 'data.js', 'styles.css', 'supabase-config.js'];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const name of files) {
  const source = path.join(root, name);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Required web asset is missing: ${name}`);
  }
  fs.copyFileSync(source, path.join(out, name));
}
console.log(`Prepared ${files.length} APEX OS web assets in ${path.relative(root, out)}/`);
