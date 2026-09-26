// Tag Autocomplete (Image Prompts) for SillyTavern
// Danbooru tag suggestions in the image-generation "Review and edit the prompt" popup
// and (optionally) the Image Generation prompt prefix / negative fields.

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE = 'tagAutocomplete';
const BASE = new URL('.', import.meta.url).href;

const DEFAULTS = {
    enabled: true,
    maxSuggestions: 15,
    minChars: 2,
    settingsFields: true,
    matchInside: true,
    relatedOnClick: true,
    maxRelated: 100,
};

// Textareas in the SD settings drawer that also get autocomplete (when settingsFields is on)
const SETTINGS_FIELD_IDS = ['sd_prompt_prefix', 'sd_negative_prompt', 'sd_character_prompt', 'sd_character_negative_prompt', 'sd_refine_negative'];

// Danbooru category -> css class
const CATEGORY = { 0: 'general', 1: 'artist', 3: 'copyright', 4: 'character', 5: 'metatag', custom: 'custom' };

/** @type {{tag:string, cat:number|string, count:number, aliases:string[], insert?:string}[]} */
let TAGS = [];
/** @type {{tag:string, cat:string, count:number, aliases:string[], insert:string}[]} */
let CUSTOM = [];
/** tag name -> tag entry, for exact-match / alias lookup (used by related-tags click) */
let TAG_BY_NAME = new Map();
/** tag name -> [{tag, pct}], sorted desc by relevance, from related_tags.csv */
let RELATED = new Map();
let loaded = false;

let dropdown = null;      // HTMLElement
let activeField = null;   // HTMLTextAreaElement
let items = [];           // current suggestions
let selected = 0;
let range = null;         // {start, end} of the text being replaced (or insertion point in 'related' mode)
let mode = 'complete';    // 'complete' | 'related'
let relatedSource = null; // tag name the related panel is showing relations for
let suppressNextInput = false;

function settings() {
    extension_settings[MODULE] = Object.assign({}, DEFAULTS, extension_settings[MODULE] || {});
    return extension_settings[MODULE];
}

// ---------- data loading ----------

function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
            } else { cur += ch; }
        } else if (ch === '"') { inQ = true; }
        else if (ch === ',') { out.push(cur); cur = ''; }
        else { cur += ch; }
    }
    out.push(cur);
    return out;
}

async function loadData() {
    try {
        const res = await fetch(BASE + 'danbooru_tags.csv');
        const text = await res.text();
        const lines = text.split(/\r?\n/);
        const list = [];
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i]) continue;
            const [tag, cat, count, alias] = parseCsvLine(lines[i]);
            if (!tag) continue;
            // keep only latin-script aliases; the Japanese/Chinese ones aren't useful for typing here
            const aliases = (alias || '').split(',').map(a => a.trim().toLowerCase().replace(/ /g, '_'))
                .filter(a => a && /^[\x20-\x7e]+$/.test(a) && a !== tag);
            list.push({ tag, cat: Number(cat), count: Number(count) || 0, aliases });
        }
        list.sort((a, b) => b.count - a.count);
        TAGS = list;
        TAG_BY_NAME = new Map();
        for (const t of list) {
            TAG_BY_NAME.set(t.tag, t);
            for (const a of t.aliases) if (!TAG_BY_NAME.has(a)) TAG_BY_NAME.set(a, t);
        }
    } catch (e) {
        console.error('[Tag Autocomplete] could not load danbooru_tags.csv', e);
    }
    try {
        // personal custom_tags.txt (not in git) wins; otherwise fall back to the shipped example
        let res = await fetch(BASE + 'custom_tags.txt');
        if (!res.ok) res = await fetch(BASE + 'custom_tags.example.txt');
        if (res.ok) {
            const text = await res.text();
            CUSTOM = text.split(/\r?\n/)
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#') && l.includes('|'))
                .map(l => {
                    const idx = l.indexOf('|');
                    const trigger = l.slice(0, idx).trim().toLowerCase().replace(/ /g, '_');
                    const insert = l.slice(idx + 1).trim();
                    return { tag: trigger, cat: 'custom', count: 0, aliases: [], insert };
                });
        }
    } catch { /* optional file */ }
    try {
        const res = await fetch(BASE + 'related_tags.csv');
        if (res.ok) {
            const text = await res.text();
            const lines = text.split(/\r?\n/);
            const map = new Map();
            for (const line of lines) {
                if (!line) continue;
                const idx = line.indexOf(',');
                if (idx < 0) continue;
                const tag = line.slice(0, idx);
                const rest = line.slice(idx + 1);
                const parts = rest.split('|').map(p => {
                    const i = p.lastIndexOf(':');
                    if (i < 0) return null;
                    const t = p.slice(0, i);
                    const pct = parseFloat(p.slice(i + 1));
                    if (!t || Number.isNaN(pct)) return null;
                    return { tag: t, pct };
                }).filter(Boolean);
                if (parts.length) map.set(tag, parts);
            }
            RELATED = map;
        }
    } catch { /* optional file */ }
    loaded = true;
    console.log(`[Tag Autocomplete] loaded ${TAGS.length} tags, ${CUSTOM.length} custom snippets, ${RELATED.size} tags with related-tag data`);
}

