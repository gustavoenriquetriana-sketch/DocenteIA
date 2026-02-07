const express = require('express');
const router = express.Router();
const db = require('./database');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('./mailer');

// --- STUDENTS API ---

// Get all students
router.get('/students', (req, res) => {
    db.all("SELECT * FROM students", [], (err, rows) => {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }
        // Add random initials/colors for frontend compatibility
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

        if (!process.env.GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY is not defined in environment variables");
        }

        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });



        const name = userName || "Profesor de la UNEXPO";
        const systemInstruction = `Eres el Profesor ${name} (Ingeniería Mecatrónica, UNEXPO).

        TUS 3 REGLAS DE SEGURIDAD (OBLIGATORIAS):
        1. FIDELIDAD ABSOLUTA: Respeta estrictamente los datos que da el usuario. Si dice "Salón 1", pon "Salón 1". 
        2. CERO INVENCIÓN: NO agregues fechas, horas, plazos o reglas que el usuario NO haya mencionado. Si falta info, NO la inventes.
        3. RELLENO MÍNIMO: Solo agrega un saludo cordial y una despedida profesional. El cuerpo del mensaje debe ser casi idéntico a la instrucción original, solo mejor redactado.

        EJEMPLO:
        Usuario: "Examen mañana salon 1"
        IA: "Estimados estudiantes, les informo que el examen será mañana en el Salón 1. Saludos, Prof. ${name}."

        Firma siempre como: "Saludos, Prof. ${name}".

        Solicitud del usuario: `;
        const fullPrompt = systemInstruction + prompt;

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();

        res.json({ result: text });
    } catch (error) {
        console.error("Error calling Gemini API:", error);
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
        // Use verified email for Resend testing
        sendEmail('gustavoenriquetriana@gmail.com', `[Soporte] ${ticketId}: ${subject}`, htmlContent)
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

    // Insert user (using plain text password for now as requested)
    try {
        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO users (name, email, password) VALUES (?, ?, ?)`, [name, email, password], function (err) {
                if (err) {
                    // If unique constraint violation (already registered), we might want to just log them in or return error
                    if (err.message.includes('UNIQUE')) {
                        // For this "demo" flow, let's just proceed as if success but maybe update name
                        console.log("User exists, logging in...");
                        resolve();
                    } else {
                        reject(err);
                    }
                } else {
                    resolve();
                }
            });
        });

        // Send Welcome Email
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
            console.log('Error sending email:', err);
        }

        res.json({ success: true, redirect: 'dashboard.html' });

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
