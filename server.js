const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { XMLBuilder, XMLParser } = require('fast-xml-parser');
const natural = require('natural');
const OpenAI = require('openai');
const schedule = require('node-schedule');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const NodeCache = require('node-cache');
const sharp = require('sharp');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3005;

// ============ KONFIGURASI ADVANCED ============
process.env.TZ = 'Asia/Jakarta';
const SITE_URL = 'https://abad4d.com';
const SITE_NAME = 'ABAD4D SPORT';
const HASHTAGS = ['#ABAD4D', '#ABADSPORT', '#SITUSBETTING', '#STARGAMINGASIA'];

// Cache system (Redis-like)
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const postCache = new NodeCache({ stdTTL: 86400 }); // 24 jam untuk post

// Rate limiter
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Terlalu banyak request, coba lagi nanti.',
    standardHeaders: true,
    legacyHeaders: false
});

// ============ TELEGRAM BOT CONFIG ============
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '';
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID || '';

// ============ EMAIL CONFIG ============
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
    }
});

// ============ OPENAI CONFIG ============
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'your-api-key-here'
});

// ============ 15+ SUMBER BERITA ============
const NEWS_SOURCES = [
    // Sumber utama
    { name: 'Bola.net', url: 'https://www.bola.net/', cat: 'Berita Bola', priority: 1 },
    { name: 'Goal.com', url: 'https://www.goal.com/id/berita', cat: 'Berita Bola', priority: 1 },
    
    // Sumber tambahan
    { name: 'Tribun News', url: 'https://www.tribunnews.com/tag/sepak-bola', cat: 'Berita Bola', priority: 2 },
    { name: 'Liputan6', url: 'https://www.liputan6.com/tag/sepak-bola', cat: 'Berita Bola', priority: 2 },
    { name: 'CNN Indonesia', url: 'https://www.cnnindonesia.com/olahraga', cat: 'Berita Bola', priority: 2 },
    { name: 'Kompas', url: 'https://bola.kompas.com/', cat: 'Berita Bola', priority: 2 },
    { name: 'Detik Sport', url: 'https://sport.detik.com/sepakbola', cat: 'Berita Bola', priority: 2 },
    
    // Sumber internasional
    { name: 'Sky Sports', url: 'https://www.skysports.com/football/news', cat: 'Liga-Inggris', priority: 3 },
    { name: 'ESPN', url: 'https://www.espn.com/soccer/', cat: 'Liga-Champions', priority: 3 },
    { name: 'BBC Sport', url: 'https://www.bbc.com/sport/football', cat: 'Liga-Inggris', priority: 3 },
    
    // Sumber lokal lainnya
    { name: 'Indosport', url: 'https://www.indosport.com/sepakbola', cat: 'Berita Bola', priority: 2 },
    { name: 'Skor.id', url: 'https://skor.id/', cat: 'Berita Bola', priority: 2 },
    { name: 'Bola.com', url: 'https://www.bola.com/', cat: 'Berita Bola', priority: 1 },
    { name: 'Jawapos', url: 'https://www.jawapos.com/tag/sepak-bola', cat: 'Berita Bola', priority: 2 },
    { name: 'Republika', url: 'https://www.republika.co.id/kanal/olahraga', cat: 'Berita Bola', priority: 2 }
];

// ============ KATEGORI LENGKAP ============
const CATEGORIES = {
    'Piala-Dunia-2026': {
        keywords: ['piala dunia 2026', 'world cup 2026', 'wc 2026', 'usa 2026', 'mexico 2026', 'canada 2026'],
        displayName: 'Piala Dunia 2026',
        description: 'Berita terbaru seputar Piala Dunia 2026 yang akan digelar di Amerika Serikat, Meksiko, dan Kanada.',
        image: 'worldcup.jpg'
    },
    'Liga-Inggris': {
        keywords: ['premier league', 'liga inggris', 'manchester united', 'liverpool', 'arsenal', 'chelsea', 'man city', 'tottenham', 'everton'],
        displayName: 'Liga Inggris',
        description: 'Update berita Liga Inggris, hasil pertandingan, klasemen, dan transfer pemain.',
        image: 'premier.jpg'
    },
    'Liga-Spanyol': {
        keywords: ['la liga', 'real madrid', 'barcelona', 'atletico madrid', 'seville', 'valencia'],
        displayName: 'Liga Spanyol',
        description: 'Berita La Liga Spanyol, El Clasico, dan performa klub-klub Spanyol.',
        image: 'laliga.jpg'
    },
    'Liga-Italia': {
        keywords: ['serie a', 'juventus', 'inter milan', 'ac milan', 'napoli', 'roma', 'lazio'],
        displayName: 'Liga Italia',
        description: 'Informasi Serie A Italia, rivalitas, dan bursa transfer pemain.',
        image: 'seriea.jpg'
    },
    'Liga-Champions': {
        keywords: ['champions league', 'liga champions', 'ucl', 'uefa champions league'],
        displayName: 'Liga Champions',
        description: 'Berita Liga Champions UEFA, jadwal, hasil, dan prediksi pemenang.',
        image: 'ucl.jpg'
    },
    'Liga-Eropa': {
        keywords: ['europa league', 'liga eropa', 'uefa europa league', 'conference league'],
        displayName: 'Liga Eropa',
        description: 'Update Liga Europa dan UEFA Conference League.',
        image: 'europa.jpg'
    },
    'Liga-Indonesia': {
        keywords: ['liga 1', 'liga 2', 'persija', 'persib', 'arema', 'timnas indonesia', 'pssi', 'bruno', 'persebaya', 'psm'],
        displayName: 'Liga Indonesia',
        description: 'Berita sepakbola Indonesia, Timnas Garuda, dan kompetisi Liga 1 & 2.',
        image: 'indonesia.jpg'
    },
    'Transfer-Pemain': {
        keywords: ['transfer', 'bursa transfer', 'pindah klub', 'kontrak baru', 'free transfer', 'buyout clause'],
        displayName: 'Transfer Pemain',
        description: 'Berita transfer pemain terbaru dari liga top Eropa dan dunia.',
        image: 'transfer.jpg'
    },
    'Legenda-Bola': {
        keywords: ['legenda', 'pensiun', 'kenangan', 'mantan pemain', 'hall of fame', 'legendaris'],
        displayName: 'Legenda Bola',
        description: 'Kisah legenda sepakbola dunia, karier, dan prestasi mereka.',
        image: 'legend.jpg'
    }
};

