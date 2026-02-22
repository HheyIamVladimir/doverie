const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'database.json');

app.use(express.json());
app.use(express.static(__dirname));

// Инициализация базы данных
let db = { users: [], messages: [], groups: [], groupMessages: [], lastId: 1000, lastGroupId: 100 };

function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(data);
            // Совместимость со старой БД без групп
            if (!parsed.groups) parsed.groups = [];
            if (!parsed.groupMessages) parsed.groupMessages = [];
            if (!parsed.lastGroupId) parsed.lastGroupId = 100;
            return parsed;
        }
    } catch (e) {
        console.error("[DB] Ошибка загрузки, создаю новую базу.");
    }
    return { users: [], messages: [], groups: [], groupMessages: [], lastId: 1000, lastGroupId: 100 };
}

function saveDB() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error("[DB] Ошибка записи (возможно, Read-Only на Render):", e.message);
    }
}

// Генерация уникального ID группы (формат: GRP-XXXXX)
function generateGroupId() {
    db.lastGroupId++;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 5; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    return `GRP-${suffix}`;
}

db = loadDB();

// ==================== ПОЛЬЗОВАТЕЛИ ====================

// Регистрация
app.post('/api/register', (req, res) => {
    const { username, password, platform } = req.body;
    if (!username || !password) return res.status(400).json({ success: false });

    db.lastId++;
    const newId = db.lastId.toString();
    const finalName = (platform === 'app' ? '[app] ' : '[site] ') + username;

    db.users.push({ id: newId, username: finalName, password });
    saveDB();
    res.json({ success: true, id: newId });
});

// Вход
app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    const user = db.users.find(u => u.id === id && u.password === password);
    if (user) {
        res.json({ success: true, id: user.id, username: user.username });
    } else {
        res.status(401).json({ success: false });
    }
});

// ==================== ЛИЧНЫЕ ЧАТЫ ====================

// Список чатов (кто писал мне или кому писал я)
app.get('/api/chats/:myId', (req, res) => {
    const myId = req.params.myId;
    const chattedIds = new Set();

    db.messages.forEach(m => {
        if (m.fromId === myId) chattedIds.add(m.toId);
        if (m.toId === myId) chattedIds.add(m.fromId);
    });

    const activeChats = db.users
        .filter(u => chattedIds.has(u.id))
        .map(u => ({ id: u.id, username: u.username }));

    res.json(activeChats);
});

// Отправить личное сообщение
app.post('/api/messages', (req, res) => {
    const { fromId, toId, text } = req.body;
    if (!text || !fromId || !toId) return res.json({ success: false });

    db.messages.push({ fromId, toId, text, time: Date.now() });
    saveDB();
    res.json({ success: true });
});

// Получить историю личных сообщений
app.get('/api/messages/:myId/:otherId', (req, res) => {
    const { myId, otherId } = req.params;
    const history = db.messages.filter(m =>
        (m.fromId === myId && m.toId === otherId) ||
        (m.fromId === otherId && m.toId === myId)
    );
    res.json(history);
});

// ==================== ГРУППЫ ====================

// Создать группу
app.post('/api/groups', (req, res) => {
    const { name, creatorId } = req.body;
    if (!name || !creatorId) return res.status(400).json({ success: false, error: 'Нет имени или создателя' });

    const creator = db.users.find(u => u.id === creatorId);
    if (!creator) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

    const groupId = generateGroupId();
    const group = {
        id: groupId,
        name: name.trim(),
        creatorId,
        members: [creatorId],
        createdAt: Date.now()
    };

    db.groups.push(group);
    saveDB();
    console.log(`[GROUPS] Создана группа "${name}" (${groupId}) пользователем ${creatorId}`);
    res.json({ success: true, groupId });
});

// Вступить в группу
app.post('/api/groups/join', (req, res) => {
    const { groupId, userId } = req.body;
    if (!groupId || !userId) return res.status(400).json({ success: false, error: 'Нет данных' });

    const group = db.groups.find(g => g.id === groupId.toUpperCase());
    if (!group) return res.status(404).json({ success: false, error: 'Группа не найдена' });

    if (group.members.includes(userId)) {
        return res.json({ success: true, alreadyMember: true });
    }

    group.members.push(userId);
    saveDB();
    console.log(`[GROUPS] Пользователь ${userId} вступил в группу ${groupId}`);
    res.json({ success: true });
});

// Список групп пользователя
app.get('/api/groups/:userId', (req, res) => {
    const { userId } = req.params;
    const userGroups = db.groups
        .filter(g => g.members.includes(userId))
        .map(g => ({
            id: g.id,
            name: g.name,
            creatorId: g.creatorId,
            memberCount: g.members.length,
            createdAt: g.createdAt
        }));
    res.json(userGroups);
});

// Инфо о конкретной группе
app.get('/api/groups/info/:groupId', (req, res) => {
    const group = db.groups.find(g => g.id === req.params.groupId.toUpperCase());
    if (!group) return res.status(404).json({ success: false, error: 'Не найдена' });
    res.json({
        id: group.id,
        name: group.name,
        memberCount: group.members.length,
        createdAt: group.createdAt
    });
});

// ==================== СООБЩЕНИЯ ГРУПП ====================

// Отправить сообщение в группу
app.post('/api/group-messages', (req, res) => {
    const { fromId, groupId, text } = req.body;
    if (!fromId || !groupId || !text) return res.status(400).json({ success: false });

    const group = db.groups.find(g => g.id === groupId);
    if (!group) return res.status(404).json({ success: false, error: 'Группа не найдена' });
    if (!group.members.includes(fromId)) return res.status(403).json({ success: false, error: 'Ты не в этой группе' });

    const sender = db.users.find(u => u.id === fromId);
    const fromName = sender ? sender.username : fromId;

    db.groupMessages.push({ fromId, fromName, groupId, text, time: Date.now() });
    saveDB();
    res.json({ success: true });
});

// Получить историю сообщений группы
app.get('/api/group-messages/:groupId', (req, res) => {
    const { groupId } = req.params;

    // Проверка: только участники могут читать (опционально можно добавить auth)
    const messages = db.groupMessages
        .filter(m => m.groupId === groupId)
        .slice(-200); // последние 200 сообщений

    res.json(messages);
});

// ==================== ПРОЧЕЕ ====================

// Лямбда
app.post('/api/lambda', (req, res) => {
    const user = db.users.find(u => u.id === req.body.id);
    if (user && !user.username.includes('λ')) {
        user.username += ' λ';
        saveDB();
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.listen(PORT, () => {
    console.log(`
    ======================================
    СЕРВЕР "ДОВЕРИЕ" v1.3.0 ЗАПУЩЕН
    Порт: ${PORT}
    Группы: включены ✓
    ======================================
    `);
});
