const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'database.json');

app.use(express.json());
app.use(express.static(__dirname));

// Инициализация базы данных
let db = { users: [], messages: [], groups: [], groupMessages: [], channels: [], channelPosts: [], channelComments: [], reports: [], lastId: 1000, lastGroupId: 100, lastChannelId: 0 };

function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (!parsed.groups) parsed.groups = [];
            if (!parsed.groupMessages) parsed.groupMessages = [];
            if (!parsed.lastGroupId) parsed.lastGroupId = 100;
            if (!parsed.channels) parsed.channels = [];
            if (!parsed.channelPosts) parsed.channelPosts = [];
            if (!parsed.channelComments) parsed.channelComments = [];
            if (!parsed.lastChannelId) parsed.lastChannelId = 0;
            if (!parsed.reports) parsed.reports = [];
            return parsed;
        }
    } catch (e) {
        console.error("[DB] Ошибка загрузки, создаю новую базу.");
    }
    return { users: [], messages: [], groups: [], groupMessages: [], channels: [], channelPosts: [], channelComments: [], reports: [], lastId: 1000, lastGroupId: 100, lastChannelId: 0 };
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

// ==================== ОНЛАЙН-СТАТУС ====================
// Хранится только в памяти (сбрасывается при перезапуске — это нормально)
const onlineUsers = new Map(); // userId -> lastSeen timestamp

function pingOnline(userId) {
    onlineUsers.set(userId, Date.now());
}

function isOnline(userId) {
    const last = onlineUsers.get(userId);
    if (!last) return false;
    return (Date.now() - last) < 35000; // онлайн если пинговал <35 сек назад
}

// Пинг онлайна (клиент вызывает каждые 20 сек)
app.post('/api/ping', (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false });
    pingOnline(userId);
    res.json({ success: true });
});

// Статус конкретного пользователя
app.get('/api/status/:userId', (req, res) => {
    const { userId } = req.params;
    const last = onlineUsers.get(userId);
    res.json({
        online: isOnline(userId),
        lastSeen: last || null
    });
});

// ==================== ПОЛЬЗОВАТЕЛИ ====================

// Регистрация
app.post('/api/register', (req, res) => {
    const { username, password, platform } = req.body;
    if (!username || !password) return res.status(400).json({ success: false });

    // Проверка уникальности юзернейма (без учёта регистра)
    const exists = db.users.find(u => u.username.toLowerCase() === username.toLowerCase() ||
        u.username.replace(/^\[.*?\]\s*/, '').toLowerCase() === username.toLowerCase());
    if (exists) return res.json({ success: false, error: 'taken' });

    db.lastId++;
    const newId = db.lastId.toString();
    const displayName = (platform === 'app' ? '[app] ' : '[site] ') + username;

    db.users.push({ id: newId, username: displayName, rawUsername: username.toLowerCase(), password });
    saveDB();
    res.json({ success: true, id: newId, displayName });
});

// Вход по юзернейму
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(401).json({ success: false });

    // Ищем по rawUsername или по части displayName
    const user = db.users.find(u =>
        (u.rawUsername && u.rawUsername === username.toLowerCase() && u.password === password) ||
        (u.username.replace(/^\[.*?\]\s*/, '').toLowerCase() === username.toLowerCase() && u.password === password)
    );
    if (user) {
        pingOnline(user.id);
        res.json({ success: true, id: user.id, username: user.username });
    } else {
        res.status(401).json({ success: false });
    }
});

