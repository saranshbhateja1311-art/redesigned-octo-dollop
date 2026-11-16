'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = __dirname;
const store = new Map();
const listeners = {};
const elements = new Map();
function makeElement(selector) {
  if (!elements.has(selector)) elements.set(selector, {
    textContent: '', innerHTML: '', value: '', dataset: {}, type: '', checked: false,
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(name, fn) { (this.listeners ||= {})[name] = fn; },
    focus() {}, click() {}, remove() {},
    matches(query) { return false; }
  });
  return elements.get(selector);
}
const document = {
  querySelector: makeElement,
  querySelectorAll() { return []; },
  addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
  body: { dataset: {} },
  documentElement: { dataset: {}, style: { setProperty() {} } },
  createElement() { return makeElement('created-' + Math.random()); }
};
const localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); }
};
const window = {
  APEX_SUPABASE_CONFIG: {},
  matchMedia() { return { matches: false }; },
  scrollTo() {}
};
const ctx = {
  window, document, localStorage, URL, Blob, console, Date, JSON, Math, Map, Set,
  Array, Object, String, Number, RegExp, Error, Promise, Intl,
  setTimeout, clearTimeout, confirm() { return true; }
};
vm.createContext(ctx);
for (const file of ['data.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
const data = window.APEX_INITIAL_DATA;
const content = elements.get('#content');
const assert = (value, message) => { if (!value) throw new Error(message); };
const click = (selector, dataset = {}) => {
  const target = { closest(query) { return query === selector ? { dataset, classList: { add() {}, remove() {} } } : null; } };
  for (const handler of (listeners.click || [])) handler({ target, stopPropagation() {} });
};
assert(data.records.length === 18, 'exactly 18 profiles');
assert(data.records.filter(x => x.type === 'university').length === 13, '13 university profiles');
assert(data.records.filter(x => x.type === 'scholarship').length === 5, '5 government scholarship profiles');
assert(data.records.every(x => x.officialLinks.length > 0), 'every profile has official links');
assert(data.records.every(x => x.officialLinks.every(link => /^https:\/\//.test(link.url) && link.official === true)), 'every official link has a secure URL');
assert(data.records.filter(x => x.dates.status === 'confirmed').length === 0, 'no unannounced 2028 dates claimed as confirmed');
assert(data.records.find(x => x.id === 't-rkiye-burslar').dates.status === 'recurring_window', 'Türkiye recurring period distinguished from a confirmed 2028 call');
assert(content.innerHTML.includes('13') && content.innerHTML.includes('5'), 'overview renders portfolio counts');
assert(!content.innerHTML.toLowerCase().includes('document checklist'), 'no checklist shown in app UI');
click('[data-view]', { view: 'universities' });
assert((content.innerHTML.match(/class="record-card"/g) || []).length === 13, 'university directory renders exactly 13 cards');
click('[data-action]', { action: 'open-record', record: 'kaist-international-undergraduate-scholarship' });
assert(content.innerHTML.includes('KAIST'), 'individual KAIST profile opens');
click('[data-action]', { action: 'profile-tab', tab: 'dates' });
assert(content.innerHTML.includes('Fall 2028 / AY 2028–29 date status'), '2028 date-status tab opens');
click('[data-action]', { action: 'profile-tab', tab: 'links' });
assert(content.innerHTML.includes('Official sources') && content.innerHTML.includes('https://admission.kaist.ac.kr'), 'official source links tab opens');
click('[data-view]', { view: 'scholarships' });
assert((content.innerHTML.match(/class="record-card"/g) || []).length === 5, 'government scholarship directory renders exactly 5 cards');
click('[data-view]', { view: 'priorities' });
assert(content.innerHTML.includes('Priority list'), 'priority view renders');
click('[data-view]', { view: 'settings' });
assert(content.innerHTML.includes('Export JSON backup') && content.innerHTML.includes('Export CSV'), 'backup settings render');
const files = fs.readdirSync(root);
assert(!files.includes('documents.js'), 'retired documents module file absent');
assert(!files.some(name => name.toLowerCase().includes('document')),'no files named for removed module remain');
console.log('APEX OS v1.2.0 smoke test passed: 13 universities, 5 government scholarships, 18 total profiles, official links, unannounced-date guards, profile tabs and module scope.');