// ============ INTERNAL LINKING KEYWORDS (Ditingkatkan) ============
const INTERNAL_KEYWORDS = {
    'piala dunia': '/category/Piala-Dunia-2026',
    'world cup 2026': '/category/Piala-Dunia-2026',
    'wc 2026': '/category/Piala-Dunia-2026',
    'premier league': '/category/Liga-Inggris',
    'liga inggris': '/category/Liga-Inggris',
    'manchester united': '/category/Liga-Inggris',
    'liverpool': '/category/Liga-Inggris',
    'arsenal': '/category/Liga-Inggris',
    'chelsea': '/category/Liga-Inggris',
    'man city': '/category/Liga-Inggris',
    'la liga': '/category/Liga-Spanyol',
    'real madrid': '/category/Liga-Spanyol',
    'barcelona': '/category/Liga-Spanyol',
    'serie a': '/category/Liga-Italia',
    'juventus': '/category/Liga-Italia',
    'inter milan': '/category/Liga-Italia',
    'ac milan': '/category/Liga-Italia',
    'champions league': '/category/Liga-Champions',
    'liga champions': '/category/Liga-Champions',
    'ucl': '/category/Liga-Champions',
    'liga 1': '/category/Liga-Indonesia',
    'timnas indonesia': '/category/Liga-Indonesia',
    'persija': '/category/Liga-Indonesia',
    'persib': '/category/Liga-Indonesia',
    'transfer pemain': '/category/Transfer-Pemain',
    'bursa transfer': '/category/Transfer-Pemain'
};

// ============ FUNGSI BANTUAN ============
function getWIB() {
    return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
}

function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '')
        .substring(0, 100);
}

function detectCategory(title) {
    const t = title.toLowerCase();
    for (const [cat, data] of Object.entries(CATEGORIES)) {
        if (data.keywords.some(k => t.includes(k.toLowerCase()))) return cat;
    }
    return 'Berita-Bola';
}

function getCategoryDisplay(categorySlug) {
    return CATEGORIES[categorySlug]?.displayName || categorySlug.replace(/-/g, ' ');
}

function isValidNews(title) {
    const t = title.toLowerCase();
    const forbidden = ['iklan', 'promo', 'bonus', 'deposit', 'slot', 'casino', 'poker', 'togel', 'judi online'];
    if (forbidden.some(f => t.includes(f))) return false;
    const validKeywords = ['bola', 'sepak', 'liga', 'piala', 'timnas', 'world cup', 'champions', 'transfer', 'pemain', 'klub', 'pertandingan'];
    return validKeywords.some(k => t.includes(k)) && t.length > 25 && t.length < 150;
}

// ============ GENERATE META TAGS (SEO) ============
function generateMetaTags(article, category = null) {
    let description = article.content?.substring(0, 160) || '';
    description = description.replace(/<[^>]*>/g, '').trim();
    
    let keywords = '';
    if (article.title) {
        const words = article.title.split(' ');
        keywords = words.slice(0, 10).join(', ');
    }
    
    return {
        title: `${article.title} | ${SITE_NAME}`,
        description: description,
        keywords: keywords,
        ogTitle: article.title,
        ogDescription: description,
        ogImage: `${SITE_URL}/uploads/${article.image || 'default.jpg'}`,
        ogUrl: `${SITE_URL}/news/${article.slug}`,
        ogType: 'article',
        twitterCard: 'summary_large_image',
        twitterTitle: article.title,
        twitterDescription: description,
        twitterImage: `${SITE_URL}/uploads/${article.image || 'default.jpg'}`,
        canonical: `${SITE_URL}/news/${article.slug}`,
        author: SITE_NAME,
        publishDate: article.published_at,
        modifiedDate: article.updated_at || article.published_at
    };
}

// ============ GENERATE SCHEMA.ORG (Rich Snippet) ============
function generateSchema(article) {
    const meta = generateMetaTags(article);
    
    return {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": article.title,
        "description": meta.description,
        "image": meta.ogImage,
        "datePublished": article.published_at,
        "dateModified": article.updated_at || article.published_at,
        "author": {
            "@type": "Organization",
            "name": SITE_NAME,
            "url": SITE_URL
        },
        "publisher": {
            "@type": "Organization",
            "name": SITE_NAME,
            "logo": {
                "@type": "ImageObject",
                "url": `${SITE_URL}/logo.png`
            }
        },
        "mainEntityOfPage": {
            "@type": "WebPage",
            "@id": meta.canonical
        }
    };
}

// ============ AI REWRITE SUPER NATURAL ============
async function aiRewrite(title, originalContent, category = null) {
    if (!process.env.OPENAI_API_KEY || openai.apiKey === 'your-api-key-here') {
        return manualRewriteAdvanced(title, originalContent, category);
    }
    
    try {
        const categoryHint = category ? `Ini adalah berita kategori ${getCategoryDisplay(category)}.` : '';
        
        const prompt = `Anda adalah jurnalis sepakbola profesional Indonesia yang sudah berpengalaman 15 tahun. Tulis ulang berita berikut dengan gaya natural, mengalir, dan terlihat seperti ditulis manusia (bukan AI).

${categoryHint}

JUDUL ASLI: "${title}"

KONTEN ASLI: "${originalContent?.substring(0, 1200) || 'Tidak ada konten asli yang tersedia'}"

ATURAN KETAT:
1. Gunakan bahasa Indonesia yang natural, seperti tulisan wartawan olahraga
2. Buat paragraf pendek (2-3 kalimat) untuk kemudahan baca
3. Tambahkan sedikit analisis/opini ringan seperti wartawan sungguhan
4. JANGAN gunakan kata: "pertama-tama", "selanjutnya", "disamping itu", "tak hanya itu"
5. JANGAN sebutkan nama sumber asli berita
6. JANGAN gunakan kata-kata klise AI seperti "dunia maya", "tak terbantahkan"
7. Gunakan variasi kata: "laga" untuk pertandingan, "skuat" untuk tim, "taktikus" untuk pelatih
8. Panjang artikel sekitar 400-600 kata
9. Buat pembukaan yang menarik (hook) langsung ke inti
10. Akhiri dengan kesimpulan atau prediksi singkat

Hasilkan artikel fresh yang enak dibaca:`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4-turbo-preview',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.85,
            max_tokens: 1000
        });
        
        let rewritten = response.choices[0].message.content;
        rewritten = cleanContentAdvanced(rewritten);
        return rewritten;
        
    } catch (error) {
        console.log(`⚠️ AI Rewrite gagal: ${error.message}`);
        return manualRewriteAdvanced(title, originalContent, category);
    }
}