// Найти пользователя по юзернейму
app.get('/api/user/find/:username', (req, res) => {
    const search = req.params.username.toLowerCase();
    const user = db.users.find(u =>
        (u.rawUsername && u.rawUsername === search) ||
        u.username.replace(/^\[.*?\]\s*/, '').toLowerCase() === search
    );
    if (!user) return res.status(404).json({ success: false, error: 'Не найден' });
    res.json({ id: user.id, username: user.username });
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
        .map(u => {
            // Считаем непрочитанные: сообщения ОТ собеседника, у которых нет поля readBy с myId
            const unread = db.messages.filter(m =>
                m.fromId === u.id && m.toId === myId && !m.readBy?.includes(myId)
            ).length;
            return {
                id: u.id,
                username: u.username,
                online: isOnline(u.id),
                unread
            };
        });

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

// Получить историю личных сообщений (и пометить как прочитанные)
app.get('/api/messages/:myId/:otherId', (req, res) => {
    const { myId, otherId } = req.params;
    const history = db.messages.filter(m =>
        (m.fromId === myId && m.toId === otherId) ||
        (m.fromId === otherId && m.toId === myId)
    );
    // Помечаем входящие как прочитанные
    let changed = false;
    history.forEach(m => {
        if (m.toId === myId && m.fromId === otherId) {
            if (!m.readBy) m.readBy = [];
            if (!m.readBy.includes(myId)) {
                m.readBy.push(myId);
                changed = true;
            }
        }
    });
    if (changed) saveDB();
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

// ==================== КАНАЛЫ ====================

// Генерация ID канала (формат D-XXXX)
function generateChannelId() {
    db.lastChannelId++;
    const num = String(db.lastChannelId).padStart(4, '0');
    return `D-${num}`;
}

// Создать канал
app.post('/api/channels', (req, res) => {
    const { name, desc, ownerId } = req.body;
    if (!name || !ownerId) return res.status(400).json({ success: false, error: 'Нет данных' });
    const owner = db.users.find(u => u.id === ownerId);
    if (!owner) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

    const channelId = generateChannelId();
    db.channels.push({
        id: channelId,
        name: name.trim(),
        desc: (desc || '').trim(),
        ownerId,
        subscribers: [ownerId],
        createdAt: Date.now()
    });
    saveDB();
    console.log(`[CHANNELS] Создан канал "${name}" (${channelId}) пользователем ${ownerId}`);
    res.json({ success: true, channelId });
});

// Подписаться на канал
app.post('/api/channels/subscribe', (req, res) => {
    const { channelId, userId } = req.body;
    if (!channelId || !userId) return res.status(400).json({ success: false, error: 'Нет данных' });
    const channel = db.channels.find(c => c.id === channelId.toUpperCase());
    if (!channel) return res.status(404).json({ success: false, error: 'Канал не найден' });
    if (channel.subscribers.includes(userId)) return res.json({ success: true, alreadySubscribed: true });
    channel.subscribers.push(userId);
    saveDB();
    res.json({ success: true });
});

// Список каналов пользователя (подписан или владелец)
app.get('/api/channels/:userId', (req, res) => {
    const { userId } = req.params;
    // Проверяем что это не запрос инфо о канале
    if (userId.startsWith('D-') || userId.startsWith('d-')) return res.status(400).json([]);
    const userChannels = db.channels
        .filter(c => c.subscribers.includes(userId))
        .map(c => ({
            id: c.id,
            name: c.name,
            desc: c.desc,
            ownerId: c.ownerId,
            subCount: c.subscribers.length
        }));
    res.json(userChannels);
});

// Инфо о канале
app.get('/api/channels/info/:channelId', (req, res) => {
    const channel = db.channels.find(c => c.id === req.params.channelId.toUpperCase());
    if (!channel) return res.status(404).json({ success: false, error: 'Не найден' });
    res.json({ id: channel.id, name: channel.name, desc: channel.desc, ownerId: channel.ownerId, subCount: channel.subscribers.length });
});

// Опубликовать пост в канал
app.post('/api/channels/:channelId/posts', (req, res) => {
    const { channelId } = req.params;
    const { authorId, text } = req.body;
    if (!authorId || !text) return res.status(400).json({ success: false });
    const channel = db.channels.find(c => c.id === channelId);
    if (!channel) return res.status(404).json({ success: false, error: 'Канал не найден' });
    if (channel.ownerId !== authorId) return res.status(403).json({ success: false, error: 'Только владелец может публиковать' });

    const author = db.users.find(u => u.id === authorId);
    const postId = `P-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    db.channelPosts.push({ id: postId, channelId, authorId, authorName: author ? author.username : authorId, text, time: Date.now() });
    saveDB();
    res.json({ success: true, postId });
});

// Получить посты канала
app.get('/api/channels/:channelId/posts', (req, res) => {
    const { channelId } = req.params;
    const posts = db.channelPosts
        .filter(p => p.channelId === channelId)
        .slice(-50)
        .map(p => ({
            ...p,
            commentCount: db.channelComments.filter(c => c.postId === p.id).length
        }));
    res.json(posts);
});

// Добавить комментарий к посту
app.post('/api/channels/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const { authorId, text } = req.body;
    if (!authorId || !text) return res.status(400).json({ success: false });
    const post = db.channelPosts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ success: false, error: 'Пост не найден' });
    const author = db.users.find(u => u.id === authorId);
    db.channelComments.push({
        id: `C-${Date.now()}`,
        postId,
        authorId,
        authorName: author ? author.username : authorId,
        text,
        time: Date.now()
    });
    saveDB();
    res.json({ success: true });
});

// Получить комментарии поста
app.get('/api/channels/posts/:postId/comments', (req, res) => {
    const comments = db.channelComments.filter(c => c.postId === req.params.postId);
    res.json(comments);
});

// ==================== СТРИМ ====================
// Хранится в памяти (не сохраняется в БД)
let activeStream = null; // { hostId, hostName, startTime, messages: [] }

// Проверить статус стрима
app.get('/api/stream', (req, res) => {
    if(activeStream) {
        res.json({ active: true, hostId: activeStream.hostId, hostName: activeStream.hostName, startTime: activeStream.startTime });
    } else {
        res.json({ active: false });
    }
});

app.get('/api/stream/check', (req, res) => {
    if(activeStream) {
        res.json({ active: true, hostId: activeStream.hostId, startTime: activeStream.startTime });
    } else {
        res.json({ active: false });
    }
});

// Запустить стрим
app.post('/api/stream/start', (req, res) => {
    const { hostId } = req.body;
    if(activeStream) return res.json({ success: false, error: 'Уже идёт трансляция' });
    const host = db.users.find(u => u.id === hostId);
    if(!host) return res.status(404).json({ success: false });
    activeStream = { hostId, hostName: host.username, startTime: Date.now(), messages: [] };
    console.log(`[STREAM] Трансляция запущена пользователем ${host.username}`);
    res.json({ success: true, startTime: activeStream.startTime });
});

// Завершить стрим
app.post('/api/stream/end', (req, res) => {
    const { hostId } = req.body;
    if(!activeStream) return res.json({ success: false, error: 'Нет активной трансляции' });
    if(activeStream.hostId !== hostId) return res.status(403).json({ success: false, error: 'Только хост может завершить' });
    console.log(`[STREAM] Трансляция завершена. Длилась ${Math.floor((Date.now() - activeStream.startTime)/1000)} сек`);
    activeStream = null;
    res.json({ success: true });
});

// Отправить сообщение в стрим
app.post('/api/stream/messages', (req, res) => {
    const { fromId, text } = req.body;
    if(!activeStream) return res.status(400).json({ success: false, error: 'Нет трансляции' });
    if(!text || !fromId) return res.status(400).json({ success: false });
    const user = db.users.find(u => u.id === fromId);
    activeStream.messages.push({
        fromId,
        fromName: user ? user.username : fromId,
        hostId: activeStream.hostId,
        text,
        time: Date.now()
    });
    // Хранить только последние 200 сообщений
    if(activeStream.messages.length > 200) activeStream.messages.shift();
    res.json({ success: true });
});

// Получить сообщения стрима
app.get('/api/stream/messages', (req, res) => {
    if(!activeStream) return res.json([]);
    res.json(activeStream.messages.slice(-100));
});

// ==================== РЕАКЦИИ ====================

app.post('/api/reactions', (req, res) => {
    const { msgId, userId, emoji, chatType, chatId } = req.body;
    if(!msgId || !userId || !emoji) return res.status(400).json({ success: false });

    let msg = null;
    if(chatType === 'group') {
        msg = db.groupMessages.find(m => (m.id || (m.fromId + '_' + m.time)) === msgId);
    } else {
        msg = db.messages.find(m => (m.id || (m.fromId + '_' + m.time)) === msgId);
    }

    // Если нашли по составному ключу — присваиваем id
    if(!msg) {
        // Попробуем найти по time (последние 500)
        const pool = chatType === 'group' ? db.groupMessages : db.messages;
        msg = pool.find(m => String(m.fromId + '_' + m.time) === msgId || String(m.time) === msgId.split('_')[1]);
    }

    if(!msg) return res.status(404).json({ success: false, error: 'Сообщение не найдено' });

    if(!msg.id) msg.id = msg.fromId + '_' + msg.time;
    if(!msg.reactions) msg.reactions = {};
    if(!msg.reactions[emoji]) msg.reactions[emoji] = [];

    const idx = msg.reactions[emoji].indexOf(userId);
    if(idx === -1) {
        msg.reactions[emoji].push(userId);
    } else {
        msg.reactions[emoji].splice(idx, 1);
        if(msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    }

    saveDB();
    res.json({ success: true });
});

// ==================== РЕПОРТЫ ====================

const ADMIN_USERNAME = 'adminjs';

function isAdmin(userId) {
    const user = db.users.find(u => u.id === userId);
    if (!user) return false;
    const raw = (user.rawUsername || user.username.replace(/^\[.*?\]\s*/, '')).toLowerCase();
    return raw === ADMIN_USERNAME;
}

// Отправить жалобу
app.post('/api/reports', (req, res) => {
    const { fromId, targetId, targetName, reason, comment } = req.body;
    if (!fromId || !targetId || !reason) return res.status(400).json({ success: false });

    const from = db.users.find(u => u.id === fromId);
    const reportId = `R-${Date.now()}`;

    db.reports.push({
        id: reportId,
        fromId,
        fromName: from ? from.username : fromId,
        targetId,
        targetName,
        reason,
        comment: comment || '',
        time: Date.now(),
        reviewed: false
    });
    saveDB();
    console.log(`[REPORT] ${from?.username || fromId} пожаловался на ${targetName} (${reason})`);
    res.json({ success: true });
});

// Получить все репорты (только для админа)
app.post('/api/admin/reports', (req, res) => {
    const { adminId } = req.body;
    if (!isAdmin(adminId)) return res.status(403).json({ success: false, error: 'Нет доступа' });
    res.json({ success: true, reports: db.reports });
});

// Пометить репорт как просмотренный
app.post('/api/admin/reports/reviewed', (req, res) => {
    const { adminId, reportId } = req.body;
    if (!isAdmin(adminId)) return res.status(403).json({ success: false });
    const report = db.reports.find(r => r.id === reportId);
    if (!report) return res.status(404).json({ success: false });
    report.reviewed = true;
    saveDB();
    res.json({ success: true });
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
    СЕРВЕР "ДОВЕРИЕ" v1.9.0 ЗАПУЩЕН
    Порт: ${PORT}
    Юзернеймы: включены ✓
    Группы: включены ✓
    Каналы: включены ✓
    Стрим: включён ✓
    Реакции: включены ✓
    Репорты: включены ✓
    ======================================
    `);
});
