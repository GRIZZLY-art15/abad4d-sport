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
const PORT = 3005;

// ============ SET TIMEZONE WIB (UTC+7) ============
process.env.TZ = 'Asia/Jakarta';

// ============ KEAMANAN ADMIN ============
const ADMIN_SECRET_KEY = 'ABAD4D_SPORT_SUPER_SECRET_2026_XYZ123';
const ADMIN_USERNAME = 'admin';

// ============ KATEGORI PIALA DUNIA ============
const WORLD_CUP_CATEGORIES = {
    'Berita Umum': {
        keywords: []
    },
    'Piala Dunia 2026': {
        keywords: [
            'piala dunia 2026', 'world cup 2026', 'usa 2026', 'mexico 2026', 'canada 2026',
            'fifa world cup 2026', 'wc 2026'
        ]
    },
    'Jadwal Piala Dunia': {
        keywords: ['jadwal piala dunia', 'schedule world cup', 'world cup match', 'world cup 2026 schedule']
    },
    'Grup Piala Dunia': {
        keywords: ['grup piala dunia', 'world cup groups', 'draw piala dunia', 'pembagian grup']
    },
    'Bintang Piala Dunia': {
        keywords: ['bintang piala dunia', 'world cup stars', 'mbappe', 'messi', 'haaland', 'ronaldo']
    },
    'Tim Lolos Piala Dunia': {
        keywords: ['tim lolos piala dunia', 'qualified teams', 'lolos ke piala dunia', 'tiket piala dunia']
    },
    'Hasil Pertandingan': {
        keywords: ['hasil piala dunia', 'world cup result', 'skor piala dunia', 'hasil pertandingan']
    },
    'Sejarah Piala Dunia': {
        keywords: ['sejarah piala dunia', 'history world cup', 'juara piala dunia', 'world cup winners']
    }
};

// ============ SUMBER WEBSITE BERITA PIALA DUNIA ============
const NEWS_SOURCES = [
    { name: 'Bola.net - Piala Dunia', url: 'https://www.bola.net/tag/piala-dunia/', category: 'Piala Dunia 2026' },
    { name: 'Bola.net - World Cup', url: 'https://www.bola.net/tag/world-cup/', category: 'Piala Dunia 2026' },
    { name: 'Goal.com World Cup', url: 'https://www.goal.com/id/berita/piala-dunia', category: 'Piala Dunia 2026' }
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
        return res.redirect('/admin-login.html');
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
        
        res.redirect('/admin-login.html');
    } catch (error) {
        res.redirect('/admin-login.html');
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

// ============ DETEKSI KATEGORI ============
function detectCategory(title) {
    const titleLower = title.toLowerCase();
    const order = ['Jadwal Piala Dunia', 'Hasil Pertandingan', 'Grup Piala Dunia', 'Tim Lolos Piala Dunia', 'Bintang Piala Dunia', 'Sejarah Piala Dunia', 'Piala Dunia 2026'];
    
    for (const category of order) {
        const keywords = WORLD_CUP_CATEGORIES[category].keywords;
        for (const keyword of keywords) {
            if (titleLower.includes(keyword)) {
                return category;
            }
        }
    }
    return 'Berita Umum';
}

// ============ CLEAN CONTENT (BERSIHKAN METADATA) ============
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
        /Rabu, \d{1,2} [A-Za-z]+ \d{4} \d{2}:\d{2} WIB/gi,
        /Kamis, \d{1,2} [A-Za-z]+ \d{4} \d{2}:\d{2} WIB/gi,
        /Jumat, \d{1,2} [A-Za-z]+ \d{4} \d{2}:\d{2} WIB/gi,
        /Sabtu, \d{1,2} [A-Za-z]+ \d{4} \d{2}:\d{2} WIB/gi,
        /Minggu, \d{1,2} [A-Za-z]+ \d{4} \d{2}:\d{2} WIB/gi,
        /Senin, \d{1,2} [A-Za-z]+ \d{4} \d{2}:\d{2} WIB/gi,
        /Selasa, \d{1,2} [A-Za-z]+ \d{4} \d{2}:\d{2} WIB/gi,
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

// ============ FUNGSI DOWNLOAD GAMBAR ============
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

// ============ AMBIL GAMBAR DARI LINK ARTIKEL (FALLBACK) ============
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
                
                if (href && text && text.length > 25 && text.length < 180) {
                    let fullUrl = href;
                    if (!fullUrl.startsWith('http')) {
                        try {
                            const urlObj = new URL(fullUrl, source.url);
                            fullUrl = urlObj.href;
                        } catch(e) { return; }
                    }
                    
                    const isWorldCup = /piala dunia|world cup|wc 2026|worldcup|fifa world cup/i.test(text);
                    
                    if (fullUrl && isWorldCup && !fullUrl.includes('tag/') && !fullUrl.includes('/indeks')) {
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
            await sleep(800);
            
        } catch (error) {
            console.log(`    ⚠️ Gagal: ${error.message}`);
        }
    }
    
    return allArticles;
}