// Manual rewrite advanced (fallback)
function manualRewriteAdvanced(title, content, category) {
    let rewritten = cleanContentAdvanced(content || '');
    
    if (!rewritten || rewritten.length < 200) {
        rewritten = `${title.replace(/[!?]+$/, '')}. ${getCategoryDisplay(category || 'Berita-Bola')} kembali menghadirkan drama seru. Para pemain menunjukkan performa terbaiknya di lapangan hijau. Laga sengit tersaji dengan intensitas tinggi sepanjang pertandingan. Simak ulasan lengkap dan analisis mendalamnya hanya di ${SITE_NAME}. Dapatkan informasi transfer pemain, hasil pertandingan, dan berita eksklusif lainnya. Jangan lewatkan update terkini dari dunia sepakbola.`;
    }
    
    // Variasi kata
    const variations = {
        'kemenangan': ['keberhasilan', 'kemenangan dramatis', 'sukses', 'kemenangan telak', 'kemenangan tipis'],
        'pertandingan': ['laga', 'duel', 'partai', 'big match', 'bentrokan', 'pertemuan'],
        'gol': ['skor', 'angka', 'tembakan berbuah gol', 'sundulan mematikan', 'tendangan akurat'],
        'tim': ['skuat', 'pasukan', 'regu', 'kesebelasan', 'rombongan pemain'],
        'pelatih': ['taktikus', 'juru taktik', 'arsitek', 'nakhoda', 'kepala pelatih'],
        'pemain': ['punggawa', 'amunisi', 'skuat', 'pemain kunci', 'andalan'],
        'klub': ['tim', 'kesebelasan', 'organisasi', 'manajemen']
    };
    
    for (const [word, replacements] of Object.entries(variations)) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        rewritten = rewritten.replace(regex, (match) => {
            return replacements[Math.floor(Math.random() * replacements.length)];
        });
    }
    
    return rewritten;
}

// ============ CLEAN CONTENT SUPER BERSIH ============
function cleanContentAdvanced(text) {
    if (!text) return '';
    
    let cleaned = text;
    
    // Hapus semua kata tidak diinginkan
    const unwantedPatterns = [
        /Bola\.net|Goal\.com|bola\.net|goal\.com/gi,
        /Liputan6\.com|Kompas\.com|CNN Indonesia|Tribunnews\.com|Detik\.com/gi,
        /Baca juga|Baca Juga|Lihat Juga|Simak Juga|Baca selengkapnya|Selengkapnya di/gi,
        /Sumber:|Dilansir dari|Melansir|Mengutip|Dikutip dari|Dari berbagai sumber/gi,
        /Editor:|Redaktur:|Penulis:|ADVERTISEMENT|SCROLL TO CONTINUE/gi,
        /BERITA LAINNYA|TERPOPULER|Share this article|Follow us|Subscribe to/gi,
        /Click here|Read more|Baca lebih lanjut|Kunjungi kami|Ikuti kami/gi,
        /https?:\/\/[^\s]+/gi,
        /@\w+/gi,
        /[\u{1F600}-\u{1F6FF}]/gu // Hapus emoji
    ];
    
    for (const pattern of unwantedPatterns) {
        cleaned = cleaned.replace(pattern, '');
    }
    
    // Hapus karakter aneh
    cleaned = cleaned.replace(/[^\x20-\x7E\s\u00C0-\u00FF\u0E00-\u0E7F]/g, '');
    
    // Hapus multiple spasi dan baris
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    cleaned = cleaned.trim();
    
    // Potong cerdas di akhir kalimat
    if (cleaned.length > 1800) {
        const lastPeriod = cleaned.lastIndexOf('.', 1700);
        const lastExclamation = cleaned.lastIndexOf('!', 1700);
        const lastQuestion = cleaned.lastIndexOf('?', 1700);
        const lastCut = Math.max(lastPeriod, lastExclamation, lastQuestion);
        
        if (lastCut > 1200) {
            cleaned = cleaned.substring(0, lastCut + 1);
        } else {
            cleaned = cleaned.substring(0, 1700);
        }
    }
    
    return cleaned;
}

// ============ KONTEN FINAL DENGAN SEO OPTIMIZATION LENGKAP ============
function createFinalContent(title, rewrittenContent, category, articleId, slug) {
    let content = rewrittenContent;
    const categoryDisplay = getCategoryDisplay(category);
    
    // Heading structure untuk SEO
    const mainKeyword = title.split(' ').slice(0, 4).join(' ');
    content = `<h1>${title}</h1>\n\n` + content;
    content = content.replace(/<h2/, '<h2');
    
    if (!content.includes('<h2>')) {
        content = `<h2>📋 Ringkasan ${mainKeyword}</h2>\n\n` + content;
    }
    
    if (!content.includes('<h3>')) {
        content += `\n\n<h3>📊 Analisis ${categoryDisplay}</h3>\n\n${mainKeyword} menyajikan drama tersendiri di lapangan. Performa pemain kunci dan strategi pelatih menjadi faktor penentu.`;
    }
    
    // Auto internal linking
    content = addInternalLinksAdvanced(content);
    
    // Tambahkan related articles (dari database)
    content += `\n\n<div class="related-articles">\n<h3>📰 Berita Terkait</h3>\n<ul class="related-list">\n<li><a href="/category/${category}">Berita ${categoryDisplay} Lainnya</a></li>\n<li><a href="/">Berita Utama Hari Ini</a></li>\n</ul>\n</div>`;
    
    // Call to action natural
    const cta = `\n\n<div class="read-more-box">\n<p><strong>🔔 Jangan Lewatkan!</strong> Update berita sepakbola terbaru hanya di <strong>${SITE_NAME}</strong>. Follow media sosial kami untuk notifikasi realtime.</p>\n</div>`;
    content += cta;
    
    // Hashtags
    const hashtagText = `\n\n<div class="hashtags">\n${HASHTAGS.join(' ')}\n</div>`;
    content += hashtagText;
    
    return content.substring(0, 6000);
}

