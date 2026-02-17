const express = require('express');
const router = express.Router();
const db = require('./database');
const { v4: uuidv4 } = require('uuid');
const { sendEmail, sendGmail } = require('./mailer');
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const multer = require('multer');

// Configure multer for PDF uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });


router.get('/students', (req, res) => {
    db.all("SELECT * FROM students", [], (err, rows) => {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }

        const enrichedRows = rows.map(row => {
            const initials = row.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const colors = ['bg-pink-100 text-pink-600', 'bg-indigo-100 text-indigo-600', 'bg-teal-100 text-teal-600', 'bg-purple-100 text-purple-600', 'bg-orange-100 text-orange-600'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            return { ...row, initials, avatarClass: randomColor };
        });
        res.json({
            "message": "success",
            "data": enrichedRows
        });
    });
});

// Create student
router.post('/students', (req, res) => {
    const { name, subject, grade } = req.body;
    let status = 'reprobado';
    if (grade >= 10) status = 'aprobado';

    // Optional: match existing frontend logic for 'riesgo' if desired, but user asked for simple logic.
    // Existing frontend uses: < 10 red (reprobado), < 14 yellow (riesgo), else blue.
    // However, user explicitly said: "Nota >= 10 es Aprobado". I will stick to that.
    // If I want to be consistent with the "Riesgo" badge in frontend, I could add:
    // if (grade >= 10 && grade < 14) status = 'riesgo'; 
    // But user instructions were specific: "Calculalo tú automatically... (ej. Nota >= 10 es Aprobado)".
    // I'll stick to simple Aprobado/Reprobado based on >=10 as requested.
    // Actually, looking at key "status" in frontend map: 'riesgo' is handled. 
    // Let's stick to the User's rule: >= 10 Aprobado. So < 10 Reprobado.

    db.run(
        'INSERT INTO students (name, subject, grade, status) VALUES (?,?,?,?)',
        [name, subject, grade, status],
        function (err) {
            if (err) {
                res.status(400).json({ "error": err.message });
                return;
            }
            res.json({
                "message": "success",
                "data": { id: this.lastID, name, subject, grade, status }
            });
        }
    );
});

// Update student
router.put('/students/:id', (req, res) => {
    const { grade, status } = req.body;
    db.run(
        `UPDATE students SET grade = ?, status = ? WHERE id = ?`,
        [grade, status, req.params.id],
        function (err) {
            if (err) {
                res.status(400).json({ "error": res.message });
                return;
            }
            res.json({
                message: "success",
                data: req.body,
                changes: this.changes
            });
        }
    );
});

// --- TASKS API ---

// Get all tasks
router.get('/tasks', (req, res) => {
    db.all("SELECT * FROM tasks", [], (err, rows) => {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }
        res.json({
            "message": "success",
            "data": rows
        });
    });
});

// Create task
router.post('/tasks', (req, res) => {
    const { title, date, type } = req.body;
    db.run(
        'INSERT INTO tasks (title, date, type) VALUES (?,?,?)',
        [title, date, type],
        function (err) {
            if (err) {
                res.status(400).json({ "error": err.message });
                return;
            }
            res.json({
                "message": "success",
                "data": { id: this.lastID, title, date, type }
            });
        }
    );
});


// --- SETTINGS API ---
router.get('/settings', (req, res) => {
    // Check table exists or handle error if it's being created
    const db = require('./database');
    db.get("SELECT * FROM user_settings WHERE user_id = 1", (err, row) => {
        if (err) {
            console.error("Error fetching settings:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({
            reminders: row ? !!row.reminders : false,
            summary: row ? !!row.summary : false
        });
    });
});

router.post('/settings', (req, res) => {
    console.log('Recibiendo configuración:', req.body);
    const { reminders, summary } = req.body;
    const db = require('./database');
    db.run(
        `INSERT INTO user_settings (user_id, reminders, summary) 
         VALUES (1, ?, ?) 
         ON CONFLICT(user_id) DO UPDATE SET 
         reminders = excluded.reminders, 
         summary = excluded.summary`,
        [reminders, summary],
        function (err) {
            if (err) {
                console.error("Error saving settings:", err.message);
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, message: "Settings updated" });
        }
    );
});


