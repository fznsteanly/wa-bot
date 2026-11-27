// ============================================================
// WA-BOT — Bot WhatsApp otomatis (whatsapp-web.js)
// Fitur: balas otomatis (kata kunci), perintah (!menu dll),
//        stiker (.s), stiker -> foto (.toimg),
//        anti view-once (.vo), cuaca (.cuaca),
//        jadwal sholat (.jadwalsholat), pengingat (.ingetin),
//        tag semua anggota grup (.tagall), stiker audio (.audio),
//        stiker video bersuara (.vstiker), stiker bersuara (.s video,
//        .sb, .setaudio, .resetaudio, .getaudio),
//        broadcast promosi ke semua grup (.bc, khusus owner),
//        pesan terjadwal, dan log sederhana.
// Jalankan: npm install  lalu  npm start  lalu scan QR di HP
//           (atau pakai kode pairing — lihat config.botNumber).
// Bisa jalan di VPS maupun di Termux (Android).
// Catatan: stiker video (animasi) & .toimg butuh ffmpeg terinstal.
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const schedule = require('node-schedule');
const config = require('./config');

const log = (...args) => console.log(new Date().toISOString(), ...args);

// Cooldown per chat supaya bot tidak nge-spam
const lastReplyAt = new Map();

function isOnCooldown(chatId) {
  const last = lastReplyAt.get(chatId);
  if (!last) return false;
  return Date.now() - last < config.replyCooldownSeconds * 1000;
}

// Cari balasan dari aturan kata kunci
function findAutoReply(text) {
  const lower = text.toLowerCase();
  for (const rule of config.autoReplies) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return rule.reply;
    }
  }
  return null;
}

// Cari media dari pesan yang di-reply, atau dari pesan itu sendiri
// (misal foto dikirim dengan caption perintah). Dipakai .s, .vo, .toimg.
async function findMediaMessage(msg) {
  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      if (quoted && quoted.hasMedia) return quoted;
    } catch (e) {
      log('⚠️ Gagal ambil pesan reply:', e.message);
    }
  }
  if (msg.hasMedia) return msg;
  return null;
}

// Ambil JSON dari URL dengan batas waktu (untuk API cuaca & jadwal sholat)
async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Terjemahan deskripsi cuaca wttr.in (Inggris -> Indonesia)
const WEATHER_ID = {
  'Clear': 'Cerah', 'Sunny': 'Cerah',
  'Partly cloudy': 'Berawan sebagian', 'Partly Cloudy': 'Berawan sebagian',
  'Cloudy': 'Berawan', 'Overcast': 'Mendung',
  'Mist': 'Berkabut', 'Fog': 'Berkabut tebal', 'Freezing fog': 'Kabut beku',
  'Patchy rain possible': 'Berpotensi hujan',
  'Patchy light drizzle': 'Gerimis ringan setempat',
  'Light drizzle': 'Gerimis ringan', 'Drizzle': 'Gerimis',
  'Light rain': 'Hujan ringan', 'Patchy light rain': 'Hujan ringan setempat',
  'Moderate rain': 'Hujan sedang', 'Patchy moderate rain': 'Hujan sedang setempat',
  'Heavy rain': 'Hujan lebat', 'Patchy heavy rain': 'Hujan lebat setempat',
  'Light rain shower': 'Hujan gerimis',
  'Moderate or heavy rain shower': 'Hujan deras',
  'Torrential rain shower': 'Hujan sangat deras',
  'Thundery outbreaks possible': 'Berpotensi petir',
  'Patchy light rain with thunder': 'Hujan ringan disertai petir',
  'Moderate or heavy rain with thunder': 'Hujan disertai petir',
  'Thunderstorm': 'Badai petir',
  'Light snow': 'Salju ringan', 'Heavy snow': 'Salju lebat',
  'Light sleet': 'Hujan es ringan', 'Moderate or heavy sleet': 'Hujan es',
};
function translateWeather(desc) {
  return WEATHER_ID[desc] || desc;
}

// Nama bulan Hijriah (untuk jadwal sholat)
const HIJRI_MONTHS = ['Muharram', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir', 'Rajab', 'Syaban', 'Ramadan', 'Syawal', 'Zulkaidah', 'Zulhijah'];

// Parse durasi pengingat: 30m, 2j, 1h30m, 45d, 10s, "1j 30m", angka saja = menit.
// Kembalikan milidetik, atau null kalau format tidak dikenali.
function parseDuration(str) {
  const s = (str || '').trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 60000;
  const re = /(\d+)\s*(jam|j|h|menit|mnt|m|detik|dtk|s)/g;
  let ms = 0, found = false, match;
  while ((match = re.exec(s)) !== null) {
    found = true;
    const n = parseInt(match[1], 10);
    const u = match[2];
    if (u === 'jam' || u === 'j' || u === 'h') ms += n * 3600000;
    else if (u === 'menit' || u === 'mnt' || u === 'm') ms += n * 60000;
    else ms += n * 1000;
  }
  if (!found) return null;
  const cleaned = s.replace(/(\d+)\s*(jam|j|h|menit|mnt|m|detik|dtk|s)\s*/g, '');
  if (cleaned.trim() !== '') return null;
  return ms > 0 ? ms : null;
}

function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h} jam`);
  if (m) parts.push(`${m} menit`);
  if (s || parts.length === 0) parts.push(`${s} detik`);
  return parts.join(' ');
}

// Konversi stiker WebP -> JPG pakai ffmpeg. Kembalikan base64 JPG,
// atau null kalau ffmpeg tidak ada / gagal (pemanggil pakai WebP asli).
function webpToJpg(base64) {
  return new Promise((resolve) => {
    let tmp;
    try {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-'));
      const input = path.join(tmp, 'in.webp');
      const output = path.join(tmp, 'out.jpg');
      fs.writeFileSync(input, Buffer.from(base64, 'base64'));
      execFile('ffmpeg', ['-y', '-v', 'error', '-i', input, output], (err) => {
        let result = null;
        if (!err && fs.existsSync(output)) result = fs.readFileSync(output).toString('base64');
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
        resolve(result);
      });
    } catch (e) {
      if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
      resolve(null);
    }
  });
}

// Tangani perintah yang diawali !
async function handleCommand(msg, text) {
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  switch (cmd) {
    case '!menu':
    case '!help':
      return config.menuText;
    case '!ping':
      return 'Pong! 🏓 Bot aktif dan siap melayani.';
    case '!jam': {
      const now = new Date();
      const hour = parseInt(now.toLocaleString('en-US', {
        timeZone: 'Asia/Makassar', hour: 'numeric', hourCycle: 'h23',
      }), 10);
      const greet = hour >= 5 && hour < 11 ? '☀️ Selamat pagi!'
        : hour >= 11 && hour < 15 ? '🌤️ Selamat siang!'
        : hour >= 15 && hour < 18 ? '🌇 Selamat sore!'
        : '🌙 Selamat malam!';
      const dateStr = now.toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        timeZone: 'Asia/Makassar',
      });
      const timeStr = now.toLocaleTimeString('id-ID', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Asia/Makassar',
      }).replace(/\./g, ':');
      return `${greet}\n🗓️ ${dateStr}\n🕐 ${timeStr} WITA`;
    }
    case '!owner':
      return config.ownerNumber
        ? `👑 *Owner Bot*\n📱 +${config.ownerNumber}\n💬 https://wa.me/${config.ownerNumber}`
        : '⚠️ Kontak owner belum diatur di config.js.';
    default:
      return null; // perintah tidak dikenal -> lanjut ke aturan biasa
  }
}

