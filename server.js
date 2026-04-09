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

const app = express();
const PORT = process.env.PORT || 3005;

// ============ SET TIMEZONE WIB (UTC+7) ============
process.env.TZ = 'Asia/Jakarta';

// ============ KEAMANAN ADMIN ============
const ADMIN_SECRET_KEY = 'ABAD4D_SPORT_SUPER_SECRET_2026_XYZ123';
const ADMIN_USERNAME = 'admin';

// ============ KATEGORI SEPAKBOLA LENGKAP ============
const FOOTBALL_CATEGORIES = {
    'Piala Dunia 2026': {
        keywords: ['piala dunia 2026', 'world cup 2026', 'usa 2026', 'mexico 2026', 'canada 2026', 'wc 2026']
    },
    'Liga Champions': {
        keywords: ['champions league', 'liga champions', 'ucl', 'uefa champions league']
    },
    'Liga Inggris': {
        keywords: ['premier league', 'liga inggris', 'epl', 'manchester united', 'liverpool', 'arsenal', 'chelsea', 'manchester city', 'tottenham']
    },
    'Liga Spanyol': {
        keywords: ['la liga', 'real madrid', 'barcelona', 'atletico madrid']
    },
    'Liga Italia': {
        keywords: ['serie a', 'juventus', 'inter milan', 'ac milan', 'napoli', 'roma']
    },
    'Bundesliga': {
        keywords: ['bundesliga', 'bayern munich', 'borussia dortmund']
    },
    'Ligue 1': {
        keywords: ['ligue 1', 'psg', 'paris saint germain', 'marseille']
    },
    'Liga Indonesia': {
        keywords: ['liga 1', 'persija', 'persib', 'arema', 'timnas indonesia', 'pssi']
    },
    'Transfer Pemain': {
        keywords: ['transfer', 'resmi', 'gabung', 'pindah', 'rekrut', 'datangkan']
    },
    'Hasil Pertandingan': {
        keywords: ['hasil', 'skor', 'menang', 'kalah', 'imbang']
    },
    'Jadwal Pertandingan': {
        keywords: ['jadwal', 'schedule', 'match']
    },
    'Cedera Pemain': {
        keywords: ['cedera', 'injury', 'absensi']
    },
    'Berita Klub': {
        keywords: ['kabar klub', 'berita klub', 'official']
    }
};

// ============ KATA KUNCI DILARANG ============
const FORBIDDEN_KEYWORDS = [
    'iklan', 'promo', 'bonus', 'deposit', 'withdraw', 'slot', 'casino', 
    'poker', 'togel', 'livechat', 'login', 'daftar', 'agen bola'
];

// ============ SUMBER WEBSITE BERITA BOLA ============
const NEWS_SOURCES = [
    { name: 'Bola.net - Terbaru', url: 'https://www.bola.net/', category: 'Berita Bola' },
    { name: 'Bola.net - Liga Inggris', url: 'https://www.bola.net/inggris/', category: 'Liga Inggris' },
    { name: 'Bola.net - Liga Champions', url: 'https://www.bola.net/champions/', category: 'Liga Champions' },
    { name: 'Bola.net - Spanyol', url: 'https://www.bola.net/spanyol/', category: 'Liga Spanyol' },
    { name: 'Bola.net - Italia', url: 'https://www.bola.net/italia/', category: 'Liga Italia' },
    { name: 'Bola.net - Indonesia', url: 'https://www.bola.net/indonesia/', category: 'Liga Indonesia' },
    { name: 'Goal.com Indonesia', url: 'https://www.goal.com/id/berita', category: 'Berita Bola' }
];

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static('uploads'));
app.use(express.static(__dirname));

// ============ PROTECT ADMIN PAGE ============
app.use('/admin.html', (req, res, next) => {
    const token = req.cookies?.adminToken || req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.redirect('/login.html');
    }
    
    try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [username, timestamp, secretKey] = decoded.split(':');
        
        if (username === ADMIN_USERNAME && secretKey === ADMIN_SECRET_KEY) {
            const loginTime = parseInt(timestamp);
            const hoursSinceLogin = (Date.now() - loginTime) / (1000 * 60 * 60);
            
            if (hoursSinceLogin < 24) {
                return next();
            }
        }
        
        res.redirect('/login.html');
    } catch (error) {
        res.redirect('/login.html');
    }
});

