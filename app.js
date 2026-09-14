'use strict';

const APP_VERSION = '4.1.0';
const DB_NAME = 'CarteiraWebDB';
const DB_VERSION = 1;
const DOCS_STORE = 'documents';
const META_STORE = 'meta';
const LEGACY_DB_NAME = 'DocsDB';
const LEGACY_STORE = 'docs';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const PBKDF2_ITERATIONS = 250000;
const BACKUP_VERSION = 1;

let db = null;
let docsCache = [];
let activeDocId = null;
let activeBlob = null;
let activeObjectUrl = null;
let renameDocId = null;
let deferredInstallPrompt = null;
let isSaving = false;

const $ = id => document.getElementById(id);

const refs = {
  addBtn: $('addBtn'), emptyAddBtn: $('emptyAddBtn'), backupBtn: $('backupBtn'), restoreBtn: $('restoreBtn'),
  persistBtn: $('persistBtn'), migrateLegacyBtn: $('migrateLegacyBtn'), installBtn: $('installBtn'),
  searchInput: $('searchInput'), sortSelect: $('sortSelect'), docsGrid: $('docsGrid'), emptyState: $('emptyState'), emptyText: $('emptyText'),
  docsCount: $('docsCount'), legacyCount: $('legacyCount'), storageUsed: $('storageUsed'), storageQuota: $('storageQuota'),
  lastBackup: $('lastBackup'), backupAdvice: $('backupAdvice'), networkBadge: $('networkBadge'),
  storageProtectionTitle: $('storageProtectionTitle'), storageProtectionText: $('storageProtectionText'), protectionDot: $('protectionDot'),
  addDialog: $('addDialog'), addForm: $('addForm'), titleInput: $('titleInput'), passwordInput: $('passwordInput'), fileInput: $('fileInput'), fileDrop: $('fileDrop'), fileLabel: $('fileLabel'), saveDocBtn: $('saveDocBtn'),
  viewerDialog: $('viewerDialog'), viewerTitle: $('viewerTitle'), viewerBadge: $('viewerBadge'), closeViewerBtn: $('closeViewerBtn'), unlockStage: $('unlockStage'), unlockPassword: $('unlockPassword'), unlockBtn: $('unlockBtn'), legacyUpgradeNote: $('legacyUpgradeNote'),
  previewStage: $('previewStage'), previewContainer: $('previewContainer'), downloadBtn: $('downloadBtn'), hidePreviewBtn: $('hidePreviewBtn'),
  renameDialog: $('renameDialog'), renameForm: $('renameForm'), renameInput: $('renameInput'),
  backupDialog: $('backupDialog'), backupForm: $('backupForm'), backupPassword: $('backupPassword'), backupPasswordConfirm: $('backupPasswordConfirm'), createBackupBtn: $('createBackupBtn'),
  restoreDialog: $('restoreDialog'), restoreForm: $('restoreForm'), restoreFileInput: $('restoreFileInput'), restoreFileLabel: $('restoreFileLabel'), restorePassword: $('restorePassword'), replaceOnRestore: $('replaceOnRestore'), restoreBackupBtn: $('restoreBackupBtn'),
  toastRegion: $('toastRegion')
};

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha no IndexedDB.'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transação não concluída.'));
    tx.onabort = () => reject(tx.error || new Error('Transação cancelada.'));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(DOCS_STORE)) {
        const store = database.createObjectStore(DOCS_STORE, { keyPath: 'id' });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o banco local.'));
    request.onblocked = () => reject(new Error('Atualização do banco bloqueada por outra aba aberta.'));
  });
}

async function getAllDocs() {
  const tx = db.transaction(DOCS_STORE, 'readonly');
  const result = await requestToPromise(tx.objectStore(DOCS_STORE).getAll());
  await transactionDone(tx);
  return result;
}

async function getDoc(id) {
  const tx = db.transaction(DOCS_STORE, 'readonly');
  const result = await requestToPromise(tx.objectStore(DOCS_STORE).get(id));
  await transactionDone(tx);
  return result;
}

async function putDoc(doc) {
  const tx = db.transaction(DOCS_STORE, 'readwrite');
  tx.objectStore(DOCS_STORE).put(doc);
  await transactionDone(tx);
}

async function deleteDocById(id) {
  const tx = db.transaction(DOCS_STORE, 'readwrite');
  tx.objectStore(DOCS_STORE).delete(id);
  await transactionDone(tx);
}

async function clearDocs() {
  const tx = db.transaction(DOCS_STORE, 'readwrite');
  tx.objectStore(DOCS_STORE).clear();
  await transactionDone(tx);
}

async function getMeta(key) {
  const tx = db.transaction(META_STORE, 'readonly');
  const result = await requestToPromise(tx.objectStore(META_STORE).get(key));
  await transactionDone(tx);
  return result ? result.value : null;
}

