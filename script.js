const els = {
  btnAddFolder: document.getElementById('btnAddFolder'),
  btnShare: document.getElementById('btnShare'),
  folderPicker: document.getElementById('folderPicker'),
  tabs: document.getElementById('tabs'),
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
  stats: document.getElementById('stats'),
  search: document.getElementById('searchInput'),
  typeFilter: document.getElementById('typeFilter'),
  sortSelect: document.getElementById('sortSelect'),
  modal: document.getElementById('modal'),
  modalClose: document.getElementById('modalClose'),
  modalName: document.getElementById('modalName'),
  modalPath: document.getElementById('modalPath'),
  modalMedia: document.getElementById('modalMedia'),
  modalDownload: document.getElementById('modalDownload'),
  infoGrid: document.getElementById('infoGrid')
};

const state = {
  folders: [],
  activeFolderId: null,
  q: '',
  type: 'all',
  sort: 'name-asc',
  modalOpen: false,
  modalFolderId: null,
  modalItemId: null
};

const IMAGE_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','avif','tif','tiff','heic']);
const VIDEO_EXT = new Set(['mp4','webm','mov','m4v','mkv','avi','ogg']);
const AUDIO_EXT = new Set(['mp3','wav','ogg','m4a','aac','flac','opus']);

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function typeFromFile(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  const e = extOf(file.name);
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  if (AUDIO_EXT.has(e)) return 'audio';
  return 'other';
}

function safeRelPath(file) {
  return file.webkitRelativePath || file.name;
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B','KB','MB','GB','TB'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return d.toLocaleString();
}

function durationLabel(sec) {
  if (!Number.isFinite(sec)) return '';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
  return `${m}:${String(r).padStart(2,'0')}`;
}

function guessFolderName(files) {
  const p = (files[0] && files[0].webkitRelativePath) ? files[0].webkitRelativePath : '';
  if (!p) return `Папка ${state.folders.length + 1}`;
  const first = p.split('/')[0];
  return first || `Папка ${state.folders.length + 1}`;
}

async function loadVideoPoster(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.src = url;

    const cleanup = () => {
      try { URL.revokeObjectURL(url); } catch {}
    };

    v.onloadedmetadata = () => {
      const t = Math.min(0.25, Math.max(0, v.duration ? Math.min(v.duration, 0.25) : 0));
      try { v.currentTime = t; } catch { resolve({ posterUrl: null, duration: v.duration || null, w: v.videoWidth || null, h: v.videoHeight || null }); cleanup(); }
    };

    v.onseeked = () => {
      const w = v.videoWidth || 640;
      const h = v.videoHeight || 360;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      try {
        ctx.drawImage(v, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve({ posterUrl: null, duration: v.duration || null, w, h });
            cleanup();
            return;
          }
          const posterUrl = URL.createObjectURL(blob);
          resolve({ posterUrl, duration: v.duration || null, w, h });
          cleanup();
        }, 'image/jpeg', 0.82);
      } catch {
        resolve({ posterUrl: null, duration: v.duration || null, w, h });
        cleanup();
      }
    };

    v.onerror = () => {
      resolve({ posterUrl: null, duration: null, w: null, h: null });
      cleanup();
    };
  });
}

async function loadImageDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || null;
      const h = img.naturalHeight || null;
      try { URL.revokeObjectURL(url); } catch {}
      resolve({ w, h });
    };
    img.onerror = () => {
      try { URL.revokeObjectURL(url); } catch {}
      resolve({ w: null, h: null });
    };
    img.src = url;
  });
}

function createFolderFromFiles(fileList) {
  const files = Array.from(fileList || []);
  const folderId = uid();
  const folderName = guessFolderName(files);

  const items = [];
  for (const file of files) {
    const type = typeFromFile(file);
    if (type === 'other') continue;
    const id = uid();
    const url = URL.createObjectURL(file);

    items.push({
      id,
      folderId,
      file,
      url,
      type,
      name: file.name,
      relPath: safeRelPath(file),
      size: file.size,
      lastModified: file.lastModified,
      posterUrl: type === 'image' ? url : null,
      duration: null,
      width: null,
      height: null
    });
  }

  return { id: folderId, name: folderName, createdAt: Date.now(), items };
}

async function enrichFolder(folder) {
  const imgs = folder.items.filter(i => i.type === 'image');
  for (const item of imgs) {
    const { w, h } = await loadImageDimensions(item.file);
    item.width = w;
    item.height = h;
  }

  const vids = folder.items.filter(i => i.type === 'video');
  for (const item of vids) {
    const { posterUrl, duration, w, h } = await loadVideoPoster(item.file);
    item.posterUrl = posterUrl || null;
    item.duration = Number.isFinite(duration) ? duration : null;
    item.width = w;
    item.height = h;
  }
}