// Ubah foto/video menjadi stiker.
// Cara pakai: reply foto/video lalu ketik .s
//   .s            -> stiker dengan nama dari config.js
//   .s teks bebas -> stiker dengan nama "teks bebas"
// Bisa juga kirim foto/video dengan caption .s (tanpa reply).
// Foto -> stiker biasa, video/gif pendek -> stiker animasi
// (stiker video butuh ffmpeg terinstal di server).
async function handleSticker(msg, text) {
  // Nama pack & author: ".s Nama Bebas" atau ".s Nama Pack | Nama Author"
  const rawArgs = text.trim().split(/\s+/).slice(1).join(' ');
  let customName = rawArgs;
  let customAuthor = config.stickerAuthor;
  if (rawArgs.includes('|')) {
    const [n, a] = rawArgs.split('|').map((s) => s.trim());
    customName = n || '';
    if (a) customAuthor = a;
  }

  const mediaMsg = await findMediaMessage(msg);
  if (!mediaMsg) {
    return 'Caranya: *reply foto/video* lalu ketik *.s*\n' +
      'Contoh: tahan foto > Reply > ketik *.s* > kirim.\n' +
      'Bisa juga kirim foto dengan caption *.s*.';
  }

  const media = await mediaMsg.downloadMedia();
  if (!media || !media.data) {
    return 'Gagal mengunduh medianya. Coba kirim ulang fotonya lalu *.s* lagi ya.';
  }

  const isVideo = (media.mimetype || '').startsWith('video/');
  await client.sendMessage(msg.from, media, {
    sendMediaAsSticker: true,
    stickerName: customName || config.stickerName,
    stickerAuthor: customAuthor,
    quotedMessageId: msg.id._serialized,
  });
  log(`🏷️ Stiker ${isVideo ? 'video' : 'foto'} dikirim ke ${msg.from}`);
  return null; // sudah dibalas langsung, tidak perlu balasan teks
}

// Kirim ulang sebuah media sebagai foto/video biasa (bukan sekali lihat).
// Dipakai oleh konversi otomatis maupun perintah .vo.
async function resendAsNormalMedia(msg, mediaMsg) {
  const media = await mediaMsg.downloadMedia();
  if (!media || !media.data) return false;
  const isVideo = (media.mimetype || '').startsWith('video/');
  await client.sendMessage(msg.from, media, {
    caption: isVideo
      ? '🎬 Video sekali lihat — disimpan sebagai video biasa'
      : '📸 Foto sekali lihat — disimpan sebagai foto biasa',
  });
  log(`👁️ Media sekali lihat dikirim ulang sebagai ${isVideo ? 'video' : 'foto'} biasa ke ${msg.from}`);
  return true;
}

// Perintah .vo / .lihat — reply ke foto/video sekali lihat untuk
// mengubahnya jadi foto/video biasa. Ini cara utama memakai fitur
// anti view-once (konversi otomatis nonaktif secara default).
async function handleViewOnceCommand(msg) {
  const mediaMsg = await findMediaMessage(msg);
  if (!mediaMsg) {
    return 'Caranya: *reply foto/video sekali lihat* lalu ketik *.vo*\n' +
      'Bot akan mengirim ulang medianya sebagai foto/video biasa.';
  }
  const ok = await resendAsNormalMedia(msg, mediaMsg);
  if (!ok) return 'Gagal mengunduh medianya — mungkin sudah tidak tersedia lagi.';
  return null; // sudah dibalas langsung
}

// Perintah .toimg — reply stiker/foto untuk mengubahnya jadi foto biasa.
// Stiker WebP dikonversi ke JPG (butuh ffmpeg); kalau ffmpeg tidak ada,
// WebP asli tetap dikirim sebagai gambar.
async function handleToImg(msg) {
  const mediaMsg = await findMediaMessage(msg);
  if (!mediaMsg) {
    return 'Caranya: *reply stiker/foto* lalu ketik *.toimg*';
  }
  const media = await mediaMsg.downloadMedia();
  if (!media || !media.data) {
    return 'Gagal mengunduh medianya. Coba lagi ya.';
  }
  let outMedia = media;
  if ((media.mimetype || '') === 'image/webp') {
    const jpg = await webpToJpg(media.data);
    if (jpg) outMedia = new MessageMedia('image/jpeg', jpg, 'sticker.jpg');
  }
  await client.sendMessage(msg.from, outMedia, {
    caption: '🖼️ Stiker diubah jadi foto',
    quotedMessageId: msg.id._serialized,
  });
  log(`🖼️ Stiker diubah jadi foto untuk ${msg.from}`);
  return null; // sudah dibalas langsung
}

// Perintah .cuaca [kota] — cuaca terkini dari wttr.in (gratis, tanpa API key).
// Tanpa kota, pakai config.defaultCity.
async function handleWeather(msg, city) {
  const query = (city || '').trim() || config.defaultCity;
  try {
    const data = await fetchJson(`https://wttr.in/${encodeURIComponent(query)}?format=j1`);
    const cur = data && data.current_condition && data.current_condition[0];
    if (!cur) return `Cuaca untuk "${query}" tidak ditemukan. Coba nama kota lain ya.`;
    const today = data.weather && data.weather[0];
    const desc = translateWeather(cur.weatherDesc[0].value);
    let reply = `🌤️ *Cuaca ${query}*\n\n${desc}\n` +
      `🌡️ ${cur.temp_C}°C (terasa ${cur.FeelsLikeC}°C)\n` +
      `💧 Kelembapan ${cur.humidity}%\n` +
      `💨 Angin ${cur.windspeedKmph} km/jam ${cur.winddir16Point}\n` +
      `🌧️ Hujan ${cur.precipMM} mm`;
    if (today) reply += `\n📈 Hari ini: ${today.mintempC}–${today.maxtempC}°C`;
    return reply;
  } catch (err) {
    log('❌ Gagal ambil cuaca:', err.message);
    return 'Gagal mengambil data cuaca. Coba lagi sebentar ya.';
  }
}