// ---------- matching ----------

function normalize(s) {
    return s.toLowerCase().replace(/\\([()])/g, '$1').replace(/\s+/g, '_');
}

/** Text to put in the prompt for a tag */
function displayTag(tag) {
    // short emoticon tags (^_^, o_o, >_<, ...) keep their underscores
    let t = tag.length <= 3 ? tag : tag.replace(/_/g, ' ');
    // escape parentheses so ComfyUI doesn't read them as weights: "ganyu (genshin impact)" -> "ganyu \(genshin impact\)"
    t = t.replace(/([()])/g, '\\$1');
    return t;
}

function search(query, existing) {
    const s = settings();
    const max = s.maxSuggestions;
    const results = [];
    const seen = new Set();
    const push = (entry, via) => {
        if (seen.has(entry.tag) || results.length >= max) return;
        seen.add(entry.tag);
        results.push({ ...entry, via, used: existing.has(entry.tag) });
    };

    // 1. custom snippets (any length query)
    for (const c of CUSTOM) {
        if (c.tag.startsWith(query)) push(c, null);
    }
    if (query.length < s.minChars) return results;

    // 2. tag prefix
    for (const t of TAGS) {
        if (results.length >= max) break;
        if (t.tag.startsWith(query)) push(t, null);
    }
    // 3. alias prefix
    if (results.length < max) {
        for (const t of TAGS) {
            if (results.length >= max) break;
            if (seen.has(t.tag)) continue;
            const a = t.aliases.find(x => x.startsWith(query));
            if (a) push(t, a);
        }
    }
    // 4. word inside tag ("hair" -> long_hair, black_hair)
    if (s.matchInside && results.length < max) {
        const inner = '_' + query;
        for (const t of TAGS) {
            if (results.length >= max) break;
            if (!seen.has(t.tag) && t.tag.includes(inner)) push(t, null);
        }
    }
    return results;
}

// ---------- field handling ----------

function isTargetField(el) {
    if (!(el instanceof HTMLTextAreaElement)) return false;
    const s = settings();
    if (!s.enabled) return false;
    if (el.classList.contains('popup-input')) {
        const dlg = el.closest('.popup');
        if (!dlg) return false;
        // Only the image-gen "Review and edit the prompt" popup
        if (dlg.querySelector('#sd_refine_negative, #sd_use_saved_resolution')) return true;
        const txt = dlg.textContent || '';
        return /Review and edit the prompt|abort the image generation/i.test(txt);
    }
    if (el.id === 'sd_refine_negative') return true;
    return s.settingsFields && SETTINGS_FIELD_IDS.includes(el.id);
}

