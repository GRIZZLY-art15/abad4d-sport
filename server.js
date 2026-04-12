const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3005;

// ============ SET TIMEZONE WIB ============
process.env.TZ = 'Asia/Jakarta';

// ============ KONFIGURASI ============
const ADMIN_SECRET_KEY = 'ABAD4D_SPORT_SECRET_2026';
const SITE_URL = process.env.SITE_URL || 'http://localhost:3005';

// ============ KATEGORI ============
const CATEGORIES = {
    'Piala Dunia 2026': ['piala dunia 2026', 'world cup 2026', 'wc 2026', 'usa 2026'],
    'Liga Inggris': ['premier league', 'liga inggris', 'manchester', 'liverpool', 'arsenal', 'chelsea'],
    'Liga Spanyol': ['la liga', 'real madrid', 'barcelona', 'atletico madrid'],
    'Liga Italia': ['serie a', 'juventus', 'inter milan', 'ac milan', 'napoli'],
    'Liga Champions': ['champions league', 'liga champions', 'ucl'],
    'Liga Indonesia': ['liga 1', 'persija', 'persib', 'arema', 'timnas indonesia']
};

// ============ KATA DILARANG ============
const FORBIDDEN = ['iklan', 'promo', 'bonus', 'deposit', 'slot', 'casino', 'poker', 'togel'];

// ============ CORS ============
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