function activeFolder() {
  return state.folders.find(f => f.id === state.activeFolderId) || null;
}

function setActiveFolder(id) {
  state.activeFolderId = id;
  render();
}

function closeFolder(id) {
  const idx = state.folders.findIndex(f => f.id === id);
  if (idx < 0) return;

  const folder = state.folders[idx];
  for (const item of folder.items) {
    try { URL.revokeObjectURL(item.url); } catch {}
    if (item.posterUrl && item.posterUrl !== item.url) {
      try { URL.revokeObjectURL(item.posterUrl); } catch {}
    }
  }

  state.folders.splice(idx, 1);

  if (state.activeFolderId === id) state.activeFolderId = state.folders[0]?.id || null;
  if (!state.folders.length) hideModal();
  render();
}

function filterAndSortItems(items) {
  const q = state.q.trim().toLowerCase();
  let out = items.slice();

  if (q) out = out.filter(i => i.name.toLowerCase().includes(q) || (i.relPath || '').toLowerCase().includes(q));
  if (state.type !== 'all') out = out.filter(i => i.type === state.type);

  const [key, dir] = state.sort.split('-');
  const mul = dir === 'asc' ? 1 : -1;

  const typeOrder = { audio: 0, image: 1, video: 2 };

  out.sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name) * mul;
    if (key === 'type') return ((typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9)) * mul;
    if (key === 'size') return ((a.size ?? 0) - (b.size ?? 0)) * mul;
    if (key === 'date') return ((a.lastModified ?? 0) - (b.lastModified ?? 0)) * mul;
    return 0;
  });

  return out;
}

function renderTabs() {
  els.tabs.innerHTML = '';
  for (const f of state.folders) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (f.id === state.activeFolderId ? ' active' : '');
    tab.tabIndex = 0;

    const name = document.createElement('div');
    name.textContent = f.name;

    const count = document.createElement('div');
    count.className = 'count';
    count.textContent = String(f.items.length);

    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); closeFolder(f.id); });

    tab.append(name, count, close);
    tab.addEventListener('click', () => setActiveFolder(f.id));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') setActiveFolder(f.id);
    });

    els.tabs.appendChild(tab);
  }
}

function createCard(item) {
  const card = document.createElement('div');
  card.className = 'card';

  const thumb = document.createElement('div');
  thumb.className = 'thumb';

  if (item.type === 'image' && item.posterUrl) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = item.name;
    img.src = item.posterUrl;
    thumb.appendChild(img);
  } else if (item.type === 'video' && item.posterUrl) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = item.name;
    img.src = item.posterUrl;
    thumb.appendChild(img);
  } else {
    const f = document.createElement('div');
    f.className = 'fallback';
    const t = item.type === 'video' ? 'Видео' : item.type === 'audio' ? 'Аудио' : 'Файл';
    f.textContent = `${t}\n${extOf(item.name).toUpperCase()}`;
    thumb.appendChild(f);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';

  const name = document.createElement('div');
  name.className = 'name';
  name.title = item.relPath;
  name.textContent = item.name;

  const sub = document.createElement('div');
  sub.className = 'sub';

  const left = document.createElement('div');
  left.className = 'kv';
  left.textContent = fmtBytes(item.size);

  const right = document.createElement('div');
  right.className = 'kv';
  if (item.type === 'video') right.textContent = item.duration ? durationLabel(item.duration) : 'Видео';
  else if (item.type === 'audio') right.textContent = 'Аудио';
  else right.textContent = extOf(item.name).toUpperCase();

  sub.append(left, right);
  meta.append(name, sub);

  card.append(thumb, meta);
  card.addEventListener('click', () => openModal(item.folderId, item.id));
  return card;
}

function renderGrid() {
  const folder = activeFolder();
  els.grid.innerHTML = '';

  if (!folder) {
    els.stats.textContent = '';
    els.empty.hidden = false;
    return;
  }

  const items = filterAndSortItems(folder.items);
  els.empty.hidden = items.length > 0;

  const counts = {
    all: folder.items.length,
    image: folder.items.filter(i => i.type === 'image').length,
    video: folder.items.filter(i => i.type === 'video').length,
    audio: folder.items.filter(i => i.type === 'audio').length
  };

  els.stats.textContent = `Показано: ${items.length}. В папке: ${counts.all} (фото: ${counts.image}, видео: ${counts.video}, аудио: ${counts.audio})`;

  const frag = document.createDocumentFragment();
  for (const item of items) frag.appendChild(createCard(item));
  els.grid.appendChild(frag);
}

function renderShareState() {
  els.btnShare.disabled = !activeFolder();
}

function render() {
  renderTabs();
  renderGrid();
  renderShareState();
}

function showModal() {
  els.modal.hidden = false;
  document.body.style.overflow = 'hidden';
  state.modalOpen = true;
}