/** Find the tag currently being typed/clicked at the caret */
function currentToken(el) {
    const value = el.value;
    const caret = el.selectionStart;
    if (caret !== el.selectionEnd) return null;
    let start = Math.max(value.lastIndexOf(',', caret - 1), value.lastIndexOf('\n', caret - 1)) + 1;
    let end = caret;
    // extend to the end of the current tag (if editing/clicking in the middle of one)
    while (end < value.length && value[end] !== ',' && value[end] !== '\n') end++;
    // trim trailing spaces of the replace range
    while (end > caret && value[end - 1] === ' ') end--;

    let token = value.slice(start, caret);
    const lead = token.length - token.replace(/^[\s(]+/, '').length;
    start += lead;
    token = token.slice(lead);

    if (!token) return null;
    if (token.includes('<') && !token.includes('>')) return null;   // typing a <lora:...>
    if (/^embedding:/i.test(token) || token === 'BREAK') return null;
    if (/:[\d.]*$/.test(token) && token.includes(':') && /[a-z]:/i.test(token)) return null; // weight like smile:1.2
    return { token, start, end };
}

/** Full span [start,end) of the tag under the caret, including any part after the caret (for click-to-explore) */
function fullTokenSpan(el) {
    const value = el.value;
    const caret = el.selectionStart;
    if (caret !== el.selectionEnd) return null;
    let start = Math.max(value.lastIndexOf(',', caret - 1), value.lastIndexOf('\n', caret - 1)) + 1;
    let end = caret;
    while (end < value.length && value[end] !== ',' && value[end] !== '\n') end++;
    while (start < end && /[\s(]/.test(value[start])) start++;
    while (end > start && /[\s)]/.test(value[end - 1])) end--;
    if (end <= start) return null;
    return { token: value.slice(start, end), start, end };
}

function existingTags(el) {
    return new Set(el.value.split(/[,\n]/).map(t => normalize(t.trim().replace(/^\(+|\)+$/g, '').replace(/:[\d.]+$/, ''))).filter(Boolean));
}

function update(el) {
    if (!loaded) return hide();
    const tok = currentToken(el);
    if (!tok) return hide();
    const query = normalize(tok.token);
    const found = search(query, existingTags(el));
    if (!found.length) return hide();
    activeField = el;
    mode = 'complete';
    items = found;
    selected = 0;
    range = { start: tok.start, end: tok.end };
    render(true);
}

/** Called on mouse click inside a target field: prefer showing "related tags" if the
 *  clicked word is already a complete, recognized tag; otherwise fall back to normal search. */
function handleClick(el) {
    if (!loaded) return hide();
    const s = settings();
    if (s.relatedOnClick) {
        const span = fullTokenSpan(el);
        if (span) {
            const norm = normalize(span.token);
            const entry = TAG_BY_NAME.get(norm);
            if (entry && RELATED.has(entry.tag)) {
                showRelated(el, entry.tag, span);
                return;
            }
        }
    }
    update(el);
}

function showRelated(el, tagName, span) {
    const list = RELATED.get(tagName);
    if (!list || !list.length) return update(el);
    const existing = existingTags(el);
    activeField = el;
    mode = 'related';
    relatedSource = tagName;
    items = list.slice(0, settings().maxRelated).map(r => {
        const entry = TAG_BY_NAME.get(r.tag);
        return { tag: r.tag, cat: entry ? entry.cat : 0, pct: r.pct, used: existing.has(r.tag) };
    });
    selected = 0;
    // insertion point: right after the clicked tag, not a replace range
    range = { start: span.end, end: span.end };
    render(true);
}

function formatCount(n) {
    if (!n) return '';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(n);
}

function render(resetScroll = false) {
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = 'tac-dropdown';
        dropdown.addEventListener('mousedown', (e) => {
            e.preventDefault(); // keep focus in the textarea
            const row = e.target.closest('.tac-item');
            if (row) { selected = Number(row.dataset.i); accept(); }
        });
    }
    // Place right under the textarea (inside the same popup so it isn't hidden behind the modal)
    if (dropdown.previousElementSibling !== activeField) {
        activeField.insertAdjacentElement('afterend', dropdown);
    }
    dropdown.innerHTML = '';

    if (mode === 'related') {
        const header = document.createElement('div');
        header.className = 'tac-header';
        header.textContent = `Related to: ${relatedSource.replace(/_/g, ' ')}`;
        dropdown.appendChild(header);
    }

    items.forEach((it, i) => {
        const row = document.createElement('div');
        row.className = `tac-item tac-${CATEGORY[it.cat] || 'general'}` + (i === selected ? ' tac-selected' : '') + (it.used ? ' tac-used' : '');
        row.dataset.i = String(i);

        const name = document.createElement('span');
        name.className = 'tac-name';
        name.textContent = it.via ? `${it.via.replace(/_/g, ' ')} → ${it.tag.replace(/_/g, ' ')}` : it.tag.replace(/_/g, ' ');
        row.appendChild(name);

        const meta = document.createElement('span');
        meta.className = 'tac-meta';
        meta.textContent = mode === 'related'
            ? `${(it.used ? '✓ ' : '')}${it.pct.toFixed(1)}%`
            : (it.cat === 'custom' ? it.insert : (it.used ? '✓ ' : '') + formatCount(it.count));
        row.appendChild(meta);

        dropdown.appendChild(row);
    });
    dropdown.style.display = 'block';
    if (resetScroll) dropdown.scrollTop = 0;
    keepSelectedVisible();
}

