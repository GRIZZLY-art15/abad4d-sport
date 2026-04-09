const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const app = express();
const PORT = 3005;

process.env.TZ = 'Asia/Jakarta';

app.use(cors());
app.use(express.json());

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const db = new sqlite3.Database('pialadunia.db');

// ================= DB =================
db.run(`CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    slug TEXT,
    content TEXT,
    image TEXT,
    meta TEXT,
    category TEXT,
    status TEXT,
    published_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// ================= HELPER =================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function spinText(text) {
    return text
        .replace(/menang/g, 'berhasil meraih kemenangan')
        .replace(/kalah/g, 'harus mengakui kekalahan')
        .replace(/pertandingan/g, 'laga')
        .replace(/tim/g, 'skuad')
        .replace(/gol/g, 'torehan gol');
}

function generateSEO(title, content) {
    return {
        title: title + " Terbaru 2026",
        meta: content.substring(0, 150)
    };
}

function getTime() {
    return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
}

// ================= SCRAPE LIST =================
async function scrapeList() {
    let data = [];

    try {
        const res = await axios.get('https://www.bola.net/tag/piala-dunia/');
        const $ = cheerio.load(res.data);

        $('a').each((i, el) => {
            const title = $(el).text().trim();
            const link = $(el).attr('href');

            if (title.length > 30 && link && title.toLowerCase().includes('piala')) {
                data.push({ title, link });
            }
        });

    } catch (e) {
        console.log('❌ scrape list error');
    }

    return data.slice(0, 10);
}

// ================= SCRAPE DETAIL =================
async function scrapeDetail(url) {
    try {
        const res = await axios.get(url);
        const $ = cheerio.load(res.data);

        let content = '';
        $('p').each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 50) content += txt + ' ';
        });

        let img = $('img').first().attr('src');

        return {
            content: content.substring(0, 800),
            image: img || 'default.jpg'
        };

    } catch {
        return null;
    }
}

// ================= UPDATE =================
let isUpdating = false;

async function updateNews() {
    console.log(`\n🔥 ${getTime()} UPDATE`);

    let list = await scrapeList();
    let saved = 0;

    for (let item of list) {
        if (saved >= 1) break;

        const exist = await new Promise(res => {
            db.get(`SELECT id FROM news WHERE title = ?`, [item.title], (e, r) => res(r));
        });

        if (exist) continue;

        console.log(`📌 ${item.title}`);

        let detail = await scrapeDetail(item.link);
        if (!detail || !detail.content) continue;

        // AI REWRITE
        let newContent = spinText(detail.content);

        // SEO
        let seo = generateSEO(item.title, newContent);
        let slug = slugify(seo.title);

        db.run(
            `INSERT INTO news (title, slug, content, image, meta, category, status, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                seo.title,
                slug,
                newContent,
                detail.image,
                seo.meta,
                'Piala Dunia 2026',
                'published',
                new Date().toISOString()
            ]
        );

        console.log('✅ POST + SEO + REWRITE');
        saved++;

        await sleep(1000);
    }

    // LIMIT DB
    db.run(`
        DELETE FROM news 
        WHERE id NOT IN (
            SELECT id FROM news ORDER BY id DESC LIMIT 300
        )
    `);
}

// ================= AUTO LOOP =================
function randomDelay() {
    return Math.floor(Math.random() * (15 - 10 + 1) + 10) * 60000;
}

function next() {
    const delay = randomDelay();
    console.log(`⏰ Next ${(delay / 60000)} menit`);
    setTimeout(loop, delay);
}

async function loop() {
    if (isUpdating) return next();

    isUpdating = true;

    try {
        await updateNews();
    } catch (e) {
        console.log('❌ error:', e.message);
    }

    isUpdating = false;

    next();
}

// ================= API =================
app.get('/api/news', (req, res) => {
    db.all(`SELECT * FROM news ORDER BY id DESC`, (e, r) => res.json(r));
});

// ================= START =================
app.listen(PORT, async () => {
    console.log(`🚀 Server http://localhost:${PORT}`);
    console.log(`🔥 BOT AI + SEO AKTIF`);
    console.log(`⏰ Auto 10-15 menit\n`);

    await loop();
});
