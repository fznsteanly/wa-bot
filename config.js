// ============================================================
// KONFIGURASI BOT — edit file ini aja buat ubah perilaku bot
// ============================================================

module.exports = {
  // Nomor owner (format: kode negara + nomor, tanpa + / spasi / 0 depan)
  // Contoh Indonesia: 6281234567890
  ownerNumber: '',

  // Nomor WhatsApp BOT itu sendiri (format sama seperti ownerNumber).
  // Kalau diisi, login memakai KODE PAIRING 8 huruf (bukan scan QR) —
  // cocok kalau bot jalan di Termux di HP yang sama dengan nomor bot.
  // Kosongkan ('') kalau mau login dengan scan QR seperti biasa.
  botNumber: '',

  // Balas otomatis di grup? false = bot cuma balas chat pribadi.
  // Nyalakan (true) kalau bot memang untuk grup.
  replyInGroups: false,

  // Jeda minimal antar balasan ke chat yang sama (detik).
  // Mencegah bot nge-spam kalau ada yang kirim banyak pesan.
  replyCooldownSeconds: 3,

  // ---------- ANTI VIEW-ONCE ----------
  // false (default) = foto/video sekali lihat TIDAK diubah otomatis;
  // ubahnya hanya lewat perintah .vo (reply pesan sekali lihat).
  // true = setiap foto/video sekali lihat yang masuk otomatis dikirim
  // ulang sebagai foto/video biasa di chat yang sama.
  antiViewOnce: false,

  // ---------- STIKER (.s) ----------
  // Nama & pembuat yang tampil di info stiker (bisa diubah).
  stickerName: 'BABUKU',
  stickerAuthor: 'wa-bot',

  // ---------- ATURAN BALAS OTOMATIS (kata kunci -> balasan) ----------
  // Bot cek apakah pesan MENGANDUNG kata kunci (tidak peduli huruf besar/kecil).
  // Aturan pertama yang cocok yang dipakai.
  autoReplies: [
    {
      keywords: ['halo', 'hai', 'hello', 'hi', 'assalamualaikum', 'selamat pagi', 'selamat siang', 'selamat malam'],
      reply: 'Halo! 👋 Ada yang bisa dibantu? Ketik *!menu* untuk lihat perintah yang tersedia.',
    },
    {
      keywords: ['harga', 'price', 'berapa'],
      reply: 'Untuk info harga, silakan hubungi owner ya 🙏 Ketik *!owner* untuk info kontak.',
    },
    {
      keywords: ['jam buka', 'buka jam', 'operasional'],
      reply: 'Kami buka setiap hari pukul 08.00–21.00 WITA.',
    },
    {
      keywords: ['lokasi', 'alamat', 'dimana', 'di mana'],
      reply: 'Lokasi kami: [isi alamatmu di sini].',
    },
    {
      keywords: ['terima kasih', 'makasih', 'thanks', 'thank you'],
      reply: 'Sama-sama! 😊 Senang bisa membantu.',
    },
  ],

  // Balasan kalau pesan tidak cocok aturan apa pun (kosongkan '' = tidak balas).
  fallbackReply: 'Maaf, saya bot otomatis dan belum paham pesan itu. Ketik *!menu* untuk lihat yang bisa saya bantu.',

  // ---------- PESAN TERJADWAL ----------
  // schedule: format cron "menit jam tanggal bulan hari-minggu"
  //   Contoh: '0 8 * * *' = setiap hari jam 08:00
  //          '30 18 * * 5' = setiap Jumat jam 18:30
  // to: nomor tujuan (format sama seperti ownerNumber) atau ID grup
  //     (ID grup: 628xxx-123456789@g.us — lihat dari log saat bot menerima pesan grup)
  scheduledMessages: [
    // Contoh (nonaktif secara default — hapus // di depannya untuk mengaktifkan):
    // { schedule: '0 8 * * *', to: '6281234567890', text: 'Selamat pagi! ☀️ Semoga harimu menyenangkan.' },
  ],

  // ---------- TEKS MENU ----------
  menuText:
    '🤖 *MENU BOT*\n\n' +
    '*!menu* — tampilkan menu ini\n' +
    '*!ping* — cek bot aktif atau tidak\n' +
    '*!jam* — lihat jam sekarang\n' +
    '*!owner* — info kontak owner\n' +
    '*.s* — ubah foto/video jadi stiker (reply foto lalu ketik *.s*)\n' +
    '*.vo* — ubah foto/video sekali lihat jadi foto/video biasa\n\n' +
    'Ketik kata kunci seperti *harga*, *lokasi*, atau *jam buka* untuk info cepat.',
};
