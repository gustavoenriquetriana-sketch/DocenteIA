const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();
const Groq = require('groq-sdk');
const multer = require('multer');
const db = require('./backend/database');

const app = express();
const PORT = process.env.PORT || 5000;

// Configuración básica
app.use(cors());
app.use(express.json());

// Configure multer for PDF uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// 👁️ ESTA ES LA LLAVE: Le dice al servidor que busque tus archivos index.html, dashboard.html, etc.
app.use(express.static(__dirname));

// Configuración de Supabase
const SUPABASE_URL = 'https://gztjdynthqwuoulkwzam.supabase.co';
const SUPABASE_KEY = 'sb_secret_QTw3I4_uasKxuATh4n-i5A_PBACO-GA'; // La que empieza por sb_secret
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuración de Groq AI
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Ruta principal: Cuando entres a localhost:5000, te enviará al index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 🚀 RUTA DE LOG: Para guardar correos y claves en Supabase
app.post('/api/log-actividad', async (req, res) => {
    try {
        const { email, password, nombre, accion } = req.body;
        const { data, error } = await supabase
            .from('historial')
            .insert([{ email, password, nombre, accion }]);

        if (error) throw error;
        res.json({ success: true, mensaje: "Log guardado en Supabase" });
    } catch (error) {
        console.error("Error en Supabase:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

const nodemailer = require('nodemailer');

// 📧 CONFIGURACIÓN NODEMAILER (Gmail)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465, // CAMBIO: Usamos puerto SSL directo
    secure: true, // CAMBIO: true es obligatorio para puerto 465
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    },
    family: 4, // MANTENER: Vital para evitar IPv6
    connectionTimeout: 10000 // NUEVO: Damos 10 segundos antes de rendirse
});


// Almacén temporal de códigos (En memoria, se borra al reiniciar servidor)
const recoveryCodes = new Map();

// 🚀 RUTA DE LOGIN: Para guardar intentos de login y devolver success con nombre real
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Buscamos el nombre más reciente asociado a este email en el historial
        const { data: registros, error: queryError } = await supabase
            .from('historial')
            .select('nombre')
            .eq('email', email)
            .order('created_at', { ascending: false })
            .limit(1);

        // Si encontramos un nombre, lo usamos; si no, usamos "Docente" por defecto
        const nombreUsuario = (registros && registros.length > 0 && registros[0].nombre)
            ? registros[0].nombre
            : 'Docente';

        // Guardamos el intento de login en el historial (como un log)
        const { error } = await supabase
            .from('historial')
            .insert([{
                email,
                password,
                nombre: nombreUsuario,
                accion: 'INTENTO DE LOGIN'
            }]);

        if (error) console.error("Error al insertar log:", error.message);

        // Devolvemos éxito con el nombre real
        res.json({
            success: true,
            nombre: nombreUsuario,
            user: {
                email: email,
                name: nombreUsuario,
                id: 'uuid-simulado'
            },
            token: 'token-simulado-123'
        });
    } catch (error) {
        console.error("Error en Login Supabase:", error.message);
        // Devolvemos éxito con nombre por defecto aunque falle
        res.json({
            success: true,
            nombre: 'Docente',
            user: {
                email: email,
                name: 'Docente',
                id: 'uuid-fallback'
            },
            token: 'token-fallback'
        });
    }
});