// ============ API ADMIN LOGIN ============
app.post('/api/admin/login', async (req, res) => {
    const { username, password, secretKey } = req.body;
    
    if (secretKey !== ADMIN_SECRET_KEY) {
        return res.status(401).json({ success: false, message: 'Secret Key salah!' });
    }
    
    db.get('SELECT * FROM admin WHERE username = ?', [username], async (err, user) => {
        if (err || !user) {
            return res.json({ success: false, message: 'Username atau password salah!' });
        }
        
        const valid = await bcrypt.compare(password, user.password);
        if (valid) {
            const sessionToken = Buffer.from(`${username}:${Date.now()}:${ADMIN_SECRET_KEY}`).toString('base64');
            res.json({ success: true, token: sessionToken });
        } else {
            res.json({ success: false, message: 'Username atau password salah!' });
        }
    });
});

// ============ VERIFY TOKEN ============
app.get('/api/admin/verify', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.json({ valid: false });
    }
    
    try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [username, timestamp, secretKey] = decoded.split(':');
        
        if (username === ADMIN_USERNAME && secretKey === ADMIN_SECRET_KEY) {
            const hoursSinceLogin = (Date.now() - parseInt(timestamp)) / (1000 * 60 * 60);
            if (hoursSinceLogin < 24) {
                return res.json({ valid: true });
            }
        }
        res.json({ valid: false });
    } catch (error) {
        res.json({ valid: false });
    }
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

// ============ FILTER BERITA (LEBIH LONGGA) ============
function isValidFootballNews(title) {
    const titleLower = title.toLowerCase();
    
    // Cek kata terlarang
    for (const forbidden of FORBIDDEN_KEYWORDS) {
        if (titleLower.includes(forbidden)) {
            return false;
        }
    }
    
    // Minimal harus mengandung kata kunci sepakbola
    const footballKeywords = [
        'sepakbola', 'bola', 'liga', 'piala', 'champions', 'premier', 'serie', 
        'bundesliga', 'ligue', 'persija', 'persib', 'timnas', 'madrid', 
        'barcelona', 'manchester', 'liverpool', 'juventus', 'inter', 'milan', 
        'psg', 'bayern', 'transfer', 'resmi', 'gabung', 'hasil', 'skor', 
        'menang', 'kalah', 'jadwal', 'cedera', 'pelatih'
    ];
    
    for (const keyword of footballKeywords) {
        if (titleLower.includes(keyword)) {
            return true;
        }
    }
    
    return false;
}

// ============ DETEKSI KATEGORI ============
function detectCategory(title) {
    const titleLower = title.toLowerCase();
    
    for (const [category, config] of Object.entries(FOOTBALL_CATEGORIES)) {
        for (const keyword of config.keywords) {
            if (titleLower.includes(keyword)) {
                return category;
            }
        }
    }
    return 'Berita Bola';
}

// ============ CEK DUPLIKAT ============
async function isDuplicate(title) {
    return new Promise((resolve) => {
        const cleanTitle = title.toLowerCase().replace(/[^\w\s]/gi, '').substring(0, 80);
        
        db.get(
            `SELECT id FROM news WHERE LOWER(REPLACE(REPLACE(title, '?', ''), '!', '')) LIKE ?`,
            [`%${cleanTitle}%`],
            (err, row) => {
                resolve(!!row);
            }
        );
    });
}

// ============ CLEAN CONTENT ============
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