// ============ DATABASE ============
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const db = new sqlite3.Database('pialadunia.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        image TEXT NOT NULL DEFAULT 'default.jpg',
        category TEXT DEFAULT 'Berita Bola',
        status TEXT DEFAULT 'published',
        published_at DATETIME,
        views INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT
    )`);
});

// ============ ADMIN DEFAULT ============
bcrypt.hash('admin123', 10).then(hash => {
    db.run(`INSERT OR IGNORE INTO admin (id, username, password) VALUES (1, 'admin', ?)`, [hash]);
    console.log('✅ Admin: admin / admin123');
});

// ============ FUNGSI BANTUAN ============
function getWIB() {
    return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
}

function detectCategory(title) {
    const t = title.toLowerCase();
    for (const [cat, keywords] of Object.entries(CATEGORIES)) {
        if (keywords.some(k => t.includes(k))) return cat;
    }
    return 'Berita Bola';
}

function isValidNews(title) {
    const t = title.toLowerCase();
    if (FORBIDDEN.some(f => t.includes(f))) return false;
    return t.includes('bola') || t.includes('sepak') || t.includes('liga') || t.includes('piala');
}

function cleanContent(text) {
    if (!text) return '';
    return text
        .replace(/[^\x20-\x7E\s\u00C0-\u00FF]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 1500);
}

// ============ DOWNLOAD GAMBAR (RINGAN) ============
async function downloadImage(url, retry = 0) {
    if (!url || !url.startsWith('http')) return null;
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 8000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (response.data && response.data.length > 5000) {
            const ext = response.headers['content-type']?.includes('png') ? 'png' : 'jpg';
            const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;
            fs.writeFileSync(path.join('uploads', filename), response.data);
            return filename;
        }
        return null;
    } catch (error) {
        if (retry < 1) {
            await new Promise(r => setTimeout(r, 1000));
            return downloadImage(url, retry + 1);
        }
        return null;
    }
}

// ============ SCRAPE BERITA (DIBATASI) ============
async function scrapeNews() {
    const sources = [
        { name: 'Bola.net', url: 'https://www.bola.net/', cat: 'Berita Bola' },
        { name: 'Goal.com', url: 'https://www.goal.com/id/berita', cat: 'Berita Bola' }
    ];
    const articles = [];
    
    for (const source of sources) {
        try {
            const response = await axios.get(source.url, { timeout: 10000 });
            const $ = cheerio.load(response.data);
            let count = 0;
            
            $('a').each((i, el) => {
                if (count >= 5) return;
                const href = $(el).attr('href');
                const text = $(el).text().trim();
                if (href && text && text.length > 20 && text.length < 150 && isValidNews(text)) {
                    let fullUrl = href;
                    if (!fullUrl.startsWith('http')) {
                        try { fullUrl = new URL(href, source.url).href; } catch(e) { return; }
                    }
                    articles.push({
                        title: text.substring(0, 120),
                        link: fullUrl,
                        source: source.name,
                        category: detectCategory(text)
                    });
                    count++;
                }
            });
            await new Promise(r => setTimeout(r, 500));
        } catch (error) {
            console.log(`⚠️ Scrape ${source.name} gagal: ${error.message}`);
        }
    }
    return articles;
}

// ============ SCRAPE KONTEN ARTIKEL ============
async function scrapeContent(url) {
    if (!url) return null;
    try {
        const response = await axios.get(url, { timeout: 8000 });
        const $ = cheerio.load(response.data);
        $('script, style, iframe, .ad, .ads, nav, header, footer').remove();
        
        let content = '';
        const selectors = ['article', '.article-content', '.post-content', '.entry-content', 'main'];
        for (const sel of selectors) {
            const el = $(sel);
            if (el.length) {
                content = el.text().trim();
                if (content.length > 200) break;
            }
        }
        if (!content || content.length < 100) {
            const paragraphs = [];
            $('p').each((i, p) => {
                const text = $(p).text().trim();
                if (text.length > 40 && paragraphs.length < 5) paragraphs.push(text);
            });
            content = paragraphs.join(' ');
        }
        return cleanContent(content).substring(0, 1000);
    } catch (error) {
        return null;
    }
}

// ============ CEK DUPLIKAT ============
async function isDuplicate(title) {
    return new Promise((resolve) => {
        const clean = title.toLowerCase().substring(0, 80);
        db.get('SELECT id FROM news WHERE LOWER(title) LIKE ?', [`%${clean}%`], (err, row) => {
            resolve(!!row);
        });
    });
}

// ============ UPDATE BERITA (1 POST PER 10 MENIT) ============
let isUpdating = false;
let lastPostTime = 0;
const POST_INTERVAL = 10 * 60 * 1000; // 10 menit

async function updateNews() {
    const now = Date.now();
    if (now - lastPostTime < POST_INTERVAL && lastPostTime > 0) {
        const remaining = Math.round((POST_INTERVAL - (now - lastPostTime)) / 1000);
        console.log(`⏳ Next post: ${Math.floor(remaining / 60)}m ${remaining % 60}s lagi`);
        return;
    }
    if (isUpdating) return;
    isUpdating = true;
    
    console.log(`\n📰 ${getWIB()} - Mencari berita...`);
    
    const articles = await scrapeNews();
    console.log(`📊 Dapat ${articles.length} artikel`);
    
    let posted = false;
    
    for (const article of articles) {
        if (posted) break;
        
        const isDup = await isDuplicate(article.title);
        if (isDup) {
            console.log(`⏭️ Duplikat: ${article.title.substring(0, 40)}...`);
            continue;
        }
        
        console.log(`📌 ${article.category}: ${article.title.substring(0, 50)}...`);
        
        // Ambil konten
        let content = await scrapeContent(article.link);
        if (!content || content.length < 100) {
            content = `Berita terbaru dari dunia sepakbola. ${article.title}. Simak update selengkapnya hanya di ABAD4D SPORT.`;
        }
        
        // Cari gambar
        let imageFile = null;
        
        // Cari gambar dari halaman artikel
        try {
            const imgRes = await axios.get(article.link, { timeout: 8000 });
            const $ = cheerio.load(imgRes.data);
            const imgSrc = $('meta[property="og:image"]').attr('content') || 
                          $('img').first().attr('src');
            if (imgSrc && imgSrc.startsWith('http')) {
                imageFile = await downloadImage(imgSrc);
            }
        } catch(e) {}
        
        if (!imageFile) imageFile = 'default.jpg';
        
        // Simpan ke database
        await new Promise((resolve) => {
            db.run(
                `INSERT INTO news (title, content, image, category, status, published_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [article.title.substring(0, 200), content, imageFile, article.category, 'published', new Date().toISOString()],
                (err) => {
                    if (err) {
                        console.log(`❌ Gagal simpan: ${err.message}`);
                    } else {
                        posted = true;
                        lastPostTime = Date.now();
                        console.log(`✅ BERITA DIPOSTING!`);
                        console.log(`📅 Next post: 10 menit lagi`);
                    }
                    resolve();
                }
            );
        });
        
        await new Promise(r => setTimeout(r, 1000));
    }
    
    if (!posted) {
        console.log(`⚠️ Tidak ada berita baru`);
    }
    
    isUpdating = false;
}

