const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const cookieParser = require('cookie-parser');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3005;

// ============ SET TIMEZONE WIB (UTC+7) ============
process.env.TZ = 'Asia/Jakarta';

// ============ KEAMANAN ADMIN ============
const ADMIN_SECRET_KEY = 'ABAD4D_SPORT_SUPER_SECRET_2026_XYZ123';
const ADMIN_USERNAME = 'admin';
const SITE_URL = process.env.SITE_URL || 'https://abad4d-sport.onrender.com';

// ============ KONFIGURASI SEO ============
const SITEMAP_CONFIG = {
    changefreq: 'daily',
    priority: 0.8,
    lastmod: new Date().toISOString()
};

// ============ KATEGORI SEPAKBOLA LENGKAP ============
const FOOTBALL_CATEGORIES = {
    'Piala Dunia 2026': {
        keywords: ['piala dunia 2026', 'world cup 2026', 'usa 2026', 'mexico 2026', 'canada 2026', 'wc 2026'],
        slug: 'piala-dunia-2026'
    },
    'Liga Champions': {
        keywords: ['champions league', 'liga champions', 'ucl', 'uefa champions league'],
        slug: 'liga-champions'
    },
    'Liga Inggris': {
        keywords: ['premier league', 'liga inggris', 'epl', 'manchester united', 'liverpool', 'arsenal'],
        slug: 'liga-inggris'
    },
    'Liga Spanyol': {
        keywords: ['la liga', 'real madrid', 'barcelona', 'atletico madrid'],
        slug: 'liga-spanyol'
    },
    'Liga Italia': {
        keywords: ['serie a', 'juventus', 'inter milan', 'ac milan', 'napoli'],
        slug: 'liga-italia'
    },
    'Bundesliga': {
        keywords: ['bundesliga', 'bayern munich', 'borussia dortmund'],
        slug: 'bundesliga'
    },
    'Ligue 1': {
        keywords: ['ligue 1', 'psg', 'paris saint germain'],
        slug: 'ligue-1'
    },
    'Liga Indonesia': {
        keywords: ['liga 1', 'persija', 'persib', 'arema', 'timnas indonesia', 'pssi'],
        slug: 'liga-indonesia'
    },
    'Transfer Pemain': {
        keywords: ['transfer', 'resmi', 'gabung', 'pindah', 'rekrut'],
        slug: 'transfer-pemain'
    },
    'Hasil Pertandingan': {
        keywords: ['hasil', 'skor', 'menang', 'kalah', 'imbang'],
        slug: 'hasil-pertandingan'
    },
    'Jadwal Pertandingan': {
        keywords: ['jadwal', 'schedule', 'match'],
        slug: 'jadwal-pertandingan'
    }
};

// ============ KATA KUNCI DILARANG ============
const FORBIDDEN_KEYWORDS = [
    'iklan', 'promo', 'bonus', 'deposit', 'withdraw', 'slot', 'casino', 
    'poker', 'togel', 'livechat', 'login', 'daftar', 'agen bola'
];

// ============ SINONIM UNTUK AI REWRITE ============
const SYNONYMS = {
    'mengatakan': ['menyebutkan', 'mengungkapkan', 'menyatakan', 'mengumumkan'],
    'menang': ['meraih kemenangan', 'mengalahkan', 'unggul', 'berhasil'],
    'kalah': ['takluk', 'kekalahan', 'jatuh', 'tersingkir'],
    'transfer': ['pindah klub', 'bergabung', 'rekrutmen', 'perekrutan'],
    'resmi': ['diumumkan', 'dikonfirmasi', 'sah', 'official'],
    'pemain': ['bintang', 'atlet', 'pesepakbola', 'pemain bola'],
    'pelatih': ['manajer', 'taktisi', 'juru taktik', 'coach'],
    'klub': ['tim', 'kesebelasan', 'squad', 'skuat'],
    'pertandingan': ['laga', 'duel', 'partai', 'tandingan'],
    'gol': ['tendangan', 'lesakan', 'sundulan', 'tembakan'],
    'hebat': ['luar biasa', 'fantastis', 'spektakuler', 'gemilang'],
    'penting': ['krusial', 'vital', 'signifikan', 'menentukan'],
    'terbaru': ['terkini', 'update', 'mutakhir', 'hangat'],
    'segera': ['cepat', 'lekas', 'dalam waktu dekat', 'tak lama lagi']
};

function aiRewrite(text, category) {
    if (!text || text.length < 50) return text;
    let rewritten = text;
    for (const [word, synonyms] of Object.entries(SYNONYMS)) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        if (regex.test(rewritten) && Math.random() > 0.6) {
            const randomSynonym = synonyms[Math.floor(Math.random() * synonyms.length)];
            rewritten = rewritten.replace(regex, randomSynonym);
        }
    }
    const sentences = rewritten.split(/(?<=[.!?])\s+/);
    if (sentences.length > 2 && Math.random() > 0.7) {
        const temp = sentences[0];
        sentences[0] = sentences[1];
        sentences[1] = temp;
        rewritten = sentences.join(' ');
    }
    const connectors = ['Selain itu,', 'Sementara itu,', 'Di sisi lain,', 'Tak hanya itu,'];
    if (rewritten.length > 100 && Math.random() > 0.8) {
        const randomConnector = connectors[Math.floor(Math.random() * connectors.length)];
        const insertPoint = rewritten.indexOf('.') + 2;
        if (insertPoint > 0 && insertPoint < rewritten.length) {
            rewritten = rewritten.slice(0, insertPoint) + ' ' + randomConnector + ' ' + rewritten.slice(insertPoint);
        }
    }
    if (rewritten.length > 300 && !rewritten.includes('Kabar')) {
        const openers = [`Kabar terbaru datang dari dunia sepakbola, `, `Breaking news! `, `Informasi hangat terbaru, `];
        if (Math.random() > 0.5) {
            rewritten = openers[Math.floor(Math.random() * openers.length)] + rewritten.charAt(0).toLowerCase() + rewritten.slice(1);
        }
    }
    rewritten = rewritten.replace(/\s+/g, ' ');
    return rewritten;
}