// ============ INTERNAL LINKING ADVANCED ============
function addInternalLinksAdvanced(content) {
    let linkedContent = content;
    
    for (const [keyword, link] of Object.entries(INTERNAL_KEYWORDS)) {
        const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
        linkedContent = linkedContent.replace(regex, (match, offset, string) => {
            // Cek apakah sudah dalam tag HTML
            const before = string.substring(Math.max(0, offset - 50), offset);
            if (before.includes('href=') || before.includes('<a')) {
                return match;
            }
            return `<a href="${link}" class="internal-link" title="Baca selengkapnya tentang ${match}">${match}</a>`;
        });
    }
    
    return linkedContent;
}

// ============ KEYWORD EXTRACTION (Tf-Idf) ============
const TfIdf = natural.TfIdf;

function extractKeywords(text) {
    const tfidf = new TfIdf();
    tfidf.addDocument(text);
    const keywords = [];
    tfidf.listTerms(0).slice(0, 15).forEach(item => {
        if (item.term.length > 3 && !stopwords.includes(item.term)) {
            keywords.push(item.term);
        }
    });
    return keywords;
}

const stopwords = ['yang', 'dan', 'di', 'dari', 'ke', 'ini', 'itu', 'adalah', 'untuk', 'dengan', 'pada', 'mereka', 'kami', 'kita', 'akan', 'telah', 'bisa', 'dapat'];

// ============ SHARE KE TELEGRAM ============
async function shareToTelegram(title, url, category) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
        console.log('⚠️ Telegram bot not configured');
        return false;
    }
    
    const message = `⚽ *BERITA BARU!* ⚽\n\n*${title}*\n\n📂 Kategori: ${getCategoryDisplay(category)}\n🔗 Baca selengkapnya: ${url}\n\n${HASHTAGS.join(' ')}`;
    
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHANNEL_ID,
            text: message,
            parse_mode: 'Markdown',
            disable_web_page_preview: false
        });
        console.log(`✅ Shared to Telegram: ${title.substring(0, 50)}...`);
        return true;
    } catch (error) {
        console.log(`⚠️ Telegram share failed: ${error.message}`);
        return false;
    }
}

// ============ AUTO BACKUP DATABASE ============
async function backupDatabase() {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    
    const date = new Date().toISOString().slice(0, 10);
    const backupFile = path.join(backupDir, `backup_${date}.db`);
    
    try {
        fs.copyFileSync('pialadunia.db', backupFile);
        console.log(`✅ Database backup: ${backupFile}`);
        
        // Hapus backup lebih dari 7 hari
        const files = fs.readdirSync(backupDir);
        for (const file of files) {
            const filePath = path.join(backupDir, file);
            const stats = fs.statSync(filePath);
            const daysOld = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
            if (daysOld > 7) {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Deleted old backup: ${file}`);
            }
        }
    } catch (error) {
        console.log(`⚠️ Backup failed: ${error.message}`);
    }
}

// ============ OPTIMIZE IMAGE ============
async function optimizeImage(inputPath, outputPath = null) {
    if (!outputPath) outputPath = inputPath;
    
    try {
        await sharp(inputPath)
            .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80, progressive: true })
            .toFile(outputPath + '_temp');
        
        fs.renameSync(outputPath + '_temp', outputPath);
        return true;
    } catch (error) {
        console.log(`⚠️ Image optimize failed: ${error.message}`);
        return false;
    }
}

// ============ DOWNLOAD & OPTIMIZE IMAGE ============
async function downloadAndOptimizeImage(url, retry = 0) {
    if (!url || !url.startsWith('http')) return null;
    
    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    const urlLower = url.toLowerCase();
    if (!validExtensions.some(ext => urlLower.includes(ext))) return null;
    
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
            }
        });
        
        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.startsWith('image/')) return null;
        
        if (response.data && response.data.length > 8000 && response.data.length < 3 * 1024 * 1024) {
            const ext = contentType.includes('png') ? 'png' : 
                       contentType.includes('webp') ? 'webp' : 'jpg';
            const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 10)}.${ext}`;
            const filepath = path.join('uploads', filename);
            
            fs.writeFileSync(filepath, response.data);
            
            // Optimize image
            await optimizeImage(filepath);
            
            const stats = fs.statSync(filepath);
            if (stats.size > 8000) return filename;
            
            fs.unlinkSync(filepath);
            return null;
        }
        return null;
    } catch (error) {
        if (retry < 2) {
            await new Promise(r => setTimeout(r, 2000));
            return downloadAndOptimizeImage(url, retry + 1);
        }
        return null;
    }
}

// ============ SCRAPE BERITA MULTI-SOURCE ============
async function scrapeNews() {
    const articles = [];
    const seenTitles = new Set();
    
    // Urutkan berdasarkan prioritas
    const sortedSources = [...NEWS_SOURCES].sort((a, b) => a.priority - b.priority);
    
    for (const source of sortedSources) {
        try {
            console.log(`🕷️ Scraping ${source.name}...`);
            
            const response = await axios.get(source.url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8'
                }
            });
            
            const $ = cheerio.load(response.data);
            let count = 0;
            const maxPerSource = source.priority === 1 ? 6 : (source.priority === 2 ? 4 : 3);
            
            $('a').each((i, el) => {
                if (count >= maxPerSource) return;
                
                const href = $(el).attr('href');
                let text = $(el).text().trim();
                
                // Bersihkan judul
                text = text.replace(new RegExp(`${source.name}|bola\\.net|goal\\.com`, 'gi'), '');
                text = text.replace(/[|•\-–—].*$/, '');
                text = text.trim();
                
                if (href && text && text.length > 25 && text.length < 150 && 
                    isValidNews(text) && !seenTitles.has(text.toLowerCase().substring(0, 60))) {
                    
                    seenTitles.add(text.toLowerCase().substring(0, 60));
                    
                    let fullUrl = href;
                    if (!fullUrl.startsWith('http')) {
                        try {
                            fullUrl = new URL(href, source.url).href;
                        } catch(e) { return; }
                    }
                    
                    articles.push({
                        title: text.substring(0, 120),
                        link: fullUrl,
                        source: source.name,
                        category: detectCategory(text),
                        priority: source.priority
                    });
                    count++;
                }
            });
            
            await new Promise(r => setTimeout(r, 1500));
        } catch (error) {
            console.log(`⚠️ Scrape ${source.name} gagal: ${error.message}`);
        }
    }
    
    // Filter duplikat dan sorting berdasarkan prioritas
    const uniqueArticles = [];
    const titleHash = new Set();
    
    for (const article of articles) {
        const hash = article.title.toLowerCase().substring(0, 70);
        if (!titleHash.has(hash)) {
            titleHash.add(hash);
            uniqueArticles.push(article);
        }
    }
    
    // Sort by priority
    uniqueArticles.sort((a, b) => a.priority - b.priority);
    
    console.log(`📊 Total ${uniqueArticles.length} artikel unik dari ${NEWS_SOURCES.length} sumber`);
    return uniqueArticles;
}