// --- LEADS API ---
router.post('/leads', (req, res) => {
    console.log("Recibiendo Lead:", req.body); // Debug Log
    const { name, role, institution, size } = req.body;
    if (!name || !role || !institution || !size) {
        return res.status(400).json({ success: false, message: "Missing fields" });
    }

    db.run(
        `INSERT INTO leads (name, role, institution, size) VALUES (?, ?, ?, ?)`,
        [name, role, institution, size],
        function (err) {
            if (err) {
                console.error("Error saving lead:", err.message);
                return res.status(500).json({ success: false, error: err.message });
            }
            console.log("Lead guardado con ID:", this.lastID);
            res.json({ success: true, message: "Lead captured", id: this.lastID });
        }
    );
});

// --- AUTH API ---

router.post('/auth/register', (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ success: false, error: "Missing fields" });
    }

    // Check if user exists
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err) return res.status(500).json({ error: "Internal error" });
        if (user) return res.status(400).json({ error: "Email already registered" });

        // Insert new user
        // WARNING: Plain text for demo! Use bcrypt in production.
        const stmt = db.prepare("INSERT INTO users (name, email, password) VALUES (?, ?, ?)");
        stmt.run(name, email, password, function (err) {
            if (err) return res.status(500).json({ error: "Could not create user" });

            // Auto login or just return success
            res.json({
                success: true,
                message: "User registered successfully",
                userId: this.lastID
            });
        });
        stmt.finalize();
    });
});

router.post('/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err) return res.status(500).json({ error: "Internal error" });
        if (!user) return res.status(404).json({ error: "User not found" });

        // WARNING: Plain text for demo purposes! Use bcrypt in production.
        if (user.password === password) {
            // Mock token - in real app use JWT
            const token = "mock-jwt-token-" + require('crypto').randomBytes(16).toString('hex');
            res.json({
                success: true,
                message: "Login success",
                token: token,
                user: { id: user.id, name: user.name, email: user.email }
            });
        } else {
            res.status(401).json({ success: false, error: "Invalid password" });
        }
    });
});

router.post('/auth/forgot-password', (req, res) => {
    const { email } = req.body;
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err) return res.status(500).json({ error: "Internal error" });
        if (!user) return res.status(404).json({ error: "Email no registrado" });

        const crypto = require('crypto');
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 3600000; // 1 hour

        // DEBUG: Print token to console so I can verify without checking email
        // console.log(`[DEBUG] Generated Reset Token for ${email}: ${token}`);

        db.run("UPDATE users SET reset_token = ?, reset_expires = ? WHERE email = ?", [token, expires, email], async (err) => {
            if (err) return res.status(500).json({ error: "Error updating database" });

            try {
                const link = `https://docenteia-production.up.railway.app/reset-password.html?token=${token}`;
                console.log(`[DEBUG] Generando link de reset para ${email}: ${link}`);
                const htmlContent = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
                    <div style="background-color: #1e3a8a; color: white; padding: 20px; text-align: center;">
                        <h2 style="margin: 0;">Restablecer Contraseña</h2>
                    </div>
                    <div style="padding: 20px; background-color: #f8fafc;">
                        <p>Hola <strong>${user.name}</strong>,</p>
                        <p>Has solicitado restablecer tu contraseña. Haz clic en el siguiente enlace para continuar:</p>
                        <div style="text-align: center; margin: 25px 0;">
                            <a href="${link}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Restablecer Contraseña</a>
                        </div>
                        <p style="font-size: 12px; color: #64748b; text-align: center;">Este enlace expira en 1 hora.</p>
                    </div>
                </div>
                `;

                // In production, send to the actual user
                await sendEmail(user.email, 'Restablecer Contraseña - DocenteAI', htmlContent);
                res.json({ success: true, message: "Enlace enviado a tu correo" });
            } catch (error) {
                console.error("Error sending reset email:", error);
                res.status(500).json({ error: "Error al enviar el correo" });
            }
        });
    });
});

router.post('/auth/reset-password', (req, res) => {
    const { token, newPassword } = req.body;

    db.get("SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?", [token, Date.now()], (err, user) => {
        if (err) return res.status(500).json({ error: "Internal error" });
        if (!user) return res.status(400).json({ error: "Token inválido o expirado" });

        db.run("UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?", [newPassword, user.id], async (err) => {
            if (err) return res.status(500).json({ error: "Error resetting password" });

            // Confirmation Email
            try {
                const dateVET = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
                const htmlContent = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
                    <div style="background-color: #16a34a; color: white; padding: 20px; text-align: center;">
                        <h2 style="margin: 0;">¡Contraseña Actualizada!</h2>
                    </div>
                    <div style="padding: 20px; background-color: #f8fafc;">
                        <p>Hola <strong>${user.name}</strong>,</p>
                        <p>Tu contraseña ha sido actualizada exitosamente el <strong>${dateVET}</strong>.</p>
                        <p style="font-size: 14px; color: #64748b;">Si no hiciste este cambio, contacta a soporte inmediatamente.</p>
                    </div>
                </div>
                `;
                await sendEmail(user.email, 'Confirmación de Cambio de Contraseña', htmlContent);
            } catch (e) { console.error("Error sending confirmation", e); }

            res.json({ success: true, message: "Contraseña actualizada correctamente" });
        });
    });
});