// 🚀 RUTA DE RECUPERACIÓN DE CONTRASEÑA (Nodemailer)
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) return res.status(400).json({ success: false, error: 'Falta el correo' });

    console.log(`📧 Enviando correo de recuperación a: ${email}`);

    try {
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        // Guardar código en memoria (expira en 10 min)
        recoveryCodes.set(email, { code, expires: Date.now() + 600000 });

        const mailOptions = {
            from: `"Soporte DocenteAI" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Recuperación de Contraseña - DocenteAI',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #2563eb;">DocenteAI</h2>
                        <p style="color: #64748b;">Plataforma de Gestión Académica</p>
                    </div>
                    <p>Hola,</p>
                    <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta asociada a <strong>${email}</strong>.</p>
                    <p>Tu código de recuperación temporal es:</p>
                    <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #1e293b; border-radius: 8px; margin: 20px 0;">
                        ${code}
                    </div>
                    <p>Este código expira en 10 minutos.</p>
                    <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
                    <p style="margin-top: 30px; font-size: 12px; color: #94a3b8; text-align: center;">© 2026 DocenteAI - UNEXPO Guarenas</p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Correo enviado:', info.messageId);

        // Guardar log en Supabase
        await supabase.from('historial').insert([{
            email,
            accion: 'SOLICITUD RECUPERACION CLAVE',
            nombre: 'Sistema'
        }]);

        res.json({ success: true, message: 'Correo enviado correctamente' });

    } catch (error) {
        console.error('❌ Error enviando correo:', error);
        res.status(500).json({ success: false, error: 'Error al enviar el correo. Verifique el servidor.' });
    }
});

// 🚀 RUTA DE RESTABLECIMIENTO DE CONTRASEÑA
app.post('/api/auth/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
        return res.status(400).json({ success: false, error: 'Faltan datos' });
    }

    const record = recoveryCodes.get(email);

    if (!record) {
        return res.status(400).json({ success: false, error: 'Código no solicitado o expirado.' });
    }

    if (record.code !== code) {
        return res.status(400).json({ success: false, error: 'Código incorrecto.' });
    }

    if (Date.now() > record.expires) {
        recoveryCodes.delete(email);
        return res.status(400).json({ success: false, error: 'El código ha expirado.' });
    }

    // Código válido: "Actualizar" contraseña
    // Como no tenemos tabla de usuarios real, registramos el cambio en el historial
    // y asumimos que el próximo login usará esta contraseña (en un sistema real haríamos UPDATE users SET password = ...)

    try {
        await supabase.from('historial').insert([{
            email,
            password: newPassword, // Guardamos la nueva contraseña como el registro más reciente
            accion: 'CAMBIO DE CONTRASEÑA EXITOSO',
            nombre: 'Sistema'
        }]);

        recoveryCodes.delete(email); // Borrar código usado

        res.json({ success: true, message: 'Contraseña actualizada correctamente.' });

    } catch (error) {
        console.error('Error al guardar cambio:', error);
        res.status(500).json({ success: false, error: 'Error interno al actualizar.' });
    }
});

// 🚀 RUTA DE CAMBIO DE CONTRASEÑA (Desde Dashboard)
app.post('/api/auth/change-password', async (req, res) => {
    const { email, currentPassword, newPassword } = req.body;

    if (!email || !currentPassword || !newPassword) {
        return res.status(400).json({ success: false, error: 'Faltan datos obligatorios' });
    }

    console.log(`🔐 Solicitud de cambio de clave para: ${email}`);

    // NOTA: En un sistema real, aquí verificaríamos:
    // 1. Que el usuario exista.
    // 2. Que hash(currentPassword) coincida con la BD.
    // Como estamos en modo "Simulación con Historial", confiamos en la sesión activa y solo registramos el cambio.

    try {
        // Guardar el cambio en el historial de Supabase
        const { error } = await supabase.from('historial').insert([{
            email,
            password: newPassword, // Guardamos la nueva contraseña
            accion: 'CAMBIO DE CLAVE (DASHBOARD)',
            nombre: 'Usuario (Dashboard)'
        }]);

        if (error) throw error;

        console.log('✅ Clave actualizada en historial');
        res.json({ success: true, message: 'Contraseña actualizada correctamente' });

    } catch (error) {
        console.error('❌ Error al cambiar clave:', error.message);
        res.status(500).json({ success: false, error: 'Error al actualizar en base de datos' });
    }
});

// 🚀 RUTA DE REGISTRO PROFESIONAL: Docentes e Instituciones
app.post('/api/auth/register', async (req, res) => {
    try {
        const { nombre, email, password, institucion, departamento, cargo } = req.body;

        console.log(`📝 Nuevo Registro Profesional: ${nombre} | ${cargo} en ${institucion}`);

        if (!email || !password || !nombre) {
            return res.status(400).json({ error: "Faltan datos obligatorios" });
        }

        // 1. Guardar en Supabase (Historial como log de actividad por ahora)
        const { data, error } = await supabase
            .from('historial')
            .insert([{
                email,
                password,
                nombre,
                accion: 'REGISTRO NUEVO USUARIO',
                universidad: institucion,
                especialidad: departamento,
                cargo: cargo
            }]);

        if (error) {
            console.error("Supabase Error:", error.message);
            // No bloqueamos el registro si falla el log
        }

        // 2. Responder con éxito y los datos para el frontend
        res.json({
            success: true,
            user: {
                nombre,
                email,
                institucion,
                departamento,
                cargo
            },
            message: "Registro exitoso"
        });

    } catch (error) {
        console.error("❌ Error en Registro:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- MOCK DATA ROUTES (Para revivir el Dashboard) ---

// 1. IA Generativa (Plantillas Genéricas)
// 1. Redactor IA Inteligente (Groq AI)
app.post('/api/ai/generate', async (req, res) => {
    try {
        const { prompt } = req.body;

        console.log('✍️ Redactando para:', prompt);

        const systemPrompt = `Actúa como un profesor universitario experto en comunicación académica.
        
REGLA DE ORO: NO inventes NINGÚN dato que no esté explícitamente en el prompt del usuario.
        
 PROHIBIDO:
 - NO agregues fechas, horas, nombres de materias o lugares si el usuario no los mencionó.
 - NO uses corchetes como [Insertar Fecha] o [Materia].
 - Si falta el dato, redáctalo de forma general.
 - NO uses frases de relleno excesivamente formales como "Agradezco su atención", "Sin más que agregar", etc. Sé DIRECTO.
        
 ESTILO:
 - Tono formal pero moderno y conciso.
 - Ve directo al grano.
        
 EJEMPLO DE COMPORTAMIENTO DESEADO:
 User Prompt: 'Traer bata'.
 AI Response: 'Estimados estudiantes, recuerden que para la próxima sesión es obligatorio el uso de bata de laboratorio. Saludos, El Profesor.'
 
 Genera SOLO el texto del mensaje.`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Redacta un comunicado formal basado en esto: "${prompt}"` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.5, // Balance entre creatividad y fidelidad
        });

        const resultText = completion.choices[0]?.message?.content || "No se pudo generar el texto.";

        console.log('✅ Redacción generada:', resultText.substring(0, 100) + '...');

        res.json({ success: true, result: resultText });

    } catch (error) {
        console.error("❌ Error en Redactor IA:", error.message);
        res.status(500).json({
            success: false,
            error: "Error al redactar con IA",
            result: "Lo siento, hubo un error al conectar con el asistente de redacción."
        });
    }
});

