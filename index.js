const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Токен бота из .env
const token = process.env.TELEGRAM_BOT_TOKEN;
const ARTISTS_FILE = process.env.ARTISTS_FILE || './artists.json';

// Создаем бота с polling (фоновый режим)
const bot = new TelegramBot(token, { polling: true });

// Хранилище художников в памяти
let artists = [];

// Функция для безопасного экранирования MarkdownV2
function escapeMarkdown(text) {
  if (!text) return '';
  // Список символов для экранирования в MarkdownV2: _ * [ ] ( ) ~ ` > # + - = | { } . !
  // Важно: экранируем каждый символ отдельно
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// Функция для форматирования даты без точек (альтернативный подход)
function formatDateForMarkdown(date) {
  const d = new Date(date);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const seconds = d.getSeconds().toString().padStart(2, '0');
  
  // Используем другой разделитель вместо точек
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

// Загрузка художников из файла
async function loadArtists() {
  try {
    const data = await fs.readFile(ARTISTS_FILE, 'utf8');
    artists = JSON.parse(data).artists;
    console.log(`✅ Загружено ${artists.length} художников:`);
    artists.forEach(a => {
      console.log(`   - ${a.name} (${a.username}) ${a.telegramId ? '✅ зарегистрирован' : '❌ не зарегистрирован'}`);
    });
  } catch (error) {
    console.log('❌ Файл artists.json не найден, создаю новый...');
    artists = [];
    await saveArtists();
  }
}

// Функция сохранения художников в файл
async function saveArtists() {
  try {
    await fs.writeFile(ARTISTS_FILE, JSON.stringify({ artists }, null, 2), 'utf8');
    console.log('✅ Список художников сохранен');
  } catch (error) {
    console.error('❌ Ошибка сохранения художников:', error.message);
  }
}

// Функция поиска художника по username
function findArtistByUsername(username) {
  const normalizedUsername = username.startsWith('@') ? username : `@${username}`;
  return artists.find(a => a.username === normalizedUsername);
}

// Функция обновления telegramId художника
async function updateArtistTelegramId(username, telegramId) {
  const artist = findArtistByUsername(username);
  
  if (artist) {
    artist.telegramId = telegramId.toString();
    artist.registeredAt = new Date().toISOString();
    await saveArtists();
    console.log(`✅ Художник ${artist.name} зарегистрирован с ID: ${telegramId}`);
    return artist;
  }
  
  return null;
}

// Форматирование цены
function formatPrice(price) {
  if (!price) return 'По запросу';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0
  }).format(price).replace('₽', 'руб.');
}

// Создание текста уведомления (без Markdown)
function createNotificationMessage(data) {
  const { workTitle, artistName, price, customer } = data;
  
  let message = '🖼 НОВАЯ ЗАЯВКА НА КАРТИНУ!\n\n';
  message += `Работа: ${workTitle}\n`;
  message += `Художник: ${artistName}\n`;
  message += `Цена: ${price ? formatPrice(price) : 'По запросу'}\n\n`;
  message += 'ДАННЫЕ ПОКУПАТЕЛЯ:\n';
  message += `👤 ФИО: ${customer.fullName}\n`;
  message += `📞 Телефон: ${customer.phone}\n`;
  
  if (customer.telegram) {
    message += `✈️ Telegram: ${customer.telegram}\n`;
  }
  
  if (customer.comment) {
    message += `\n💬 Комментарий:\n${customer.comment}\n`;
  }
  
  return message;
}

// Загружаем художников при старте
loadArtists();

// Команда /start (упрощенная, без Markdown)
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username ? `@${msg.from.username}` : null;
  
  console.log(`📱 Новый вход: ${username || 'без username'} (chatId: ${chatId})`);
  
  if (!username) {
    await bot.sendMessage(
      chatId,
      '❌ У вас не установлен username в Telegram.\n\n' +
      'Пожалуйста, установите username в настройках Telegram и попробуйте снова:\n' +
      'Настройки -> Имя пользователя'
    );
    return;
  }
  
  const artist = findArtistByUsername(username);
  
  if (artist) {
    await updateArtistTelegramId(username, chatId);
    
    // Отправляем простое сообщение без Markdown
    await bot.sendMessage(
      chatId,
      `🎨 Добро пожаловать, ${artist.name}!\n\n` +
      `✅ Вы успешно зарегистрированы в системе уведомлений галереи LIMBO.\n\n` +
      `Теперь вы будете получать уведомления о новых заявках на приобретение ваших работ.\n\n` +
      `Ваш статус: активен\n` +
      `Username: ${username}\n` +
      `Дата регистрации: ${new Date().toLocaleString('ru-RU')}`
    );
    
    setTimeout(async () => {
      try {
        await bot.sendMessage(
          chatId,
          '🔔 Тестовое уведомление\n\nСистема работает корректно. Вы будете получать уведомления о новых заявках.'
        );
      } catch (error) {
        console.log('Ошибка отправки тестового:', error.message);
      }
    }, 1000);
    
  } else {
    await bot.sendMessage(
      chatId,
      '👋 Здравствуйте! Этот бот предназначен только для художников галереи LIMBO.\n\n' +
      'Если вы художник и хотите получать уведомления, свяжитесь с администрацией галереи.\n\n' +
      `Ваш username: ${username}`
    );
  }
});