// ============ DOWNLOAD GAMBAR ============
async function downloadImage(imageUrl, retryCount = 0) {
    if (!imageUrl || !imageUrl.startsWith('http')) return null;
    
    if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads', { recursive: true });
    }
    
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    ];
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    
    try {
        let cleanUrl = imageUrl.split('?')[0];
        cleanUrl = cleanUrl.split('#')[0];
        cleanUrl = cleanUrl.replace(/[<>"']/g, '');
        
        if (cleanUrl.includes('placeholder') || cleanUrl.includes('default') || cleanUrl.includes('no-image')) {
            return null;
        }
        
        const response = await axios.get(cleanUrl, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': randomUA,
                'Accept': 'image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
                'Referer': 'https://www.google.com/'
            },
            maxRedirects: 5
        });
        
        const fileSize = response.data ? response.data.length : 0;
        
        if (fileSize < 10240) {
            if (retryCount < 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return downloadImage(imageUrl, retryCount + 1);
            }
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
        
        if (fs.existsSync(filepath) && fs.statSync(filepath).size >= 10240) {
            console.log(`      ✅ Gambar OK (${(fileSize / 1024).toFixed(0)}KB)`);
            return filename;
        }
        
        return null;
        
    } catch (error) {
        if (retryCount < 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return downloadImage(imageUrl, retryCount + 1);
        }
        return null;
    }
}

// ============ AMBIL GAMBAR DARI LINK ARTIKEL ============
async function extractImageFromArticle(url) {
    if (!url) return null;
    
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        
        const selectors = [
            'meta[property="og:image"]', 'meta[name="twitter:image"]',
            'article img', '.article-content img', '.post-content img',
            '.entry-content img', '.detail-text img', '.content img'
        ];
        
        for (const selector of selectors) {
            let imgSrc = null;
            if (selector.startsWith('meta')) {
                imgSrc = $(selector).attr('content');
            } else {
                const img = $(selector).first();
                if (img.length) {
                    imgSrc = img.attr('src') || img.attr('data-src');
                }
            }
            
            if (imgSrc && imgSrc.startsWith('http') && !imgSrc.includes('placeholder') && !imgSrc.includes('default')) {
                return imgSrc.split('?')[0];
            }
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

// ============ SCRAPING BERITA ============
async function scrapeNews() {
    const allArticles = [];
    
    for (const source of NEWS_SOURCES) {
        try {
            console.log(`  🔍 ${source.name}...`);
            
            const response = await axios.get(source.url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                }
            });
            
            const $ = cheerio.load(response.data);
            let articlesCount = 0;
            
            $('a').each((i, elem) => {
                const href = $(elem).attr('href');
                const text = $(elem).text().trim();
                
                if (href && text && text.length > 25 && text.length < 200) {
                    let fullUrl = href;
                    if (!fullUrl.startsWith('http')) {
                        try {
                            const urlObj = new URL(fullUrl, source.url);
                            fullUrl = urlObj.href;
                        } catch(e) { return; }
                    }
                    
                    if (fullUrl && isValidFootballNews(text) && 
                        !fullUrl.includes('tag/') && !fullUrl.includes('/indeks') && 
                        !fullUrl.includes('login') && !fullUrl.includes('register')) {
                        
                        let imageUrl = null;
                        const parent = $(elem).closest('article, .article, .post, .item, .list-item');
                        if (parent.length) {
                            const img = parent.find('img').first();
                            if (img.length) {
                                imageUrl = img.attr('src') || img.attr('data-src');
                                if (imageUrl && !imageUrl.startsWith('http')) {
                                    try {
                                        const imgUrlObj = new URL(imageUrl, source.url);
                                        imageUrl = imgUrlObj.href;
                                    } catch(e) {}
                                }
                            }
                        }
                        
                        if (!imageUrl) {
                            const img = $(elem).find('img').first();
                            if (img.length) {
                                imageUrl = img.attr('src') || img.attr('data-src');
                                if (imageUrl && !imageUrl.startsWith('http')) {
                                    try {
                                        const imgUrlObj = new URL(imageUrl, source.url);
                                        imageUrl = imgUrlObj.href;
                                    } catch(e) {}
                                }
                            }
                        }
                        
                        const category = detectCategory(text);
                        
                        allArticles.push({
                            title: fixTitle(text),
                            link: fullUrl,
                            image: imageUrl,
                            source: source.name,
                            category: category,
                            published_at: new Date().toISOString()
                        });
                        articlesCount++;
                    }
                }
            });
            
            console.log(`    ✅ ${articlesCount} berita`);
            await sleep(500);
            
        } catch (error) {
            console.log(`    ⚠️ Gagal: ${error.message}`);
        }
    }
    
    return allArticles;
}