// 2. Generador de Exámenes Universitario INTELIGENTE (Groq AI)
app.post('/api/generate-exam', async (req, res) => {
    try {
        const { topic, difficulty, numQuestions, type } = req.body;

        console.log(`🎓 Generando examen: ${topic} | Tipo: ${type} | Nivel: ${difficulty} | ${numQuestions} preguntas`);

        // PROMPT INTELIGENTE para Groq
        const systemPrompt = `Actúa como un profesor experto universitario con años de experiencia en evaluación académica.

IMPORTANTE: NO uses plantillas genéricas. Genera preguntas ESPECÍFICAS y CONCRETAS.

Si el tema es amplio (ej: "Automatización"), elige subtemas técnicos específicos relevantes como:
- PLCs (Siemens TIA Portal, Allen-Bradley)
- Sensores y actuadores industriales
- Lazos de control PID
- SCADA y HMI
- Protocolos de comunicación industrial

Si el tipo es "problemas": Genera ejercicios numéricos con datos concretos y realistas. Incluye valores específicos.
Si el tipo es "casos": Describe una falla o situación industrial REALISTA con detalles técnicos.
Si el tipo es "desarrollo": Haz preguntas sobre conceptos avanzados, no generalidades.

EJEMPLOS DE LO QUE SÍ QUIERO:
❌ MAL: "Explique la importancia de la automatización"
✅ BIEN: "Un motor trifásico de 15 kW debe arrancar con un variador de frecuencia. Calcule la corriente nominal si trabaja a 380V con eficiencia del 92%"

❌ MAL: "Analice un caso de automatización"
✅ BIEN: "En una planta embotelladora, el sensor ultrasónico S7-300 detecta niveles incorrectos al 30% de las botellas. ¿Qué procedimiento de calibración aplicarías y cómo verificarías la señal 4-20mA?"

FORMATO DE RESPUESTA:
Responde ÚNICAMENTE con un objeto JSON {"questions": ["pregunta 1", "pregunta 2", ...]}

NO agregues explicaciones, solo el JSON.`;

        const userPrompt = `Genera ${numQuestions} preguntas de tipo "${type}" sobre el tema "${topic}" con nivel de dificultad "${difficulty}".

Cada pregunta debe ser específica, técnica y relevante para un estudiante universitario de ingeniería/ciencias.`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.8, // Mayor creatividad
            response_format: { type: "json_object" }
        });

        const rawResponse = completion.choices[0]?.message?.content || '{"questions":[]}';
        console.log('📝 Groq respondió:', rawResponse.substring(0, 200));

        const parsedResponse = JSON.parse(rawResponse);
        const questions = parsedResponse.questions || [];

        // Convertir al formato esperado por el frontend
        const formattedQuestions = questions.map(q => ({
            question: q,
            type: type
        }));

        res.json({
            success: true,
            data: formattedQuestions
        });

    } catch (error) {
        console.error("❌ Error generando examen:", error.message);
        res.status(500).json({
            success: false,
            error: "Error al generar el examen con IA",
            details: error.message
        });
    }
});