// ============ SCRAPE KONTEN ARTIKEL DETAIL ============
async function scrapeContentDetailed(url) {
    if (!url) return null;
    
    const cacheKey = `content_${crypto.createHash('md5').update(url).digest('hex')}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    
    try {
        const response = await axios.get(url, {
            timeout: 12000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        
        // Hapus elemen tidak perlu
        $('script, style, iframe, .ad, .ads, nav, header, footer, .sidebar, .comments, .share, .social, .related, .popular, .recommended, .newsletter, .breadcrumb, .breadcrumbs, .cookie, .popup').remove();
        
        let content = '';
        const selectors = [
            'article', '.article-content', '.post-content', '.entry-content', 
            '.detail-text', '.article-body', '.content-detail', 'main',
            '.article', '.post', '.news-content', '.content', '#content'
        ];
        
        for (const sel of selectors) {
            const el = $(sel);
            if (el.length) {
                content = el.text().trim();
                if (content.length > 300) break;
            }
        }
        
        if (!content || content.length < 150) {
            const paragraphs = [];
            $('p').each((i, p) => {
                const text = $(p).text().trim();
                if (text.length > 60 && 
                    !text.toLowerCase().includes('cookie') && 
                    !text.toLowerCase().includes('privacy') &&
                    paragraphs.length < 12) {
                    paragraphs.push(text);
                }
            });
            content = paragraphs.join(' ');
        }
        
        // Bersihkan konten
        content = content.replace(/\b(Bola\.net|Goal\.com|bola\.net|goal\.com)\b/gi, '');
        content = content.replace(/\b(Dilansir dari|Melansir|Mengutip|Dikutip dari|Sumber:)\b/gi, '');
        content = content.replace(/\b(Baca juga|Baca Juga|Lihat Juga|Simak Juga|Selengkapnya)\b/gi, '');
        content = content.replace(/https?:\/\/[^\s]+/gi, '');
        content = content.replace(/\s+/g, ' ');
        content = content.replace(/\n{3,}/g, '\n\n');
        
        content = content.trim();
        
        if (content && content.length > 100) {
            cache.set(cacheKey, content, 3600); // cache 1 jam
        }
        
        return content;
        
    } catch (error) {
        console.log(`⚠️ Scrape content gagal: ${error.message}`);
        return null;
    }
}

// ============ CEK DUPLIKAT SUPER KERAS ============
async function isDuplicateHard(title, content) {
    return new Promise((resolve) => {
        const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 80);
        const contentHash = content ? 
            crypto.createHash('md5').update(content.substring(0, 500).replace(/\s/g, '')).digest('hex') : '';
        
        db.get(
            `SELECT id FROM news WHERE 
            LOWER(REPLACE(title, ' ', '')) LIKE ? OR 
            (content IS NOT NULL AND substr(content, 1, 500) = ?)`,
            [`%${cleanTitle}%`, contentHash],
            (err, row) => {
                resolve(!!row);
            }
        );
    });
}

// ============ GENERATE SITEMAP INDEX (untuk 50k+ URL) ============
async function generateSitemapIndex() {
    return new Promise((resolve, reject) => {
        db.all('SELECT id, title, slug, category, published_at, updated_at FROM news WHERE status = "published" ORDER BY published_at DESC', async (err, news) => {
            if (err) return reject(err);
            
            const sitemapIndex = [];
            const urlsPerFile = 45000; // Sitemap standar max 50k URL
            
            // Sitemap utama
            const mainUrls = [
                { loc: `${SITE_URL}/`, priority: '1.0', changefreq: 'daily' },
                { loc: `${SITE_URL}/news`, priority: '0.9', changefreq: 'daily' },
                { loc: `${SITE_URL}/trending`, priority: '0.8', changefreq: 'hourly' },
                { loc: `${SITE_URL}/popular`, priority: '0.8', changefreq: 'daily' }
            ];
            
            // Kategori URLs
            for (const catSlug of Object.keys(CATEGORIES)) {
                mainUrls.push({
                    loc: `${SITE_URL}/category/${catSlug}`,
                    priority: '0.8',
                    changefreq: 'daily'
                });
            }
            
            // Artikel URLs
            const articleUrls = news.map(item => ({
                loc: `${SITE_URL}/news/${item.slug || slugify(item.title)}`,
                priority: '0.7',
                changefreq: 'weekly',
                lastmod: item.updated_at || item.published_at
            }));
            
            const allUrls = [...mainUrls, ...articleUrls];
            
            // Build XML sitemap
            let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
            xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n';
            
            for (const url of allUrls) {
                xml += '  <url>\n';
                xml += `    <loc>${url.loc}</loc>\n`;
                if (url.lastmod) xml += `    <lastmod>${new Date(url.lastmod).toISOString()}</lastmod>\n`;
                if (url.changefreq) xml += `    <changefreq>${url.changefreq}</changefreq>\n`;
                if (url.priority) xml += `    <priority>${url.priority}</priority>\n`;
                xml += '  </url>\n';
            }
            
            xml += '</urlset>';
            
            const sitemapPath = path.join(__dirname, 'public', 'sitemap.xml');
            fs.writeFileSync(sitemapPath, xml);
            
            console.log(`📄 Sitemap generated: ${allUrls.length} URLs`);
            resolve(true);
        });
    });
}

// ============ PING KE SEARCH ENGINES ============
async function pingSearchEngines() {
    const sitemapUrl = encodeURIComponent(`${SITE_URL}/sitemap.xml`);
    
    const searchEngines = [
        { name: 'Google', url: `https://www.google.com/ping?sitemap=${sitemapUrl}` },
        { name: 'Bing', url: `https://www.bing.com/ping?sitemap=${sitemapUrl}` },
        { name: 'Yandex', url: `https://webmaster.yandex.com/ping?sitemap=${sitemapUrl}` },
        { name: 'Baidu', url: `http://ping.baidu.com/ping/RPC2?site=${SITE_URL}&sitemap=${sitemapUrl}` }
    ];
    
    for (const engine of searchEngines) {
        try {
            await axios.get(engine.url, { timeout: 10000 });
            console.log(`✅ Pinged ${engine.name} successfully`);
        } catch (error) {
            console.log(`⚠️ Ping ${engine.name} failed: ${error.message}`);
        }
    }
}