// ============ GOOGLE NEWS SCRAPING ============
async function scrapeGoogleNews() {
    const queries = ['piala+dunia+2026', 'world+cup+2026', 'jadwal+piala+dunia+2026'];
    const articles = [];
    
    for (const query of queries) {
        try {
            const url = `https://news.google.com/rss/search?q=${query}&hl=id&gl=ID&ceid=ID:id`;
            const response = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(response.data, { xmlMode: true });
            
            $('item').each((i, item) => {
                if (i >= 3) return;
                const title = $(item).find('title').text();
                const link = $(item).find('link').text();
                const pubDate = $(item).find('pubDate').text();
                
                if (title && title.length > 25 && link) {
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
    if (!title) return 'Berita Piala Dunia Terbaru';
    
    let fixed = title;
    fixed = fixed.replace(/^[^a-zA-Z0-9\s]+/, '');
    fixed = fixed.replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
    fixed = fixed.replace(/[!?]+$/, '');
    fixed = fixed.replace(/\s+/g, ' ').trim();
    
    if (fixed.length > 0) {
        fixed = fixed.charAt(0).toUpperCase() + fixed.slice(1);
    }
    
    return fixed.substring(0, 120) || 'Berita Piala Dunia Terbaru';
}

// ============ BUAT DESKRIPSI (BERSIH, TANPA METADATA DOBEL) ============
function createDescription(title, originalContent, category) {
    const titleClean = title.replace(/[!?]+$/, '');
    
    let opening = `${titleClean}\n\n`;
    
    let main = originalContent || '';
    
    main = main.replace(/Diperbarui.*?WIB/gi, '');
    main = main.replace(/Diterbitkan.*?WIB/gi, '');
    main = main.replace(/Updated.*?\./gi, '');
    main = main.replace(/Published.*?\./gi, '');
    main = main.replace(/\d{1,2}-\d{2} WIB/gi, '');
    main = main.replace(/\d{1,2}:\d{2} WIB/gi, '');
    main = main.trim();
    
    if (!main || main.length < 100) {
        switch(category) {
            case 'Piala Dunia 2026':
                main = `Piala Dunia 2026 akan menjadi edisi istimewa karena digelar di tiga negara: Amerika Serikat, Meksiko, dan Kanada. Turnamen ini akan diikuti 48 tim untuk pertama kalinya. Pertandingan pembukaan akan digelar pada 12 Juni 2026 di Stadion Azteca, Meksiko City. Babak grup akan berlangsung dari 12 Juni hingga 28 Juni 2026. Babak 32 besar dimulai 29 Juni 2026, babak 16 besar pada 3 Juli 2026, perempat final 7 Juli 2026, semi final 11 Juli 2026, dan grand final pada 12 Juli 2026 di MetLife Stadium, New Jersey.`;
                break;
            case 'Jadwal Piala Dunia':
                main = `Jadwal lengkap Piala Dunia 2026: Babak Grup (12-28 Juni 2026), Babak 32 Besar (29 Juni - 2 Juli 2026), Babak 16 Besar (3-6 Juli 2026), Perempat Final (7-8 Juli 2026), Semi Final (11 Juli 2026), Final (12 Juli 2026 di MetLife Stadium, New Jersey).`;
                break;
            case 'Grup Piala Dunia':
                main = `Sebanyak 48 tim dibagi ke dalam 16 grup pada Piala Dunia 2026. Dua tim teratas dari setiap grup akan lolos ke babak 32 besar. Format baru ini memberikan peluang lebih besar bagi tim-tim underdog.`;
                break;
            case 'Bintang Piala Dunia':
                main = `Para bintang dunia siap meramaikan Piala Dunia 2026: Kylian Mbappe (Prancis), Erling Haaland (Norwegia), Jude Bellingham (Inggris), Vinicius Jr (Brasil), Jamal Musiala (Jerman), dan Pedri (Spanyol). Persaingan merebut Golden Boot diprediksi sangat ketat.`;
                break;
            case 'Tim Lolos Piala Dunia':
                main = `Tim-tim yang telah lolos ke Piala Dunia 2026: Prancis, Inggris, Jerman, Spanyol, Italia, Belanda, Portugal, Brasil, Argentina, Uruguay, Amerika Serikat, Meksiko, Kanada, Jepang, Korea Selatan, Australia, Maroko, Senegal, dan masih banyak lagi. Total 48 tim akan bertanding.`;
                break;
            case 'Hasil Pertandingan':
                main = `Hasil pertandingan Piala Dunia 2026 akan terus diperbarui. Setiap laga menyajikan drama dan ketegangan hingga menit akhir. Simak skor akhir dan rekap pertandingan hanya di ABAD4D SPORT.`;
                break;
            case 'Sejarah Piala Dunia':
                main = `Piala Dunia pertama kali digelar pada 1930 di Uruguay. Brasil menjadi negara dengan koleksi trofi terbanyak (5 gelar), diikuti Italia dan Jerman (4 gelar). Piala Dunia 2026 akan menjadi edisi pertama dengan 48 tim.`;
                break;
            default:
                main = `Piala Dunia 2026 akan digelar di Amerika Serikat, Meksiko, dan Kanada pada 12 Juni - 12 Juli 2026. Turnamen ini diikuti 48 tim untuk pertama kalinya.`;
        }
    }
    
    const closing = `\n\nIkuti terus ABAD4D SPORT untuk berita Piala Dunia 2026 terupdate. #PialaDunia2026 #WorldCup2026 #ABAD4DSPORT`;
    
    let final = opening + main + closing;
    final = final.replace(/\s+/g, ' ');
    final = final.replace(/Piala Dunia 2022/g, 'Piala Dunia 2026');
    final = final.replace(/Qatar/g, 'Amerika Serikat, Meksiko, dan Kanada');
    
    return final.substring(0, 3000);
}

// ============ UPDATE BERITA (HANYA BERITA TERBARU) ============
async function updateNews() {
    const now = getWIB();
    console.log('\n' + '='.repeat(55));
    console.log(`🏆 ${now} WIB - UPDATE BERITA PIALA DUNIA`);
    console.log('='.repeat(55));
    
    let allArticles = [];
    
    console.log('\n📡 SCRAPING BERITA...');
    const [webArticles, googleArticles] = await Promise.all([
        scrapeNews(),
        scrapeGoogleNews()
    ]);
    
    console.log(`  Website: ${webArticles.length} berita`);
    console.log(`  Google News: ${googleArticles.length} berita`);
    allArticles.push(...webArticles, ...googleArticles);
    
    const unique = [];
    const seen = new Set();
    for (const article of allArticles) {
        const key = article.title.substring(0, 60);
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(article);
        }
    }
    
    console.log(`\n📊 TOTAL BERITA UNIK: ${unique.length}`);
    unique.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    
    const latestNews = unique.slice(0, 10);
    console.log(`\n📋 MENGAMBIL ${latestNews.length} BERITA TERBARU...`);
    
    let saved = 0;
    let targetCount = Math.min(latestNews.length, 2);
    
    console.log(`\n📝 TARGET: ${targetCount} berita per jam\n`);
    
    for (const article of latestNews) {
        if (saved >= 2) break;
        
        const category = detectCategory(article.title);
        
        const exists = await new Promise((resolve) => {
            db.get(
                `SELECT id FROM news WHERE title LIKE ? AND published_at > datetime('now', '-24 hours')`,
                [`%${article.title.substring(0, 40)}%`],
                (err, row) => resolve(row)
            );
        });
        
        if (exists) {
            console.log(`  ⏭️ [LEWATI - SUDAH ADA] ${article.title.substring(0, 50)}...`);
            continue;
        }
        
        console.log(`\n  📌 [${category}] ${article.title.substring(0, 55)}...`);
        
        let content = null;
        if (article.link) {
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
    
    console.log('\n' + '='.repeat(55));
    console.log(`✅ UPDATE SELESAI!`);
    console.log(`   📰 Berita baru disimpan: ${saved}`);
    console.log('='.repeat(55) + '\n');
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
        category TEXT DEFAULT 'Berita Umum',
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

// Ganti password default dengan yang lebih kuat
bcrypt.hash('admin123', 10).then(hash => {
    db.run(`INSERT OR IGNORE INTO admin (id, username, password) VALUES (1, 'admin', ?)`, [hash]);
    console.log('✅ Admin: admin / admin123 (Ganti password setelah login pertama)');
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
        [fixTitle(title), content, image, category || 'Berita Umum', status || 'published', new Date().toISOString()],
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
    res.json({ message: 'Update berita Piala Dunia selesai!' });
});

// ============ JALANKAN SERVER ============
app.listen(PORT, async () => {
    console.log(`\n🏆🏆🏆 ABAD4D SPORT - BOT PIALA DUNIA 2026 🏆🏆🏆`);
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`🔑 Admin: admin / admin123 (Ganti password segera!)`);
    console.log(`🔐 Secret Key: ${ADMIN_SECRET_KEY}`);
    console.log(`📡 SUMBER: Bola.net, Goal.com, Google News`);
    console.log(`🎯 TARGET: 1-2 berita per jam (HANYA berita terbaru)`);
    console.log(`⏰ UPDATE: Setiap 1 jam (24 jam penuh)\n`);
    
    console.log('📰 Memulai update pertama...\n');
    await updateNews();
    
    setInterval(updateNews, 60 * 60 * 1000);
    console.log('⏰ Timer aktif: Update setiap 1 jam\n');
});