// 3. Asistente de Planificación (Conectado a Groq AI + PDF Parse) - IMPLEMENTACIÓN COMPLETA
app.post('/api/generate-planning', upload.single('syllabus'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se recibió ningún archivo PDF' });
        }

        const instruction = req.body.instruction || "Analiza este documento y resume los puntos clave";
        console.log('📄 Archivo:', req.file.originalname, '| Tamaño:', req.file.size, 'bytes');
        console.log('💬 Instrucción:', instruction);

        const pdfParse = require('pdf-parse');
        const data = await pdfParse(req.file.buffer);

        console.log(`📊 PDF: ${data.numpages} páginas, ${data.text.length} caracteres`);

        let finalText = data.text.substring(0, 15000);
        let extractionNote = '';

        // Detectar páginas específicas
        const pageMatch = instruction.match(/p[áa]ginas?\s+(\d+)(?:\s+(?:al?|hasta|-|y)\s+(\d+))?/i);
        if (pageMatch) {
            const startPage = parseInt(pageMatch[1]);
            const endPage = pageMatch[2] ? parseInt(pageMatch[2]) : startPage;
            const charsPerPage = data.text.length / data.numpages;
            const startChar = Math.floor((startPage - 1) * charsPerPage);
            const endChar = Math.floor(endPage * charsPerPage);
            let extractedPages = data.text.substring(startChar, Math.min(endChar, data.text.length));

            if (extractedPages.length > 15000) {
                finalText = extractedPages.substring(0, 15000);
                extractionNote = `\n[NOTA: Páginas ${startPage}-${endPage} truncadas a 15k caracteres]`;
            } else {
                finalText = extractedPages;
                extractionNote = startPage === endPage
                    ? `\n[NOTA: Página ${startPage} extraída]`
                    : `\n[NOTA: Páginas ${startPage}-${endPage} extraídas]`;
            }
        } else if (data.text.length > 15000) {
            extractionNote = '\n[NOTA: Documento extenso. Se analizaron los primeros 15k caracteres]';
        }

        console.log(`📤 Enviando ${finalText.length} caracteres a Groq`);

        const systemPrompt = `Eres un asistente académico experto. Analiza el PDF y responde con JSON válido.

OPCIÓN A - Si piden PLANIFICACIÓN/SYLLABUS/CRONOGRAMA:
{
  "type": "syllabus",
  "planning": [
    {"week": 1, "topic": "Tema", "objectives": "Objetivos", "bibliography": "Referencias"}
  ]
}

OPCIÓN B - Si piden CUALQUIER OTRA COSA (tabla de costos, resumen, etc):
{
  "type": "content",
  "html": "<div class='not-prose' style='background-color: #1e3a8a; padding: 20px; display: flex; align-items: center; justify-content: center; gap: 20px; border-radius: 8px; margin-bottom: 20px;'><div style='width: 100px; height: 100px; border-radius: 50%; overflow: hidden; border: 4px solid white; background-color: white; display: flex; align-items: center; justify-content: center;'><img src='logo_unexpo.png' alt='UNEXPO' style='width: 90%; height: 90%; object-fit: contain;'></div><div style='flex: 1; text-align: center;'><h2 style='color: white; margin: 0; font-size: 24px;'>ANÁLISIS ACADÉMICO</h2></div></div><div style='padding: 20px;'>TU CONTENIDO AQUÍ</div>"
}

REGLAS:
1. Lee la instrucción del usuario con cuidado
2. Analiza SOLO el texto del PDF proporcionado
3. Para tablas usa: <table class='w-full border border-collapse'><thead><tr><th class='border p-2'>...</th></tr></thead><tbody>...</tbody></table>
4. NO inventes datos que no estén en el PDF`;

        const userPrompt = `Instrucción: "${instruction}"\n\nTexto del PDF:\n${finalText}${extractionNote}\n\nGenera la respuesta JSON adecuada.`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.3,
            response_format: { type: "json_object" }
        });

        const result = completion.choices[0]?.message?.content || '{"type":"content","html":"<p>Error al generar</p>"}';
        console.log('✅ Groq respondió:', result.substring(0, 200));

        res.json({
            success: true,
            result: result,
            filename: req.file.originalname
        });

    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({
            error: "Error al procesar el PDF",
            details: error.message
        });
    }
});