// ============ API ENDPOINTS ============
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM admin WHERE username = ?', [username], async (err, user) => {
        if (err || !user) return res.json({ success: false });
        const valid = await bcrypt.compare(password, user.password);
        res.json({ success: valid });
    });
});

app.get('/api/news', (req, res) => {
    db.all('SELECT * FROM news WHERE status = "published" ORDER BY published_at DESC, created_at DESC LIMIT 50', (err, rows) => {
        res.json(err ? [] : rows);
    });
});

app.get('/api/news/:id', (req, res) => {
    db.get('SELECT * FROM news WHERE id = ?', [req.params.id], (err, row) => {
        res.json(row);
    });
});

app.post('/api/news', upload.single('image'), (req, res) => {
    const { title, content, category, status } = req.body;
    const image = req.file ? req.file.filename : 'default.jpg';
    if (!title || !content) return res.status(400).json({ message: 'Judul dan isi harus diisi!' });
    db.run('INSERT INTO news (title, content, image, category, status, published_at) VALUES (?, ?, ?, ?, ?, ?)',
        [title.substring(0, 200), content, image, category || 'Berita Bola', status || 'published', new Date().toISOString()],
        function(err) {
            res.json(err ? { message: 'Gagal menyimpan' } : { message: 'Berita ditambahkan!', id: this.lastID });
        });
});

app.put('/api/news/:id', upload.single('image'), (req, res) => {
    const { title, content, category, status } = req.body;
    const id = req.params.id;
    if (req.file) {
        db.run('UPDATE news SET title = ?, content = ?, image = ?, category = ?, status = ? WHERE id = ?',
            [title, content, req.file.filename, category, status, id], (err) => {
                res.json(err ? { message: 'Gagal update' } : { message: 'Berita diupdate!' });
            });
    } else {
        db.run('UPDATE news SET title = ?, content = ?, category = ?, status = ? WHERE id = ?',
            [title, content, category, status, id], (err) => {
                res.json(err ? { message: 'Gagal update' } : { message: 'Berita diupdate!' });
            });
    }
});

app.delete('/api/news/:id', (req, res) => {
    db.run('DELETE FROM news WHERE id = ?', [req.params.id], function(err) {
        res.json(err ? { message: 'Gagal hapus' } : { message: 'Berita dihapus!' });
    });
});

app.post('/api/fetch-news', async (req, res) => {
    await updateNews();
    res.json({ message: 'Update berita selesai!' });
});

// ============ STATIC FILES ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ============ JALANKAN SERVER ============
app.listen(PORT, async () => {
    console.log(`\n⚽ ABAD4D SPORT - BOT BERITA SEPAKBOLA ⚽`);
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`🔑 Login: admin / admin123`);
    console.log(`\n✅ OPTIMASI DITERAPKAN:`);
    console.log(`   ✅ Scraping dibatasi (2 sumber, 5 artikel/sumber)`);
    console.log(`   ✅ Timeout lebih pendek (8-10 detik)`);
    console.log(`   ✅ Database query dibatasi LIMIT 50`);
    console.log(`   ✅ Upload file maks 5MB`);
    console.log(`   ✅ Interval posting: 10 menit`);
    console.log(`\n📰 Memulai update pertama...\n`);
    
    await updateNews();
    
    setInterval(updateNews, 60 * 1000);
    console.log(`⏰ Timer: Pengecekan setiap 1 menit, posting setiap 10 menit\n`);
});