// ============ GOOGLE NEWS SCRAPING ============
async function scrapeGoogleNews() {
    const queries = [
        'sepakbola+terbaru', 'transfer+pemain', 'hasil+pertandingan',
        'liga+inggris', 'liga+spanyol', 'liga+italia'
    ];
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
                    articles.push({
                        title: fixTitle(title),
                        link: link,
                        image: null,
                        source: 'Google News',
                        category: detectCategory(title),
                        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
                    });
                }
            });
            await sleep(300);
        } catch (error) {}
    }
    
    return articles;
}

// ============ AMBIL KONTEN ARTIKEL ============
async function scrapeArticleContent(url) {
    if (!url) return null;
    
    try {
        const response = await axios.get(url, {
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        
        $('script, style, iframe, .ad, .ads, .social-share, .comment, nav, header, footer, .sidebar').remove();
        
        let content = '';
        const selectors = [
            'article', '.article-content', '.post-content', '.entry-content',
            '.detail-text', '.article-body', '.content-detail', '.story__content',
            '.news-content', '#content', 'main'
        ];
        
        for (const selector of selectors) {
            const element = $(selector);
            if (element.length) {
                let text = element.text().trim();
                if (text.length > 200) {
                    content = text;
                    break;
                }
            }
        }
        
        if (!content) {
            const paragraphs = [];
            $('p').each((i, p) => {
                const text = $(p).text().trim();
                if (text.length > 50 && !text.includes('Cookie') && !text.includes('Privacy')) {
                    paragraphs.push(text);
                }
            });
            content = paragraphs.join(' ');
        }
        
        content = cleanContent(content);
        
        if (content.length > 600) {
            const sentences = content.split(/[.!?]+/);
            let short = '';
            let count = 0;
            for (const sentence of sentences) {
                const cleanSentence = sentence.trim();
                if (cleanSentence.length > 30 && count < 4) {
                    short += cleanSentence + '. ';
                    count++;
                }
            }
            content = short.length > 100 ? short : content.substring(0, 600);
        }
        
        return content.length > 200 ? content : null;
    } catch (error) {
        return null;
    }
}

// ============ FIX TITLE ============
function fixTitle(title) {
    if (!title) return 'Berita Sepakbola Terbaru';
    
    let fixed = title;
    fixed = fixed.replace(/^[^a-zA-Z0-9\s]+/, '');
    fixed = fixed.replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
    fixed = fixed.replace(/[!?]+$/, '');
    fixed = fixed.replace(/\s+/g, ' ').trim();
    
    if (fixed.length > 0) {
        fixed = fixed.charAt(0).toUpperCase() + fixed.slice(1);
    }
    
    return fixed.substring(0, 120) || 'Berita Sepakbola Terbaru';
}

// ============ BUAT DESKRIPSI ============
function createDescription(title, originalContent, category) {
    const titleClean = title.replace(/[!?]+$/, '');
    
    let opening = `${titleClean}\n\n`;
    
    let main = originalContent || '';
    main = main.replace(/Diperbarui.*?WIB/gi, '');
    main = main.replace(/Diterbitkan.*?WIB/gi, '');
    main = main.trim();
    
    if (!main || main.length < 100) {
        main = `Berita terbaru dari dunia sepakbola. ${titleClean} menjadi sorotan utama. Simak update selengkapnya hanya di ABAD4D SPORT.`;
    }
    
    const closing = `\n\nIkuti terus ABAD4D SPORT untuk berita sepakbola terupdate. #ABAD4DSPORT #BeritaBola #${category.replace(/ /g, '')}`;
    
    let final = opening + main + closing;
    final = final.replace(/\s+/g, ' ');
    
    return final.substring(0, 2000);
}

// ============ UPDATE BERITA ============
let isUpdating = false;
let lastPostTime = 0;
const POST_INTERVAL_MS = 14 * 60 * 1000;

async function updateNews() {
    const now = getWIB();
    const nowMs = Date.now();
    
    if (nowMs - lastPostTime < POST_INTERVAL_MS && lastPostTime > 0) {
        const remaining = Math.round((POST_INTERVAL_MS - (nowMs - lastPostTime)) / 1000);
        console.log(`\n⏳ ${now} WIB - Post berikutnya: ${Math.floor(remaining / 60)}m ${remaining % 60}s lagi`);
        return;
    }
    
    if (isUpdating) {
        console.log(`\n⏳ ${now} WIB - Update sedang berjalan...`);
        return;
    }
    
    isUpdating = true;
    
    console.log('\n' + '='.repeat(60));
    console.log(`⚽ ${now} WIB - MENCARI BERITA BARU`);
    console.log('='.repeat(60));
    
    let allArticles = [];
    
    console.log('\n📡 SCRAPING BERITA...');
    const [webArticles, googleArticles] = await Promise.all([
        scrapeNews(),
        scrapeGoogleNews()
    ]);
    
    console.log(`\n  📰 Website: ${webArticles.length} berita`);
    console.log(`  📰 Google News: ${googleArticles.length} berita`);
    allArticles.push(...webArticles, ...googleArticles);
    
    // Filter unik
    const unique = [];
    const seen = new Set();
    for (const article of allArticles) {
        const key = article.title.substring(0, 80).toLowerCase().replace(/[^\w\s]/gi, '');
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(article);
        }
    }
    
    console.log(`\n📊 TOTAL BERITA UNIK: ${unique.length}`);
    unique.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    
    let posted = false;
    let checkedCount = 0;
    
    for (const article of unique) {
        if (posted) break;
        checkedCount++;
        
        const category = detectCategory(article.title);
        
        // Cek duplikat di database
        const isDuplicateNews = await isDuplicate(article.title);
        
        if (isDuplicateNews) {
            console.log(`  ⏭️ [DUPLIKAT] ${article.title.substring(0, 50)}...`);
            continue;
        }
        
        console.log(`\n  📌 [${category}] ${article.title.substring(0, 55)}...`);
        
        let content = null;
        if (article.link) {
            console.log(`      🔗 Mengambil konten...`);
            content = await scrapeArticleContent(article.link);
            await sleep(300);
        }
        
        let imageFile = null;
        
        if (article.image) {
            imageFile = await downloadImage(article.image);
        }
        
        if (!imageFile && article.link) {
            console.log(`      🔍 Cari gambar alternatif...`);
            const fallbackImage = await extractImageFromArticle(article.link);
            if (fallbackImage) {
                imageFile = await downloadImage(fallbackImage);
            }
        }
        
        if (!imageFile) {
            console.log(`      ❌ GAGAL gambar - cari berita lain`);
            continue;
        }
        
        const finalContent = createDescription(article.title, content, category);
        
        await new Promise((resolve) => {
            db.run(
                `INSERT INTO news (title, content, image, category, status, published_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    article.title.substring(0, 200),
                    finalContent,
                    imageFile,
                    category,
                    'published',
                    article.published_at
                ],
                (err) => {
                    if (err) {
                        console.log(`      ❌ Gagal simpan: ${err.message}`);
                    } else {
                        posted = true;
                        lastPostTime = Date.now();
                        console.log(`      ✅ BERITA BERHASIL DIPOSTING!`);
                        console.log(`      📅 Next post: 14 menit lagi`);
                        backupDatabase();
                    }
                    resolve();
                }
            );
        });
        
        await sleep(500);
    }
    
    if (!posted) {
        console.log(`\n⚠️ TIDAK ADA BERITA BARU!`);
        console.log(`   📊 Total dicek: ${checkedCount} berita`);
        console.log(`   💾 Total di database: ${await getTotalNews()}`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`✅ UPDATE SELESAI!`);
    console.log(`   📰 Status: ${posted ? 'BERHASIL POSTING' : 'TIDAK ADA BERITA'}`);
    console.log('='.repeat(60) + '\n');
    
    isUpdating = false;
}

async function getTotalNews() {
    return new Promise((resolve) => {
        db.get('SELECT COUNT(*) as count FROM news', (err, row) => {
            resolve(row ? row.count : 0);
        });
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getWIB() {
    return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ============ SETUP DATABASE & STORAGE ============
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads', { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, 'uploads/'); },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
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

// Restore database
setTimeout(() => {
    restoreDatabase();
}, 1000);

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
    if (!title || !content || !image) {
        return res.status(400).json({ message: 'Judul, isi, dan gambar harus diisi!' });
    }
    db.run('INSERT INTO news (title, content, image, category, status, published_at) VALUES (?, ?, ?, ?, ?, ?)',
        [fixTitle(title), content, image, category || 'Berita Bola', status || 'published', new Date().toISOString()],
        function(err) {
            if (err) {
                res.status(500).json({ message: 'Gagal menyimpan' });
            } else {
                backupDatabase();
                res.json({ message: 'Berita ditambahkan!', id: this.lastID });
            }
        });
});

app.put('/api/news/:id', upload.single('image'), (req, res) => {
    const { title, content, category, status } = req.body;
    const id = req.params.id;
    if (req.file) {
        db.run('UPDATE news SET title = ?, content = ?, image = ?, category = ?, status = ? WHERE id = ?',
            [fixTitle(title), content, req.file.filename, category, status, id], (err) => {
                if (err) res.status(500).json({ message: 'Gagal update' });
                else {
                    backupDatabase();
                    res.json({ message: 'Berita diupdate!' });
                }
            });
    } else {
        db.run('UPDATE news SET title = ?, content = ?, category = ?, status = ? WHERE id = ?',
            [fixTitle(title), content, category, status, id], (err) => {
                if (err) res.status(500).json({ message: 'Gagal update' });
                else {
                    backupDatabase();
                    res.json({ message: 'Berita diupdate!' });
                }
            });
    }
});

app.delete('/api/news/:id', (req, res) => {
    db.run('DELETE FROM news WHERE id = ?', [req.params.id], function(err) {
        if (err) res.status(500).json({ message: 'Gagal hapus' });
        else {
            backupDatabase();
            res.json({ message: 'Berita dihapus!' });
        }
    });
});

app.post('/api/fetch-news', async (req, res) => {
    await updateNews();
    res.json({ message: 'Update berita sepakbola selesai!' });
});

// ============ ROUTE UNTUK HALAMAN STATIS ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('*.html', (req, res) => {
    const filePath = path.join(__dirname, req.path);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('File not found');
    }
});

// ============ JALANKAN SERVER ============
app.listen(PORT, async () => {
    console.log(`\n⚽⚽⚽ ABAD4D SPORT - BOT BERITA SEPAKBOLA ⚽⚽⚽`);
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`🔑 Admin: admin / admin123`);
    console.log(`🔐 Secret Key: ${ADMIN_SECRET_KEY}`);
    console.log(`📡 SUMBER: Bola.net, Goal.com, Google News`);
    console.log(`⏰ UPDATE: Setiap 14 menit (1 postingan)`);
    console.log(`💾 BACKUP: Otomatis setiap post\n`);
    
    await restoreDatabase();
    const totalNews = await getTotalNews();
    console.log(`📊 TOTAL BERITA DI DATABASE: ${totalNews}\n`);
    
    console.log('📰 Memulai pencarian berita...\n');
    await updateNews();
    
    setInterval(async () => {
        await updateNews();
    }, 60 * 1000);
    
    setInterval(() => {
        backupDatabase();
    }, 60 * 60 * 1000);
    
    console.log('⏰ Timer aktif: Pengecekan setiap 1 menit\n');
});