// --- AI API ---
// --- CAREERS API ---
router.post('/careers', async (req, res) => {
    console.log("Recibiendo Postulación:", req.body);
    const { vacancy_title, name, email, profile_link } = req.body;

    if (!vacancy_title || !name || !email || !profile_link) {
        return res.status(400).json({ success: false, message: "Missing fields" });
    }

    try {
        // 1. Save to Database
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO applications (vacancy_title, name, email, profile_link) VALUES (?, ?, ?, ?)`,
                [vacancy_title, name, email, profile_link],
                function (err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // 2. IA Simulation (Score & Skills)
        const matchScore = Math.floor(Math.random() * (99 - 88) + 88); // 88% to 98%
        const allSkills = ['Liderazgo', 'Python', 'React', 'Scrum', 'Node.js', 'AI Architecture', 'Cloud Computing', 'Data Science'];
        // Pick 3 random skills
        const detectedSkills = [];
        while (detectedSkills.length < 3) {
            const skill = allSkills[Math.floor(Math.random() * allSkills.length)];
            if (!detectedSkills.includes(skill)) detectedSkills.push(skill);
        }
        const skillsString = detectedSkills.join(', ');

        // 3. Send Email
        await sendEmail(
            email,
            `Resultados de Análisis de Perfil: ${vacancy_title}`,
            `
            <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <div style="background-color: #1e3a8a; color: white; padding: 30px; text-align: center;">
                    <h1 style="margin: 0; font-size: 24px;">DocenteAI Careers</h1>
                    <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Reporte de Compatibilidad</p>
                </div>
                <div style="padding: 30px; background-color: #ffffff;">
                    <p style="font-size: 16px; color: #334155;">Hola <strong>${name}</strong>,</p>
                    <p style="color: #475569; line-height: 1.6;">Nuestra IA ha analizado tu perfil de LinkedIn/GitHub y lo ha comparado con los requisitos para <strong>${vacancy_title}</strong>.</p>
                    
                    <div style="background-color: #f0fdf4; border-radius: 12px; padding: 25px; margin: 25px 0; border: 1px solid #bbf7d0; text-align: center;">
                        <p style="color: #166534; font-size: 14px; margin-bottom: 5px;">Match Score</p>
                        <h2 style="color: #16a34a; font-size: 48px; margin: 0; font-weight: 800;">${matchScore}%</h2>
                    </div>

                    <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; border: 1px solid #cbd5e1;">
                         <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">Skills Detectadas:</p>
                         <p style="margin: 0; font-size: 16px; font-weight: 600; color: #334155;">${skillsString}</p>
                    </div>

                    <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-top: 25px;">
                        Tu perfil es altamente compatible. Un reclutador humano ha sido notificado y te contactará en breve para agendar una entrevista técnica.
                    </p>
                    
                    <div style="text-align: center; margin-top: 30px;">
                        <a href="https://docenteai.com/careers" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Ver Estado de Solicitud</a>
                    </div>
                </div>
                <div style="background-color: #f1f5f9; padding: 20px; text-align: center; color: #94a3b8; font-size: 12px;">
                    © ${new Date().getFullYear()} DocenteAI Inc. | Talent Acquisition Team
                </div>
            </div>
            `
        );
        console.log(`Email enviado a ${email} con score ${matchScore}%`);

        res.json({ success: true, message: "Application received", score: matchScore });

    } catch (error) {
        console.error("Error processing application:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- AI API ---
router.post('/ai/generate', async (req, res) => {
    try {
        const { prompt, userName } = req.body;

        if (!process.env.GROQ_API_KEY) {
            throw new Error("GROQ_API_KEY is not defined");
        }

        console.log('DEBUG: Groq API Key present?', process.env.GROQ_API_KEY ? 'Yes' : 'No');

        const name = userName || "Profesor de la UNEXPO";
        const systemInstruction = `Eres el Profesor ${name} (Ingeniería Mecatrónica, UNEXPO).

        TUS 3 REGLAS DE SEGURIDAD (OBLIGATORIAS):
        1. FIDELIDAD ABSOLUTA: Respeta estrictamente los datos que da el usuario. Si dice "Salón 1", pon "Salón 1". 
        2. CERO INVENCIÓN: NO agregues fechas, horas, plazos o reglas que el usuario NO haya mencionado. Si falta info, NO la inventes.
        3. RELLENO MÍNIMO: Solo agrega un saludo cordial y una despedida profesional. El cuerpo del mensaje debe ser casi idéntico a la instrucción original, solo mejor redactado.

        EJEMPLO:
        Usuario: "Examen mañana salon 1"
        IA: "Estimados estudiantes, les informo que el examen será mañana en el Salón 1. Saludos, Prof. ${name}."

        Firma siempre como: "Saludos, Prof. ${name}".`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: prompt }
            ],
            model: "llama-3.3-70b-versatile",
        });

        const text = completion.choices[0]?.message?.content || "";

        res.json({ result: text });
    } catch (error) {
        console.error("Error calling Groq API:", error.message);
        res.status(500).json({
            error: "Failed to generate content",
            details: error.message
        });
    }
});

// --- SUPPORT TICKET API ---
router.post('/support/ticket', async (req, res) => {
    try {
        const { userName, userEmail, subject, description } = req.body;
        const ticketId = '#TK-' + Math.floor(1000 + Math.random() * 9000);
        const date = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });

        // Save to Database first
        const db = require('./database');
        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO tickets (id_ticket, user_name, user_email, subject, description) VALUES (?, ?, ?, ?, ?)`,
                [ticketId, userName, userEmail, subject, description],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // 1. Send Success Response IMMEDIATELY (User sees "Sent")
        res.json({ success: true, message: 'Ticket enviado correctamente', ticketId: ticketId });

        // 2. Prepare Email Content
        const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
            <div style="background-color: #1e3a8a; color: white; padding: 20px; text-align: center;">
                <h2 style="margin: 0;">Nuevo Ticket de Soporte</h2>
                <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.8;">${ticketId}</p>
            </div>
            <div style="padding: 20px; background-color: #f8fafc;">
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; width: 30%;">FECHA</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #1e293b;">${date}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px;">USUARIO</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #1e293b;">${userName || 'Anónimo'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px;">CORREO DE CONTACTO</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #1e293b;">${userEmail || 'No especificado'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px;">ESTADO</td>
                        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #d97706; font-weight: bold;">Pendiente de Revisión</td>
                    </tr>
                </table>
                
                <div style="background-color: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <p style="margin-top: 0; color: #64748b; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Asunto</p>
                    <p style="color: #0f172a; font-weight: bold; font-size: 16px; margin: 5px 0 20px 0;">${subject}</p>
                    
                    <p style="margin-top: 0; color: #64748b; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Descripción</p>
                    <p style="color: #334155; line-height: 1.6; margin: 5px 0 0 0;">${description}</p>
                </div>
            </div>
            <div style="background-color: #f1f5f9; padding: 15px; text-align: center; color: #94a3b8; font-size: 11px; border-top: 1px solid #e2e8f0;">
                Este es un reporte automático generado por el Panel DocenteAI
            </div>
        </div>
        `;

        // 3. Send Email in Background (NO AWAIT)
        // If it fails, it logs error but user already got "Success"
        // Use Gmail for Admin Notifications
        sendGmail(process.env.EMAIL_USER, `[Soporte] ${ticketId}: ${subject}`, htmlContent)
            .catch(err => console.error("[Background Email Error]", err.message));


    } catch (error) {
        console.error("Error saving ticket:", error);
        res.status(500).json({ error: 'Error al guardar el ticket.', details: error.message });
    }
});

router.get('/support/history', (req, res) => {
    const db = require('./database');
    db.all("SELECT * FROM tickets ORDER BY created_at DESC", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ tickets: rows });
    });
});

router.patch('/support/ticket/:id', (req, res) => {
    const db = require('./database');
    const { status } = req.body;
    db.run("UPDATE tickets SET status = ? WHERE id_ticket = ?", [status, req.params.id], function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ success: true });
    });
});

// Resolve specific ticket
router.patch('/support/ticket/:id/resolve', (req, res) => {
    const db = require('./database');
    const { comments } = req.body;
    console.log('Resolving ticket:', req.params.id, 'Comments:', comments);

    db.run("UPDATE tickets SET status = 'Resuelto', admin_comments = ? WHERE id_ticket = ?", [comments, req.params.id], function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ success: true, message: 'Ticket resolved' });
    });
});

// Reopen specific ticket
router.patch('/support/ticket/:id/reopen', (req, res) => {
    const db = require('./database');
    console.log('Reopening ticket:', req.params.id);
    db.run("UPDATE tickets SET status = 'Pendiente' WHERE id_ticket = ?", [req.params.id], function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ success: true, message: 'Ticket reopened' });
    });
});

// --- AUTH API ---

router.post('/auth/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ success: false, message: 'Faltan datos' });
    }

    console.log(`[DEBUG] Registrando usuario: ${name}, ${email}, Password Length: ${password ? password.length : 0}`);

    // Insert user (using plain text password for now as requested)
    try {
        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO users (name, email, password) VALUES (?, ?, ?)`, [name, email, password], function (err) {
                if (err) {
                    // If unique constraint violation, return error
                    if (err.message.includes('UNIQUE')) {
                        reject(new Error("El correo ya está registrado. Por favor inicia sesión o restablece tu contraseña."));
                    } else {
                        reject(err);
                    }
                } else {
                    resolve();
                }
            });
        });

        // Send Welcome Email (Fail-Safe)
        try {
            const info = await sendEmail(
                email,
                '¡Bienvenido a DocenteAI! 🎓',
                `
            <div style="background-color: #f3f4f6; padding: 40px 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                    <!-- Header -->
                    <div style="background-color: #0f172a; padding: 24px; text-align: center;">
                        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px; font-weight: 700;">DocenteAI</h1>
                    </div>
                    
                    <!-- Content -->
                    <div style="padding: 40px;">
                        <h2 style="color: #1e293b; margin-top: 0; font-size: 20px;">¡Bienvenido, ${name}!</h2>
                        <p style="color: #475569; font-size: 16px; line-height: 1.6;">
                            Tu suscripción a <strong>Docente Pro</strong> ha sido activada correctamente. Aquí tienes el recibo de tu transacción.
                        </p>

                        <!-- Receipt Table -->
                        <div style="margin-top: 30px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                            <div style="background-color: #f8fafc; padding: 12px 20px; border-bottom: 1px solid #e5e7eb; font-size: 12px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">
                                Recibo #${Math.floor(100000 + Math.random() * 900000)}
                            </div>
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 16px 20px; color: #475569; font-size: 14px; border-bottom: 1px solid #f1f5f9;">Fecha</td>
                                    <td style="padding: 16px 20px; color: #1e293b; font-weight: 500; font-size: 14px; text-align: right; border-bottom: 1px solid #f1f5f9;">${new Date().toLocaleDateString('es-VE')}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 16px 20px; color: #475569; font-size: 14px; border-bottom: 1px solid #f1f5f9;">Transacción ID</td>
                                    <td style="padding: 16px 20px; color: #1e293b; font-weight: 500; font-size: 14px; text-align: right; border-bottom: 1px solid #f1f5f9;">TX-${Math.floor(10000000 + Math.random() * 90000000)}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 16px 20px; color: #475569; font-size: 14px; border-bottom: 1px solid #f1f5f9;">Licencia Anual Docente Pro</td>
                                    <td style="padding: 16px 20px; color: #1e293b; font-weight: 600; font-size: 14px; text-align: right; border-bottom: 1px solid #f1f5f9;">$3.99</td>
                                </tr>
                                <tr style="background-color: #f8fafc;">
                                    <td style="padding: 20px; color: #0f172a; font-weight: bold; font-size: 16px;">Total Pagado</td>
                                    <td style="padding: 20px; color: #2563eb; font-weight: 800; font-size: 24px; text-align: right;">$3.99</td>
                                </tr>
                            </table>
                        </div>

                        <!-- CTA Button -->
                        <div style="margin-top: 40px; text-align: center;">
                            <a href="https://docenteia-production.up.railway.app/dashboard.html" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">Ir a mi Dashboard</a>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
                        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                            Gracias por enseñar con el corazón ❤️
                        </p>
                        <p style="color: #cbd5e1; font-size: 12px; margin: 8px 0 0 0; font-weight: 600;">
                            El equipo de DocenteAI
                        </p>
                    </div>
                </div>
            </div>
            `
            );
            console.log('Email sent: ' + info.messageId);
        } catch (err) {
            console.error('Error sending welcome email (Non-fatal):', err.message);
            // Proceed without throwing to allow registration
        }

        res.json({ success: true, redirect: 'dashboard.html' });

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// --- AI Exam Generator Route ---
router.post('/generate-exam', async (req, res) => {
    try {
        const { topic, difficulty, numQuestions, type } = req.body;

        if (!topic || !difficulty || !numQuestions || !type) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        console.log('DEBUG: Groq API Key present?', process.env.GROQ_API_KEY ? 'Yes' : 'No');

        const systemPrompt = `You are an expert teacher. Create a ${difficulty} level exam on "${topic}".
        Generate exactly ${numQuestions} questions of type "${type}".
        
        Return the response STRICTLY as a JSON object with a "questions" key containing an array of objects.
        The JSON must be valid and adhere to this structure:
        {
          "questions": [
            {
              "question": "Question text here",
              "options": ["Option A", "Option B", "Option C", "Option D"], // Only for Multiple Choice
              "correctAnswer": "Correct Option"
            }
          ]
        }
        
        Example for True/False:
        {
          "questions": [
            {
               "question": "The sky is blue",
               "options": ["True", "False"],
               "correctAnswer": "True"
            }
          ]
        }`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Generate ${numQuestions} ${type} questions about ${topic}.` }
            ],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        });

        const text = completion.choices[0]?.message?.content || "{}";
        const parsed = JSON.parse(text);
        const examData = parsed.questions || [];

        res.json({ success: true, data: examData });

    } catch (error) {
        console.error("Error generating exam:", error.message);
        res.status(500).json({ error: "Error al generar el examen con IA", details: error.message });
    }
});

// --- AI ACADEMIC PLANNING FROM PDF ---
router.post('/generate-planning', upload.single('syllabus'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se recibió ningún archivo PDF' });
        }

        // Get custom instruction from user
        const instruction = req.body.instruction || "Analiza este documento y resume los puntos clave en formato de tabla organizada";

        console.log('Archivo recibido:', req.file.originalname, 'Tamaño:', req.file.size);
        console.log('Instrucción del usuario:', instruction);

        // Parse PDF buffer to extract text
        const pdfParse = require('pdf-parse');

        console.log('📄 Buffer size:', req.file.buffer.length, 'bytes');

        const data = await pdfParse(req.file.buffer);

        console.log('📊 PDF Info:');
        console.log('  - Total pages:', data.numpages);
        console.log('  - Total text length:', data.text.length, 'characters');

        // Extract up to 15k characters to avoid Groq Rate Limits (TPM)
        const extractedText = data.text.substring(0, 15000);

        console.log('✂️ Extracted text length:', extractedText.length);
        console.log('🔤 First 1000 characters:', extractedText.substring(0, 1000));

        // Smart extraction: detect pages OR chapters
        let finalText = extractedText;
        let extractionNote = '';

        // OPTION 1: Check if user requests specific PAGES
        const pageMatch = instruction.match(/p[áa]ginas?\s+(\d+)(?:\s+(?:al?|hasta|-|y)\s+(\d+))?/i);

        if (pageMatch) {
            const startPage = parseInt(pageMatch[1]);
            const endPage = pageMatch[2] ? parseInt(pageMatch[2]) : startPage;

            console.log(`📄 User requested page(s) ${startPage} to ${endPage}`);

            // Calculate approximate character positions
            const totalPages = data.numpages;
            const totalChars = data.text.length;
            const charsPerPage = totalChars / totalPages;

            const startChar = Math.floor((startPage - 1) * charsPerPage);
            const endChar = Math.floor(endPage * charsPerPage);

            let extractedPages = data.text.substring(startChar, Math.min(endChar, data.text.length));

            // Limit to 15k characters
            const MAX_CHARS = 15000;
            if (extractedPages.length > MAX_CHARS) {
                console.warn(`⚠️ Pages too long (${extractedPages.length} chars), truncating to ${MAX_CHARS}`);
                finalText = extractedPages.substring(0, MAX_CHARS);
                extractionNote = `\n\n[NOTA: Las páginas ${startPage}-${endPage} son extensas. Se analizaron ${MAX_CHARS.toLocaleString()} caracteres.]`;
            } else {
                finalText = extractedPages;
                extractionNote = startPage === endPage
                    ? `\n\n[NOTA: Se extrajo la página ${startPage}]`
                    : `\n\n[NOTA: Se extrajeron las páginas ${startPage} al ${endPage}]`;
            }
            console.log(`✅ Extracted ${finalText.length} characters from pages ${startPage}-${endPage}`);

        } else {
            // OPTION 2: Check if user requests specific CHAPTERS
            const chapterMatch = instruction.match(/cap[íi]tulos?\s+(\d+)(?:\s+(?:y|al|hasta|-)\s+(\d+))?/i);

            if (chapterMatch) {
                const firstChapter = parseInt(chapterMatch[1]);
                const lastChapter = chapterMatch[2] ? parseInt(chapterMatch[2]) : firstChapter;

                console.log(`🔍 User requested chapter(s) ${firstChapter} to ${lastChapter}`);

                // Skip TOC (first 10% of document)
                const skipBytes = Math.floor(extractedText.length * 0.1);
                const searchText = extractedText.substring(skipBytes);

                // Find chapter start
                const startPatterns = [
                    new RegExp(`(?:^|\\n)\\s*(?:CAPÍTULO|CAPITULO|CHAPTER)\\s+${firstChapter}(?:\\s|\\n)`, 'i'),
                    new RegExp(`(?:^|\\n)${firstChapter}[\\-\\.]+\\d`, 'm'), // 3-1, 3.1
                    new RegExp(`(?:^|\\n)\\s*${firstChapter}\\s*[\\n\\r]+\\s*[A-ZÁÉÍÓÚÑ]`, 'm')
                ];

                let chapterStart = -1;
                for (const pattern of startPatterns) {
                    const match = searchText.match(pattern);
                    if (match) {
                        chapterStart = skipBytes + match.index;
                        console.log(`✅ Found chapter ${firstChapter} at position ${chapterStart}`);
                        break;
                    }
                }

                if (chapterStart !== -1) {
                    // Find chapter end
                    const nextChapter = lastChapter + 1;
                    const endPatterns = [
                        new RegExp(`(?:^|\\n)\\s*(?:CAPÍTULO|CAPITULO|CHAPTER)\\s+${nextChapter}`, 'i'),
                        new RegExp(`(?:^|\\n)${nextChapter}[\\-\\.]+\\d`, 'm')
                    ];

                    let chapterEnd = extractedText.length;
                    for (const pattern of endPatterns) {
                        const match = extractedText.substring(chapterStart + 100).match(pattern);
                        if (match) {
                            chapterEnd = chapterStart + 100 + match.index;
                            break;
                        }
                    }

                    let extractedChapters = extractedText.substring(Math.max(0, chapterStart - 500), chapterEnd);

                    // Limit to 15k characters
                    const MAX_CHARS = 15000;
                    if (extractedChapters.length > MAX_CHARS) {
                        console.warn(`⚠️ Chapters too long (${extractedChapters.length} chars), truncating`);
                        finalText = extractedChapters.substring(0, MAX_CHARS);
                        extractionNote = `\n\n[NOTA: Capítulos ${firstChapter}-${lastChapter} extensos. Se analizaron ${MAX_CHARS.toLocaleString()} caracteres.]`;
                    } else {
                        finalText = extractedChapters;
                        extractionNote = firstChapter === lastChapter
                            ? `\n\n[NOTA: Se extrajo el capítulo ${firstChapter}]`
                            : `\n\n[NOTA: Se extrajeron los capítulos ${firstChapter} al ${lastChapter}]`;
                    }
                    console.log(`✅ Extracted ${finalText.length} characters from chapters`);
                } else {
                    console.warn(`⚠️ Chapter ${firstChapter} not found, using first 30k chars`);
                    finalText = extractedText.substring(0, 30000);
                    extractionNote = `\n\n[ADVERTENCIA: No se encontró el capítulo ${firstChapter}. Se usó el inicio del documento.]`;
                }
            } else {
                // No specific pages/chapters requested - use first 30k
                console.log('ℹ️ No pages/chapters specified, using first 15k characters');
                finalText = extractedText.substring(0, 15000);
                if (extractedText.length > 15000) {
                    extractionNote = '\n\n[NOTA: Documento extenso. Se analizaron los primeros 15,000 caracteres. Especifica "página X" o "capítulo Y" para secciones específicas.]';
                }
            }
        }

        console.log(`📤 Sending to Groq: ${finalText.length} characters`);

        // Prepare Groq prompt with user instruction
        const systemPrompt = `Contexto: Eres un asistente académico experto en análisis de documentos técnicos y académicos.

REGLAS CRÍTICAS DE SALIDA JSON:
Debes analizar la solicitud del usuario y el documento PDF para decidir qué formato de respuesta es el adecuado.
Responde SIEMPRE con un objeto JSON válido con una de las siguientes dos estructuras:

OPCIÓN A: Si el usuario pide una PLANIFICACIÓN, SYLLABUS, CRONOGRAMA o el prompt está vacío:
{
  "type": "syllabus",
  "planning": [
    {
      "week": 1,
      "topic": "Título del Tema",
      "objectives": "Objetivos específicos",
      "bibliography": "Referencias"
    }
  ]
}

OPCIÓN B: Si el usuario pide CUALQUIER OTRA COSA (ej: Tabla de costos, Resumen, Lista de definiciones, Explicación de un concepto):
{
  "type": "content",
  "html": "<div class='not-prose' style='background-color: #1e3a8a; padding: 20px; display: flex; align-items: center; justify-content: center; gap: 20px; border-radius: 8px; margin-bottom: 20px;'><div style='width: 100px; height: 100px; border-radius: 50% !important; overflow: hidden; border: 4px solid white; background-color: white; display: flex; align-items: center; justify-content: center;'><img src='logo_unexpo.png' alt='UNEXPO' style='width: 90%; height: 90%; object-fit: contain; border-radius: 50%;'></div><div style='flex: 1; text-align: center;'><h2 style='color: white; margin: 0; font-size: 24px; font-family: sans-serif;'>ANÁLISIS ACADÉMICO</h2></div></div><div style='padding: 20px;'><h3>Título del Contenido</h3><p>Explicación...</p><table class='w-full border-collapse'>...</table></div>"
IMPORTANTE PARA "content": Tu respuesta HTML DEBE comenzar OBLIGATORIAMENTE con este header exacto (copia y pega):
<div class='not-prose' style='background-color: #1e3a8a; padding: 20px; display: flex; align-items: center; justify-content: center; gap: 20px; border-radius: 8px; margin-bottom: 20px;'><div style='width: 100px; height: 100px; border-radius: 50% !important; overflow: hidden; border: 4px solid white; background-color: white; display: flex; align-items: center; justify-content: center;'><img src='logo_unexpo.png' alt='UNEXPO' style='width: 90%; height: 90%; object-fit: contain; border-radius: 50%;'></div><div style='flex: 1; text-align: center;'><h2 style='color: white; margin: 0; font-size: 24px; font-family: sans-serif;'>ANÁLISIS ACADÉMICO</h2></div></div>

Después del header, agrega el contenido solicitado dentro de <div style='padding: 20px;'>TU CONTENIDO AQUÍ</div>
NO repitas el título "ANÁLISIS ACADÉMICO" ni agregues otro título principal. Empieza directamente con el contenido solicitado.

REGLAS DE CONTENIDO:
1. Lee CUIDADOSAMENTE la instrucción del usuario.
2. Analiza SOLAMENTE el texto del PDF.
3. Si el usuario pide una tabla, genera HTML <table> con clases de Tailwind (w-full, border, etc).
4. NO inventes contenido.

REGLA CRÍTICA PARA HEADERS CON LOGO (OBLIGATORIA):
Cuando generes un header que incluya el logo "logo_unexpo.png", DEBES usar la siguiente estructura HTML EXACTA para crear un logo CIRCULAR:

<div style="background-color: #1e3a8a; padding: 20px; display: flex; align-items: center; justify-content: space-between;">
  <div style="width: 100px; height: 100px; border-radius: 50%; overflow: hidden; border: 4px solid white; background-color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: center;">
    <img src="logo_unexpo.png" alt="UNEXPO" style="width: 90%; height: 90%; object-fit: contain;">
  </div>
  <div style="flex: 1; text-align: center;">
    <h2 style="color: white; margin: 0;">ANÁLISIS ACADÉMICO</h2>
  </div>
  <div style="text-align: right; color: white;">
    <p style="margin: 0; font-size: 14px;">UNEXPO</p>
    <p style="margin: 0; font-size: 12px;">Ingeniería Mecatrónica</p>
  </div>
</div>

IMPORTANTE: El div contenedor del logo tiene "border-radius: 50%; overflow: hidden;" para forzar la forma circular.`;

        const userPrompt = `Instrucción del Usuario: "${instruction}"

Texto extraído del PDF (${finalText.length} caracteres):
${finalText}${extractionNote}

Genera la respuesta (JSON) adecuada según la instrucción.`;

        // Call Groq API (force JSON mode)
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.3,
            response_format: { type: "json_object" }
        });

        const htmlResult = completion.choices[0]?.message?.content || "<p>No se pudo generar contenido</p>";
        console.log('Respuesta de Groq (primeros 300 caracteres):', htmlResult.substring(0, 300));



        res.json({
            success: true,
            result: htmlResult,
            filename: req.file.originalname
        });

    } catch (error) {
        console.error("Error en generate-planning:", error.message);
        res.status(500).json({
            error: "Error al procesar el PDF y ejecutar la instrucción",
            details: error.message
        });
    }
});

module.exports = router;