// Команда для проверки статуса (упрощенная)
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  
  const artist = artists.find(a => a.telegramId === chatId.toString());
  
  if (artist) {
    const status = artist.telegramId ? '✅ активен' : '❌ не активен';
    const regDate = artist.registeredAt ? new Date(artist.registeredAt).toLocaleString('ru-RU') : 'не зарегистрирован';
    
    await bot.sendMessage(
      chatId,
      `📊 СТАТУС РЕГИСТРАЦИИ\n\n` +
      `Имя: ${artist.name}\n` +
      `Username: ${artist.username}\n` +
      `Статус: ${status}\n` +
      `ID: ${artist.telegramId || 'не указан'}\n` +
      `Slug: ${artist.slug}\n` +
      `Зарегистрирован: ${regDate}`
    );
  } else {
    await bot.sendMessage(
      chatId,
      '❌ Вы не зарегистрированы в системе как художник.\n\n' +
      'Если вы художник, убедитесь что ваш username совпадает с указанным в системе.'
    );
  }
});

// Команда для администратора
bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  const adminId = process.env.ADMIN_ID;
  
  if (adminId && chatId.toString() === adminId) {
    let message = '📋 СПИСОК ХУДОЖНИКОВ:\n\n';
    
    artists.forEach((artist, index) => {
      const status = artist.telegramId ? '✅' : '❌';
      message += `${index + 1}. ${status} ${artist.name}\n`;
      message += `   └─ @${artist.username.replace('@', '')}\n`;
      if (artist.telegramId) {
        message += `   └─ ID: ${artist.telegramId}\n`;
        message += `   └─ Регистрация: ${artist.registeredAt ? new Date(artist.registeredAt).toLocaleDateString('ru-RU') : 'неизвестно'}\n`;
      }
      message += '\n';
    });
    
    const registered = artists.filter(a => a.telegramId).length;
    message += `\n📊 Итого: ${registered}/${artists.length} зарегистрировано`;
    
    await bot.sendMessage(chatId, message);
  }
});

// Функция для отправки уведомления художнику
async function sendNotificationToArtist(artistUsername, requestData) {
  const normalizedUsername = artistUsername.startsWith('@') ? artistUsername : `@${artistUsername}`;
  const artist = artists.find(a => a.username === normalizedUsername);
  
  if (!artist) {
    console.log(`❌ Художник ${artistUsername} не найден в базе`);
    return { 
      success: false, 
      message: 'Художник не найден в системе' 
    };
  }
  
  if (!artist.telegramId) {
    console.log(`⚠️ Художник ${artist.name} не зарегистрирован в боте`);
    return { 
      success: false, 
      message: 'Художник ещё не зарегистрировался в боте' 
    };
  }
  
  const message = createNotificationMessage(requestData);
  
  try {
    await bot.sendMessage(artist.telegramId, message, {
      disable_web_page_preview: true
    });
    
    console.log(`✅ Уведомление отправлено художнику ${artist.name}`);
    
    return { 
      success: true, 
      message: 'Уведомление доставлено художнику' 
    };
  } catch (error) {
    console.error(`❌ Ошибка отправки уведомления ${artist.name}:`, error.message);
    
    if (error.message.includes('blocked') || error.message.includes('forbidden')) {
      artist.telegramId = null;
      await saveArtists();
      console.log(`⚠️ Художник ${artist.name} заблокировал бота, telegramId сброшен`);
    }
    
    return { 
      success: false, 
      message: 'Ошибка доставки уведомления' 
    };
  }
}

// API endpoint для получения заявок
app.post('/api/notification', async (req, res) => {
  try {
    const requestData = req.body;
    console.log('\n📨 Получена новая заявка:');
    console.log(`   Работа: ${requestData.workTitle}`);
    console.log(`   Художник: ${requestData.artistUsername}`);
    console.log(`   Покупатель: ${requestData.customer.fullName}`);
    
    const result = await sendNotificationToArtist(
      requestData.artistUsername, 
      requestData
    );
    
    res.json({
      success: result.success,
      message: result.message,
      artistFound: result.success || result.message.includes('не зарегистрировался'),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка обработки заявки:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Внутренняя ошибка сервера' 
    });
  }
});

// API endpoint для получения статуса художника
app.get('/api/artist/:username/status', async (req, res) => {
  try {
    const { username } = req.params;
    const normalizedUsername = username.startsWith('@') ? username : `@${username}`;
    
    const artist = artists.find(a => a.username === normalizedUsername);
    
    if (artist) {
      res.json({
        found: true,
        name: artist.name,
        registered: !!artist.telegramId,
        telegramId: artist.telegramId,
        registeredAt: artist.registeredAt || null
      });
    } else {
      res.json({
        found: false,
        message: 'Художник не найден'
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n🚀 Сервер уведомлений запущен');
  console.log(`📡 Порт: ${PORT}`);
  console.log(`🤖 Бот активен, ожидает команды...\n`);
});

// Обработка ошибок бота
bot.on('polling_error', (error) => {
  if (error.message.includes('ETELEGRAM')) {
    console.error('❌ Ошибка подключения к Telegram API:', error.message);
  } else {
    console.error('⚠️ Ошибка polling:', error.message);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Завершение работы...');
  await saveArtists();
  process.exit();
});

process.on('SIGTERM', async () => {
  console.log('\n👋 Завершение работы...');
  await saveArtists();
  process.exit();
});