/** Scroll only the dropdown (never the popup/page) so the selected row is visible below the header */
function keepSelectedVisible() {
    const row = dropdown.querySelector('.tac-selected');
    if (!row) return;
    const header = dropdown.querySelector('.tac-header');
    const top = row.offsetTop - (header ? header.offsetHeight : 0);
    const bottom = row.offsetTop + row.offsetHeight - dropdown.clientHeight;
    if (dropdown.scrollTop > top) dropdown.scrollTop = Math.max(0, top);
    else if (dropdown.scrollTop < bottom) dropdown.scrollTop = bottom;
}

function hide() {
    if (dropdown) dropdown.style.display = 'none';
    items = [];
    range = null;
    mode = 'complete';
    relatedSource = null;
}

function isOpen() {
    return dropdown && dropdown.style.display === 'block' && items.length > 0;
}

function accept() {
    const el = activeField;
    const it = items[selected];
    if (!el || !it || !range) return hide();

    if (mode === 'related') {
        const insertText = ', ' + displayTag(it.tag);
        el.focus();
        el.setSelectionRange(range.start, range.start);
        suppressNextInput = true;
        let ok = false;
        try { ok = document.execCommand('insertText', false, insertText); } catch { ok = false; }
        if (!ok) {
            el.setRangeText(insertText, range.start, range.start, 'end');
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        suppressNextInput = false;
        hide();
        return;
    }

    const text = it.insert ?? displayTag(it.tag);
    const after = el.value.slice(range.end);
    const needsSep = !/^\s*,/.test(after);
    const insertText = text + (needsSep ? ', ' : '');

    el.focus();
    el.setSelectionRange(range.start, range.end);
    suppressNextInput = true;
    // execCommand keeps Ctrl+Z working; fall back if the browser refuses
    let ok = false;
    try { ok = document.execCommand('insertText', false, insertText); } catch { ok = false; }
    if (!ok) {
        el.setRangeText(insertText, range.start, range.end, 'end');
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (!needsSep) {
        // hop over the existing ", "
        const m = el.value.slice(el.selectionStart).match(/^\s*,\s?/);
        if (m) { const p = el.selectionStart + m[0].length; el.setSelectionRange(p, p); }
    }
    suppressNextInput = false;
    hide();
}

// ---------- events ----------

function onInput(e) {
    if (suppressNextInput) return;
    const el = e.target;
    if (!isTargetField(el)) return;
    update(el);
}

function onKeyDown(e) {
    if (!isOpen() || e.target !== activeField) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    switch (e.key) {
        case 'ArrowDown':
            stop(); selected = (selected + 1) % items.length; render(); break;
        case 'ArrowUp':
            stop(); selected = (selected - 1 + items.length) % items.length; render(); break;
        case 'Enter':
        case 'Tab':
            if (e.shiftKey || e.ctrlKey || e.altKey) return; // Ctrl+Enter still submits the popup
            stop(); accept(); break;
        case 'Escape':
            stop(); hide(); break; // close the list, not the popup
    }
}

function onCaretMove(e) {
    if (e.type === 'click') {
        if (!isTargetField(e.target)) return;
        handleClick(e.target);
        return;
    }
    if (!isOpen() || e.target !== activeField) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) update(e.target);
}

// ---------- settings UI ----------

function addSettingsUi() {
    const s = settings();
    const html = `
    <div class="tac-settings">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>Tag Autocomplete</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <label class="checkbox_label"><input type="checkbox" id="tac_enabled"> <span>Enabled</span></label>
          <label class="checkbox_label"><input type="checkbox" id="tac_settings_fields"> <span>Also in Image Generation prefix / negative fields</span></label>
          <label class="checkbox_label"><input type="checkbox" id="tac_match_inside"> <span>Match words inside tags ("hair" finds long hair)</span></label>
          <label class="checkbox_label"><input type="checkbox" id="tac_related_click"> <span>Click an existing tag to see related tags</span></label>
          <label for="tac_max">Max suggestions: <span id="tac_max_val"></span></label>
          <input type="range" id="tac_max" min="5" max="50" step="1">
          <label for="tac_max_related">Max related tags: <span id="tac_max_related_val"></span></label>
          <input type="range" id="tac_max_related" min="10" max="100" step="5">
          <small>Custom snippets: edit <code>custom_tags.txt</code> in the extension folder, then reload.</small>
        </div>
      </div>
    </div>`;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return;
    host.insertAdjacentHTML('beforeend', html);

    const bindCheck = (id, key) => {
        const el = document.getElementById(id);
        el.checked = !!s[key];
        el.addEventListener('change', () => { settings()[key] = el.checked; saveSettingsDebounced(); });
    };
    bindCheck('tac_enabled', 'enabled');
    bindCheck('tac_settings_fields', 'settingsFields');
    bindCheck('tac_match_inside', 'matchInside');
    bindCheck('tac_related_click', 'relatedOnClick');

    const max = document.getElementById('tac_max');
    const maxVal = document.getElementById('tac_max_val');
    max.value = String(s.maxSuggestions);
    maxVal.textContent = String(s.maxSuggestions);
    max.addEventListener('input', () => {
        settings().maxSuggestions = Number(max.value);
        maxVal.textContent = max.value;
        saveSettingsDebounced();
    });

    const maxRel = document.getElementById('tac_max_related');
    const maxRelVal = document.getElementById('tac_max_related_val');
    maxRel.value = String(s.maxRelated);
    maxRelVal.textContent = String(s.maxRelated);
    maxRel.addEventListener('input', () => {
        settings().maxRelated = Number(maxRel.value);
        maxRelVal.textContent = maxRel.value;
        saveSettingsDebounced();
    });
}

// ---------- init ----------

jQuery(async () => {
    settings();
    addSettingsUi();
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);  // capture: runs before the popup's own Enter/Escape handling
    document.addEventListener('keyup', onCaretMove, true);
    document.addEventListener('click', onCaretMove, true);
    document.addEventListener('focusout', (e) => {
        if (e.target === activeField) setTimeout(() => { if (document.activeElement !== activeField) hide(); }, 150);
    }, true);
    await loadData();
});