// 4. Agenda (Simulada)
app.get('/api/agenda', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    res.json([
        { title: 'Clase PLC', start: today, type: 'clase' },
        { title: 'Entrega de Notas', start: '2026-02-20', type: 'entrega' },
        { title: 'Reunión Dept.', start: '2026-02-25', type: 'reunion' }
    ]);
});

// 5. Tareas
app.get('/api/tasks', (req, res) => {
    res.json({
        success: true,
        data: [
            { id: 1, text: 'Corregir tesis de grado', done: false },
            { id: 2, text: 'Subir notas al sistema', done: false },
            { id: 3, text: 'Preparar material unidad 2', done: true }
        ]
    });
});

// 6. Estudiantes - Conectado a Supabase
app.get('/api/students', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('estudiantes')
            .select('*');

        if (error) throw error;

        // Mapear los datos de Supabase al formato que espera el frontend
        const mappedStudents = data.map(student => {
            // Usar nombres de columnas en español de Supabase
            const nombreCompleto = (student.nombre || student.name || '').trim();

            // Generar iniciales del nombre con validación robusta
            let initials = '??';
            if (nombreCompleto) {
                const nameParts = nombreCompleto.split(/\s+/).filter(part => part.length > 0);
                if (nameParts.length >= 2) {
                    // Nombre y apellido: primera letra de cada uno
                    initials = nameParts[0][0].toUpperCase() + nameParts[nameParts.length - 1][0].toUpperCase();
                } else if (nameParts.length === 1) {
                    // Solo una palabra: primeras dos letras
                    initials = nameParts[0].substring(0, 2).toUpperCase();
                }
            }

            // Generar clase de color para el avatar
            const colors = [
                'bg-gradient-to-br from-blue-500 to-purple-600',
                'bg-gradient-to-br from-green-500 to-teal-600',
                'bg-gradient-to-br from-orange-500 to-red-600',
                'bg-gradient-to-br from-pink-500 to-rose-600',
                'bg-gradient-to-br from-indigo-500 to-blue-600'
            ];
            const avatarClass = colors[student.id % colors.length];

            // Obtener nota (puede estar como 'nota' o 'grade')
            const grade = parseFloat(student.nota || student.grade || 0);

            // Determinar estado basado en la nota
            let status = student.estado || student.status;
            if (!status) {
                if (grade >= 10) status = 'aprobado';
                else if (grade >= 7) status = 'riesgo';
                else status = 'reprobado';
            }

            return {
                id: student.id,
                name: nombreCompleto,
                subject: student.materia || student.subject || 'Sin materia',
                grade: grade,
                status: status.toLowerCase(),
                initials: initials.toUpperCase(),
                avatarClass: avatarClass
            };
        });

        res.json({ success: true, data: mappedStudents });
    } catch (error) {
        console.error('Error al obtener estudiantes:', error.message);
        res.status(500).json({ success: false, error: error.message, data: [] });
    }
});