function hideModal() {
  state.modalOpen = false;
  state.modalFolderId = null;
  state.modalItemId = null;
  els.modal.hidden = true;
  els.modalName.textContent = '';
  els.modalPath.textContent = '';
  els.modalMedia.innerHTML = '';
  els.infoGrid.innerHTML = '';
  els.modalDownload.removeAttribute('href');
  document.body.style.overflow = '';
}

function addInfoRow(k, v) {
  const kk = document.createElement('div');
  kk.className = 'k';
  kk.textContent = k;
  const vv = document.createElement('div');
  vv.className = 'v';
  vv.textContent = v ?? '';
  els.infoGrid.append(kk, vv);
}

function openModal(folderId, itemId) {
  const folder = state.folders.find(f => f.id === folderId);
  if (!folder) return;
  const item = folder.items.find(i => i.id === itemId);
  if (!item) return;

  state.modalFolderId = folderId;
  state.modalItemId = itemId;

  els.modalName.textContent = item.name;
  els.modalPath.textContent = item.relPath || '';

  els.modalMedia.innerHTML = '';
  if (item.type === 'image') {
    const img = document.createElement('img');
    img.alt = item.name;
    img.src = item.url;
    els.modalMedia.appendChild(img);
  } else if (item.type === 'video') {
    const v = document.createElement('video');
    v.controls = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.src = item.url;
    els.modalMedia.appendChild(v);
  } else if (item.type === 'audio') {
    const a = document.createElement('audio');
    a.controls = true;
    a.preload = 'metadata';
    a.src = item.url;
    els.modalMedia.appendChild(a);
  }

  els.modalDownload.href = item.url;
  els.modalDownload.download = item.name;

  els.infoGrid.innerHTML = '';
  addInfoRow('Имя файла', item.name);
  addInfoRow('Путь', item.relPath || '');
  addInfoRow('Тип', item.type === 'image' ? 'Фото' : item.type === 'video' ? 'Видео' : 'Аудио');
  addInfoRow('MIME', item.file.type || '');
  addInfoRow('Расширение', extOf(item.name).toUpperCase());
  addInfoRow('Размер', fmtBytes(item.size));
  addInfoRow('Последнее изменение (file)', fmtDate(item.lastModified));
  addInfoRow('Последнее изменение (ISO)', new Date(item.lastModified).toISOString());
  addInfoRow('Последнее изменение (UTC)', new Date(item.lastModified).toUTCString());
  addInfoRow('Папка (вкладка)', folder.name);
  addInfoRow('Добавлено в Stash', fmtDate(folder.createdAt));

  if (item.type === 'image' || item.type === 'video') {
    const dim = (item.width && item.height) ? `${item.width} × ${item.height}` : '';
    addInfoRow('Размеры', dim);
  }

  if (item.type === 'video') addInfoRow('Длительность', item.duration ? durationLabel(item.duration) : '');
  if (item.type === 'audio') addInfoRow('Длительность', '');

  showModal();
}

async function shareActiveFolder() {
  const folder = activeFolder();
  if (!folder) return;

  const files = folder.items.map(i => i.file);
  const title = `Stash: ${folder.name}`;
  const text = `Папка: ${folder.name}\nФайлов: ${folder.items.length}`;

  if (navigator.share && (!navigator.canShare || navigator.canShare({ files }))) {
    try {
      await navigator.share({ title, text, files });
      return;
    } catch {}
  }

  try {
    await navigator.clipboard.writeText(text);
    alert('Web Share недоступен. Информация о папке скопирована в буфер обмена.');
  } catch {
    prompt('Web Share недоступен. Скопируйте текст:', text);
  }
}

els.btnAddFolder.addEventListener('click', () => els.folderPicker.click());

els.folderPicker.addEventListener('change', (e) => {
  const files = e.target.files;
  if (!files || !files.length) return;

  const folder = createFolderFromFiles(files);
  if (!folder.items.length) {
    alert('В выбранной папке нет поддерживаемых фото/видео/аудио.');
    els.folderPicker.value = '';
    return;
  }

  state.folders.push(folder);
  state.activeFolderId = folder.id;
  render();

  enrichFolder(folder).then(() => {
    if (state.activeFolderId === folder.id) renderGrid();
  });

  els.folderPicker.value = '';
});

els.search.addEventListener('input', (e) => {
  state.q = e.target.value || '';
  renderGrid();
});

els.typeFilter.addEventListener('change', (e) => {
  state.type = e.target.value;
  renderGrid();
});

els.sortSelect.addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderGrid();
});

els.btnShare.addEventListener('click', shareActiveFolder);

els.modalClose.addEventListener('click', hideModal);
els.modal.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.dataset && t.dataset.close) hideModal();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.modalOpen) hideModal();
});

render();