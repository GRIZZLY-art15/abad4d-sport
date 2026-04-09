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
        keywords: ['premier league', 'liga inggris', 'manchester united', 'liverpool', 'arsenal', 'chelsea', 'manchester city', 'tottenham']
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
        keywords: ['transfer', 'resmi', 'gabung', 'pindah', 'rekrut', 'datangkan', 'perpanjang kontrak', 'kontrak baru']
    },
    'Hasil Pertandingan': {
        keywords: ['hasil', 'skor', 'menang', 'kalah', 'imbang', 'laga', 'big match']
    },
    'Jadwal Pertandingan': {
        keywords: ['jadwal', 'schedule', 'match', 'pertandingan']
    },
    'Cedera Pemain': {
        keywords: ['cedera', 'injury', 'absensi', 'pemain cedera']
    },
    'Berita Klub': {
        keywords: ['kabar klub', 'berita klub', 'official', 'resmi klub']
    }
};

// ============ KATA KUNCI DILARANG (BERITA LAMA) ============
const FORBIDDEN_KEYWORDS = [
    '2022', '2021', '2020', '2019', '2018', '2017', '2016', '2015',
    'qatar 2022', 'piala dunia 2022', 'world cup 2022', 'russia 2018',
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

// ============ FILTER BERITA TERBARU (HANYA 3 HARI) ============
function isRecentFootballNews(title, publishedAt) {
    const titleLower = title.toLowerCase();
    
    for (const forbidden of FORBIDDEN_KEYWORDS) {
        if (titleLower.includes(forbidden)) {
            return false;
        }
    }
    
    const footballKeywords = [
        'sepakbola', 'bola', 'liga', 'piala', 'champions', 'premier', 'serie', 
        'bundesliga', 'ligue', 'persija', 'persib', 'timnas', 'madrid', 
        'barcelona', 'manchester', 'liverpool', 'juventus', 'inter', 'milan', 
        'psg', 'bayern', 'transfer', 'resmi', 'gabung', 'hasil', 'skor', 
        'menang', 'kalah', 'jadwal', 'cedera', 'pelatih', 'klub'
    ];
    
    let isFootball = false;
    for (const keyword of footballKeywords) {
        if (titleLower.includes(keyword)) {
            isFootball = true;
            break;
        }
    }
    
    if (!isFootball) return false;
    
    if (publishedAt) {
        const newsDate = new Date(publishedAt);
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        
        if (newsDate < threeDaysAgo) return false;
    }
    
    return true;
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
async function isDuplicate(title, link) {
    return new Promise((resolve) => {
        const cleanTitle = title.toLowerCase().replace(/[^\w\s]/gi, '').substring(0, 80);
        
        db.get(
            `SELECT id FROM news WHERE 
                (LOWER(REPLACE(REPLACE(title, '?', ''), '!', '')) LIKE ?) OR 
                (published_at > datetime('now', '-24 hours'))`,
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
        /Bagikan:.*?(?=\.|$)/gi, /url telah tercopy/gi, /Add as a preferred source on Google/gi,
        /Komentar/gi, /Tulis Komentar/gi, /Rekomendasi/gi, /Share this article/gi,
        /Follow us on/gi, /Subscribe to/gi, /Click here/gi, /Read more/gi,
        /Selengkapnya di/gi, /Baca selengkapnya/gi, /Lihat Juga:.*?(?=\.|$)/gi,
        /VIDEO:.*?(?=\.|$)/gi, /FOTO:.*?(?=\.|$)/gi, /GALERI:.*?(?=\.|$)/gi,
        /BERITA TERKAIT:.*?(?=\.|$)/gi, /TAG:.*?(?=\.|$)/gi,
        /Jakarta, CNN Indonesia --/gi, /CNN Indonesia --/gi, /Kompas.com -/gi,
        /Liputan6.com -/gi, /Goal.com -/gi, /Bola.net -/gi,
        /Dilansir dari/gi, /Melansir/gi, /Mengutip/gi, /ADVERTISEMENT/gi,
        /BERITA LAINNYA/gi, /TERPOPULER/gi, /TERKINI/gi,
        /[\d]+ Jam yang lalu/gi, /[\d]+ Menit yang lalu/gi, /[\d]+ Hari yang lalu/gi,
        /Diterbitkan:.*?(?=\.|$)/gi, /Diperbarui:.*?(?=\.|$)/gi,
        /Published:.*?(?=\.|$)/gi, /Updated:.*?(?=\.|$)/gi, /Tanggal:.*?(?=\.|$)/gi,
        /Rabu|Kamis|Jumat|Sabtu|Minggu|Senin|Selasa,\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}/gi,
        /\d{1,2}\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}/gi
    ];
    
    for (const pattern of patterns) {
        clean = clean.replace(pattern, '');
    }
    
    clean = clean.replace(/https?:\/\/[^\s]+/gi, '');
    clean = clean.replace(/\s+/g, ' ');
    clean = clean.trim();
    clean = clean.replace(/^\d+[^a-zA-Z]*\s*/, '');
    
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
            const processedLinks = new Set();
            
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
                    
                    if (processedLinks.has(fullUrl)) return;
                    processedLinks.add(fullUrl);
                    
                    const isValid = isRecentFootballNews(text, new Date().toISOString());
                    
                    if (fullUrl && isValid && !fullUrl.includes('tag/') && !fullUrl.includes('/indeks') && 
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
            
            console.log(`    ✅ ${articlesCount} berita terbaru`);
            await sleep(800);
            
        } catch (error) {
            console.log(`    ⚠️ Gagal: ${error.message}`);
        }
    }
    
    return allArticles;
}

// ============ GOOGLE NEWS SCRAPING ============
async function scrapeGoogleNews() {
    const queries = [
        'sepakbola+terbaru', 'transfer+pemain+terbaru', 'hasil+pertandingan+sepakbola',
        'liga+inggris+terbaru', 'liga+spanyol+terbaru', 'liga+italia+terbaru',
        'champions+league+terbaru', 'bundesliga+terbaru', 'ligue+1+terbaru'
    ];
    const articles = [];
    
    for (const query of queries) {
        try {
            const url = `https://news.google.com/rss/search?q=${query}&hl=id&gl=ID&ceid=ID:id`;
            const response = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(response.data, { xmlMode: true });
            
            $('item').each((i, item) => {
                if (i >= 4) return;
                const title = $(item).find('title').text();
                const link = $(item).find('link').text();
                let pubDate = $(item).find('pubDate').text();
                
                if (title && title.length > 25 && link) {
                    const isValid = isRecentFootballNews(title, pubDate);
                    
                    if (isValid) {
                        articles.push({
                            title: fixTitle(title),
                            link: link,
                            image: null,
                            source: 'Google News',
                            category: detectCategory(title),
                            published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
                        });
                    }
                }
            });
            await sleep(500);
        } catch (error) {}
    }
    
    return articles;
}

// ============ AMBIL KONTEN ARTIKEL ============
async function scrapeArticleContent(url) {
    if (!url) return null;
    
    try {
        const response = await axios.get(url, {
            timeout: 10000,
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

// ============ BUAT DESKRIPSI PANJANG (1000+ KATA) ============
function createDescription(title, originalContent, category) {
    const titleClean = title.replace(/[!?]+$/, '');
    
    const openingPhrases = [
        `⚽ ${titleClean}\n\nKabar terbaru dari dunia sepakbola datang hari ini. `,
        `📰 ${titleClean}\n\nBreaking news! `,
        `🔥 ${titleClean}\n\nInformasi hangat terbaru, `,
        `🏆 ${titleClean}\n\nKabar mengejutkan datang dari `,
    ];
    const randomOpening = openingPhrases[Math.floor(Math.random() * openingPhrases.length)];
    
    let main = originalContent || '';
    main = main.replace(/Diperbarui.*?WIB/gi, '');
    main = main.replace(/Diterbitkan.*?WIB/gi, '');
    main = main.replace(/Updated.*?\./gi, '');
    main = main.replace(/Published.*?\./gi, '');
    main = main.trim();
    
    // KONTEN PANJANG PER KATEGORI
    let longContent = '';
    
    switch(category) {
        case 'Piala Dunia 2026':
            longContent = `Piala Dunia 2026 akan menjadi edisi bersejarah dalam dunia sepakbola. Turnamen ini akan digelar di tiga negara: Amerika Serikat, Meksiko, dan Kanada. Ini adalah pertama kalinya dalam sejarah Piala Dunia diselenggarakan oleh tiga negara sekaligus. Keputusan FIFA untuk memperluas format menjadi 48 tim juga akan diterapkan untuk pertama kalinya, menjanjikan persaingan yang lebih seru dan tidak terduga.\n\n` +
            `Sebanyak 48 negara akan dibagi ke dalam 16 grup yang masing-masing terdiri dari 3 tim. Dua tim teratas dari setiap grup akan lolos ke babak 32 besar. Format baru ini memberikan peluang lebih besar bagi tim-tim underdog untuk menciptakan kejutan. Beberapa grup disebut-sebut sebagai "grup neraka" karena dihuni oleh tim-tim kuat. Persaingan di setiap grup diprediksi akan berlangsung sengit hingga pertandingan terakhir.\n\n` +
            `Jadwal pertandingan Piala Dunia 2026 akan berlangsung dari 12 Juni hingga 12 Juli 2026. Pertandingan pembukaan akan digelar di Stadion Azteca, Meksiko City, yang merupakan stadion legendaris dengan kapasitas lebih dari 87.000 penonton. Stadion ini telah menjadi saksi berbagai momen bersejarah, termasuk final Piala Dunia 1970 dan 1986.\n\n` +
            `Babak grup akan berlangsung dari 12 Juni hingga 28 Juni 2026. Selanjutnya babak 32 besar pada 29 Juni - 2 Juli 2026, babak 16 besar pada 3-6 Juli 2026, perempat final pada 7-8 Juli 2026, semi final pada 11 Juli 2026, dan grand final pada 12 Juli 2026.\n\n` +
            `Stadion final Piala Dunia 2026 akan digelar di MetLife Stadium, New Jersey, Amerika Serikat. Stadion ini memiliki kapasitas lebih dari 82.500 penonton dan telah direnovasi untuk menyambut partai puncak. Stadion ini adalah markas dari dua tim NFL, New York Giants dan New York Jets.\n\n` +
            `Beberapa stadion lain yang akan digunakan antara lain SoFi Stadium (Los Angeles) yang berkapasitas 70.000 penonton, AT&T Stadium (Dallas) dengan kapasitas 80.000, Hard Rock Stadium (Miami) kapasitas 65.000, Mercedes-Benz Stadium (Atlanta) kapasitas 71.000, dan Levi's Stadium (San Francisco) kapasitas 68.500.\n\n` +
            `Tim-tim unggulan yang diprediksi menjadi kandidat juara antara lain Brasil (5 gelar), Argentina (juara bertahan), Prancis (2 gelar), Jerman (4 gelar), Spanyol (1 gelar), dan Inggris (1 gelar). Namun kejutan selalu mungkin terjadi di Piala Dunia, seperti yang terjadi pada edisi 2018 ketika Prancis keluar sebagai juara dan 2022 ketika Argentina mengangkat trofi.\n\n` +
            `Para bintang dunia seperti Kylian Mbappe (Prancis), Erling Haaland (Norwegia), Jude Bellingham (Inggris), Vinicius Jr (Brasil), Jamal Musiala (Jerman), dan Pedri (Spanyol) diprediksi akan menjadi pusat perhatian. Persaingan merebut Golden Boot (sepatu emas) diprediksi sangat ketat di antara para penyerang top dunia.\n\n` +
            `Piala Dunia 2026 diprediksi akan menjadi turnamen paling seru dalam sejarah dengan persaingan yang lebih ketat. Format baru dengan 48 tim menjanjikan kejutan-kejutan menarik. Tim-tim underdog seperti Maroko (yang mencapai semi final 2022), Kroasia, dan Belgia juga berpotensi menciptakan kejutan.\n\n` +
            `Dari sisi penyelenggaraan, Piala Dunia 2026 akan menggunakan teknologi VAR (Video Assistant Referee) yang lebih canggih. Semi-automated offside technology juga akan digunakan untuk mempercepat pengambilan keputusan wasit. Teknologi goal-line detection akan dipasang di semua stadion.\n\n` +
            `Tiket Piala Dunia 2026 sudah mulai dipesan oleh jutaan penggemar dari seluruh dunia. Harga tiket bervariasi mulai dari $100 untuk babak grup hingga $2.000 untuk partai final. Paket hospitality dan akomodasi juga tersedia bagi yang ingin menikmati pengalaman premium.\n\n` +
            `FIFA memperkirakan lebih dari 5 juta penonton akan hadir langsung di stadion selama turnamen berlangsung. Selain itu, miliaran pasang mata di seluruh dunia akan menyaksikan melalui siaran televisi dan streaming online. Piala Dunia 2026 diprediksi akan menjadi event olahraga paling banyak ditonton dalam sejarah.\n\n`;
            break;
            
        case 'Transfer Pemain':
            longContent = `Bursa transfer pemain selalu menjadi momen yang paling dinanti oleh para penggemar sepakbola di seluruh dunia. Setiap musim, klub-klub besar berlomba-lomba mendatangkan pemain bintang untuk memperkuat skuat mereka. Nilai transfer yang mencapai miliaran euro menunjukkan betapa berharganya seorang pemain bintang di era modern ini.\n\n` +
            `Proses transfer pemain melibatkan negosiasi rumit antara klub, agen pemain, dan pemain itu sendiri. Faktor-faktor seperti gaji, bonus, durasi kontrak, serta visi klub menjadi pertimbangan utama. Tidak jarang proses negosiasi berlangsung berbulan-bulan sebelum akhirnya mencapai kesepakatan.\n\n` +
            `Agen pemain memegang peranan penting dalam proses transfer. Agen-agen top seperti Jorge Mendes, Mino Raiola (almarhum), dan Jonathan Barnett dikenal sangat berpengaruh dalam dunia sepakbola. Mereka mampu memindahkan pemain binaan mereka ke klub-klub besar dengan nilai transfer yang fantastis.\n\n` +
            `Klub-klub besar Eropa seperti Real Madrid, Barcelona, Manchester City, Paris Saint-Germain, dan Bayern Munich selalu menjadi pusat perhatian setiap bursa transfer. Mereka memiliki daya tarik dan kekuatan finansial untuk mendatangkan pemain-pemain terbaik dunia. Persaingan untuk mendapatkan signature pemain bintang sangat ketat.\n\n` +
            `Beberapa transfer termahal dalam sejarah sepakbola antara lain Neymar ke PSG (222 juta euro), Kylian Mbappe ke PSG (180 juta euro), Philippe Coutinho ke Barcelona (135 juta euro), Joao Felix ke Atletico Madrid (126 juta euro), dan Enzo Fernandez ke Chelsea (121 juta euro).\n\n` +
            `Bursa transfer tidak hanya tentang pemain mahal. Klub-klub kecil juga berburu pemain-pemain pinjaman atau pemain bebas transfer untuk memperkuat tim. Kesalahan dalam merekrut pemain bisa berakibat fatal, baik secara finansial maupun performa tim. Karena itu, direktur teknik dan tim scouting sangat penting.\n\n` +
            `Teknologi dan analisis data semakin berperan dalam proses transfer. Klub-klub modern menggunakan big data dan artificial intelligence untuk menganalisis performa pemain potensial. Statistik seperti expected goals (xG), persentase umpan sukses, dan jarak tempuh per pertandingan menjadi pertimbangan penting.\n\n` +
            `Bursa transfer musim panas biasanya berlangsung dari Juli hingga September, sementara bursa transfer musim dingin berlangsung di bulan Januari. Klub-klub biasanya lebih agresif di bursa transfer musim panas karena memiliki waktu lebih panjang untuk mengintegrasikan pemain baru.\n\n` +
            `Aturan Financial Fair Play (FFP) dari UEFA membatasi pengeluaran klub agar tidak melebihi pendapatan mereka. Klub yang melanggar bisa dikenakan sanksi seperti denda, larangan transfer, atau bahkan diskualifikasi dari kompetisi Eropa. Hal ini membuat klub harus lebih bijak dalam berbelanja.\n\n` +
            `Beberapa transfer terbesar yang dikabarkan akan terjadi di musim depan antara lain Kylian Mbappe yang kemungkinan pindah ke Real Madrid, Erling Haaland yang dikaitkan dengan Barcelona, dan Jude Bellingham yang menjadi target Liverpool dan Manchester City.\n\n` +
            `Agen-agen pemain terus bekerja di balik layar untuk mencari klub terbaik bagi klien mereka. Komisi agen bisa mencapai 10-15% dari nilai transfer, sehingga transfer pemain bintang bisa menghasilkan puluhan juta euro bagi sang agen.\n\n` +
            `Para penggemar tentu tidak sabar menantikan kejutan-kejutan di bursa transfer mendatang. Spekulasi dan rumor terus bermunculan di media sosial. Ikuti terus perkembangan bursa transfer hanya di ABAD4D SPORT.\n\n`;
            break;
            
        case 'Hasil Pertandingan':
            longContent = `Hasil pertandingan sepakbola selalu menyajikan drama dan ketegangan hingga menit akhir. Setiap laga memiliki cerita uniknya sendiri, mulai dari gol spektakuler, kartu merah kontroversial, hingga drama adu penalti. Sepakbola memang olahraga yang penuh dengan kejutan.\n\n` +
            `Dalam setiap pertandingan, faktor-faktor seperti kondisi fisik pemain, strategi pelatih, dukungan suporter, dan bahkan cuaca bisa mempengaruhi hasil akhir. Tim yang difavoritkan tidak selalu keluar sebagai pemenang. Inilah yang membuat sepakbola begitu menarik untuk diikuti.\n\n` +
            `Statistik pertandingan seperti penguasaan bola, jumlah tembakan, akurasi umpan, dan pelanggaran seringkali menjadi indikator performa tim. Namun, sepakbola tetaplah tentang siapa yang bisa mencetak gol lebih banyak. Sebuah tim bisa kalah meskipun mendominasi statistik.\n\n` +
            `Gol-gol spektakuler selalu menjadi sorotan utama. Tendangan jarak jauh, voli akrobatik, sundulan indah, atau eksekusi free kick yang mematikan selalu berhasil membuat penonton terpukau. Setiap pekannya, selalu ada gol yang layak dinobatkan sebagai "Gol of the Week".\n\n` +
            `Kartu merah juga sering menjadi titik balik dalam sebuah pertandingan. Sebuah tim bisa kehilangan momentum setelah salah satu pemainnya diusir wasit. Namun ada juga kasus di mana tim justru bermain lebih baik setelah kehilangan satu pemain.\n\n` +
            `Drama adu penalti selalu menjadi momen paling menegangkan dalam sepakbola. Hanya satu tendangan yang bisa menentukan apakah sebuah tim melangkah ke babak berikutnya atau pulang lebih awal. Mental dan saraf baja sangat dibutuhkan dalam situasi ini.\n\n` +
            `Suporter memiliki peran penting dalam menciptakan atmosfer pertandingan. Nyanyian, yel-yel, dan spanduk kreatif dari suporter menjadi pemandangan yang tidak terpisahkan dari sepakbola. Mereka adalah pemain ke-12 yang bisa memotivasi tim bermain lebih baik.\n\n` +
            `Hasil pertandingan juga berdampak besar pada klasemen. Poin demi poin sangat berharga dalam perebutan gelar juara, tiket kompetisi Eropa, atau perjuangan menghindari degradasi. Setiap pekan, posisi di klasemen bisa berubah drastis.\n\n` +
            `Simak skor akhir dan rekap pertandingan hanya di ABAD4D SPORT. Kami akan terus mengupdate setiap hasil pertandingan secara cepat dan akurat.\n\n`;
            break;
            
        case 'Jadwal Pertandingan':
            longContent = `Jadwal pertandingan sepakbola selalu dinantikan oleh para penggemar. Dari liga domestik hingga kompetisi Eropa, setiap pekannya selalu ada laga-laga menarik yang patut disaksikan. Mengetahui jadwal pertandingan membantu penggemar untuk tidak melewatkan aksi seru dari tim kesayangan mereka.\n\n` +
            `Premier League Inggris biasanya digelar pada akhir pekan, dengan beberapa pertandingan tambahan pada hari kerja. Laga big match seperti Manchester United vs Liverpool, Arsenal vs Chelsea, atau Manchester City vs Tottenham selalu menjadi primadona.\n\n` +
            `La Liga Spanyol juga memiliki jadwal yang padat dengan El Clasico (Real Madrid vs Barcelona) sebagai puncak acara. Derbi Madrid (Real Madrid vs Atletico Madrid) dan Derbi Sevilla (Sevilla vs Real Betis) juga tidak kalah seru.\n\n` +
            `Serie A Italia menyajikan Derby della Madonnina (Inter Milan vs AC Milan) dan Derby della Capitale (Roma vs Lazio) yang selalu penuh dengan drama dan intensitas tinggi.\n\n` +
            `Bundesliga Jerman memiliki Der Klassiker (Bayern Munich vs Borussia Dortmund) yang selalu menyajikan pertandingan terbuka dengan banyak gol. Revierderby (Borussia Dortmund vs Schalke 04) juga menjadi laga yang dinanti.\n\n` +
            `Ligue 1 Prancis menampilkan Le Classique (PSG vs Marseille) yang merupakan rivalitas terpanas di Prancis. Pertandingan ini sering diwarnai dengan kartu merah dan ketegangan.\n\n` +
            `Liga Champions UEFA digelar pada tengah pekan, dengan babak grup berlangsung dari September hingga Desember, dilanjutkan babak gugur mulai Februari hingga final di bulan Mei atau Juni.\n\n` +
            `Liga Europa dan Liga Conference juga memiliki jadwal yang hampir sama dengan Liga Champions, memberikan kesempatan bagi klub-klub dari liga-liga kecil untuk bersinar di pentas Eropa.\n\n` +
            `Jadwal pertandingan juga penting bagi penggemar yang ingin menonton langsung di stadion. Tiket biasanya dijual beberapa minggu sebelum pertandingan. Harga tiket bervariasi tergantung pada kelas dan popularitas pertandingan.\n\n` +
            `Catat tanggal-tanggal penting ini agar tidak ketinggalan aksi seru dari tim-tim favorit Anda!\n\n`;
            break;
            
        case 'Cedera Pemain':
            longContent = `Cedera adalah musuh terbesar bagi para pemain sepakbola. Cedera bisa terjadi kapan saja, baik saat latihan maupun pertandingan. Cedera serius seperti ACL (anterior cruciate ligament), patah tulang, atau cedera hamstring bisa memaksa pemain absen berbulan-bulan.\n\n` +
            `Proses pemulihan yang panjang dan melelahkan harus dijalani dengan disiplin dan kesabaran. Fisioterapis, dokter tim, dan pelatih kebugaran bekerja sama untuk mengembalikan kondisi pemain ke performa terbaiknya.\n\n` +
            `Pemain yang cedera biasanya akan menjalani serangkaian tes medis untuk menentukan tingkat keparahan cedera. MRI, CT scan, dan pemeriksaan fisik lainnya dilakukan untuk mendapatkan diagnosis yang akurat.\n\n` +
            `Setelah diagnosis ditegakkan, rencana pemulihan disusun, mulai dari istirahat total, latihan ringan, hingga latihan penuh. Pemain juga harus menjaga asupan nutrisi dan mental mereka selama masa pemulihan.\n\n` +
            `Dukungan dari keluarga, teman, dan suporter sangat berarti bagi pemain yang sedang cedera. Doa dan semangat dari mereka bisa menjadi motivasi tambahan untuk segera pulih.\n\n` +
            `Cedera pemain kunci bisa sangat mempengaruhi performa tim. Pelatih harus mencari alternatif strategi, merotasi pemain, atau bahkan mengubah formasi. Kedalaman skuat menjadi sangat penting dalam situasi seperti ini.\n\n` +
            `Manajemen beban pemain juga menjadi perhatian utama klub-klub modern. Dengan jadwal padat yang harus dijalani, rotasi pemain menjadi kunci untuk mencegah cedera akibat kelelahan.\n\n` +
            `Pencegahan cedera juga menjadi fokus utama. Latihan pemanasan yang tepat, pendinginan setelah pertandingan, dan program kebugaran khusus dirancang untuk meminimalisir risiko cedera.\n\n` +
            `Pemain juga diajarkan teknik jatuh yang aman dan cara menjaga tubuh agar tetap fit. Nutrisi yang baik dan istirahat yang cukup adalah kunci utama untuk mencegah cedera.\n\n` +
            `Beberapa cedera yang sering terjadi dalam sepakbola antara lain cedera hamstring, cedera pergelangan kaki, cedera lutut (ACL), cedera pangkal paha, dan patah tulang.\n\n` +
            `Tim medis modern menggunakan teknologi canggih seperti cryotherapy, hidroterapi, dan terapi gelombang kejut untuk mempercepat pemulihan pemain. Pemain juga sering menjalani rehabilitasi di fasilitas khusus.\n\n` +
            `Kabar cedera pemain selalu menjadi perhatian utama jelang pertandingan penting. Ikuti terus update kondisi pemain hanya di ABAD4D SPORT.\n\n`;
            break;
            
        case 'Berita Klub':
            longContent = `Berita seputar klub sepakbola selalu menarik untuk diikuti. Dari kebijakan manajemen, rencana transfer, hingga program pengembangan akademi, semua menjadi konsumsi harian para penggemar.\n\n` +
            `Klub-klub besar Eropa seperti Real Madrid, Barcelona, Manchester United, Liverpool, Bayern Munich, dan PSG memiliki basis penggemar yang sangat besar di seluruh dunia. Setiap keputusan yang diambil manajemen selalu menjadi sorotan.\n\n` +
            `Akademi klub memegang peranan penting dalam menghasilkan pemain-pemain berkualitas. La Masia milik Barcelona, La Fabrica milik Real Madrid, dan Ajax Academy terkenal sebagai akademi terbaik di dunia.\n\n` +
            `Klub-klub modern juga sangat memperhatikan aspek bisnis. Pendapatan dari hak siar televisi, penjualan merchandise, sponsor, dan tiket pertandingan menjadi sumber utama pemasukan.\n\n` +
            `Stadion menjadi kebanggaan setiap klub. Stadion-stadion megah seperti Camp Nou, Santiago Bernabeu, Old Trafford, Anfield, Allianz Arena, dan Signal Iduna Park menjadi tujuan ziarah para penggemar.\n\n` +
            `Museum klub juga menjadi daya tarik tersendiri. Trofi-trofi yang pernah diraih, memorabilia pemain legendaris, dan sejarah klub dipajang dengan apik untuk dikunjungi penggemar.\n\n` +
            `Program komunitas dan yayasan klub juga aktif melakukan kegiatan sosial. Mereka membantu masyarakat kurang mampu, menyediakan fasilitas olahraga untuk anak-anak, dan mempromosikan gaya hidup sehat.\n\n` +
            `Media sosial klub menjadi sarana interaksi dengan penggemar. Klub-klub besar memiliki jutaan pengikut di berbagai platform seperti Instagram, Twitter, Facebook, dan TikTok.\n\n` +
            `Kabar terbaru seputar klub kesayangan Anda hanya di ABAD4D SPORT. Dapatkan informasi akurat dan terpercaya.\n\n`;
            break;
            
        default:
            longContent = `Sepakbola adalah olahraga paling populer di dunia dengan lebih dari 3,5 miliar penggemar. Dari Liga Champions, Premier League, La Liga, Serie A, Bundesliga, Ligue 1, hingga Liga Indonesia, semuanya menyajikan tontonan menarik yang sayang untuk dilewatkan.\n\n` +
            `Persaingan di setiap kompetisi semakin ketat seiring berjalannya musim. Setiap tim berjuang mati-matian untuk meraih hasil terbaik. Para pemain bintang menunjukkan kualitas terbaik mereka di setiap pertandingan.\n\n` +
            `Dukungan suporter menjadi energi tambahan bagi tim kesayangan. Atmosfer stadion yang luar biasa menciptakan pengalaman tak terlupakan bagi siapapun yang menyaksikannya.\n\n` +
            `Sepakbola juga memiliki dampak sosial yang luar biasa. Banyak pemain yang menggunakan ketenaran mereka untuk kegiatan amal, membantu masyarakat yang membutuhkan. Klub-klub juga memiliki yayasan yang fokus pada pendidikan, kesehatan, dan pemberdayaan pemuda.\n\n` +
            `Perkembangan teknologi juga semakin mempengaruhi sepakbola modern. VAR (Video Assistant Referee) diperkenalkan untuk membantu wasit mengambil keputusan yang lebih akurat. Goal-line technology memastikan apakah bola benar-benar melewati garis gawang.\n\n` +
            `Analisis data dan statistik juga digunakan oleh pelatih untuk menyusun strategi. Meski kontroversial, teknologi terus berusaha untuk membuat permainan lebih adil.\n\n` +
            `Ke depan, sepakbola akan terus berkembang. Kompetisi baru, format baru, dan teknologi baru akan terus dihadirkan untuk membuat olahraga ini semakin menarik.\n\n` +
            `Ikuti terus update berita sepakbola terbaru hanya di ABAD4D SPORT. Dapatkan informasi akurat, cepat, dan terpercaya seputar dunia sepakbola.\n\n`;
    }
    
    // FAKTA MENARIK
    const interestingFacts = [
        `\n📌 **TAHUKAH ANDA?** Lapangan sepakbola profesional memiliki ukuran standar antara 100-110 meter panjang dan 64-75 meter lebar.\n\n`,
        `\n📌 **TAHUKAH ANDA?** Wasit dalam pertandingan sepakbola profesional berlari rata-rata 10-12 kilometer per pertandingan.\n\n`,
        `\n📌 **TAHUKAH ANDA?** Sepakbola modern pertama kali dimainkan di Inggris pada tahun 1863.\n\n`,
        `\n📌 **TAHUKAH ANDA?** Piala Dunia pertama diadakan pada tahun 1930 di Uruguay dan diikuti 13 negara.\n\n`,
        `\n📌 **TAHUKAH ANDA?** Pemain dengan gol terbanyak dalam sejarah adalah Josef Bican dengan 805 gol resmi.\n\n`,
        `\n📌 **TAHUKAH ANDA?** Kartu kuning dan merah pertama kali digunakan di Piala Dunia 1970.\n\n`,
        `\n📌 **TAHUKAH ANDA?** Suporter sepakbola di seluruh dunia mencapai lebih dari 3,5 miliar orang.\n\n`,
        `\n📌 **TAHUKAH ANDA?** Transfer termahal dalam sejarah adalah Kylian Mbappe ke PSG dengan nilai 180 juta euro.\n\n`,
        `\n📌 **TAHUKAH ANDA?** Cristiano Ronaldo adalah pemain dengan followers terbanyak di Instagram (lebih dari 600 juta).\n\n`,
        `\n📌 **TAHUKAH ANDA?** Stadion Camp Nou milik Barcelona adalah stadion terbesar di Eropa dengan kapasitas 99.354 penonton.\n\n`
    ];
    const randomFact = interestingFacts[Math.floor(Math.random() * interestingFacts.length)];
    
    // KUTIPAN
    const quotes = [
        `\n"Sepakbola adalah olahraga paling indah di dunia." - Pele\n\n`,
        `\n"Kesuksesan bukanlah kebetulan. Ini adalah kerja keras, ketekunan, belajar, berkorban, dan yang terpenting, cinta pada apa yang Anda lakukan." - Pelé\n\n`,
        `\n"Saya tidak memiliki bakat yang luar biasa. Saya hanya memiliki rasa ingin tahu yang besar." - Albert Einstein\n\n`,
        `\n"Sepakbola adalah tentang kebahagiaan." - Ronaldinho\n\n`,
        `\n"Gol adalah emosi. Assist adalah seni." - Zinedine Zidane\n\n`,
    ];
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    
    // PENUTUP
    const closing = `\n\n✨ **ABAD4D SPORT** ✨\n\n` +
        `Ikuti terus ABAD4D SPORT untuk berita sepakbola terupdate dan terpercaya. Dapatkan informasi terkini seputar jadwal, hasil, transfer, cedera pemain, dan analisis mendalam hanya di ABAD4D SPORT.\n\n` +
        `📱 **Ikuti Juga Media Sosial Kami:**\n` +
        `• WhatsApp Official: 0812-3456-7890\n` +
        `• Telegram: @abad4d\n` +
        `• Live Chat 24 Jam: Tersedia di website\n\n` +
        `Jangan lupa bagikan artikel ini ke sesama pecinta sepakbola!\n\n` +
        `#ABAD4DSPORT #BeritaBola #${category.replace(/ /g, '')} #SepakbolaDunia #TransferPemain #HasilPertandingan #JadwalBola`;
    
    let finalContent = '';
    
    if (main && main.length > 100) {
        finalContent = randomOpening + main + '\n\n' + longContent + randomFact + randomQuote + closing;
    } else {
        finalContent = randomOpening + longContent + randomFact + randomQuote + closing;
    }
    
    finalContent = finalContent.replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
    finalContent = finalContent.replace(/Piala Dunia 2022/g, 'Piala Dunia 2026');
    finalContent = finalContent.replace(/Qatar/g, 'Amerika Serikat, Meksiko, dan Kanada');
    finalContent = finalContent.replace(/\s+/g, ' ');
    
    if (finalContent.length < 3000) {
        finalContent += '\n\n' + interestingFacts[Math.floor(Math.random() * interestingFacts.length)];
    }
    
    return finalContent.substring(0, 8000);
}

// ============ UPDATE BERITA ============
async function updateNews() {
    const now = getWIB();
    console.log('\n' + '='.repeat(60));
    console.log(`⚽ ${now} WIB - UPDATE BERITA SEPAKBOLA TERBARU`);
    console.log('='.repeat(60));
    
    let allArticles = [];
    
    console.log('\n📡 SCRAPING BERITA...');
    const [webArticles, googleArticles] = await Promise.all([
        scrapeNews(),
        scrapeGoogleNews()
    ]);
    
    console.log(`  Website: ${webArticles.length} berita terbaru`);
    console.log(`  Google News: ${googleArticles.length} berita terbaru`);
    allArticles.push(...webArticles, ...googleArticles);
    
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
    
    const latestNews = unique.slice(0, 5);
    console.log(`\n📋 MENGAMBIL ${latestNews.length} BERITA TERBARU (maksimal 3 hari)...`);
    
    let saved = 0;
    let duplicateCount = 0;
    let imageFailCount = 0;
    let rejectedCount = 0;
    
    console.log(`\n📝 TARGET: 1-2 berita per jam (SEMUA KATEGORI SEPAKBOLA)\n`);
    
    for (const article of latestNews) {
        if (saved >= 2) break;
        
        const category = detectCategory(article.title);
        
        if (!isRecentFootballNews(article.title, article.published_at)) {
            rejectedCount++;
            continue;
        }
        
        const isDuplicateNews = await isDuplicate(article.title, article.link);
        
        if (isDuplicateNews) {
            duplicateCount++;
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
            console.log(`      🔍 Cari gambar dari artikel...`);
            const fallbackImage = await extractImageFromArticle(article.link);
            if (fallbackImage) {
                imageFile = await downloadImage(fallbackImage);
            }
        }
        
        if (!imageFile) {
            console.log(`      ❌ GAGAL gambar - berita dilewati`);
            imageFailCount++;
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
                        saved++;
                        console.log(`      ✅ BERITA ${saved} BERHASIL!`);
                    }
                    resolve();
                }
            );
        });
        
        await sleep(500);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`✅ UPDATE SELESAI!`);
    console.log(`   📰 Berita baru disimpan: ${saved}`);
    console.log(`   ⏭️ Duplikat tercegah: ${duplicateCount}`);
    console.log(`   🚫 Berita ditolak (lama): ${rejectedCount}`);
    console.log(`   ❌ Gambar gagal: ${imageFailCount}`);
    console.log('='.repeat(60) + '\n');
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
            res.json(err ? { message: 'Gagal menyimpan' } : { message: 'Berita ditambahkan!', id: this.lastID });
        });
});

