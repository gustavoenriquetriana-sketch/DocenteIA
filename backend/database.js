const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'docenteai.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Students Table
        db.run(`CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            subject TEXT,
            grade REAL,
            status TEXT
        )`);

        // Tasks Table
        db.run(`CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            date TEXT,
            type TEXT
        )`);

        // Leads Table (Institutional Requests)
        db.run(`CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            role TEXT,
            institution TEXT,
            size TEXT,
            date DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Applications Table (Gamified Careers)
        db.run(`CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vacancy_title TEXT,
            name TEXT,
            email TEXT,
            profile_link TEXT,
            date DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tickets Table
        db.run(`CREATE TABLE IF NOT EXISTS tickets (
            id_ticket TEXT PRIMARY KEY,
            user_name TEXT,
            user_email TEXT,
            subject TEXT,
            description TEXT,
            status TEXT DEFAULT 'Pendiente',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            admin_comments TEXT
        )`, (err) => {
            if (err) console.error("Error creating tickets table:", err.message);
        });

        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT UNIQUE,
            password TEXT,
            reset_token TEXT,
            reset_expires DATETIME
        )`);

        // Update existing users table if columns don't exist
        db.run("ALTER TABLE users ADD COLUMN reset_token TEXT", (err) => {
            // Ignore error if column exists
        });
        db.run("ALTER TABLE users ADD COLUMN reset_expires DATETIME", (err) => {
            // Ignore error if column exists
        });

        // User Settings Table - Drop first to ensure correct schema for this demo
        db.run("DROP TABLE IF EXISTS user_settings", () => {
            db.run(`CREATE TABLE user_settings (
                user_id INTEGER PRIMARY KEY,
                reminders BOOLEAN DEFAULT 0,
                summary BOOLEAN DEFAULT 0
            )`, (err) => {
                if (!err) {
                    // Insert default settings for user 1
                    db.run(`INSERT OR IGNORE INTO user_settings (user_id, reminders, summary) VALUES (1, 0, 1)`);
                }
            });
        });

        // Seed data if empty
        db.get("SELECT count(*) as count FROM students", (err, row) => {
            if (row.count === 0) {
                console.log("Seeding students...");
                const students = [
                    ['Ana Pérez', 'Mecatrónica', 18.5, 'aprobado'],
                    ['Carlos Ruiz', 'Mecatrónica', 9.0, 'riesgo'],
                    ['María Díaz', 'Programación', 16.0, 'aprobado'],
                    ['José Torres', 'Física', 14.5, 'aprobado'],
                    ['Laura Méndez', 'Matemática', 7.5, 'reprobado'],
                    ['Gabriel Silva', 'Mecatrónica', 19.0, 'aprobado'],
                    ['Sofía Vargas', 'Programación', 12.0, 'aprobado'],
                    ['Diego Castillo', 'Física', 9.8, 'riesgo'],
                    ['Valentina Rivas', 'Matemática', 17.5, 'aprobado'],
                    ['Andrés Bello', 'Mecatrónica', 5.0, 'reprobado'],
                    ['Camila Osorio', 'Programación', 15.0, 'aprobado'],
                    ['Ricardo Peña', 'Física', 11.0, 'aprobado'],
                    ['Elena Gómez', 'Matemática', 13.0, 'aprobado'],
                    ['Fernando Paz', 'Mecatrónica', 8.5, 'riesgo'],
                    ['Daniela Cruz', 'Programación', 20.0, 'aprobado']
                ];
                const stmt = db.prepare("INSERT INTO students (name, subject, grade, status) VALUES (?, ?, ?, ?)");
                students.forEach(s => stmt.run(s));
                stmt.finalize();
            }
        });

        db.get("SELECT count(*) as count FROM tasks", (err, row) => {
            if (row.count === 0) {
                console.log("Seeding tasks...");
                const tasks = [
                    ['Inicio Clases', '2026-01-20', 'blue'],
                    ['Entrega Notas', '2026-02-14', 'orange']
                ];
                const stmt = db.prepare("INSERT INTO tasks (title, date, type) VALUES (?, ?, ?)");
                tasks.forEach(t => stmt.run(t));
                stmt.finalize();
            }
        });

        // Default user
        db.run(`INSERT OR IGNORE INTO users (email, password) VALUES ('profesor@unexpo.edu.ve', '123456')`);
    });
}

module.exports = db;
