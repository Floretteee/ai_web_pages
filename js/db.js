const DB_NAME = 'FimallChat';
const DB_VERSION = 2;
const STORE_NAME = 'chats';
const SETTINGS_STORE_NAME = 'settings';

let _db = null;

function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
                db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => {
            _db = request.result;
            _db.addEventListener('close', () => { _db = null; });
            resolve(_db);
        };
        request.onerror = () => reject(request.error);
    });
}

async function getAllChats() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveAllChats(chats) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        for (const chat of chats) {
            store.put(chat);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function deleteChatFromDB(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function clearAllChats() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getSettings() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SETTINGS_STORE_NAME, 'readonly');
        const store = tx.objectStore(SETTINGS_STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
            const settings = {};
            for (const item of request.result) {
                settings[item.key] = item.value;
            }
            resolve(settings);
        };
        request.onerror = () => reject(request.error);
    });
}

async function saveSettingsToDB(settings) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SETTINGS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SETTINGS_STORE_NAME);
        for (const [key, value] of Object.entries(settings)) {
            store.put({ key, value });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function deleteSettingsKeys(keys) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SETTINGS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SETTINGS_STORE_NAME);
        for (const key of keys) {
            store.delete(key);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