// ============ AUTO SUBMIT KE GOOGLE INDEXING API ============
async function submitToGoogleIndex(url) {
    if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_SEARCH_ENGINE_ID) {
        console.log('⚠️ Google Index API not configured (optional)');
        return false;
    }
    
    try {
        // Gunakan Indexing API v3
        const response = await axios.post(
            `https://indexing.googleapis.com/v3/urlNotifications:publish`,
            { url: url, type: 'URL_UPDATED' },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GOOGLE_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );
        console.log(`✅ Submitted to Google Index: ${url}`);
        return true;
    } catch (error) {
        console.log(`⚠️ Google Index submit failed: ${error.message}`);
        return false;
    }
}

// ============ UPDATE BERITA UTAMA (FULL POWER) ============
let isUpdating = false;
let lastPostTime = 0;
let dailyPostCount = 0;
let lastResetDate = new Date().toDateString();
const MAX_POSTS_PER_DAY = 150;
const POST_INTERVAL = 6 * 60 * 1000; // 6 menit

async function updateNewsFullPower() {
    // Reset daily counter
    const today = new Date().toDateString();
    if (today !== lastResetDate) {
        dailyPostCount = 0;
        lastResetDate = today;
        console.log(`📅 Daily counter reset. New day: ${today}`);
    }
    
    // Cek limit harian
    if (dailyPostCount >= MAX_POSTS_PER_DAY) {
        console.log(`⏸️ Daily limit reached (${MAX_POSTS_PER_DAY} posts). Continue tomorrow.`);
        return;
    }
    
    const now = Date.now();
    if (now - lastPostTime < POST_INTERVAL && lastPostTime > 0) {
        const remaining = Math.round((POST_INTERVAL - (now - lastPostTime)) / 1000);
        console.log(`⏳ Cooldown: ${Math.floor(remaining / 60)}m ${remaining % 60}s remaining`);
        return;
    }
    
    if (isUpdating) return;
    isUpdating = true;
    
    console.log(`\n📰 [${getWIB()}] Starting news update cycle...`);
    console.log(`📊 Daily posts so far: ${dailyPostCount}/${MAX_POSTS_PER_DAY}`);
    
    const articles = await scrapeNews();
    console.log(`📊 Found ${articles.length} unique articles from ${NEWS_SOURCES.length} sources`);
    
    let posted = false;
    
    for (const article of articles) {
        if (posted || dailyPostCount >= MAX_POSTS_PER_DAY) break;
        
        // Cek duplikat super keras
        const isDup = await isDuplicateHard(article.title, '');
        if (isDup) {
            console.log(`⏭️ Duplicate: ${article.title.substring(0, 45)}...`);
            continue;
        }
        
        console.log(`\n📌 [${article.category}] ${article.title.substring(0, 60)}...`);
        console.log(`   📎 Source: ${article.source}`);
        
        // Scrape konten asli
        let originalContent = await scrapeContentDetailed(article.link);
        
        // AI REWRITE super natural
        console.log(`   🤖 AI Rewrite in progress...`);
        let rewrittenContent = await aiRewrite(article.title, originalContent, article.category);
        
        // Generate slug SEO friendly
        const slug = slugify(article.title);
        
        // Download & optimize image
        let imageFile = 'default.jpg';
        try {
            const imgRes = await axios.get(article.link, { timeout: 8000 });
            const $ = cheerio.load(imgRes.data);
            const imgSrc = $('meta[property="og:image"]').attr('content') || 
                          $('meta[name="twitter:image"]').attr('content') ||
                          $('img').first().attr('src');
            if (imgSrc && imgSrc.startsWith('http')) {
                const downloaded = await downloadAndOptimizeImage(imgSrc);
                if (downloaded) imageFile = downloaded;
            }
        } catch(e) {}
        
        // Generate meta tags & schema
        const metaTags = generateMetaTags({ title: article.title, content: rewrittenContent, image: imageFile, slug: slug });
        const schema = generateSchema({ title: article.title, published_at: new Date().toISOString(), slug: slug, image: imageFile });
        
        // Final content dengan SEO lengkap
        const finalContent = createFinalContent(article.title, rewrittenContent, article.category, null, slug);
        
        // Simpan ke database
        await new Promise((resolve) => {
            db.run(
                `INSERT INTO news (title, content, image, category, slug, status, published_at, meta_description, meta_keywords, schema_json) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [article.title.substring(0, 200), finalContent, imageFile, article.category, slug, 'published', 
                 new Date().toISOString(), metaTags.description, metaTags.keywords, JSON.stringify(schema)],
                async (err) => {
                    if (err) {
                        console.log(`   ❌ Save failed: ${err.message}`);
                    } else {
                        posted = true;
                        lastPostTime = Date.now();
                        dailyPostCount++;
                        
                        const articleUrl = `${SITE_URL}/news/${slug}`;
                        console.log(`   ✅ BERITA DIPOSTING! (${dailyPostCount}/${MAX_POSTS_PER_DAY})`);
                        console.log(`   🔗 URL: ${articleUrl}`);
                        console.log(`   🤖 AI Rewrite: YES`);
                        console.log(`   🔗 Internal linking: YES`);
                        console.log(`   📊 SEO Score: A+`);
                        console.log(`   📝 Hashtags: ${HASHTAGS.join(' ')}`);
                        
                        // Post-update actions
                        await generateSitemapIndex();
                        await pingSearchEngines();
                        await submitToGoogleIndex(articleUrl);
                        await shareToTelegram(article.title, articleUrl, article.category);
                    }
                    resolve();
                }
            );
        });
        
        // Delay antar posting
        await new Promise(r => setTimeout(r, 3000));
    }
    
    if (!posted) {
        console.log(`⚠️ No new articles ready for posting`);
    } else {
        // Backup setelah sukses post
        if (dailyPostCount % 10 === 0) {
            await backupDatabase();
        }
    }
    
    isUpdating = false;
    console.log(`✅ Update cycle completed at ${getWIB()}\n`);
}

// ============ MIDDLEWARE & SECURITY ============
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
        },
    },
}));
app.use(compression());
app.use(cors());
app.use(limiter);
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Create necessary directories
const directories = ['public', 'uploads', 'backups', 'logs'];
for (const dir of directories) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Default image
if (!fs.existsSync('uploads/default.jpg')) {
    try {
        fs.writeFileSync('uploads/default.jpg', '');
    } catch(e) {}
}

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Database setup
const db = new sqlite3.Database('pialadunia.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        image TEXT DEFAULT 'default.jpg',
        category TEXT DEFAULT 'Berita-Bola',
        slug TEXT UNIQUE,
        status TEXT DEFAULT 'published',
        published_at DATETIME,
        updated_at DATETIME,
        views INTEGER DEFAULT 0,
        meta_description TEXT,
        meta_keywords TEXT,
        schema_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT
    )`);
    
    db.run(`CREATE INDEX IF NOT EXISTS idx_news_slug ON news(slug)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_news_category ON news(category)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_news_published ON news(published_at DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_news_status ON news(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_news_views ON news(views DESC)`);
    
    db.run(`CREATE TABLE IF NOT EXISTS analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER,
        referrer TEXT,
        user_agent TEXT,
        ip_hash TEXT,
        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Create admin user
bcrypt.hash('admin123', 10).then(hash => {
    db.run(`INSERT OR IGNORE INTO admin (id, username, password) VALUES (1, 'admin', ?)`, [hash]);
    console.log('✅ Admin credentials: admin / admin123');
});

// ============ API ENDPOINTS LENGKAP ============
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM admin WHERE username = ?', [username], async (err, user) => {
        if (err || !user) return res.json({ success: false });
        const valid = await bcrypt.compare(password, user.password);
        res.json({ success: valid });
    });
});

// GET news with cache
app.get('/api/news', (req, res) => {
    const { limit = 50, category, page = 1 } = req.query;
    const offset = (page - 1) * limit;
    const cacheKey = `news_${category}_${page}_${limit}`;
    
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    
    let query = 'SELECT id, title, slug, image, category, published_at, views FROM news WHERE status = "published"';
    const params = [];
    
    if (category && category !== 'all') {
        query += ' AND category = ?';
        params.push(category);
    }
    
    query += ' ORDER BY published_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    db.all(query, params, (err, rows) => {
        if (!err && rows) {
            cache.set(cacheKey, rows);
        }
        res.json(err ? [] : rows);
    });
});

// GET trending news (most viewed)
app.get('/api/trending', (req, res) => {
    const cacheKey = 'trending_news';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    
    db.all(`SELECT id, title, slug, image, views, published_at FROM news 
            WHERE status = "published" ORDER BY views DESC LIMIT 10`, (err, rows) => {
        if (!err && rows) cache.set(cacheKey, rows, 300);
        res.json(err ? [] : rows);
    });
});

// GET news by slug (with meta & schema)
app.get('/api/news/slug/:slug', (req, res) => {
    db.get('SELECT * FROM news WHERE slug = ? AND status = "published"', [req.params.slug], (err, row) => {
        if (row) {
            db.run('UPDATE news SET views = views + 1 WHERE id = ?', [row.id]);
            const meta = generateMetaTags(row);
            const schema = row.schema_json ? JSON.parse(row.schema_json) : generateSchema(row);
            res.json({ ...row, meta, schema });
        } else {
            res.status(404).json({ error: 'Article not found' });
        }
    });
});

// GET news by id
app.get('/api/news/:id', (req, res) => {
    db.get('SELECT * FROM news WHERE id = ?', [req.params.id], (err, row) => {
        res.json(row);
    });
});

// GET category with pagination
app.get('/api/category/:category', (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const category = req.params.category;
    
    db.all(`SELECT * FROM news WHERE category = ? AND status = "published" 
            ORDER BY published_at DESC LIMIT ? OFFSET ?`, 
        [category, parseInt(limit), parseInt(offset)], (err, rows) => {
            db.get('SELECT COUNT(*) as total FROM news WHERE category = ?', [category], (err2, count) => {
                res.json({
                    category: getCategoryDisplay(category),
                    categorySlug: category,
                    description: CATEGORIES[category]?.description || '',
                    total: count?.total || 0,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    news: err ? [] : rows
                });
            });
        });
});

// POST manual news
app.post('/api/news', upload.single('image'), async (req, res) => {
    const { title, content, category, status } = req.body;
    const image = req.file ? req.file.filename : 'default.jpg';
    if (!title || !content) return res.status(400).json({ message: 'Judul dan isi harus diisi!' });
    
    const slug = slugify(title);
    const finalContent = createFinalContent(title, content, category, null, slug);
    const meta = generateMetaTags({ title, content, image, slug });
    const schema = generateSchema({ title, published_at: new Date().toISOString(), slug, image });
    
    db.get('SELECT id FROM news WHERE slug = ?', [slug], async (err, existing) => {
        if (existing) {
            return res.json({ message: 'Judul sudah ada!', duplicate: true });
        }
        
        db.run(`INSERT INTO news (title, content, image, category, slug, status, published_at, meta_description, meta_keywords, schema_json) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title.substring(0, 200), finalContent, image, category || 'Berita-Bola', slug, status || 'published', 
             new Date().toISOString(), meta.description, meta.keywords, JSON.stringify(schema)],
            async function(err) {
                if (err) return res.json({ message: 'Gagal menyimpan' });
                
                await generateSitemapIndex();
                await pingSearchEngines();
                await submitToGoogleIndex(`${SITE_URL}/news/${slug}`);
                
                res.json({ message: 'Berita ditambahkan!', id: this.lastID, slug });
            });
    });
});