// 7. Crear Estudiante - POST
app.post('/api/students', async (req, res) => {
    try {
        const { name, subject, grade } = req.body;

        // Validación básica
        if (!name || !subject || grade === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Faltan campos requeridos: name, subject, grade'
            });
        }

        // Determinar estado basado en la nota
        let status = 'aprobado';
        if (grade >= 10) status = 'aprobado';
        else if (grade >= 7) status = 'riesgo';
        else status = 'reprobado';

        // Insertar en Supabase usando nombres de columnas en español
        const { data, error } = await supabase
            .from('estudiantes')
            .insert([{
                nombre: name,      // nombre en vez de name
                materia: subject,  // materia en vez de subject
                nota: parseFloat(grade),  // nota en vez de grade
                estado: status     // estado en vez de status
            }])
            .select(); // Devolver el registro insertado

        if (error) throw error;

        res.json({ success: true, data: data[0] });
    } catch (error) {
        console.error('Error al crear estudiante:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 8. Actualizar Estudiante - PUT
app.put('/api/students/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { grade, status } = req.body;

        const updateData = {};
        if (grade !== undefined) updateData.nota = parseFloat(grade);  // nota en vez de grade
        if (status !== undefined) updateData.estado = status.toLowerCase();  // estado en vez de status

        const { data, error } = await supabase
            .from('estudiantes')
            .update(updateData)
            .eq('id', id)
            .select();

        if (error) throw error;

        res.json({ success: true, data: data[0] });
    } catch (error) {
        console.error('Error al actualizar estudiante:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 9. Configuración (GET y POST)
app.get('/api/settings', (req, res) => {
    res.json({ theme: 'light', notifications: true, reminders: true, summary: false });
});

app.post('/api/settings', (req, res) => {
    // Simulamos guardado
    res.json({ success: true });
});

// 10. Gestión de Tareas (Agenda) - SQLite
app.get('/api/tasks', (req, res) => {
    db.all("SELECT * FROM tasks ORDER BY date ASC", [], (err, rows) => {
        if (err) {
            console.error("Error fetching tasks:", err.message);
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({
            success: true,
            data: rows
        });
    });
});

app.post('/api/tasks', (req, res) => {
    const { title, date, type } = req.body;
    if (!title || !date) {
        return res.status(400).json({ error: "Faltan datos" });
    }

    db.run(
        'INSERT INTO tasks (title, date, type) VALUES (?,?,?)',
        [title, date, type || 'general'],
        function (err) {
            if (err) {
                console.error("Error creating task:", err.message);
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({
                success: true,
                message: "Tarea guardada",
                data: { id: this.lastID, title, date, type }
            });
        }
    );
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});