// ============================================================
// WA-BOT — Bot WhatsApp otomatis (whatsapp-web.js)
// Fitur: balas otomatis (kata kunci), perintah (!menu dll),
//        stiker (.s — reply foto/video), pesan terjadwal,
//        dan log sederhana.
// Jalankan: npm install  lalu  npm start  lalu scan QR di HP.
// Catatan: stiker video (animasi) butuh ffmpeg terinstal di server.
// ============================================================

const { Client, LocalAuth } = require('whatsapp-web.js');
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
      return `Jam sekarang: ${now.toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })} WITA.`;
    }
    case '!owner':
      return config.ownerNumber
        ? `Owner: +${config.ownerNumber}`
        : 'Kontak owner belum diatur di config.js.';
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
  const customName = text.trim().split(/\s+/).slice(1).join(' ');

  // Cari media: utamakan pesan yang di-reply, lalu media di pesan itu sendiri
  let mediaMsg = null;
  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      if (quoted && quoted.hasMedia) mediaMsg = quoted;
    } catch (e) {
      log('⚠️ Gagal ambil pesan reply:', e.message);
    }
  }
  if (!mediaMsg && msg.hasMedia) mediaMsg = msg;

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
    stickerAuthor: config.stickerAuthor,
    quotedMessageId: msg.id._serialized,
  });
  log(`🏷️ Stiker ${isVideo ? 'video' : 'foto'} dikirim ke ${msg.from}`);
  return null; // sudah dibalas langsung, tidak perlu balasan teks
}

const client = new Client({
  authStrategy: new LocalAuth(), // sesi tersimpan di .wwebjs_auth, QR cukup sekali
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
});

client.on('qr', (qr) => {
  console.log('\n=== SCAN QR INI DENGAN WHATSAPP DI HP ===');
  console.log('(WhatsApp > titik tiga > Perangkat tertaut > Tautkan perangkat)\n');
  qrcode.generate(qr, { small: true });
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
    if (!text) return; // abaikan pesan tanpa teks (gambar/stiker/dokumen)
    if (isOnCooldown(msg.from)) return;

    log(`📩 ${isGroup ? '[grup] ' : ''}${msg.from}: ${text.slice(0, 120)}`);

    let reply = null;
    const firstWord = text.split(/\s+/)[0].toLowerCase();
    if (firstWord === '.s' || firstWord === '.sticker' || firstWord === '.stiker') {
      // Perintah stiker membalas sendiri (kirim media), jadi selesai di sini
      reply = await handleSticker(msg, text);
      if (reply === null) {
        lastReplyAt.set(msg.from, Date.now());
        return;
      }
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