function addInternalLinks(content, currentId, category) {
    const internalLinks = [
        { text: 'berita Piala Dunia 2026 lainnya', url: '/?cat=Piala Dunia 2026' },
        { text: 'jadwal pertandingan selengkapnya', url: '/?cat=Jadwal Pertandingan' },
        { text: 'update transfer pemain terbaru', url: '/?cat=Transfer Pemain' },
        { text: 'hasil pertandingan terkini', url: '/?cat=Hasil Pertandingan' },
        { text: 'berita sepakbola terupdate', url: '/' }
    ];
    const numLinks = Math.floor(Math.random() * 2) + 1;
    const selectedLinks = [];
    const shuffled = [...internalLinks];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (let i = 0; i < numLinks && i < shuffled.length; i++) {
        selectedLinks.push(shuffled[i]);
    }
    let linkedContent = content;
    for (const link of selectedLinks) {
        const linkHtml = `\n\nBaca juga ${link.text} di sini: ${SITE_URL}${link.url}\n\n`;
        linkedContent += linkHtml;
    }
    return linkedContent;
}

async function generateSitemap() {
    try {
        const news = await new Promise((resolve) => {
            db.all('SELECT id, title, category, published_at FROM news WHERE status = "published" ORDER BY published_at DESC', (err, rows) => {
                resolve(rows || []);
            });
        });
        let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
        sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        sitemap += `  <url>\n    <loc>${SITE_URL}/</loc>\n    <lastmod>${new Date().toISOString()}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;
        for (const [category, config] of Object.entries(FOOTBALL_CATEGORIES)) {
            sitemap += `  <url>\n    <loc>${SITE_URL}/?cat=${encodeURIComponent(category)}</loc>\n    <lastmod>${new Date().toISOString()}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
        }
        for (const item of news) {
            const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50);
            sitemap += `  <url>\n    <loc>${SITE_URL}/news/${item.id}/${slug}</loc>\n    <lastmod>${new Date(item.published_at).toISOString()}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
        }
        sitemap += '</urlset>';
        fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap);
        console.log(`📊 Sitemap generated: ${news.length + 1 + Object.keys(FOOTBALL_CATEGORIES).length} URLs`);
        return true;
    } catch (error) {
        console.log(`⚠️ Sitemap generation failed: ${error.message}`);
        return false;
    }
}

async function submitToGoogle() {
    try {
        const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(`${SITE_URL}/sitemap.xml`)}`;
        await axios.get(pingUrl, { timeout: 5000 });
        console.log(`📡 Submitted sitemap to Google`);
        const bingUrl = `https://www.bing.com/ping?sitemap=${encodeURIComponent(`${SITE_URL}/sitemap.xml`)}`;
        await axios.get(bingUrl, { timeout: 5000 });
        console.log(`📡 Submitted sitemap to Bing`);
        return true;
    } catch (error) {
        console.log(`⚠️ Failed to submit to search engines: ${error.message}`);
        return false;
    }
}

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static('uploads'));
app.use(express.static(__dirname));

app.get('/sitemap.xml', (req, res) => {
    const sitemapPath = path.join(__dirname, 'sitemap.xml');
    if (fs.existsSync(sitemapPath)) {
        res.header('Content-Type', 'application/xml');
        res.sendFile(sitemapPath);
    } else {
        res.status(404).send('Sitemap not found');
    }
});

app.get('/robots.txt', (req, res) => {
    const robots = `User-agent: *
Allow: /
Sitemap: ${SITE_URL}/sitemap.xml
Disallow: /api/
Disallow: /admin.html
Disallow: /login.html`;
    res.header('Content-Type', 'text/plain');
    res.send(robots);
});

app.use('/admin.html', (req, res, next) => {
    const token = req.cookies?.adminToken || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.redirect('/login.html');
    try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [username, timestamp, secretKey] = decoded.split(':');
        if (username === ADMIN_USERNAME && secretKey === ADMIN_SECRET_KEY) {
            const loginTime = parseInt(timestamp);
            const hoursSinceLogin = (Date.now() - loginTime) / (1000 * 60 * 60);
            if (hoursSinceLogin < 24) return next();
        }
        res.redirect('/login.html');
    } catch (error) {
        res.redirect('/login.html');
    }
});

app.post('/api/admin/login', async (req, res) => {
    const { username, password, secretKey } = req.body;
    if (secretKey !== ADMIN_SECRET_KEY) return res.status(401).json({ success: false, message: 'Secret Key salah!' });
    db.get('SELECT * FROM admin WHERE username = ?', [username], async (err, user) => {
        if (err || !user) return res.json({ success: false, message: 'Username atau password salah!' });
        const valid = await bcrypt.compare(password, user.password);
        if (valid) {
            const sessionToken = Buffer.from(`${username}:${Date.now()}:${ADMIN_SECRET_KEY}`).toString('base64');
            res.json({ success: true, token: sessionToken });
        } else {
            res.json({ success: false, message: 'Username atau password salah!' });
        }
    });
});