async function setMeta(key, value) {
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put({ key, value });
  await transactionDone(tx);
}

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveAesKey(password, salt, usages) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

async function encryptBytes(bytes, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return {
    version: 2,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: salt.buffer,
    iv: iv.buffer,
    ciphertext
  };
}

async function decryptV2(encryption, password) {
  const salt = new Uint8Array(encryption.salt);
  const iv = new Uint8Array(encryption.iv);
  const iterations = Number(encryption.iterations) || PBKDF2_ITERATIONS;
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryption.ciphertext);
}

function xorLegacy(data, key) {
  if (!key) throw new Error('Senha vazia.');
  let result = '';
  for (let i = 0; i < data.length; i++) {
    result += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

function decryptLegacy(payload, password) {
  const unicode = atob(payload);
  const dataUrl = xorLegacy(unicode, password);
  if (!/^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,/i.test(dataUrl)) {
    throw new Error('Senha inválida ou conteúdo legado corrompido.');
  }
  return dataUrlToBlob(dataUrl);
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',', 2);
  const mime = (header.match(/^data:([^;]+)/i) || [])[1] || 'application/octet-stream';
  const bytes = base64ToBytes(data);
  return new Blob([bytes], { type: mime });
}

async function migrateLegacyDocEncryption(doc, blob, password) {
  const encryption = await encryptBytes(await blob.arrayBuffer(), password);
  const migrated = {
    ...doc,
    type: blob.type || doc.type || 'application/octet-stream',
    size: blob.size,
    updatedAt: new Date().toISOString(),
    encryption,
    legacy: false,
    migratedAt: new Date().toISOString()
  };
  await putDoc(migrated);
  return migrated;
}

function readLegacyLocalStorage() {
  try {
    const raw = localStorage.getItem('imagensCriptografadas');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function legacyFingerprint(item) {
  const title = typeof item?.title === 'string' ? item.title : '';
  const data = typeof item?.data === 'string' ? item.data : '';
  return `${title}|${data.length}|${data.slice(0, 32)}|${data.slice(-32)}`;
}

function readLegacyDatabase() {
  return new Promise(resolve => {
    let createdNew = false;
    const request = indexedDB.open(LEGACY_DB_NAME);

    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) createdNew = true;
    };

    request.onerror = () => resolve([]);
    request.onsuccess = async () => {
      const legacyDb = request.result;
      if (createdNew || !legacyDb.objectStoreNames.contains(LEGACY_STORE)) {
        legacyDb.close();
        if (createdNew) indexedDB.deleteDatabase(LEGACY_DB_NAME);
        resolve([]);
        return;
      }

      try {
        const tx = legacyDb.transaction(LEGACY_STORE, 'readonly');
        const legacyDocs = await requestToPromise(tx.objectStore(LEGACY_STORE).getAll());
        await transactionDone(tx);
        legacyDb.close();
        resolve(Array.isArray(legacyDocs) ? legacyDocs : []);
      } catch {
        legacyDb.close();
        resolve([]);
      }
    };
  });
}

async function migrateLegacy(force = false) {
  const previous = await getMeta('legacyMigrationAt');
  if (previous && !force) return 0;

  const legacyDbDocs = await readLegacyDatabase();
  const legacyLocalDocs = readLegacyLocalStorage();
  const oldDocs = [...legacyDbDocs, ...legacyLocalDocs];
  if (!oldDocs.length) {
    await setMeta('legacyMigrationAt', new Date().toISOString());
    return 0;
  }

  const currentDocs = await getAllDocs();
  const fingerprints = new Set(currentDocs.map(d => d.legacyFingerprint).filter(Boolean));
  let imported = 0;

  for (const item of oldDocs) {
    if (!item || typeof item.title !== 'string' || typeof item.data !== 'string') continue;
    const fingerprint = legacyFingerprint(item);
    if (fingerprints.has(fingerprint)) continue;
    const now = new Date().toISOString();
    await putDoc({
      id: makeId(),
      title: item.title.trim() || 'Documento antigo',
      type: 'image/*',
      size: null,
      createdAt: now,
      updatedAt: now,
      legacy: true,
      legacySourceTitle: item.title,
      legacyFingerprint: fingerprint,
      encryption: {
        version: 1,
        algorithm: 'XOR-LEGACY',
        payload: item.data
      }
    });
    fingerprints.add(fingerprint);
    imported++;
  }

  await setMeta('legacyMigrationAt', new Date().toISOString());
  return imported;
}

async function refreshDocs() {
  docsCache = await getAllDocs();
  renderDocs();
  await updateStats();
}

function renderDocs() {
  const query = refs.searchInput.value.trim().toLocaleLowerCase('pt-BR');
  const sort = refs.sortSelect.value;
  let items = docsCache.filter(doc => (doc.title || '').toLocaleLowerCase('pt-BR').includes(query));

  items = [...items].sort((a, b) => {
    if (sort === 'title-asc') return (a.title || '').localeCompare(b.title || '', 'pt-BR', { sensitivity: 'base' });
    if (sort === 'title-desc') return (b.title || '').localeCompare(a.title || '', 'pt-BR', { sensitivity: 'base' });
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return sort === 'updated-asc' ? aTime - bTime : bTime - aTime;
  });

  refs.docsGrid.replaceChildren();
  refs.emptyState.classList.toggle('hidden', items.length > 0);
  refs.docsGrid.classList.toggle('hidden', items.length === 0);

  if (!items.length) {
    refs.emptyText.textContent = query ? `Nenhum documento corresponde a “${refs.searchInput.value.trim()}”.` : 'Adicione seu primeiro documento para começar.';
    refs.emptyAddBtn.classList.toggle('hidden', Boolean(query));
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach(doc => fragment.appendChild(createDocCard(doc)));
  refs.docsGrid.appendChild(fragment);
}

function createDocCard(doc) {
  const card = document.createElement('article');
  card.className = 'doc-card';
  card.dataset.id = doc.id;

  const top = document.createElement('div');
  top.className = 'doc-top';

  const icon = document.createElement('div');
  icon.className = 'doc-icon';
  icon.textContent = doc.type === 'application/pdf' ? 'P' : 'D';
  icon.setAttribute('aria-hidden', 'true');

  const info = document.createElement('div');
  info.className = 'doc-info';
  const title = document.createElement('strong');
  title.textContent = doc.title || 'Sem nome';
  title.title = doc.title || '';
  const meta = document.createElement('small');
  meta.textContent = formatDocMeta(doc);
  info.append(title, meta);
  top.append(icon, info);

  const badges = document.createElement('div');
  badges.className = 'doc-badges';
  const secureBadge = document.createElement('span');
  secureBadge.className = `mini-badge${doc.legacy ? ' legacy' : ''}`;
  secureBadge.textContent = doc.legacy ? 'CRIPTOGRAFIA ANTIGA' : 'AES-GCM';
  badges.appendChild(secureBadge);

  const actions = document.createElement('div');
  actions.className = 'doc-actions';

  const open = document.createElement('button');
  open.className = 'btn btn-secondary';
  open.type = 'button';
  open.textContent = 'Abrir';
  open.addEventListener('click', () => openViewer(doc.id));

  const rename = document.createElement('button');
  rename.className = 'icon-action';
  rename.type = 'button';
  rename.textContent = '✎';
  rename.title = 'Renomear';
  rename.setAttribute('aria-label', `Renomear ${doc.title}`);
  rename.addEventListener('click', () => openRename(doc.id));

  const remove = document.createElement('button');
  remove.className = 'icon-action danger';
  remove.type = 'button';
  remove.textContent = '×';
  remove.title = 'Excluir';
  remove.setAttribute('aria-label', `Excluir ${doc.title}`);
  remove.addEventListener('click', () => removeDoc(doc.id));

  actions.append(open, rename, remove);
  card.append(top, badges, actions);
  return card;
}

function formatDocMeta(doc) {
  const date = doc.updatedAt || doc.createdAt;
  const dateText = date ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date)) : 'data desconhecida';
  const sizeText = typeof doc.size === 'number' ? formatBytes(doc.size) : 'tamanho legado';
  return `${dateText} • ${sizeText}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024;
    unit = units[i];
  }
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} ${unit}`;
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function resetAddForm() {
  refs.addForm.reset();
  refs.fileLabel.textContent = 'Até 25 MB. O arquivo será criptografado antes de ser salvo.';
  refs.fileDrop.classList.remove('dragover');
  isSaving = false;
  refs.saveDocBtn.disabled = false;
  refs.saveDocBtn.textContent = 'Criptografar e salvar';
}

async function saveNewDocument(event) {
  event.preventDefault();
  if (isSaving) return;

  const title = refs.titleInput.value.trim();
  const password = refs.passwordInput.value;
  const file = refs.fileInput.files[0];

  if (!title) return toast('Campo obrigatório', 'Informe um nome para o documento.', 'warn');
  if (password.length < 6) return toast('Senha curta', 'Use ao menos 6 caracteres para o documento.', 'warn');
  if (!file) return toast('Arquivo obrigatório', 'Selecione uma imagem ou PDF.', 'warn');
  if (file.size > MAX_FILE_SIZE) return toast('Arquivo muito grande', 'O limite desta versão é 25 MB por documento.', 'error');
  if (!(file.type.startsWith('image/') || file.type === 'application/pdf')) return toast('Formato não aceito', 'Use uma imagem ou um arquivo PDF.', 'error');

  isSaving = true;
  refs.saveDocBtn.disabled = true;
  refs.saveDocBtn.textContent = 'Criptografando…';

  try {
    await requestPersistentStorage(false);
    const encryption = await encryptBytes(await file.arrayBuffer(), password);
    const now = new Date().toISOString();
    await putDoc({
      id: makeId(),
      title,
      type: file.type || 'application/octet-stream',
      size: file.size,
      originalName: file.name || null,
      createdAt: now,
      updatedAt: now,
      legacy: false,
      encryption
    });
    closeDialog(refs.addDialog);
    resetAddForm();
    await refreshDocs();
    await updateStorageInfo();
    toast('Documento salvo', 'Arquivo criptografado e gravado no dispositivo.', 'success');
  } catch (error) {
    console.error(error);
    toast('Não foi possível salvar', humanizeStorageError(error), 'error', 7000);
    isSaving = false;
    refs.saveDocBtn.disabled = false;
    refs.saveDocBtn.textContent = 'Criptografar e salvar';
  }
}

async function openViewer(id) {
  const doc = docsCache.find(item => item.id === id) || await getDoc(id);
  if (!doc) return toast('Documento não encontrado', 'Ele pode ter sido removido em outra aba.', 'warn');

  activeDocId = id;
  clearPreview();
  refs.viewerTitle.textContent = doc.title;
  refs.viewerBadge.textContent = doc.legacy ? 'DOCUMENTO LEGADO' : 'DOCUMENTO PROTEGIDO';
  refs.legacyUpgradeNote.classList.toggle('hidden', !doc.legacy);
  refs.unlockPassword.value = '';
  refs.unlockStage.classList.remove('hidden');
  refs.previewStage.classList.add('hidden');
  openDialog(refs.viewerDialog);
  setTimeout(() => refs.unlockPassword.focus(), 70);
}

async function unlockActiveDoc() {
  const password = refs.unlockPassword.value;
  if (!password) return toast('Digite a senha', 'A senha é necessária para abrir o documento.', 'warn');

  const doc = await getDoc(activeDocId);
  if (!doc) return toast('Documento não encontrado', 'Atualize a página e tente novamente.', 'error');

  refs.unlockBtn.disabled = true;
  refs.unlockBtn.textContent = 'Descriptografando…';

  try {
    let blob;
    if (doc.legacy || doc.encryption?.version === 1) {
      blob = decryptLegacy(doc.encryption.payload, password);
      try {
        const migrated = await migrateLegacyDocEncryption(doc, blob, password);
        const index = docsCache.findIndex(item => item.id === migrated.id);
        if (index >= 0) docsCache[index] = migrated;
        refs.legacyUpgradeNote.classList.add('hidden');
        refs.viewerBadge.textContent = 'DOCUMENTO PROTEGIDO';
        renderDocs();
        updateStats();
        toast('Segurança atualizada', 'Este documento antigo agora usa AES-GCM.', 'success');
      } catch (migrationError) {
        console.warn('Documento aberto, mas não foi possível migrar a criptografia.', migrationError);
      }
    } else {
      const plaintext = await decryptV2(doc.encryption, password);
      blob = new Blob([plaintext], { type: doc.type || 'application/octet-stream' });
    }

    showPreview(blob, doc);
    refs.unlockPassword.value = '';
    refs.unlockStage.classList.add('hidden');
    refs.previewStage.classList.remove('hidden');
  } catch (error) {
    console.warn(error);
    refs.unlockPassword.select();
    toast('Não foi possível abrir', 'Senha incorreta ou conteúdo danificado.', 'error');
  } finally {
    refs.unlockBtn.disabled = false;
    refs.unlockBtn.textContent = 'Abrir documento';
  }
}

function showPreview(blob, doc) {
  clearPreview();
  activeBlob = blob;
  activeObjectUrl = URL.createObjectURL(blob);

  if (blob.type === 'application/pdf') {
    const frame = document.createElement('iframe');
    frame.src = activeObjectUrl;
    frame.title = `Visualização de ${doc.title}`;
    refs.previewContainer.appendChild(frame);
  } else if (blob.type.startsWith('image/')) {
    const image = document.createElement('img');
    image.src = activeObjectUrl;
    image.alt = doc.title;
    refs.previewContainer.appendChild(image);
  } else {
    const message = document.createElement('p');
    message.textContent = 'Este formato não possui visualização embutida. Use “Baixar arquivo descriptografado”.';
    message.className = 'preview-message';
    refs.previewContainer.appendChild(message);
  }
}

function clearPreview() {
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = null;
  activeBlob = null;
  refs.previewContainer.replaceChildren();
}

function lockViewer() {
  clearPreview();
  refs.unlockPassword.value = '';
  refs.previewStage.classList.add('hidden');
  refs.unlockStage.classList.remove('hidden');
}

function closeViewer() {
  clearPreview();
  activeDocId = null;
  refs.unlockPassword.value = '';
  closeDialog(refs.viewerDialog);
}

async function downloadActiveDoc() {
  if (!activeBlob || !activeDocId) return;
  const doc = await getDoc(activeDocId);
  if (!doc) return;

  const extension = extensionForMime(activeBlob.type, doc.originalName);
  const safeTitle = sanitizeFileName(doc.title || 'documento');
  const link = document.createElement('a');
  const url = URL.createObjectURL(activeBlob);
  link.href = url;
  link.download = doc.originalName || `${safeTitle}${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function extensionForMime(type, originalName) {
  if (originalName && /\.[a-z0-9]{1,8}$/i.test(originalName)) return originalName.match(/\.[a-z0-9]{1,8}$/i)[0];
  const map = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic' };
  return map[type] || '';
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'documento';
}

function openRename(id) {
  const doc = docsCache.find(item => item.id === id);
  if (!doc) return;
  renameDocId = id;
  refs.renameInput.value = doc.title;
  openDialog(refs.renameDialog);
  setTimeout(() => refs.renameInput.select(), 50);
}

async function renameDoc(event) {
  event.preventDefault();
  const title = refs.renameInput.value.trim();
  if (!title || !renameDocId) return;
  try {
    const doc = await getDoc(renameDocId);
    if (!doc) throw new Error('Documento não encontrado.');
    doc.title = title;
    doc.updatedAt = new Date().toISOString();
    await putDoc(doc);
    closeDialog(refs.renameDialog);
    renameDocId = null;
    await refreshDocs();
    toast('Nome atualizado', 'O conteúdo criptografado não foi alterado.', 'success');
  } catch (error) {
    toast('Falha ao renomear', error.message || 'Tente novamente.', 'error');
  }
}

async function removeDoc(id) {
  const doc = docsCache.find(item => item.id === id);
  if (!doc) return;
  if (!confirm(`Excluir “${doc.title}”?\n\nEsta ação apaga a cópia desta versão do app. Se você tiver um backup, poderá restaurá-la depois.`)) return;

  try {
    await deleteDocById(id);
    await refreshDocs();
    await updateStorageInfo();
    toast('Documento excluído', 'A cópia local foi removida.', 'success');
  } catch (error) {
    toast('Falha ao excluir', error.message || 'Tente novamente.', 'error');
  }
}

async function updateStats() {
  refs.docsCount.textContent = String(docsCache.length);
  const legacy = docsCache.filter(doc => doc.legacy || doc.encryption?.version === 1).length;
  refs.legacyCount.textContent = legacy ? `${legacy} item(ns) antigo(s) aguardando atualização` : 'Nenhum legado pendente';

  const lastBackupAt = await getMeta('lastBackupAt');
  if (!lastBackupAt) {
    refs.lastBackup.textContent = 'Nunca';
    refs.backupAdvice.textContent = docsCache.length ? 'Crie uma cópia fora do navegador' : 'Faça uma cópia após adicionar documentos';
  } else {
    const date = new Date(lastBackupAt);
    refs.lastBackup.textContent = formatRelativeDate(date);
    const ageDays = Math.floor((Date.now() - date.getTime()) / 86400000);
    refs.backupAdvice.textContent = ageDays >= 7 ? 'Backup antigo — recomendamos gerar outro' : 'Sua cópia externa está recente';
  }
}

function formatRelativeDate(date) {
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffDays <= 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 30) return `Há ${diffDays} dias`;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(date);
}

async function updateStorageInfo() {
  if (!navigator.storage?.estimate) {
    refs.storageUsed.textContent = 'Indisponível';
    refs.storageQuota.textContent = 'O navegador não informa a cota';
    return;
  }
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    refs.storageUsed.textContent = formatBytes(usage);
    refs.storageQuota.textContent = quota ? `Limite estimado: ${formatBytes(quota)}` : 'Limite não informado';
  } catch {
    refs.storageUsed.textContent = '—';
    refs.storageQuota.textContent = 'Não foi possível consultar';
  }
}

async function updatePersistenceStatus() {
  if (!navigator.storage?.persisted) {
    refs.storageProtectionTitle.textContent = 'Persistência não suportada';
    refs.storageProtectionText.textContent = 'Este navegador não oferece a API para solicitar proteção contra descarte automático.';
    refs.protectionDot.className = 'health-dot warn';
    refs.persistBtn.classList.add('hidden');
    return false;
  }

  const persisted = await navigator.storage.persisted();
  refs.storageProtectionTitle.textContent = persisted ? 'Armazenamento persistente ativo' : 'Armazenamento pode ser descartado';
  refs.storageProtectionText.textContent = persisted
    ? 'O navegador marcou os dados deste app como persistentes, reduzindo o risco de remoção automática por falta de espaço.'
    : 'Sob pressão de espaço, o navegador ainda pode remover dados locais. Solicite proteção e mantenha backups externos.';
  refs.protectionDot.className = `health-dot ${persisted ? 'good' : 'warn'}`;
  refs.persistBtn.classList.toggle('hidden', persisted || !navigator.storage.persist);
  return persisted;
}

async function requestPersistentStorage(showFeedback = true) {
  if (!navigator.storage?.persist) return false;
  try {
    const granted = await navigator.storage.persist();
    await updatePersistenceStatus();
    if (showFeedback) {
      toast(
        granted ? 'Proteção ativada' : 'Proteção não concedida',
        granted ? 'O navegador marcou o armazenamento como persistente.' : 'O navegador decidiu manter o modo padrão. Os backups continuam sendo importantes.',
        granted ? 'success' : 'warn',
        6500
      );
    }
    return granted;
  } catch (error) {
    if (showFeedback) toast('Não foi possível solicitar proteção', error.message || 'Tente novamente.', 'error');
    return false;
  }
}

async function serializeDoc(doc) {
  const base = {
    id: doc.id,
    title: doc.title,
    type: doc.type || 'application/octet-stream',
    size: doc.size ?? null,
    originalName: doc.originalName || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    legacy: Boolean(doc.legacy),
    legacySourceTitle: doc.legacySourceTitle || null,
    legacyFingerprint: doc.legacyFingerprint || null
  };

  if (doc.encryption?.version === 1) {
    return { ...base, encryption: { version: 1, algorithm: 'XOR-LEGACY', payload: doc.encryption.payload } };
  }

  return {
    ...base,
    encryption: {
      version: 2,
      algorithm: 'AES-GCM',
      kdf: doc.encryption.kdf || 'PBKDF2-SHA-256',
      iterations: doc.encryption.iterations || PBKDF2_ITERATIONS,
      salt: bytesToBase64(doc.encryption.salt),
      iv: bytesToBase64(doc.encryption.iv),
      ciphertext: bytesToBase64(doc.encryption.ciphertext)
    }
  };
}

function deserializeDoc(doc) {
  if (!doc || typeof doc.id !== 'string' || typeof doc.title !== 'string' || !doc.encryption) throw new Error('Documento inválido no backup.');
  const base = { ...doc };
  if (doc.encryption.version === 2) {
    base.encryption = {
      ...doc.encryption,
      salt: base64ToBytes(doc.encryption.salt).buffer,
      iv: base64ToBytes(doc.encryption.iv).buffer,
      ciphertext: base64ToBytes(doc.encryption.ciphertext).buffer
    };
  } else if (doc.encryption.version !== 1 || typeof doc.encryption.payload !== 'string') {
    throw new Error('Formato de criptografia não suportado no backup.');
  }
  return base;
}

async function encryptBackupObject(snapshot, password) {
  const plainBytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const encryption = await encryptBytes(plainBytes, password);
  return {
    format: 'webcarteira-backup',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    protection: {
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2-SHA-256',
      iterations: encryption.iterations,
      salt: bytesToBase64(encryption.salt),
      iv: bytesToBase64(encryption.iv),
      ciphertext: bytesToBase64(encryption.ciphertext)
    }
  };
}

async function decryptBackupObject(wrapper, password) {
  if (wrapper?.format !== 'webcarteira-backup' || !wrapper.protection) throw new Error('Este arquivo não é um backup protegido reconhecido.');
  const encryption = {
    version: 2,
    iterations: wrapper.protection.iterations,
    salt: base64ToBytes(wrapper.protection.salt).buffer,
    iv: base64ToBytes(wrapper.protection.iv).buffer,
    ciphertext: base64ToBytes(wrapper.protection.ciphertext).buffer
  };
  const plain = await decryptV2(encryption, password);
  return JSON.parse(new TextDecoder().decode(plain));
}

async function createBackup(event) {
  event.preventDefault();
  const password = refs.backupPassword.value;
  const confirmPassword = refs.backupPasswordConfirm.value;
  if (password.length < 8) return toast('Senha curta', 'Use ao menos 8 caracteres na senha do backup.', 'warn');
  if (password !== confirmPassword) return toast('Senhas diferentes', 'A confirmação não coincide com a senha do backup.', 'warn');

  refs.createBackupBtn.disabled = true;
  refs.createBackupBtn.textContent = 'Gerando…';

  try {
    const docs = await getAllDocs();
    const serialized = [];
    for (const doc of docs) serialized.push(await serializeDoc(doc));
    const snapshot = { format: 'webcarteira-snapshot', version: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), documents: serialized };
    const protectedBackup = await encryptBackupObject(snapshot, password);
    const blob = new Blob([JSON.stringify(protectedBackup)], { type: 'application/json' });
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    downloadBlob(blob, `CarteiraWEB-backup-${stamp}.carteira`);
    await setMeta('lastBackupAt', new Date().toISOString());
    refs.backupForm.reset();
    closeDialog(refs.backupDialog);
    await updateStats();
    toast('Backup criado', `${docs.length} documento(s) incluído(s). Guarde o arquivo e a senha em local seguro.`, 'success', 7000);
  } catch (error) {
    console.error(error);
    toast('Falha ao criar backup', error.message || 'Tente novamente.', 'error', 7000);
  } finally {
    refs.createBackupBtn.disabled = false;
    refs.createBackupBtn.textContent = 'Gerar backup';
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function restoreBackup(event) {
  event.preventDefault();
  const file = refs.restoreFileInput.files[0];
  if (!file) return toast('Selecione um backup', 'Escolha o arquivo .carteira antes de continuar.', 'warn');

  refs.restoreBackupBtn.disabled = true;
  refs.restoreBackupBtn.textContent = 'Restaurando…';

  try {
    const raw = await file.text();
    let parsed = JSON.parse(raw);
    let snapshot;

    if (parsed?.format === 'webcarteira-backup') {
      const password = refs.restorePassword.value;
      if (!password) throw new Error('Digite a senha do backup.');
      snapshot = await decryptBackupObject(parsed, password);
    } else if (parsed?.format === 'webcarteira-snapshot') {
      snapshot = parsed;
    } else if (Array.isArray(parsed)) {
      snapshot = legacyJsonToSnapshot(parsed);
    } else if (Array.isArray(parsed?.documents)) {
      snapshot = parsed;
    } else {
      throw new Error('Formato de backup não reconhecido.');
    }

    if (!Array.isArray(snapshot.documents)) throw new Error('Backup sem lista de documentos.');
    if (refs.replaceOnRestore.checked) {
      const proceed = confirm('Substituir a carteira atual? Todos os documentos desta versão serão removidos antes da restauração.');
      if (!proceed) return;
      await clearDocs();
    }

    let imported = 0;
    for (const rawDoc of snapshot.documents) {
      let doc;
      if (rawDoc.encryption) {
        doc = deserializeDoc(rawDoc);
      } else if (typeof rawDoc.title === 'string' && typeof rawDoc.data === 'string') {
        const now = new Date().toISOString();
        doc = {
          id: makeId(), title: rawDoc.title, type: 'image/*', size: null, createdAt: now, updatedAt: now,
          legacy: true, legacySourceTitle: rawDoc.title, legacyFingerprint: legacyFingerprint(rawDoc),
          encryption: { version: 1, algorithm: 'XOR-LEGACY', payload: rawDoc.data }
        };
      } else {
        continue;
      }
      await putDoc(doc);
      imported++;
    }

    refs.restoreForm.reset();
    refs.restoreFileLabel.textContent = 'Arquivos .carteira gerados por esta versão.';
    closeDialog(refs.restoreDialog);
    await refreshDocs();
    await updateStorageInfo();
    toast('Backup restaurado', `${imported} documento(s) processado(s).`, 'success', 6500);
  } catch (error) {
    console.error(error);
    const message = error.name === 'OperationError' ? 'Senha do backup incorreta ou arquivo corrompido.' : (error.message || 'Não foi possível restaurar o arquivo.');
    toast('Falha na restauração', message, 'error', 7500);
  } finally {
    refs.restoreBackupBtn.disabled = false;
    refs.restoreBackupBtn.textContent = 'Restaurar';
  }
}

function legacyJsonToSnapshot(items) {
  return { format: 'webcarteira-snapshot', version: 1, documents: items };
}

function updateNetworkStatus() {
  const online = navigator.onLine;
  refs.networkBadge.textContent = online ? 'Online' : 'Offline — app disponível';
  refs.networkBadge.className = `status-pill ${online ? 'online' : 'offline'}`;
}

function humanizeStorageError(error) {
  if (error?.name === 'QuotaExceededError') return 'O navegador informou falta de espaço. Libere armazenamento ou gere um backup antes de tentar novamente.';
  if (error?.name === 'SecurityError') return 'O navegador bloqueou o armazenamento local neste contexto. Abra o app por HTTPS e evite modo privado.';
  return error?.message || 'O navegador recusou a gravação local.';
}

function toast(title, message, type = '', duration = 4300) {
  const item = document.createElement('div');
  item.className = `toast ${type}`.trim();
  const copy = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = message;
  copy.append(strong, span);
  item.appendChild(copy);
  refs.toastRegion.appendChild(item);
  setTimeout(() => item.remove(), duration);
}

function setupFileDrop() {
  ['dragenter', 'dragover'].forEach(type => refs.fileDrop.addEventListener(type, event => {
    event.preventDefault();
    refs.fileDrop.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(type => refs.fileDrop.addEventListener(type, event => {
    event.preventDefault();
    refs.fileDrop.classList.remove('dragover');
  }));
  refs.fileDrop.addEventListener('drop', event => {
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    refs.fileInput.files = transfer.files;
    updateSelectedFileLabel();
  });
}

function updateSelectedFileLabel() {
  const file = refs.fileInput.files[0];
  refs.fileLabel.textContent = file ? `${file.name} • ${formatBytes(file.size)}` : 'Até 25 MB. O arquivo será criptografado antes de ser salvo.';
}

function updateRestoreFileLabel() {
  const file = refs.restoreFileInput.files[0];
  refs.restoreFileLabel.textContent = file ? `${file.name} • ${formatBytes(file.size)}` : 'Arquivos .carteira gerados por esta versão.';
}

function setupPasswordToggles() {
  document.querySelectorAll('[data-toggle-password]').forEach(button => {
    button.addEventListener('click', () => {
      const input = $(button.dataset.togglePassword);
      if (!input) return;
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.textContent = reveal ? 'Ocultar' : 'Mostrar';
    });
  });
}

function setupDialogClosers() {
  document.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = $(button.dataset.closeDialog);
      if (dialog) closeDialog(dialog);
      if (dialog === refs.addDialog) resetAddForm();
    });
  });

  [refs.addDialog, refs.renameDialog, refs.backupDialog, refs.restoreDialog].forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target === dialog) {
        closeDialog(dialog);
        if (dialog === refs.addDialog) resetAddForm();
      }
    });
  });

  refs.viewerDialog.addEventListener('click', event => {
    if (event.target === refs.viewerDialog) closeViewer();
  });
  refs.viewerDialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeViewer();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Service Worker:', error));
}

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    refs.installBtn.classList.remove('hidden');
  });
  refs.installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    refs.installBtn.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    refs.installBtn.classList.add('hidden');
  });
}

async function boot() {
  if (!('indexedDB' in window) || !crypto?.subtle) {
    toast('Navegador incompatível', 'Esta versão precisa de IndexedDB e Web Crypto API.', 'error', 10000);
    return;
  }

  try {
    db = await openDatabase();
    db.onversionchange = () => {
      db.close();
      toast('Atualização disponível', 'Feche esta aba e abra novamente para concluir a atualização.', 'warn', 10000);
    };

    const migrated = await migrateLegacy(false);
    await refreshDocs();
    await updateStorageInfo();
    await updatePersistenceStatus();
    if (migrated > 0) toast('Documentos antigos encontrados', `${migrated} item(ns) foram copiados para a nova carteira sem apagar o banco antigo.`, 'success', 8000);
  } catch (error) {
    console.error(error);
    toast('Falha ao iniciar a carteira', humanizeStorageError(error), 'error', 10000);
  }
}

refs.addBtn.addEventListener('click', () => openDialog(refs.addDialog));
refs.emptyAddBtn.addEventListener('click', () => openDialog(refs.addDialog));
refs.backupBtn.addEventListener('click', () => openDialog(refs.backupDialog));
refs.restoreBtn.addEventListener('click', () => openDialog(refs.restoreDialog));
refs.persistBtn.addEventListener('click', () => requestPersistentStorage(true));
refs.addForm.addEventListener('submit', saveNewDocument);
refs.renameForm.addEventListener('submit', renameDoc);
refs.backupForm.addEventListener('submit', createBackup);
refs.restoreForm.addEventListener('submit', restoreBackup);
refs.searchInput.addEventListener('input', renderDocs);
refs.sortSelect.addEventListener('change', renderDocs);
refs.fileInput.addEventListener('change', updateSelectedFileLabel);
refs.restoreFileInput.addEventListener('change', updateRestoreFileLabel);
refs.unlockBtn.addEventListener('click', unlockActiveDoc);
refs.unlockPassword.addEventListener('keydown', event => { if (event.key === 'Enter') unlockActiveDoc(); });
refs.closeViewerBtn.addEventListener('click', closeViewer);
refs.hidePreviewBtn.addEventListener('click', lockViewer);
refs.downloadBtn.addEventListener('click', downloadActiveDoc);
refs.migrateLegacyBtn.addEventListener('click', async () => {
  refs.migrateLegacyBtn.disabled = true;
  try {
    const count = await migrateLegacy(true);
    await refreshDocs();
    toast(count ? 'Dados antigos importados' : 'Nada novo encontrado', count ? `${count} documento(s) antigo(s) foram copiados.` : 'Não há documentos antigos ainda não importados.', count ? 'success' : '');
  } finally {
    refs.migrateLegacyBtn.disabled = false;
  }
});

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && refs.viewerDialog.open && !refs.previewStage.classList.contains('hidden')) lockViewer();
});
window.addEventListener('beforeunload', clearPreview);

setupPasswordToggles();
setupDialogClosers();
setupFileDrop();
setupInstallPrompt();
registerServiceWorker();
updateNetworkStatus();
boot();
