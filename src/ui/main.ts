/**
 * Page controller.
 *
 * Holds no save data beyond the two file texts and the produced output
 * string; all parsing and merging happens inside the worker.
 */

import { LAMP_NAMES, LEVEL_NAMES, RANK_NAMES } from '../core/constants';
import type { MergeRequest, MergeResponse, MergeSummary } from '../worker/protocol';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const els = {
  dropSave: $('drop-save'),
  dropCsv: $('drop-csv'),
  fileSave: $<HTMLInputElement>('file-save'),
  fileCsv: $<HTMLInputElement>('file-csv'),
  hintSave: $('hint-save'),
  hintCsv: $('hint-csv'),
  optPlaylogs: $<HTMLInputElement>('opt-playlogs'),
  btnMerge: $<HTMLButtonElement>('btn-merge'),
  status: $('status'),
  stepResult: $('step-result'),
  stats: $('stats'),
  btnDownload: $<HTMLButtonElement>('btn-download'),
  btnReset: $<HTMLButtonElement>('btn-reset'),
  outname: $('outname'),
  tabs: $('tabs'),
  badgeWarn: $('badge-warn'),
  panels: {
    added: $('panel-added'),
    updated: $('panel-updated'),
    warnings: $('panel-warnings'),
    skipped: $('panel-skipped'),
  },
};

const state = {
  saveName: '',
  saveText: '',
  csvText: '',
  outputText: '',
  outputName: '',
};

// ---------------------------------------------------------------- helpers

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const rankName = (r: number) => RANK_NAMES[r] ?? String(r);
const lampName = (l: number) => LAMP_NAMES[l] ?? String(l);
const levelName = (l: number) => LEVEL_NAMES[l] ?? `LEVEL ${l}`;

/** Build the worker output name, always a new file. */
function outputNameFor(saveName: string): string {
  const dot = saveName.lastIndexOf('.');
  const stem = dot > 0 ? saveName.slice(0, dot) : saveName;
  return `${stem}_merged.json`;
}

function setStatus(text: string, kind: 'idle' | 'busy' | 'error' = 'idle'): void {
  els.status.textContent = text;
  els.status.className = `status ${kind}`;
}