app.put('/api/news/:id', upload.single('image'), (req, res) => {
    const { title, content, category, status } = req.body;
    const id = req.params.id;
    if (req.file) {
        db.run('UPDATE news SET title = ?, content = ?, image = ?, category = ?, status = ? WHERE id = ?',
            [fixTitle(title), content, req.file.filename, category, status, id], (err) => {
                res.json(err ? { message: 'Gagal update' } : { message: 'Berita diupdate!' });
            });
    } else {
        db.run('UPDATE news SET title = ?, content = ?, category = ?, status = ? WHERE id = ?',
            [fixTitle(title), content, category, status, id], (err) => {
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
    console.log(`🏆 KATEGORI: Piala Dunia 2026, Liga Champions, Liga Inggris, Liga Spanyol, Liga Italia, Bundesliga, Ligue 1, Liga Indonesia, Transfer Pemain, Hasil Pertandingan, Jadwal, Cedera, Berita Klub`);
    console.log(`📅 BATAS WAKTU: Maksimal 3 hari dari sekarang`);
    console.log(`📝 DESKRIPSI: 1000-8000 karakter (detail dengan fakta & kutipan)`);
    console.log(`⏰ UPDATE: Setiap 1 jam\n`);
    
    console.log('📰 Memulai update pertama...\n');
    await updateNews();
    
    setInterval(updateNews, 60 * 60 * 1000);
    console.log('⏰ Timer aktif: Update setiap 1 jam\n');
});