// Perintah .jadwalsholat [kota] — jadwal sholat hari ini dari Aladhan
// (gratis, tanpa API key; metode Kemenag RI). Tanpa kota, pakai defaultCity.
async function handlePrayerTimes(msg, city) {
  const query = (city || '').trim() || config.defaultCity;
  try {
    const data = await fetchJson(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(query)}&country=Indonesia&method=20`);
    if (!data || data.code !== 200 || !data.data) {
      return `Jadwal sholat untuk "${query}" tidak ditemukan. Coba nama kota lain ya.`;
    }
    const t = data.data.timings;
    const h = data.data.date.hijri;
    const dateStr = new Date(data.data.date.timestamp * 1000).toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar',
    });
    const hijriMonth = HIJRI_MONTHS[h.month.number - 1] || h.month.en;
    return `🕌 *Jadwal Sholat ${query}*\n${dateStr}\n${h.day} ${hijriMonth} ${h.year} H\n\n` +
      `Subuh: ${t.Fajr}\nDzuhur: ${t.Dhuhr}\nAshar: ${t.Asr}\n` +
      `Maghrib: ${t.Maghrib}\nIsya: ${t.Isha}\n\n(Metode Kemenag RI)`;
  } catch (err) {
    log('❌ Gagal ambil jadwal sholat:', err.message);
    return 'Gagal mengambil jadwal sholat. Coba lagi sebentar ya.';
  }
}

// ---------- PENGINGAT (.ingetin) ----------
// .ingetin 30m minum obat   -> ingatkan 30 menit lagi
// .ingetin 1j30m rapat      -> ingatkan 1 jam 30 menit lagi
// .ingetin list             -> lihat pengingat aktif di chat ini
// .ingetin batal 1          -> batalkan pengingat nomor 1
// Catatan: pengingat tersimpan di memori — hilang kalau bot restart.
const reminders = new Map(); // chatId -> [{ id, text, fireAt, timer }]
let reminderSeq = 0;

async function handleRemind(msg, argsText) {
  const args = (argsText || '').trim();
  const chatId = msg.from;
  const list = reminders.get(chatId) || [];

  if (!args || args.toLowerCase() === 'help') {
    return 'Cara pakai: *.ingetin <waktu> <pesan>*\n' +
      'Contoh: *.ingetin 30m minum obat*\n' +
      'Waktu: 10s (detik), 30m (menit), 2j (jam), 1j30m. Maksimal 24 jam.\n' +
      '*.ingetin list* — lihat pengingat aktif\n' +
      '*.ingetin batal 1* — batalkan pengingat nomor 1';
  }
  if (args.toLowerCase() === 'list') {
    if (list.length === 0) return 'Tidak ada pengingat aktif di chat ini.';
    const lines = list.map((r, i) =>
      `${i + 1}. ${r.text} (dalam ${formatDuration(r.fireAt - Date.now())})`);
    return `⏰ *Pengingat aktif:*\n${lines.join('\n')}`;
  }
  const cancelMatch = args.match(/^batal\s+(\d+)$/i);
  if (cancelMatch) {
    const idx = parseInt(cancelMatch[1], 10) - 1;
    if (idx < 0 || idx >= list.length) return 'Nomor pengingat tidak ada. Cek dengan *.ingetin list*.';
    const [removed] = list.splice(idx, 1);
    clearTimeout(removed.timer);
    return `Pengingat dibatalkan: ${removed.text}`;
  }

  const parts = args.split(/\s+/);
  const ms = parseDuration(parts[0]);
  const text = parts.slice(1).join(' ');
  if (ms === null || !text) {
    return 'Format tidak dikenali. Contoh: *.ingetin 30m minum obat*';
  }
  if (ms > 24 * 3600000) return 'Maksimal pengingat 24 jam ya.';
  const fireAt = Date.now() + ms;
  const id = ++reminderSeq;
  const timer = setTimeout(async () => {
    try {
      const current = reminders.get(chatId) || [];
      reminders.set(chatId, current.filter((r) => r.id !== id));
      await client.sendMessage(chatId, `⏰ *Pengingat:* ${text}`, {
        quotedMessageId: msg.id._serialized,
      });
      log(`⏰ Pengingat terkirim ke ${chatId}: ${text}`);
    } catch (err) {
      log('❌ Gagal kirim pengingat:', err.message);
    }
  }, ms);
  list.push({ id, text, fireAt, timer });
  reminders.set(chatId, list);
  return `Siap, kuingetin ${formatDuration(ms)} lagi: ${text} ⏰`;
}

// ---------- BROADCAST (.bc) ----------
// .bc <pesan>  -> simpan pesan, tampilkan pratinjau + daftar grup, minta konfirmasi
// .bc kirim    -> mulai kirim ke semua grup bot, jeda broadcastDelaySec per grup
// .bc batal    -> batalkan broadcast (yang tertunda / sedang berjalan)
// .bc status   -> lihat progres broadcast yang sedang berjalan
// Hanya owner (config.ownerNumber) yang bisa memakai perintah ini, dan
// hanya lewat chat pribadi dengan bot.
// ⚠️ Broadcast massal melanggar ketentuan WhatsApp — nomor bot tetap
// berisiko diblokir meski ada jeda. Pakai seperlunya saja.
const broadcast = { pending: null, queue: [], index: 0, sent: 0, failed: 0, timer: null, ownerChat: null };

function broadcastDelayMs() {
  return (config.broadcastDelaySec || 60) * 1000;
}

async function handleBroadcast(msg, argsText) {
  if (msg.from.endsWith('@g.us')) return 'Perintah .bc hanya bisa dipakai di chat pribadi dengan bot.';
  if (!config.ownerNumber) return 'Nomor owner belum diatur di config.js (ownerNumber).';
  if (msg.from !== `${config.ownerNumber}@c.us`) return 'Perintah ini hanya bisa dipakai owner bot.';
  const args = (argsText || '').trim();
  const sub = args.toLowerCase();
  const delaySec = config.broadcastDelaySec || 60;

  if (sub === 'batal') {
    if (broadcast.timer) clearTimeout(broadcast.timer);
    const wasActive = broadcast.timer !== null || broadcast.pending !== null || broadcast.queue.length > 0;
    broadcast.pending = null; broadcast.queue = []; broadcast.timer = null;
    return wasActive ? 'Broadcast dibatalkan.' : 'Tidak ada broadcast yang berjalan.';
  }
  if (sub === 'status') {
    if (broadcast.pending) {
      return `Broadcast tertunda, menunggu konfirmasi *.bc kirim*.\nPesan: ${broadcast.pending.slice(0, 100)}${broadcast.pending.length > 100 ? '…' : ''}`;
    }
    if (broadcast.queue.length === 0) return 'Tidak ada broadcast yang berjalan.';
    return `Broadcast berjalan: ${broadcast.sent + broadcast.failed}/${broadcast.queue.length} grup sudah diproses (${broadcast.sent} terkirim, ${broadcast.failed} gagal).`;
  }
  if (sub === 'kirim') {
    if (!broadcast.pending) return 'Tidak ada pesan broadcast yang tertunda. Ketik *.bc <pesan>* dulu.';
    const chats = await client.getChats();
    const groups = chats.filter((c) => c.isGroup);
    if (groups.length === 0) { broadcast.pending = null; return 'Bot tidak ada di grup mana pun.'; }
    const text = broadcast.pending;
    broadcast.pending = null;
    broadcast.queue = groups; broadcast.index = 0; broadcast.sent = 0; broadcast.failed = 0;
    broadcast.ownerChat = msg.from;
    sendNextBroadcast(text); // grup pertama langsung, sisanya tiap jeda
    return `Broadcast dimulai: ${groups.length} grup, jeda ${delaySec} detik per pesan.\nKetik *.bc status* untuk progres, *.bc batal* untuk membatalkan.`;
  }
  if (!args) {
    return 'Cara pakai: *.bc <pesan promosi>*\n' +
      'Bot menampilkan pratinjau + jumlah grup, lalu ketik *.bc kirim* untuk mulai.\n' +
      `Pesan dikirim ke semua grup bot, jeda ${delaySec} detik per grup.\n` +
      '⚠️ Broadcast massal bisa menyebabkan nomor bot diblokir WhatsApp — pakai seperlunya.';
  }
  broadcast.pending = args;
  const chats = await client.getChats();
  const groups = chats.filter((c) => c.isGroup);
  const names = groups.slice(0, 10).map((g) => `• ${g.name || g.id._serialized}`).join('\n');
  const more = groups.length > 10 ? `\n…dan ${groups.length - 10} grup lainnya` : '';
  return `📣 *Pratinjau broadcast*\n\n${args}\n\nAkan dikirim ke *${groups.length} grup* (jeda ${delaySec} detik):\n${names}${more}\n\nKetik *.bc kirim* untuk mulai, *.bc batal* untuk membatalkan.`;
}

async function sendNextBroadcast(text) {
  const group = broadcast.queue[broadcast.index];
  broadcast.index += 1;
  try {
    await client.sendMessage(group.id._serialized, text);
    broadcast.sent += 1;
    log(`📣 Broadcast terkirim ke ${group.name || group.id._serialized} (${broadcast.sent}/${broadcast.queue.length})`);
  } catch (err) {
    broadcast.failed += 1;
    log(`❌ Broadcast gagal ke ${group.name || group.id._serialized}:`, err.message);
  }
  if (broadcast.index >= broadcast.queue.length) {
    const total = broadcast.queue.length;
    const done = `Broadcast selesai: ${broadcast.sent}/${total} grup terkirim${broadcast.failed ? `, ${broadcast.failed} gagal` : ''}.`;
    broadcast.queue = []; broadcast.timer = null;
    try { await client.sendMessage(broadcast.ownerChat, `📣 ${done}`); } catch (e) { log('❌ Gagal kirim laporan broadcast:', e.message); }
    log(`📣 ${done}`);
    return;
  }
  broadcast.timer = setTimeout(() => sendNextBroadcast(text), broadcastDelayMs());
}

// Perintah .tagall [pesan] — sebut semua anggota grup (khusus admin grup).
// Hanya jalan di grup dan hanya jika replyInGroups aktif di config.
async function handleTagAll(msg, text) {
  const chat = await msg.getChat();
  if (!chat.isGroup) return 'Perintah ini cuma bisa dipakai di grup.';
  const senderId = msg.author || msg.from;
  const sender = (chat.participants || []).find((p) => p.id._serialized === senderId);
  const isOwner = config.ownerNumber && senderId.startsWith(config.ownerNumber);
  const isAdmin = sender && (sender.isAdmin || sender.isSuperAdmin);
  if (!isAdmin && !isOwner) return 'Cuma admin grup yang bisa pakai .tagall.';
  const botId = client.info && client.info.wid && client.info.wid._serialized;
  const targets = (chat.participants || []).filter((p) =>
    p.id._serialized.endsWith('@c.us') && p.id._serialized !== botId);
  if (targets.length === 0) return 'Tidak ada anggota grup yang bisa di-tag.';
  const extra = text.trim().split(/\s+/).slice(1).join(' ');
  const CHUNK = 100;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const mentions = chunk.map((p) => p.id._serialized);
    const tags = chunk.map((p) => `@${p.id.user}`).join(' ');
    const body = (extra ? `${extra}\n\n` : '') + `📣 ${tags}`;
    await client.sendMessage(msg.from, body, { mentions });
  }
  log(`📣 .tagall di ${msg.from}: ${targets.length} anggota di-tag`);
  return null; // sudah dibalas langsung
}

// ---------- STIKER AUDIO (.audio) ----------
// Stiker audio = potongan suara pendek yang disimpan dengan nama, lalu
// dikirim ulang sebagai pesan suara (voice note) kapan pun dipanggil.
// WhatsApp tidak punya format "stiker audio" khusus — ini cara bot
// menirunya: audio disimpan sebagai .ogg (opus, format pesan suara).
// .audio simpan <nama>  -> reply pesan suara/audio untuk menyimpannya
// .audio <nama>         -> kirim stiker audio itu sebagai pesan suara
// .audio list           -> daftar stiker audio tersimpan
// .audio hapus <nama>   -> hapus (khusus owner)
// File tersimpan di folder audio-stickers/ (tidak ikut ke Git).
// Menyimpan audio non-ogg butuh ffmpeg terinstal (konversi ke opus).
const AUDIO_STICKER_DIR = path.join(__dirname, 'audio-stickers');

function audioStickerTarget(rawName) {
  const safe = (rawName || '').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe) return null;
  return { name: safe, file: path.join(AUDIO_STICKER_DIR, `${safe}.ogg`) };
}

function listAudioStickers() {
  try {
    return fs.readdirSync(AUDIO_STICKER_DIR)
      .filter((f) => f.endsWith('.ogg'))
      .map((f) => f.slice(0, -4))
      .sort();
  } catch (e) {
    return [];
  }
}

// Konversi file audio apa pun ke .ogg opus (format voice note WhatsApp)
function convertToOgg(input, output) {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-y', '-v', 'error', '-i', input, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', output], (err) => {
      resolve(!err && fs.existsSync(output));
    });
  });
}

async function handleAudioSticker(msg, argsText) {
  const args = (argsText || '').trim();
  const parts = args.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  if (!args || sub === 'help') {
    return '🔊 *Stiker Audio*\n' +
      '*.audio simpan <nama>* — reply pesan suara/audio untuk menyimpannya\n' +
      '*.audio <nama>* — kirim stiker audio sebagai pesan suara\n' +
      '*.audio list* — daftar stiker audio tersimpan\n' +
      '*.audio hapus <nama>* — hapus stiker audio (khusus owner)';
  }
  if (sub === 'list') {
    const names = listAudioStickers();
    if (names.length === 0) return 'Belum ada stiker audio tersimpan. Reply pesan suara lalu ketik *.audio simpan <nama>*.';
    return `🔊 *Stiker audio tersimpan:*\n${names.map((n) => `• ${n}`).join('\n')}\n\nKirim dengan *.audio <nama>*`;
  }
  if (sub === 'simpan' || sub === 'save') {
    const target = audioStickerTarget(parts.slice(1).join(' '));
    if (!target) return 'Kasih nama dulu ya. Contoh: *.audio simpan ketawa*';
    const mediaMsg = await findMediaMessage(msg);
    if (!mediaMsg) return 'Caranya: *reply pesan suara/audio* lalu ketik *.audio simpan <nama>*';
    const media = await mediaMsg.downloadMedia();
    if (!media || !media.data) return 'Gagal mengunduh audionya. Coba kirim ulang ya.';
    if (!(media.mimetype || '').startsWith('audio/')) return 'Itu bukan audio. Reply pesan suara atau file audio ya.';
    fs.mkdirSync(AUDIO_STICKER_DIR, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-audio-'));
    try {
      const ext = ((media.mimetype.split('/')[1] || 'bin').split(';')[0] || 'bin').replace(/[^a-z0-9]/gi, '');
      const rawFile = path.join(tmp, `in.${ext}`);
      fs.writeFileSync(rawFile, Buffer.from(media.data, 'base64'));
      let ok;
      if ((media.mimetype || '').includes('ogg')) {
        fs.copyFileSync(rawFile, target.file);
        ok = true;
      } else {
        ok = await convertToOgg(rawFile, target.file);
        if (!ok && fs.existsSync(target.file)) fs.rmSync(target.file);
      }
      if (!ok) return 'Gagal menyimpan: konversi audio butuh *ffmpeg* terinstal di perangkat bot.';
      log(`🔊 Stiker audio disimpan: ${target.name}`);
      return `Siap! Stiker audio *${target.name}* tersimpan. Kirim kapan saja dengan *.audio ${target.name}*`;
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
  }
  if (sub === 'hapus' || sub === 'delete') {
    const isOwner = config.ownerNumber &&
      (msg.from === `${config.ownerNumber}@c.us` || (msg.author || '').startsWith(config.ownerNumber));
    if (!isOwner) return 'Hapus stiker audio cuma bisa dilakukan owner bot.';
    const target = audioStickerTarget(parts.slice(1).join(' '));
    if (!target) return 'Sebutkan namanya. Contoh: *.audio hapus ketawa*';
    if (!fs.existsSync(target.file)) return `Stiker audio *${target.name}* tidak ditemukan.`;
    fs.rmSync(target.file);
    return `Stiker audio *${target.name}* dihapus.`;
  }
  // Default: kirim stiker audio dengan nama itu
  const target = audioStickerTarget(args);
  if (!target) return 'Format tidak dikenali. Ketik *.audio* untuk bantuan.';
  if (!fs.existsSync(target.file)) {
    const names = listAudioStickers();
    return `Stiker audio *${target.name}* tidak ada.` + (names.length ? `\nYang tersimpan: ${names.join(', ')}` : '');
  }
  const data = fs.readFileSync(target.file).toString('base64');
  const media = new MessageMedia('audio/ogg; codecs=opus', data, `${target.name}.ogg`);
  await client.sendMessage(msg.from, media, {
    sendAudioAsVoice: true,
    quotedMessageId: msg.id._serialized,
  });
  log(`🔊 Stiker audio terkirim: ${target.name} ke ${msg.from}`);
  return null; // sudah dibalas langsung
}

// ---------- STIKER VIDEO BERSUARA (.vstiker) ----------
// Stiker WhatsApp asli (WebP, termasuk yang animasi) TIDAK BISA berisi
// suara — formatnya memang gambar, tidak ada jalur audio. Jadi fitur
// ini menirunya dengan video pendek: video disimpan dengan nama,
// dipotong persegi 512x512 dan maksimal 15 detik (suara dipertahankan),
// lalu dikirim ulang sebagai pesan video kapan pun dipanggil.
// .vstiker simpan <nama>  -> reply video untuk menyimpannya
// .vstiker <nama>         -> kirim stiker video itu (gambar + suara)
// .vstiker list           -> daftar stiker video tersimpan
// .vstiker hapus <nama>   -> hapus (khusus owner)
// File tersimpan di folder video-stickers/ (tidak ikut ke Git).
// Pengolahan video butuh ffmpeg terinstal.
const VIDEO_STICKER_DIR = path.join(__dirname, 'video-stickers');
const VIDEO_STICKER_MAX_SEC = 15;

function videoStickerTarget(rawName) {
  const safe = (rawName || '').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe) return null;
  return { name: safe, file: path.join(VIDEO_STICKER_DIR, `${safe}.mp4`) };
}

function listVideoStickers() {
  try {
    return fs.readdirSync(VIDEO_STICKER_DIR)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => f.slice(0, -4))
      .sort();
  } catch (e) {
    return [];
  }
}

// Durasi media dalam detik (ffprobe), atau null kalau gagal
function probeDurationSec(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], (err, stdout) => {
      if (err) return resolve(null);
      const n = parseFloat((stdout || '').trim());
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

// Olah video jadi stiker video: persegi 512x512 (crop tengah), maks 15
// detik, video H.264 + audio AAC (suara dipertahankan).
function processVideoSticker(input, output) {
  return new Promise((resolve) => {
    const vf = 'crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,fps=30';
    execFile('ffmpeg', ['-y', '-v', 'error', '-i', input, '-t', String(VIDEO_STICKER_MAX_SEC),
      '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', output], (err) => {
      resolve(!err && fs.existsSync(output));
    });
  });
}

async function handleVideoSticker(msg, argsText) {
  const args = (argsText || '').trim();
  const parts = args.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  if (!args || sub === 'help') {
    return '🎬 *Stiker Video Bersuara*\n' +
      '*.vstiker simpan <nama>* — reply video untuk menyimpannya\n' +
      '*.vstiker <nama>* — kirim stiker video (gambar + suara)\n' +
      '*.vstiker list* — daftar stiker video tersimpan\n' +
      '*.vstiker hapus <nama>* — hapus stiker video (khusus owner)\n\n' +
      `Video diolah jadi persegi, maksimal ${VIDEO_STICKER_MAX_SEC} detik, suara tetap ada.`;
  }
  if (sub === 'list') {
    const names = listVideoStickers();
    if (names.length === 0) return 'Belum ada stiker video tersimpan. Reply video lalu ketik *.vstiker simpan <nama>*.';
    return `🎬 *Stiker video tersimpan:*\n${names.map((n) => `• ${n}`).join('\n')}\n\nKirim dengan *.vstiker <nama>*`;
  }
  if (sub === 'simpan' || sub === 'save') {
    const target = videoStickerTarget(parts.slice(1).join(' '));
    if (!target) return 'Kasih nama dulu ya. Contoh: *.vstiker simpan ngakak*';
    const mediaMsg = await findMediaMessage(msg);
    if (!mediaMsg) return 'Caranya: *reply video* lalu ketik *.vstiker simpan <nama>*';
    const media = await mediaMsg.downloadMedia();
    if (!media || !media.data) return 'Gagal mengunduh videonya. Coba kirim ulang ya.';
    if (!(media.mimetype || '').startsWith('video/')) return 'Itu bukan video. Reply sebuah video ya.';
    fs.mkdirSync(VIDEO_STICKER_DIR, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-vstik-'));
    try {
      const ext = ((media.mimetype.split('/')[1] || 'mp4').split(';')[0] || 'mp4').replace(/[^a-z0-9]/gi, '');
      const rawFile = path.join(tmp, `in.${ext}`);
      fs.writeFileSync(rawFile, Buffer.from(media.data, 'base64'));
      const srcDur = await probeDurationSec(rawFile);
      const ok = await processVideoSticker(rawFile, target.file);
      if (!ok) {
        if (fs.existsSync(target.file)) fs.rmSync(target.file);
        return 'Gagal menyimpan: pengolahan video butuh *ffmpeg* terinstal di perangkat bot.';
      }
      log(`🎬 Stiker video disimpan: ${target.name}`);
      const trimmed = srcDur && srcDur > VIDEO_STICKER_MAX_SEC
        ? ` (dipotong dari ${Math.round(srcDur)} detik jadi ${VIDEO_STICKER_MAX_SEC} detik pertama)` : '';
      return `Siap! Stiker video *${target.name}* tersimpan${trimmed}. Kirim kapan saja dengan *.vstiker ${target.name}*`;
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
  }
  if (sub === 'hapus' || sub === 'delete') {
    const isOwner = config.ownerNumber &&
      (msg.from === `${config.ownerNumber}@c.us` || (msg.author || '').startsWith(config.ownerNumber));
    if (!isOwner) return 'Hapus stiker video cuma bisa dilakukan owner bot.';
    const target = videoStickerTarget(parts.slice(1).join(' '));
    if (!target) return 'Sebutkan namanya. Contoh: *.vstiker hapus ngakak*';
    if (!fs.existsSync(target.file)) return `Stiker video *${target.name}* tidak ditemukan.`;
    fs.rmSync(target.file);
    return `Stiker video *${target.name}* dihapus.`;
  }
  // Default: kirim stiker video dengan nama itu
  const target = videoStickerTarget(args);
  if (!target) return 'Format tidak dikenali. Ketik *.vstiker* untuk bantuan.';
  if (!fs.existsSync(target.file)) {
    const names = listVideoStickers();
    return `Stiker video *${target.name}* tidak ada.` + (names.length ? `\nYang tersimpan: ${names.join(', ')}` : '');
  }
  const data = fs.readFileSync(target.file).toString('base64');
  const media = new MessageMedia('video/mp4', data, `${target.name}.mp4`);
  await client.sendMessage(msg.from, media, {
    quotedMessageId: msg.id._serialized,
  });
  log(`🎬 Stiker video terkirim: ${target.name} ke ${msg.from}`);
  return null; // sudah dibalas langsung
}

// ---------- STIKER BERSUARA (.s untuk video, .sb, .setaudio, .getaudio) ----------
// WhatsApp resmi MULAI merilis "stiker bersuara" (beta Android/iOS, akhir
// Nov 2026): stiker animasi dari video + trek audio yang diputar saat
// ikon audio diketuk. Tapi library whatsapp-web.js belum mendukung
// format resmi itu, jadi di bot ini stiker bersuara ditiru dengan video
// persegi pendek bersuara — gambar + suara jalan bersama di chat.
// Perintah:
// .s                 -> reply video: jadi stiker bersuara (suara asli video)
// .s 5 / .s 0:12     -> ambil mulai detik ke-5 / ke-12 (maks 10 detik)
// .s full            -> tanpa crop (video utuh di atas latar buram)
// .sb                -> stiker biasa TANPA suara (perilaku .s lama)
// .s Nama | Author   -> nama pack & author (untuk stiker biasa / .sb)
// .setaudio          -> reply VN/audio/video: tempel audionya untuk .s berikutnya
// .resetaudio        -> lepas audio tempelan
// .getaudio          -> reply video/stiker bersuara: ambil audionya
// Foto/stiker + audio (dari .setaudio, atau dari audio/video yang
// di-reply bersamaan) juga jadi stiker bersuara: gambarnya jadi video
// dengan suara menempel. Membalas VN/audio dengan .s saja = .setaudio.
// Di DM, video yang dikirim tanpa caption otomatis jadi stiker bersuara
// (atur di config: autoStickerBersuaraDM).
const SOUND_STICKER_MAX_SEC = 10;
const PENDING_AUDIO_DIR = path.join(__dirname, 'audio-pending');
const pendingAudio = new Map(); // kunci hash chat+pengirim -> path file ogg

function pendingAudioKey(msg) {
  const raw = `${msg.from}|${msg.author || msg.from}`;
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 16);
}

// Parse detik mulai: "5" -> 5, "0:12" -> 12, "1:05" -> 65. null kalau bukan waktu.
function parseStartSec(str) {
  const s = (str || '').trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/^(\d+):([0-5]\d)$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return null;
}

// Ambil audio dari sebuah pesan media (audio/VN/video) sebagai file .ogg
// di tmpDir. Kembalikan path file, atau null kalau bukan audio/video / gagal.
async function getAudioFileFromMsg(mediaMsgObj, tmpDir) {
  const m = await mediaMsgObj.downloadMedia();
  if (!m || !m.data) return null;
  const mime = m.mimetype || '';
  if (!(mime.startsWith('audio/') || mime.startsWith('video/'))) return null;
  const ext = ((mime.split('/')[1] || 'bin').split(';')[0] || 'bin').replace(/[^a-z0-9]/gi, '');
  const raw = path.join(tmpDir, `audiosrc.${ext}`);
  fs.writeFileSync(raw, Buffer.from(m.data, 'base64'));
  const out = path.join(tmpDir, 'audio.ogg');
  if (mime.includes('ogg')) { fs.copyFileSync(raw, out); return out; }
  const ok = await convertToOgg(raw, out);
  return ok ? out : null;
}

// Bangun stiker bersuara dari video: persegi 512x512 (crop tengah, atau
// 'full' = video utuh di atas latar buram), maks 10 detik. Audio asli
// dipertahankan, atau diganti audioFile kalau diberikan.
function buildSoundStickerFromVideo(input, output, { startSec = 0, full = false, audioFile = null } = {}) {
  return new Promise((resolve) => {
    const args = ['-y', '-v', 'error'];
    if (startSec > 0) args.push('-ss', String(startSec));
    args.push('-i', input);
    if (audioFile) args.push('-i', audioFile);
    if (full) {
      args.push('-filter_complex',
        '[0:v]split[a][b];[a]scale=512:512:force_original_aspect_ratio=increase,crop=512:512,gblur=sigma=24[bg];[b]scale=512:512:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30[vout]',
        '-map', '[vout]', '-map', audioFile ? '1:a:0?' : '0:a:0?');
    } else {
      args.push('-vf', 'crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,fps=30');
      if (audioFile) args.push('-map', '0:v:0', '-map', '1:a:0?');
    }
    args.push('-t', String(SOUND_STICKER_MAX_SEC),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', output);
    execFile('ffmpeg', args, (err) => resolve(!err && fs.existsSync(output)));
  });
}

// Bangun stiker bersuara dari gambar/stiker + audio: gambar jadi video
// (stiker animasi WebP tetap bergerak & diloop) selama bunyi audio,
// maksimal 10 detik.
async function buildSoundStickerFromImage(input, isAnimatedWebp, audioFile, output) {
  const dur = (await probeDurationSec(audioFile)) || SOUND_STICKER_MAX_SEC;
  const t = Math.min(dur, SOUND_STICKER_MAX_SEC);
  return new Promise((resolve) => {
    const args = ['-y', '-v', 'error'];
    if (isAnimatedWebp) args.push('-stream_loop', '-1', '-i', input);
    else args.push('-loop', '1', '-framerate', '30', '-i', input);
    args.push('-i', audioFile, '-t', String(t),
      '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p',
      '-c:v', 'libx264', '-crf', '26', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', output);
    execFile('ffmpeg', args, (err) => resolve(!err && fs.existsSync(output)));
  });
}

// Unduh video visualMsg, olah jadi stiker bersuara di tmpDir (milik
// pemanggil), lalu kirim. Kembalikan null kalau terkirim, teks error kalau gagal.
async function sendSoundStickerFromVideo(msg, visualMsg, { startSec = 0, full = false, audioFile = null, tmpDir }) {
  const media = await visualMsg.downloadMedia();
  if (!media || !media.data) return 'Gagal mengunduh videonya. Coba kirim ulang ya.';
  const ext = ((media.mimetype.split('/')[1] || 'mp4').split(';')[0] || 'mp4').replace(/[^a-z0-9]/gi, '');
  const raw = path.join(tmpDir, `vid.${ext}`);
  fs.writeFileSync(raw, Buffer.from(media.data, 'base64'));
  const out = path.join(tmpDir, 'sound-sticker.mp4');
  const ok = await buildSoundStickerFromVideo(raw, out, { startSec, full, audioFile });
  if (!ok) return 'Gagal membuat stiker bersuara: pengolahan video butuh *ffmpeg* terinstal di perangkat bot.';
  const data = fs.readFileSync(out).toString('base64');
  await client.sendMessage(msg.from, new MessageMedia('video/mp4', data, 'stiker-bersuara.mp4'), {
    quotedMessageId: msg.id._serialized,
  });
  log(`🔊🎬 Stiker bersuara terkirim ke ${msg.from}`);
  return null;
}

// Perintah .setaudio — reply VN/audio/video untuk menempelkan audionya.
// Audio tempelan dipakai .s berikutnya dari pengirim yang sama di chat
// yang sama, sampai dilepas dengan .resetaudio (atau bot restart).
async function handleSetAudio(msg, srcMsg) {
  const mediaMsg = srcMsg || (await findMediaMessage(msg));
  if (!mediaMsg) return 'Caranya: *reply VN/audio/video* lalu ketik *.setaudio*';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-setaudio-'));
  try {
    const f = await getAudioFileFromMsg(mediaMsg, tmp);
    if (!f) return 'Itu bukan audio/video, atau gagal mengambil audionya (konversi butuh *ffmpeg* terinstal).';
    fs.mkdirSync(PENDING_AUDIO_DIR, { recursive: true });
    const key = pendingAudioKey(msg);
    const dest = path.join(PENDING_AUDIO_DIR, `${key}.ogg`);
    fs.copyFileSync(f, dest);
    pendingAudio.set(key, dest);
    log(`🔊 Audio tempelan diatur untuk ${msg.from}`);
    return 'Siap! Audio ditempel 🔊\n' +
      'Sekarang kirim/reply foto, stiker, atau video dengan *.s* — hasilnya stiker bersuara dengan audio ini.\n' +
      'Ketik *.resetaudio* untuk melepas tempelan.';
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

// Perintah .resetaudio — lepas audio tempelan.
async function handleResetAudio(msg) {
  const key = pendingAudioKey(msg);
  const dest = pendingAudio.get(key);
  pendingAudio.delete(key);
  if (dest) { try { fs.rmSync(dest); } catch (e) {} }
  return dest ? 'Audio tempelan dilepas. *.s* kembali memakai suara asli.' : 'Tidak ada audio tempelan yang aktif.';
}

// Perintah .getaudio — reply video/stiker bersuara untuk mengambil
// audionya; dikirim balik sebagai pesan suara.
async function handleGetAudio(msg) {
  const mediaMsg = await findMediaMessage(msg);
  if (!mediaMsg) return 'Caranya: *reply video/stiker bersuara* lalu ketik *.getaudio*';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-getaudio-'));
  try {
    const f = await getAudioFileFromMsg(mediaMsg, tmp);
    if (!f) return 'Tidak ada audio yang bisa diambil dari media itu (stiker biasa memang tidak bersuara), atau konversi gagal (butuh *ffmpeg*).';
    const data = fs.readFileSync(f).toString('base64');
    await client.sendMessage(msg.from, new MessageMedia('audio/ogg; codecs=opus', data, 'audio.ogg'), {
      sendAudioAsVoice: true,
      quotedMessageId: msg.id._serialized,
    });
    log(`🔊 Audio diekstrak dan dikirim ke ${msg.from}`);
    return null; // sudah dibalas langsung
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

// Perintah .s — router stiker bersuara:
// - video (sendiri / di-reply) -> stiker bersuara dari video itu
// - foto/stiker + audio (tempelan .setaudio / audio di pesan sebelah)
//   -> stiker bersuara dari gambar + audio
// - foto/stiker tanpa audio -> stiker biasa (handleSticker)
// - membalas VN/audio saja dengan .s -> sama dengan .setaudio
async function handleStickerCommand(msg, text) {
  const argsText = text.trim().split(/\s+/).slice(1).join(' ');
  let quoted = null;
  if (msg.hasQuotedMsg) {
    try { quoted = await msg.getQuotedMessage(); } catch (e) { quoted = null; }
  }
  const self = msg.hasMedia ? msg : null;
  const quot = quoted && quoted.hasMedia ? quoted : null;
  const isVisual = (m) => !!m && ['image', 'video', 'sticker'].includes(m.type);
  const visualMsg = isVisual(self) ? self : (isVisual(quot) ? quot : null);
  const audioSide = [self, quot].find((m) => m && m !== visualMsg && ['audio', 'ptt', 'video'].includes(m.type)) || null;

  if (!visualMsg) {
    if (audioSide) return handleSetAudio(msg, audioSide);
    return handleSticker(msg, text); // tampilkan petunjuk pemakaian
  }

  const key = pendingAudioKey(msg);
  const pending = pendingAudio.get(key);
  const hasPending = !!pending && fs.existsSync(pending);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-ss-'));
  try {
    let audioFile = null;
    if (hasPending) audioFile = pending;
    else if (audioSide) audioFile = await getAudioFileFromMsg(audioSide, tmp);

    if (visualMsg.type === 'video') {
      const startSec = parseStartSec(argsText) || 0;
      const full = /(^|\s)full(\s|$)/i.test(argsText);
      return await sendSoundStickerFromVideo(msg, visualMsg, { startSec, full, audioFile, tmpDir: tmp });
    }

    // image / sticker
    if (!audioFile) return handleSticker(msg, text); // stiker biasa
    const media = await visualMsg.downloadMedia();
    if (!media || !media.data) return 'Gagal mengunduh medianya. Coba lagi ya.';
    const mime = media.mimetype || '';
    const ext = ((mime.split('/')[1] || 'png').split(';')[0] || 'png').replace(/[^a-z0-9]/gi, '');
    const raw = path.join(tmp, `img.${ext}`);
    fs.writeFileSync(raw, Buffer.from(media.data, 'base64'));
    const out = path.join(tmp, 'sound-sticker.mp4');
    const ok = await buildSoundStickerFromImage(raw, mime === 'image/webp', audioFile, out);
    if (!ok) return 'Gagal membuat stiker bersuara: pengolahan media butuh *ffmpeg* terinstal di perangkat bot.';
    const data = fs.readFileSync(out).toString('base64');
    await client.sendMessage(msg.from, new MessageMedia('video/mp4', data, 'stiker-bersuara.mp4'), {
      quotedMessageId: msg.id._serialized,
    });
    log(`🔊🎬 Stiker bersuara (gambar+audio) terkirim ke ${msg.from}`);
    return null;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

const client = new Client({
  authStrategy: new LocalAuth(), // sesi tersimpan di .wwebjs_auth, QR cukup sekali
  puppeteer: {
    headless: true,
    // Termux tidak bisa memakai Chromium bawaan Puppeteer — pakai Chromium Termux
    ...(fs.existsSync('/data/data/com.termux/files/usr/bin/chromium')
      ? { executablePath: '/data/data/com.termux/files/usr/bin/chromium' }
      : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
  // Kalau botNumber diisi di config.js, login pakai kode pairing 8 huruf
  // (tidak perlu scan QR — cocok untuk Termux di HP yang sama).
  ...(config.botNumber
    ? { pairWithPhoneNumber: { phoneNumber: config.botNumber } }
    : {}),
});

client.on('qr', (qr) => {
  console.log('\n=== SCAN QR INI DENGAN WHATSAPP DI HP ===');
  console.log('(WhatsApp > titik tiga > Perangkat tertaut > Tautkan perangkat)\n');
  qrcode.generate(qr, { small: true });
});

client.on('code', (code) => {
  console.log('\n=== KODE PAIRING (masukkan di WhatsApp bot) ===');
  console.log(`\n        ${code}\n`);
  console.log('(WhatsApp bot > titik tiga > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon)\n');
});

client.on('ready', () => {
  log('✅ Bot siap! Terhubung sebagai:', client.info.pushname, `(+${client.info.wid.user})`);
  startScheduledJobs();
});

client.on('authenticated', () => log('🔐 Terautentikasi, sesi tersimpan.'));
client.on('auth_failure', (m) => log('❌ Gagal autentikasi:', m));
client.on('disconnected', (reason) => log('⚠️ Terputus:', reason));

client.on('message', async (msg) => {
  try {
    // Abaikan pesan sendiri, status/story, dan pesan grup (kecuali diizinkan)
    if (msg.fromMe) return;
    if (msg.from === 'status@broadcast') return;
    const isGroup = msg.from.endsWith('@g.us');
    if (isGroup && !config.replyInGroups) return;

    const text = (msg.body || '').trim();

    // Anti view-once otomatis: foto/video sekali lihat langsung dikirim
    // ulang sebagai media biasa (pesan seperti ini tidak punya teks).
    const isViewOnce = msg.rawData && msg.rawData.isViewOnce;
    if (config.antiViewOnce && msg.hasMedia && isViewOnce) {
      try {
        await resendAsNormalMedia(msg, msg);
      } catch (err) {
        log('❌ Gagal konversi view-once:', err.message);
      }
      return;
    }

    // Stiker bersuara otomatis di DM: video yang dikirim tanpa caption
    // langsung jadi stiker bersuara (atur di config: autoStickerBersuaraDM).
    if (config.autoStickerBersuaraDM && !isGroup && msg.hasMedia && msg.type === 'video' && !text) {
      if (!isOnCooldown(msg.from)) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabot-ss-auto-'));
        try {
          const r = await sendSoundStickerFromVideo(msg, msg, { tmpDir: tmp });
          if (typeof r === 'string') await msg.reply(r);
          lastReplyAt.set(msg.from, Date.now());
        } catch (err) {
          log('❌ Gagal stiker bersuara otomatis:', err.message);
        } finally {
          try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
        }
      }
      return;
    }

    if (!text) return; // abaikan pesan tanpa teks (gambar/stiker/dokumen)
    if (isOnCooldown(msg.from)) return;

    log(`📩 ${isGroup ? '[grup] ' : ''}${msg.from}: ${text.slice(0, 120)}`);

    let reply = null;
    const firstWord = text.split(/\s+/)[0].toLowerCase();
    if (firstWord === '.s' || firstWord === '.sticker' || firstWord === '.stiker') {
      // .s: video jadi stiker bersuara; foto/stiker jadi stiker biasa
      // (atau bersuara kalau ada audio tempelan / audio di pesan sebelah)
      reply = await handleStickerCommand(msg, text);
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (firstWord === '.sb') {
      // .sb: stiker biasa tanpa suara (perilaku .s lama)
      reply = await handleSticker(msg, text);
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (firstWord === '.setaudio') {
      reply = await handleSetAudio(msg);
    } else if (firstWord === '.resetaudio') {
      reply = await handleResetAudio(msg);
    } else if (firstWord === '.getaudio') {
      reply = await handleGetAudio(msg);
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (firstWord === '.vo' || firstWord === '.lihat') {
      // Perintah view-once membalas sendiri (kirim media), jadi selesai di sini
      reply = await handleViewOnceCommand(msg);
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (firstWord === '.toimg') {
      // Perintah toimg membalas sendiri (kirim media), jadi selesai di sini
      reply = await handleToImg(msg);
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (firstWord === '.cuaca') {
      reply = await handleWeather(msg, text.split(/\s+/).slice(1).join(' '));
    } else if (firstWord === '.jadwalsholat' || firstWord === '.sholat') {
      reply = await handlePrayerTimes(msg, text.split(/\s+/).slice(1).join(' '));
    } else if (firstWord === '.ingetin' || firstWord === '.ingat') {
      reply = await handleRemind(msg, text.split(/\s+/).slice(1).join(' '));
    } else if (firstWord === '.tagall' || firstWord === '.tag') {
      // Perintah tagall membalas sendiri (kirim mention), jadi selesai di sini
      reply = await handleTagAll(msg, text);
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (firstWord === '.audio') {
      // Perintah stiker audio membalas sendiri saat mengirim suara
      reply = await handleAudioSticker(msg, text.split(/\s+/).slice(1).join(' '));
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (firstWord === '.vstiker' || firstWord === '.vsticker') {
      // Perintah stiker video membalas sendiri saat mengirim video
      reply = await handleVideoSticker(msg, text.split(/\s+/).slice(1).join(' '));
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
    } else if (firstWord === '.bc') {
      reply = await handleBroadcast(msg, text.split(/\s+/).slice(1).join(' '));
    } else if (text.startsWith('!')) {
      reply = await handleCommand(msg, text);
    }
    if (reply === null) reply = findAutoReply(text);
    if (reply === null) reply = config.fallbackReply || null;

    if (reply) {
      await msg.reply(reply);
      lastReplyAt.set(msg.from, Date.now());
      log(`↩️ Dibalas ke ${msg.from}`);
    }
  } catch (err) {
    log('❌ Error menangani pesan:', err.message);
  }
});

// Pesan terjadwal dari config.js
function startScheduledJobs() {
  for (const job of config.scheduledMessages) {
    const chatId = job.to.includes('@') ? job.to : `${job.to}@c.us`;
    schedule.scheduleJob(job.schedule, async () => {
      try {
        await client.sendMessage(chatId, job.text);
        log(`⏰ Pesan terjadwal terkirim ke ${chatId}`);
      } catch (err) {
        log(`❌ Gagal kirim terjadwal ke ${chatId}:`, err.message);
      }
    });
    log(`⏰ Jadwal aktif: "${job.schedule}" -> ${chatId}`);
  }
  if (config.scheduledMessages.length === 0) {
    log('ℹ️ Tidak ada pesan terjadwal (atur di config.js).');
  }
}

client.initialize();