function el(tag: string, text?: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// ---------------------------------------------------------------- file input

function wireFilePicker(
  drop: HTMLElement,
  input: HTMLInputElement,
  hint: HTMLElement,
  onPick: (name: string, text: string) => void,
): void {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    hint.textContent = `读取中… (${formatBytes(file.size)})`;
    file
      .text()
      .then((text) => {
        drop.classList.add('ready');
        hint.textContent = `${file.name} · ${formatBytes(file.size)}`;
        onPick(file.name, text);
      })
      .catch(() => {
        hint.textContent = '读取失败';
        drop.classList.remove('ready');
      });
  });

  for (const ev of ['dragenter', 'dragover'] as const) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('dragging');
    });
  }
  for (const ev of ['dragleave', 'drop'] as const) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('dragging');
    });
  }
  drop.addEventListener('drop', (e) => {
    const file = (e as DragEvent).dataTransfer?.files?.[0];
    if (!file) return;
    // Reuse the picker path so both routes behave identically.
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
}

wireFilePicker(els.dropSave, els.fileSave, els.hintSave, (name, text) => {
  state.saveName = name;
  state.saveText = text;
  updateReady();
});

wireFilePicker(els.dropCsv, els.fileCsv, els.hintCsv, (_name, text) => {
  state.csvText = text;
  updateReady();
});

function updateReady(): void {
  els.btnMerge.disabled = !(state.saveText && state.csvText);
}

// ---------------------------------------------------------------- merge

els.btnMerge.addEventListener('click', () => {
  if (!state.saveText || !state.csvText) return;

  setStatus('正在合并…', 'busy');
  els.btnMerge.disabled = true;

  const worker = new Worker(new URL('../worker/merge.worker.ts', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (event: MessageEvent<MergeResponse>) => {
    worker.terminate();
    const res = event.data;

    if (!res.ok) {
      setStatus(`失败：${res.message}`, 'error');
      els.btnMerge.disabled = false;
      return;
    }

    state.outputText = res.outputText;
    state.outputName = outputNameFor(state.saveName);

    render(res.summary);
    setStatus('合并完成。');
    els.stepResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  worker.onerror = (event) => {
    worker.terminate();
    setStatus(`合并进程出错：${event.message}`, 'error');
    els.btnMerge.disabled = false;
  };

  const req: MergeRequest = {
    kind: 'merge',
    csvText: state.csvText,
    saveText: state.saveText,
    injectPlaylogs: els.optPlaylogs.checked,
  };
  worker.postMessage(req);
});

// ---------------------------------------------------------------- download

els.btnDownload.addEventListener('click', () => {
  if (!state.outputText) return;
  // Blob rather than a data URL: a 3.4 MB inline base64 string is wasteful.
  const blob = new Blob([state.outputText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.outputName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has been dispatched.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

els.btnReset.addEventListener('click', () => location.reload());

// ---------------------------------------------------------------- render

function render(s: MergeSummary): void {
  els.stepResult.classList.remove('hidden');

  els.stats.replaceChildren(
    stat(s.addedCount, '新增成绩', 'good'),
    stat(s.updatedCount, '更新成绩', 'good'),
    stat(s.playlogsInjected, '补写游玩记录', ''),
    stat(s.musicCount, '存档成绩总数', ''),
    stat(s.warningCount, '提示', s.warningCount > 0 ? 'warn' : ''),
  );

  els.outname.textContent =
    `将输出 ${state.outputName}（${formatBytes(s.outputBytes)}，` +
    `原始 ${formatBytes(s.inputBytes)}）。原始文件不会被修改。`;

  if (s.warningCount > 0) {
    els.badgeWarn.textContent = String(s.warningCount);
    els.badgeWarn.classList.remove('hidden');
  }

  renderAdded(s);
  renderUpdated(s);
  renderWarnings(s);
  renderSkipped(s);
}

function stat(n: number, label: string, cls: string): HTMLElement {
  const box = el('div', undefined, `stat ${cls}`);
  box.append(el('span', String(n), 'n'), el('span', label, 'k'));
  return box;
}

function table(headers: string[]): HTMLTableElement {
  const t = document.createElement('table');
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const h of headers) tr.append(el('th', h));
  thead.append(tr);
  t.append(thead);
  t.append(document.createElement('tbody'));
  return t;
}

function bodyOf(t: HTMLTableElement): HTMLTableSectionElement {
  return t.querySelector('tbody') as HTMLTableSectionElement;
}

function emptyPanel(panel: HTMLElement, message: string): void {
  panel.replaceChildren(el('p', message, 'empty'));
}

/**
 * Full combo / all justice / full chain badges.
 *
 * AJ implies FC in the save data, so showing both would just be noise.
 * Show the stronger badge alone; full chain is independent and always
 * appears alongside.
 */
function comboTags(isFc: boolean, isAj: boolean, chain: number): HTMLElement {
  const wrap = el('span', undefined, 'combo');
  if (isAj) {
    wrap.append(el('span', 'AJ', 'tag aj'));
  } else if (isFc) {
    wrap.append(el('span', 'FC', 'tag fc'));
  }
  if (chain > 0) {
    wrap.append(el('span', `FULL CHAIN ${chain}`, 'tag chain'));
  }
  if (!wrap.childNodes.length) wrap.textContent = '—';
  return wrap;
}

/** Difficulty as a coloured capsule, wrapped in a badge-only cell. */
function levelCell(level: number): HTMLElement {
  const td = el('td');
  td.className = 'cell-badge';
  td.append(el('span', levelName(level), `lvl lvl-${level}`));
  return td;
}

function renderAdded(s: MergeSummary): void {
  const panel = els.panels.added;
  if (s.added.length === 0) return emptyPanel(panel, '没有需要新增的成绩。');

  const t = table(['歌曲', '难度', '分数', '评价', '灯号', 'FC/AJ/Chain', 'ID']);
  const body = bodyOf(t);
  for (const r of s.added) {
    const tr = document.createElement('tr');
    const nameCell = el('td', undefined, 'name');
    nameCell.textContent = r.songName || '（未知曲名）';
    nameCell.title = r.songName;
    tr.append(
      nameCell,
      levelCell(r.level),
      el('td', r.scoreMax.toLocaleString()),
      el('td', rankName(r.scoreRank)),
      el('td', lampName(r.lamp)),
    );
    const combo = document.createElement('td');
    combo.className = 'cell-badge';
    combo.append(comboTags(r.isFullCombo, r.isAllJustice, r.fullChain));
    tr.append(combo, el('td', `${r.musicId}`));
    body.append(tr);
  }
  panel.replaceChildren(t);
}

function renderUpdated(s: MergeSummary): void {
  const panel = els.panels.updated;
  if (s.updated.length === 0) return emptyPanel(panel, '没有已有成绩被提升。');

  const t = table(['歌曲', '难度', '变化', '游玩次数', 'ID']);
  const body = bodyOf(t);
  for (const r of s.updated) {
    const tr = document.createElement('tr');
    const nameCell = el('td', undefined, 'name');
    nameCell.textContent = r.songName || '（未知曲名）';
    nameCell.title = r.songName;

    const changeCell = document.createElement('td');
    changeCell.className = 'delta';
    for (const c of r.changes) {
      const line = el('div');
      line.append(el('span', `${c.field} `));
      line.append(el('span', fmt(c.from), 'from'));
      line.append(document.createTextNode(' → '));
      line.append(el('span', fmt(c.to), 'to'));
      changeCell.append(line);
    }

    tr.append(nameCell, levelCell(r.level), changeCell);
    tr.append(el('td', String(r.playCount)), el('td', `${r.musicId}`));
    body.append(tr);
  }
  panel.replaceChildren(t);
}

function fmt(v: unknown): string {
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number' && Number.isInteger(v)) {
    if (v >= 1000 && v <= 1010000) return v.toLocaleString();
    return String(v);
  }
  return String(v);
}

function renderWarnings(s: MergeSummary): void {
  const panel = els.panels.warnings;
  if (s.warningCount === 0) {
    return emptyPanel(panel, '没有提示：所有枚举值与评价均与分数一致。');
  }
  const t = table(['类型', '歌曲', '难度', '说明']);
  const body = bodyOf(t);
  const kindLabel: Record<string, string> = {
    'unknown-lamp': '未知灯号',
    'unknown-rank': '未知评价',
    'unknown-fullchain': '未知 FULL CHAIN',
    'rank-mismatch': '评价与分数不符',
    'bad-row': '无法解析的行',
    'legacy-score': '疑似旧版阈值',
  };
  for (const w of s.warnings) {
    const tr = document.createElement('tr');
    const nameCell = el('td', undefined, 'name');
    nameCell.textContent = w.songName || (w.musicId !== null ? `#${w.musicId}` : '—');
    const detail = el('td', undefined, 'delta');
    detail.textContent = w.detail;
    tr.append(
      el('td', kindLabel[w.kind] ?? w.kind),
      nameCell,
      w.level !== null ? levelCell(w.level) : el('td', '—'),
      detail,
    );
    body.append(tr);
  }
  panel.replaceChildren(t);
}

function renderSkipped(s: MergeSummary): void {
  const panel = els.panels.skipped;
  const total = s.playlogsSkippedNoPlayTime + s.playlogsSkippedUltima;
  if (total === 0) {
    return emptyPanel(panel, '成绩已更新，但没有需要跳过的游玩记录。');
  }

  const wrap = document.createElement('div');
  const note = el('p');
  note.className = 'empty';
  note.textContent =
    `这些曲目的成绩已经合并，但没有补写游玩记录：` +
    `${s.playlogsSkippedNoPlayTime} 首缺少 play_time，` +
    `${s.playlogsSkippedUltima} 首为 ULTIMA（服务器不显示该难度的最近游玩）。`;
  wrap.append(note);

  const rows = [
    ...s.skippedNoPlayTime.map((r) => ({ ...r, why: 'CSV 无 play_time' })),
    ...s.skippedUltima.map((r) => ({ ...r, why: 'ULTIMA 不显示于最近游玩' })),
  ];
  const t = table(['歌曲', '难度', '原因', 'ID']);
  const body = bodyOf(t);
  for (const r of rows) {
    const tr = document.createElement('tr');
    const nameCell = el('td', undefined, 'name');
    nameCell.textContent = r.songName || '（未知曲名）';
    nameCell.title = r.songName;
    tr.append(
      nameCell,
      levelCell(r.level),
      el('td', r.why),
      el('td', `${r.musicId}`),
    );
    body.append(tr);
  }
  wrap.append(t);
  panel.replaceChildren(wrap);
}

// ---------------------------------------------------------------- tabs

els.tabs.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const tab = target.closest('.tab') as HTMLElement | null;
  if (!tab) return;
  const name = tab.dataset.tab as keyof typeof els.panels;
  for (const t of els.tabs.querySelectorAll('.tab')) t.classList.remove('active');
  tab.classList.add('active');
  for (const [key, panel] of Object.entries(els.panels)) {
    panel.classList.toggle('hidden', key !== name);
  }
});

// (The backup reminder is static text; no handler needed.)