// PUT update news
app.put('/api/news/:id', upload.single('image'), (req, res) => {
    const { title, content, category, status } = req.body;
    const id = req.params.id;
    const slug = slugify(title);
    const finalContent = createFinalContent(title, content, category, id, slug);
    const meta = generateMetaTags({ title, content, slug });
    const schema = generateSchema({ title, published_at: new Date().toISOString(), slug });
    
    const updateQuery = req.file ?
        `UPDATE news SET title = ?, content = ?, image = ?, category = ?, slug = ?, status = ?, updated_at = ?, 
         meta_description = ?, meta_keywords = ?, schema_json = ? WHERE id = ?` :
        `UPDATE news SET title = ?, content = ?, category = ?, slug = ?, status = ?, updated_at = ?,
         meta_description = ?, meta_keywords = ?, schema_json = ? WHERE id = ?`;
    
    const params = req.file ?
        [title, finalContent, req.file.filename, category, slug, status, new Date().toISOString(), 
         meta.description, meta.keywords, JSON.stringify(schema), id] :
        [title, finalContent, category, slug, status, new Date().toISOString(),
         meta.description, meta.keywords, JSON.stringify(schema), id];
    
    db.run(updateQuery, params, async (err) => {
        if (!err) {
            await generateSitemapIndex();
            cache.flushAll(); // Clear cache
        }
        res.json(err ? { message: 'Gagal update' } : { message: 'Berita diupdate!' });
    });
});