app.get('/api/admin/verify', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.json({ valid: false });
    try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [username, timestamp, secretKey] = decoded.split(':');
        if (username === ADMIN_USERNAME && secretKey === ADMIN_SECRET_KEY) {
            const hoursSinceLogin = (Date.now() - parseInt(timestamp)) / (1000 * 60 * 60);
            if (hoursSinceLogin < 24) return res.json({ valid: true });
        }
        res.json({ valid: false });
    } catch (error) {
        res.json({ valid: false });
    }
});

// ============ API CHANGE PASSWORD ============
app.post('/api/admin/change-password', async (req, res) => {
    const { oldPassword, newPassword, secretKey } = req.body;
    
    if (secretKey !== ADMIN_SECRET_KEY) {
        return res.status(401).json({ success: false, message: 'Secret Key salah!' });
    }
    
    if (!newPassword || newPassword.length < 6) {
        return res.json({ success: false, message: 'Password baru minimal 6 karakter!' });
    }
    
    db.get('SELECT * FROM admin WHERE id = 1', async (err, user) => {
        if (err || !user) {
            return res.json({ success: false, message: 'Admin tidak ditemukan!' });
        }
        
        const valid = await bcrypt.compare(oldPassword, user.password);
        if (!valid) {
            return res.json({ success: false, message: 'Password lama salah!' });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        db.run('UPDATE admin SET password = ? WHERE id = 1', [hashedPassword], (err) => {
            if (err) {
                return res.json({ success: false, message: 'Gagal mengupdate password!' });
            }
            res.json({ success: true, message: 'Password berhasil diubah!' });
        });
    });
});

// ============ BACKUP & RESTORE DATABASE ============
const BACKUP_FILE = 'backup-news.json';

async function backupDatabase() {
    try {
        const news = await new Promise((resolve) => {
            db.all('SELECT * FROM news ORDER BY id DESC', (err, rows) => {
                resolve(rows || []);
            });
        });
        fs.writeFileSync(BACKUP_FILE, JSON.stringify(news, null, 2));
        console.log(`💾 Backup: ${news.length} berita`);
    } catch (error) {
        console.log(`⚠️ Backup gagal: ${error.message}`);
    }
}

async function restoreDatabase() {
    try {
        if (fs.existsSync(BACKUP_FILE)) {
            const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
            if (backup.length > 0) {
                const count = await new Promise((resolve) => {
                    db.get('SELECT COUNT(*) as count FROM news', (err, row) => {
                        resolve(row ? row.count : 0);
                    });
                });
                if (count === 0) {
                    for (const news of backup) {
                        await new Promise((resolve) => {
                            db.run(
                                `INSERT OR IGNORE INTO news (id, title, content, image, category, status, published_at, views, created_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [news.id, news.title, news.content, news.image, news.category, news.status, news.published_at, news.views || 0, news.created_at],
                                (err) => resolve()
                            );
                        });
                    }
                    console.log(`🔄 Restore: ${backup.length} berita dipulihkan`);
                }
            }
        }
    } catch (error) {
        console.log(`⚠️ Restore gagal: ${error.message}`);
    }
}

function isValidFootballNews(title) {
    const titleLower = title.toLowerCase();
    for (const forbidden of FORBIDDEN_KEYWORDS) {
        if (titleLower.includes(forbidden)) return false;
    }
    const footballKeywords = ['sepakbola', 'bola', 'liga', 'piala', 'champions', 'premier', 'serie', 'bundesliga', 'ligue', 'persija', 'persib', 'timnas', 'madrid', 'barcelona', 'manchester', 'liverpool', 'juventus', 'inter', 'milan', 'psg', 'bayern', 'transfer', 'resmi', 'gabung', 'hasil', 'skor'];
    for (const keyword of footballKeywords) {
        if (titleLower.includes(keyword)) return true;
    }
    return false;
}

function detectCategory(title) {
    const titleLower = title.toLowerCase();
    for (const [category, config] of Object.entries(FOOTBALL_CATEGORIES)) {
        for (const keyword of config.keywords) {
            if (titleLower.includes(keyword)) return category;
        }
    }
    return 'Berita Bola';
}

// ============ FITUR ANTI DUPLICATE YANG DIPERKUAT ============
async function isDuplicate(title, excludeId = null) {
    return new Promise((resolve) => {
        const cleanTitle = title.toLowerCase()
            .replace(/[^\w\s]/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 100);
        
        let query = `SELECT id, title FROM news WHERE LOWER(REPLACE(REPLACE(REPLACE(title, '?', ''), '!', ''), '.', '')) LIKE ?`;
        let params = [`%${cleanTitle}%`];
        
        if (excludeId) {
            query += ` AND id != ?`;
            params.push(excludeId);
        }
        
        db.get(query, params, (err, row) => {
            if (row) {
                console.log(`⚠️ DUPLIKAT TERDETEKSI: "${title.substring(0, 50)}..." sama dengan ID ${row.id} "${row.title.substring(0, 50)}..."`);
            }
            resolve(!!row);
        });
    });
}

// ============ FUNGSI CEK DAN HAPUS DOUBLE POSTINGAN ============
async function checkAndRemoveDuplicates() {
    console.log('\n🔍 MEMERIKSA DOUBLE POSTINGAN...');
    
    return new Promise((resolve) => {
        // Ambil semua berita
        db.all('SELECT id, title, published_at, created_at FROM news ORDER BY id DESC', async (err, allNews) => {
            if (err || !allNews || allNews.length === 0) {
                console.log('⚠️ Tidak ada data untuk diperiksa');
                resolve(0);
                return;
            }
            
            const duplicates = [];
            const seen = new Map(); // Map untuk menyimpan title yang sudah dilihat
            
            for (const news of allNews) {
                const cleanTitle = news.title.toLowerCase()
                    .replace(/[^\w\s]/gi, '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .substring(0, 100);
                
                if (seen.has(cleanTitle)) {
                    // Ini duplikat
                    const existingNews = seen.get(cleanTitle);
                    duplicates.push({
                        id: news.id,
                        title: news.title,
                        duplicateOf: existingNews.id,
                        existingTitle: existingNews.title
                    });
                } else {
                    seen.set(cleanTitle, {
                        id: news.id,
                        title: news.title,
                        published_at: news.published_at,
                        created_at: news.created_at
                    });
                }
            }
            
            if (duplicates.length === 0) {
                console.log('✅ Tidak ditemukan double postingan!');
                resolve(0);
                return;
            }
            
            console.log(`⚠️ Ditemukan ${duplicates.length} double postingan!`);
            
            // Hapus duplikat (keep yang paling lama/pertama)
            let deletedCount = 0;
            for (const dup of duplicates) {
                await new Promise((resolveDelete) => {
                    db.run('DELETE FROM news WHERE id = ?', [dup.id], (err) => {
                        if (err) {
                            console.log(`❌ Gagal hapus duplikat ID ${dup.id}: ${err.message}`);
                        } else {
                            deletedCount++;
                            console.log(`🗑️ DUPLIKAT DIHAPUS: "${dup.title.substring(0, 50)}..." (sama dengan ID ${dup.duplicateOf})`);
                        }
                        resolveDelete();
                    });
                });
            }
            
            if (deletedCount > 0) {
                console.log(`✅ Berhasil menghapus ${deletedCount} double postingan!`);
                backupDatabase();
                generateSitemap();
            }
            
            resolve(deletedCount);
        });
    });
}

// Fungsi untuk membersihkan duplikat secara otomatis setiap jam
let lastDuplicateCheck = 0;
const DUPLICATE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 jam

async function autoCleanDuplicates() {
    const now = Date.now();
    if (now - lastDuplicateCheck >= DUPLICATE_CHECK_INTERVAL) {
        lastDuplicateCheck = now;
        await checkAndRemoveDuplicates();
    }
}

function cleanContent(content) {
    if (!content) return '';
    let clean = content;
    const patterns = [
        /Baca juga:.*?(?=\.|$)/gi, /Baca Juga:.*?(?=\.|$)/gi, /Advertisement/gi,
        /SCROLL TO CONTINUE WITH CONTENT/gi, /Pilihan Redaksi.*?(?=\.|$)/gi,
        /Bagikan:.*?(?=\.|$)/gi, /url telah tercopy/gi, /Komentar/gi, /Tulis Komentar/gi,
        /Rekomendasi/gi, /Share this article/gi, /Follow us on/gi, /Subscribe to/gi,
        /Click here/gi, /Read more/gi, /Selengkapnya di/gi, /Baca selengkapnya/gi,
        /Lihat Juga:.*?(?=\.|$)/gi, /VIDEO:.*?(?=\.|$)/gi, /FOTO:.*?(?=\.|$)/gi,
        /BERITA TERKAIT:.*?(?=\.|$)/gi, /TAG:.*?(?=\.|$)/gi,
        /Jakarta, CNN Indonesia --/gi, /CNN Indonesia --/gi, /Kompas.com -/gi,
        /Liputan6.com -/gi, /Goal.com -/gi, /Bola.net -/gi,
        /Dilansir dari/gi, /Melansir/gi, /Mengutip/gi, /ADVERTISEMENT/gi,
        /BERITA LAINNYA/gi, /TERPOPULER/gi, /TERKINI/gi,
        /[\d]+ Jam yang lalu/gi, /[\d]+ Menit yang lalu/gi, /[\d]+ Hari yang lalu/gi,
        /Diterbitkan:.*?(?=\.|$)/gi, /Diperbarui:.*?(?=\.|$)/gi,
        /Published:.*?(?=\.|$)/gi, /Updated:.*?(?=\.|$)/gi, /Tanggal:.*?(?=\.|$)/gi
    ];
    for (const pattern of patterns) {
        clean = clean.replace(pattern, '');
    }
    clean = clean.replace(/https?:\/\/[^\s]+/gi, '');
    clean = clean.replace(/\s+/g, ' ');
    clean = clean.trim();
    return clean;
}

async function downloadImage(imageUrl, retryCount = 0) {
    if (!imageUrl || !imageUrl.startsWith('http')) return null;
    if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const urlLower = imageUrl.toLowerCase();
    let hasValidExt = false;
    for (const ext of validExtensions) {
        if (urlLower.includes(ext)) { hasValidExt = true; break; }
    }
    if (!hasValidExt) return null;
    const userAgents = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'];
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    try {
        let cleanUrl = imageUrl.split('?')[0];
        cleanUrl = cleanUrl.split('#')[0];
        cleanUrl = cleanUrl.replace(/[<>"']/g, '');
        const response = await axios.get(cleanUrl, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: { 'User-Agent': randomUA, 'Accept': 'image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8', 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8', 'Referer': 'https://www.google.com/' },
            maxRedirects: 5
        });
        const fileSize = response.data ? response.data.length : 0;
        if (fileSize < 10240) {
            if (retryCount < 1) { await new Promise(resolve => setTimeout(resolve, 1000)); return downloadImage(imageUrl, retryCount + 1); }
            return null;
        }
        let ext = 'jpg';
        const contentType = response.headers['content-type'];
        if (contentType) {
            if (contentType.includes('png')) ext = 'png';
            else if (contentType.includes('webp')) ext = 'webp';
            else if (contentType.includes('jpeg')) ext = 'jpg';
        }
        const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
        const filepath = path.join(__dirname, 'uploads', filename);
        fs.writeFileSync(filepath, response.data);
        if (fs.existsSync(filepath) && fs.statSync(filepath).size >= 10240) return filename;
        return null;
    } catch (error) {
        if (retryCount < 1) { await new Promise(resolve => setTimeout(resolve, 1000)); return downloadImage(imageUrl, retryCount + 1); }
        return null;
    }
}

async function extractImageFromArticle(url) {
    if (!url) return null;
    try {
        const response = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' } });
        const $ = cheerio.load(response.data);
        const selectors = ['meta[property="og:image"]', 'meta[name="twitter:image"]', 'article img', '.article-content img', '.post-content img', '.entry-content img', '.detail-text img', '.content img'];
        for (const selector of selectors) {
            let imgSrc = null;
            if (selector.startsWith('meta')) { imgSrc = $(selector).attr('content'); }
            else { const img = $(selector).first(); if (img.length) { imgSrc = img.attr('src') || img.attr('data-src'); } }
            if (imgSrc && imgSrc.startsWith('http') && !imgSrc.includes('placeholder') && !imgSrc.includes('default')) { return imgSrc.split('?')[0]; }
        }
        return null;
    } catch (error) { return null; }
}

const NEWS_SOURCES = [
    { name: 'Bola.net - Terbaru', url: 'https://www.bola.net/', category: 'Berita Bola' },
    { name: 'Bola.net - Liga Inggris', url: 'https://www.bola.net/inggris/', category: 'Liga Inggris' },
    { name: 'Bola.net - Liga Champions', url: 'https://www.bola.net/champions/', category: 'Liga Champions' },
    { name: 'Bola.net - Spanyol', url: 'https://www.bola.net/spanyol/', category: 'Liga Spanyol' },
    { name: 'Bola.net - Italia', url: 'https://www.bola.net/italia/', category: 'Liga Italia' },
    { name: 'Bola.net - Indonesia', url: 'https://www.bola.net/indonesia/', category: 'Liga Indonesia' },
    { name: 'Goal.com Indonesia', url: 'https://www.goal.com/id/berita', category: 'Berita Bola' }
];

async function scrapeNews() {
    const allArticles = [];
    for (const source of NEWS_SOURCES) {
        try {
            console.log(`  🔍 ${source.name}...`);
            const response = await axios.get(source.url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8' } });
            const $ = cheerio.load(response.data);
            let articlesCount = 0;
            const processedLinks = new Set();
            $('a').each((i, elem) => {
                const href = $(elem).attr('href');
                const text = $(elem).text().trim();
                if (href && text && text.length > 25 && text.length < 200) {
                    let fullUrl = href;
                    if (!fullUrl.startsWith('http')) { try { const urlObj = new URL(fullUrl, source.url); fullUrl = urlObj.href; } catch(e) { return; } }
                    if (processedLinks.has(fullUrl)) return;
                    processedLinks.add(fullUrl);
                    if (fullUrl && isValidFootballNews(text) && !fullUrl.includes('tag/') && !fullUrl.includes('/indeks') && !fullUrl.includes('login') && !fullUrl.includes('register')) {
                        let imageUrl = null;
                        const parent = $(elem).closest('article, .article, .post, .item, .list-item');
                        if (parent.length) { const img = parent.find('img').first(); if (img.length) { imageUrl = img.attr('src') || img.attr('data-src'); if (imageUrl && !imageUrl.startsWith('http')) { try { const imgUrlObj = new URL(imageUrl, source.url); imageUrl = imgUrlObj.href; } catch(e) {} } } }
                        if (!imageUrl) { const img = $(elem).find('img').first(); if (img.length) { imageUrl = img.attr('src') || img.attr('data-src'); if (imageUrl && !imageUrl.startsWith('http')) { try { const imgUrlObj = new URL(imageUrl, source.url); imageUrl = imgUrlObj.href; } catch(e) {} } } }
                        const category = detectCategory(text);
                        allArticles.push({ title: fixTitle(text), link: fullUrl, image: imageUrl, source: source.name, category: category, published_at: new Date().toISOString() });
                        articlesCount++;
                    }
                }
            });
            console.log(`    ✅ ${articlesCount} berita`);
            await sleep(500);
        } catch (error) { console.log(`    ⚠️ Gagal: ${error.message}`); }
    }
    return allArticles;
}

async function scrapeGoogleNews() {
    const queries = ['sepakbola+terbaru', 'transfer+pemain', 'hasil+pertandingan', 'liga+inggris', 'liga+spanyol', 'liga+italia'];
    const articles = [];
    for (const query of queries) {
        try {
            const url = `https://news.google.com/rss/search?q=${query}&hl=id&gl=ID&ceid=ID:id`;
            const response = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(response.data, { xmlMode: true });
            $('item').each((i, item) => {
                if (i >= 5) return;
                const title = $(item).find('title').text();
                const link = $(item).find('link').text();
                let pubDate = $(item).find('pubDate').text();
                if (title && title.length > 25 && link && isValidFootballNews(title)) {
                    articles.push({ title: fixTitle(title), link: link, image: null, source: 'Google News', category: detectCategory(title), published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString() });
                }
            });
            await sleep(300);
        } catch (error) {}
    }
    return articles;
}

async function scrapeArticleContent(url) {
    if (!url) return null;
    try {
        const response = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' } });
        const $ = cheerio.load(response.data);
        $('script, style, iframe, .ad, .ads, .social-share, .comment, nav, header, footer, .sidebar').remove();
        let content = '';
        const selectors = ['article', '.article-content', '.post-content', '.entry-content', '.detail-text', '.article-body', '.content-detail', '.story__content', '.news-content', '#content', 'main'];
        for (const selector of selectors) {
            const element = $(selector);
            if (element.length) { let text = element.text().trim(); if (text.length > 200) { content = text; break; } }
        }
        if (!content) { const paragraphs = []; $('p').each((i, p) => { const text = $(p).text().trim(); if (text.length > 50 && !text.includes('Cookie') && !text.includes('Privacy')) paragraphs.push(text); }); content = paragraphs.join(' '); }
        content = cleanContent(content);
        if (content.length > 800) { const sentences = content.split(/[.!?]+/); let short = ''; let count = 0; for (const sentence of sentences) { const cleanSentence = sentence.trim(); if (cleanSentence.length > 30 && count < 5) { short += cleanSentence + '. '; count++; } } content = short.length > 150 ? short : content.substring(0, 800); }
        return content.length > 200 ? content : null;
    } catch (error) { return null; }
}

function fixTitle(title) {
    if (!title) return 'Berita Sepakbola Terbaru';
    let fixed = title;
    fixed = fixed.replace(/^[^a-zA-Z0-9\s]+/, '');
    fixed = fixed.replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
    fixed = fixed.replace(/[!?]+$/, '');
    fixed = fixed.replace(/\s+/g, ' ').trim();
    if (fixed.length > 0) fixed = fixed.charAt(0).toUpperCase() + fixed.slice(1);
    return fixed.substring(0, 120) || 'Berita Sepakbola Terbaru';
}

function createDescription(title, originalContent, category, newsId) {
    const titleClean = title.replace(/[!?]+$/, '');
    let main = originalContent || '';
    if (!main || main.length < 100) {
        switch(category) {
            case 'Piala Dunia 2026': main = `Piala Dunia 2026 akan menjadi edisi istimewa karena digelar di tiga negara: Amerika Serikat, Meksiko, dan Kanada. Turnamen ini akan diikuti 48 tim untuk pertama kalinya. Pertandingan pembukaan akan digelar pada 12 Juni 2026 di Stadion Azteca, Meksiko City.`; break;
            case 'Transfer Pemain': main = `Bursa transfer pemain selalu menjadi momen yang dinanti. Klub-klub besar Eropa mulai bergerak untuk mendatangkan pemain bintang. Ikuti terus perkembangan transfer terbaru.`; break;
            case 'Hasil Pertandingan': main = `Hasil pertandingan sepakbola selalu menyajikan drama dan ketegangan hingga menit akhir. Simak skor akhir dan rekap pertandingan hanya di ABAD4D SPORT.`; break;
            default: main = `Berita terbaru dari dunia sepakbola. ${titleClean} menjadi sorotan utama. Simak update selengkapnya.`;
        }
    }
    let rewritten = aiRewrite(main, category);
    let withLinks = addInternalLinks(rewritten, newsId, category);
    let final = `${titleClean}\n\n${withLinks}\n\nIkuti terus ABAD4D SPORT untuk berita sepakbola terupdate. #ABAD4DSPORT #BeritaBola #${category.replace(/ /g, '')}`;
    final = final.replace(/\s+/g, ' ');
    return final.substring(0, 3500);
}

let isUpdating = false;
let lastPostTime = 0;
const POST_INTERVAL_MS = 10 * 60 * 1000;

async function updateNews() {
    const now = getWIB();
    const nowMs = Date.now();
    if (nowMs - lastPostTime < POST_INTERVAL_MS && lastPostTime > 0) {
        const remaining = Math.round((POST_INTERVAL_MS - (nowMs - lastPostTime)) / 1000);
        console.log(`\n⏳ ${now} WIB - Post berikutnya: ${Math.floor(remaining / 60)}m ${remaining % 60}s lagi`);
        // Cek double postingan setiap kali sebelum update
        await autoCleanDuplicates();
        return;
    }
    if (isUpdating) { console.log(`\n⏳ ${now} WIB - Update sedang berjalan...`); return; }
    isUpdating = true;
    console.log('\n' + '='.repeat(60));
    console.log(`⚽ ${now} WIB - MENCARI BERITA BARU (Setiap 10 menit)`);
    console.log('='.repeat(60));
    
    // Cek dan hapus double postingan sebelum mencari berita baru
    await checkAndRemoveDuplicates();
    
    let allArticles = [];
    console.log('\n📡 SCRAPING BERITA...');
    const [webArticles, googleArticles] = await Promise.all([scrapeNews(), scrapeGoogleNews()]);
    console.log(`\n  📰 Website: ${webArticles.length} berita`);
    console.log(`  📰 Google News: ${googleArticles.length} berita`);
    allArticles.push(...webArticles, ...googleArticles);
    const unique = [];
    const seen = new Set();
    for (const article of allArticles) {
        const key = article.title.substring(0, 80).toLowerCase().replace(/[^\w\s]/gi, '');
        if (!seen.has(key)) { seen.add(key); unique.push(article); }
    }
    console.log(`\n📊 TOTAL BERITA UNIK: ${unique.length}`);
    unique.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    let posted = false;
    let checkedCount = 0;
    for (const article of unique) {
        if (posted) break;
        checkedCount++;
        const category = detectCategory(article.title);
        
        // Cek duplikat dengan database existing
        const isDuplicateNews = await isDuplicate(article.title);
        if (isDuplicateNews) { 
            console.log(`  ⏭️ [DUPLIKAT] ${article.title.substring(0, 50)}... (sudah ada di database)`);
            continue; 
        }
        
        console.log(`\n  📌 [${category}] ${article.title.substring(0, 55)}...`);
        let content = null;
        if (article.link) { console.log(`      🔗 Mengambil konten...`); content = await scrapeArticleContent(article.link); await sleep(300); }
        let imageFile = null;
        if (article.image) imageFile = await downloadImage(article.image);
        if (!imageFile && article.link) { console.log(`      🔍 Cari gambar alternatif...`); const fallbackImage = await extractImageFromArticle(article.link); if (fallbackImage) imageFile = await downloadImage(fallbackImage); }
        if (!imageFile) { console.log(`      ❌ GAGAL gambar - cari berita lain`); continue; }
        const tempId = Date.now();
        const finalContent = createDescription(article.title, content, category, tempId);
        await new Promise((resolve) => {
            db.run(`INSERT INTO news (title, content, image, category, status, published_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [article.title.substring(0, 200), finalContent, imageFile, category, 'published', article.published_at],
                (err) => {
                    if (err) { 
                        console.log(`      ❌ Gagal simpan: ${err.message}`); 
                    }
                    else { 
                        posted = true; 
                        lastPostTime = Date.now(); 
                        console.log(`      ✅ BERITA BERHASIL DIPOSTING!`); 
                        console.log(`      📅 Next post: 10 menit lagi`); 
                        backupDatabase(); 
                        generateSitemap(); 
                    }
                    resolve();
                });
        });
        await sleep(500);
    }
    if (!posted) { console.log(`\n⚠️ TIDAK ADA BERITA BARU!`); console.log(`   📊 Total dicek: ${checkedCount} berita`); const totalNews = await getTotalNews(); console.log(`   💾 Total di database: ${totalNews}`); }
    console.log('\n' + '='.repeat(60));
    console.log(`✅ UPDATE SELESAI!`);
    console.log(`   📰 Status: ${posted ? 'BERHASIL POSTING' : 'TIDAK ADA BERITA'}`);
    console.log('='.repeat(60) + '\n');
    isUpdating = false;
}

async function getTotalNews() {
    return new Promise((resolve) => {
        db.get('SELECT COUNT(*) as count FROM news', (err, row) => { resolve(row ? row.count : 0); });
    });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function getWIB() { return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, 'uploads/'); },
    filename: (req, file, cb) => { cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

const db = new sqlite3.Database('pialadunia.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        image TEXT NOT NULL,
        category TEXT DEFAULT 'Berita Bola',
        status TEXT DEFAULT 'published',
        published_at DATETIME,
        views INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_title ON news(title)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_published_at ON news(published_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_category ON news(category)`);
    db.run(`CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT
    )`);
});

bcrypt.hash('admin123', 10).then(hash => {
    db.run(`INSERT OR IGNORE INTO admin (id, username, password) VALUES (1, 'admin', ?)`, [hash]);
    console.log('✅ Admin: admin / admin123');
});

setTimeout(async () => {
    await restoreDatabase();
    await generateSitemap();
    await submitToGoogle();
    // Cek double postingan saat startup
    await checkAndRemoveDuplicates();
}, 1000);

// ============ API UNTUK CEK DAN HAPUS DOUBLE POSTINGAN ============
app.get('/api/check-duplicates', async (req, res) => {
    const deleted = await checkAndRemoveDuplicates();
    res.json({ 
        success: true, 
        message: `Pengecekan selesai! ${deleted} double postingan dihapus.`,
        deletedCount: deleted 
    });
});

app.post('/api/admin/check-duplicates', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
    
    try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [username, timestamp, secretKey] = decoded.split(':');
        if (username === ADMIN_USERNAME && secretKey === ADMIN_SECRET_KEY) {
            const hoursSinceLogin = (Date.now() - parseInt(timestamp)) / (1000 * 60 * 60);
            if (hoursSinceLogin < 24) {
                const deleted = await checkAndRemoveDuplicates();
                return res.json({ 
                    success: true, 
                    message: `Pengecekan selesai! ${deleted} double postingan dihapus.`,
                    deletedCount: deleted 
                });
            }
        }
        res.status(401).json({ success: false, message: 'Unauthorized' });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM admin WHERE username = ?', [username], async (err, user) => {
        if (err || !user) return res.json({ success: false });
        const valid = await bcrypt.compare(password, user.password);
        res.json({ success: valid });
    });
});

app.get('/api/news', (req, res) => {
    db.all('SELECT * FROM news WHERE status = "published" ORDER BY published_at DESC, created_at DESC', (err, rows) => {
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
    const image = req.file ? req.file.filename : null;
    if (!title || !content || !image) return res.status(400).json({ message: 'Judul, isi, dan gambar harus diisi!' });
    db.run('INSERT INTO news (title, content, image, category, status, published_at) VALUES (?, ?, ?, ?, ?, ?)',
        [fixTitle(title), content, image, category || 'Berita Bola', status || 'published', new Date().toISOString()],
        function(err) {
            if (err) res.status(500).json({ message: 'Gagal menyimpan' });
            else { backupDatabase(); generateSitemap(); res.json({ message: 'Berita ditambahkan!', id: this.lastID }); }
        });
});

app.put('/api/news/:id', upload.single('image'), (req, res) => {
    const { title, content, category, status } = req.body;
    const id = req.params.id;
    if (req.file) {
        db.run('UPDATE news SET title = ?, content = ?, image = ?, category = ?, status = ? WHERE id = ?',
            [fixTitle(title), content, req.file.filename, category, status, id], (err) => {
                if (err) res.status(500).json({ message: 'Gagal update' });
                else { backupDatabase(); generateSitemap(); res.json({ message: 'Berita diupdate!' }); }
            });
    } else {
        db.run('UPDATE news SET title = ?, content = ?, category = ?, status = ? WHERE id = ?',
            [fixTitle(title), content, category, status, id], (err) => {
                if (err) res.status(500).json({ message: 'Gagal update' });
                else { backupDatabase(); generateSitemap(); res.json({ message: 'Berita diupdate!' }); }
            });
    }
});

app.delete('/api/news/:id', (req, res) => {
    db.run('DELETE FROM news WHERE id = ?', [req.params.id], function(err) {
        if (err) res.status(500).json({ message: 'Gagal hapus' });
        else { backupDatabase(); generateSitemap(); res.json({ message: 'Berita dihapus!' }); }
    });
});

app.post('/api/fetch-news', async (req, res) => {
    await updateNews();
    res.json({ message: 'Update berita sepakbola selesai!' });
});

app.get('/ping', (req, res) => { res.status(200).send('OK'); });

app.get('/api/seo/stats', async (req, res) => {
    const totalNews = await getTotalNews();
    const categories = Object.keys(FOOTBALL_CATEGORIES);
    res.json({ totalNews, categories: categories.length, sitemapUrl: `${SITE_URL}/sitemap.xml`, robotsUrl: `${SITE_URL}/robots.txt`, lastUpdate: new Date().toISOString() });
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/login.html', (req, res) => { res.sendFile(path.join(__dirname, 'login.html')); });
app.get('/admin.html', (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });
app.get('*.html', (req, res) => {
    const filePath = path.join(__dirname, req.path);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('File not found');
});

app.listen(PORT, async () => {
    console.log(`\n⚽⚽⚽ ABAD4D SPORT - BOT BERITA SEPAKBOLA CERDAS ⚽⚽⚽`);
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`🔑 Admin: admin / admin123`);
    console.log(`🔐 Secret Key: ${ADMIN_SECRET_KEY}`);
    console.log(`\n🤖 FITUR CERDAS:`);
    console.log(`   ✅ AI Rewrite (Natural seperti manusia)`);
    console.log(`   ✅ Auto Internal Linking`);
    console.log(`   ✅ Sitemap Generator (Otomatis)`);
    console.log(`   ✅ Auto Submit ke Google & Bing`);
    console.log(`   ✅ Ranking Booster (SEO Ready)`);
    console.log(`   ✅ Scraping Lebih Bersih`);
    console.log(`   ✅ Anti Duplicate KUAT (Cek sebelum posting)`);
    console.log(`   ✅ AUTO HAPUS DOUBLE POSTINGAN (Setiap jam)`);
    console.log(`   ✅ Gambar Valid (Cek URL)`);
    console.log(`   ✅ Ganti Password Admin`);
    console.log(`   ✅ API Check Duplicates: /api/check-duplicates`);
    console.log(`\n📡 SUMBER: Bola.net, Goal.com, Google News`);
    console.log(`⏰ UPDATE: Setiap 10 menit (1 postingan)`);
    console.log(`🗑️ AUTO CLEAN: Cek & hapus double setiap 1 jam`);
    console.log(`📊 SITEMAP: ${SITE_URL}/sitemap.xml`);
    console.log(`🤖 ROBOTS: ${SITE_URL}/robots.txt`);
    console.log(`\n📰 Memulai update pertama...\n`);
    await updateNews();
    setInterval(async () => { await updateNews(); }, 60 * 1000);
    setInterval(() => { backupDatabase(); generateSitemap(); submitToGoogle(); }, 60 * 60 * 1000);
    // Auto check duplicates setiap 1 jam
    setInterval(async () => { await checkAndRemoveDuplicates(); }, DUPLICATE_CHECK_INTERVAL);
    console.log('⏰ Timer aktif: Pengecekan setiap 1 menit, posting setiap 10 menit');
    console.log('🗑️ Timer double cleaner: Pengecekan setiap 1 jam\n');
});