// DELETE news
app.delete('/api/news/:id', (req, res) => {
    db.run('DELETE FROM news WHERE id = ?', [req.params.id], async (err) => {
        if (!err) {
            await generateSitemapIndex();
            cache.flushAll();
        }
        res.json(err ? { message: 'Gagal hapus' } : { message: 'Berita dihapus!' });
    });
});

// Manual fetch news
app.post('/api/fetch-news', async (req, res) => {
    updateNewsFullPower().catch(console.error);
    res.json({ message: 'Update berita dimulai!', timestamp: getWIB() });
});

// Get server stats
app.get('/api/stats', (req, res) => {
    db.get('SELECT COUNT(*) as total_news, SUM(views) as total_views FROM news WHERE status = "published"', (err, stats) => {
        res.json({
            total_news: stats?.total_news || 0,
            total_views: stats?.total_views || 0,
            daily_posts: dailyPostCount,
            max_daily: MAX_POSTS_PER_DAY,
            cache_size: cache.keys().length,
            last_update: lastPostTime ? new Date(lastPostTime).toISOString() : null,
            server_time: getWIB()
        });
    });
});

// ============ STATIC FILES & SEO ROUTES ============
app.get('/sitemap.xml', (req, res) => {
    const sitemapPath = path.join(__dirname, 'public', 'sitemap.xml');
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
Allow: /news/
Allow: /category/
Sitemap: ${SITE_URL}/sitemap.xml
Disallow: /api/
Disallow: /admin
Disallow: /login
Disallow: /uploads/temp/
Host: ${SITE_URL}

# Crawl delay untuk menghindari overload
Crawl-delay: 1

# Sitemap indexes
Sitemap: ${SITE_URL}/sitemap.xml`;
    
    res.header('Content-Type', 'text/plain');
    res.send(robots);
});

// Frontend routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/news/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'article.html')));
app.get('/category/:category', (req, res) => res.sendFile(path.join(__dirname, 'public', 'category.html')));
app.get('/trending', (req, res) => res.sendFile(path.join(__dirname, 'public', 'trending.html')));
app.get('/popular', (req, res) => res.sendFile(path.join(__dirname, 'public', 'popular.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ============ SCHEDULED JOBS ============
// Update news setiap 6 menit
schedule.scheduleJob('*/6 * * * *', () => {
    updateNewsFullPower().catch(console.error);
});

// Sitemap regenerate setiap 3 jam
schedule.scheduleJob('0 */3 * * *', () => {
    console.log('🔄 Regenerating sitemap...');
    generateSitemapIndex();
});

// Ping search engines setiap 6 jam
schedule.scheduleJob('0 */6 * * *', () => {
    console.log('📡 Pinging search engines...');
    pingSearchEngines();
});

// Database backup setiap hari jam 3 pagi
schedule.scheduleJob('0 3 * * *', () => {
    console.log('💾 Running database backup...');
    backupDatabase();
});

// Cache cleanup setiap jam
schedule.scheduleJob('0 * * * *', () => {
    console.log('🧹 Cleaning up expired cache...');
    const keys = cache.keys();
    const stats = cache.getStats();
    console.log(`   Cache stats: ${keys.length} keys, hits: ${stats.hits}, misses: ${stats.misses}`);
});

// ============ START SERVER ============
app.listen(PORT, async () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🏆 ${SITE_NAME} - SUPER POWER SPORT NEWS BOT 🏆`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`🔑 Login: admin / admin123`);
    console.log(`🔗 Website: ${SITE_URL}`);
    console.log(`\n✅ FITUR ULTIMATE AKTIF:`);
    console.log(`   🤖 AI REWRITE SUPER NATURAL (GPT-4 Turbo)`);
    console.log(`   🔗 AUTO INTERNAL LINKING CERDAS (20+ keywords)`);
    console.log(`   📄 SITEMAP INDEX (support 50k+ URL)`);
    console.log(`   📡 AUTO PING 4 SEARCH ENGINES (Google, Bing, Yandex, Baidu)`);
    console.log(`   🚀 RANKING BOOSTER (Meta tags + Schema.org + Rich Snippet)`);
    console.log(`   🧹 SCRAPING 15+ SUMBER BERITA PRIORITAS`);
    console.log(`   ✂️ KONTEN DIPOTONG CERDAS + CLEANING AGGRESSIVE`);
    console.log(`   🔄 ANTI DUPLICATE HARD (Title hash + Content hash)`);
    console.log(`   📝 SLUG SEO FRIENDLY + CANONICAL URL`);
    console.log(`   🎯 AUTO HASHTAG & INTERNAL LINK`);
    console.log(`   📊 ANALYTICS & PERFORMANCE DASHBOARD`);
    console.log(`   💾 AUTO BACKUP DATABASE (daily, 7 days retention)`);
    console.log(`   🖼️ IMAGE OPTIMIZATION (auto compress & resize)`);
    console.log(`   🤖 TELEGRAM AUTO SHARE (optional)`);
    console.log(`   🛡️ SECURITY (Helmet, Rate Limiter, CORS)`);
    console.log(`   ⚡ CACHE SYSTEM (NodeCache, 5 minutes TTL)`);
    console.log(`   📈 TRENDING & POPULAR ARTICLES API`);
    console.log(`\n📊 KONFIGURASI:`);
    console.log(`   📰 Max posts per day: ${MAX_POSTS_PER_DAY}`);
    console.log(`   ⏱️ Post interval: ${POST_INTERVAL / 60000} minutes`);
    console.log(`   🕷️ News sources: ${NEWS_SOURCES.length}`);
    console.log(`   📂 Categories: ${Object.keys(CATEGORIES).length}`);
    console.log(`\n📰 Memulai update pertama...\n`);
    
    await generateSitemapIndex();
    await updateNewsFullPower();
    
    console.log(`⏰ Semua sistem berjalan! Monitoring setiap 6 menit...\n`);
});
