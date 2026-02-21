const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();
const Groq = require('groq-sdk');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 5000;

// Configuración básica
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// 📧 CONFIGURACIÓN RESEND (API HTTP - Sin bloqueo de puertos SMTP)
const resend = new Resend(process.env.RESEND_API_KEY);

// 🔐 CONSTANTES DE AUTENTICACIÓN
const SALT_ROUNDS = 10;

// 🛡️ MIDDLEWARE DE AUTENTICACIÓN JWT
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Token de autenticación requerido.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ success: false, error: 'Token inválido o expirado. Inicia sesión nuevamente.' });
    }
};

// 🚀 RUTA DE LOGIN: Autenticación real con bcrypt + JWT
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email y contraseña son requeridos.' });
    }

    try {
        // 1. Buscar el registro de registro del usuario (no logs de login)
        const { data: usuarios, error: queryError } = await supabase
            .from('historial')
            .select('*')
            .eq('email', email)
            .eq('accion', 'REGISTRO NUEVO USUARIO')
            .order('created_at', { ascending: false })
            .limit(1);

        if (queryError) throw queryError;

        if (!usuarios || usuarios.length === 0) {
            return res.status(401).json({ success: false, error: 'Credenciales incorrectas.' });
        }

        const usuario = usuarios[0];

        // 2. Comparar contraseña con hash almacenado
        const passwordValida = await bcrypt.compare(password, usuario.password);
        if (!passwordValida) {
            return res.status(401).json({ success: false, error: 'Credenciales incorrectas.' });
        }

        // 3. Firmar JWT con 24h de expiración
        const token = jwt.sign(
            { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // 4. Registrar log de login exitoso (sin password)
        await supabase.from('historial').insert([{
            email,
            nombre: usuario.nombre,
            accion: 'LOGIN EXITOSO'
        }]);

        res.json({
            success: true,
            token,
            nombre: usuario.nombre,
            user: {
                id: usuario.id,
                email: usuario.email,
                name: usuario.nombre,
                nombre: usuario.nombre
            }
        });

    } catch (error) {
        console.error('❌ Error en Login:', error.message);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// 🚀 RUTA DE RECUPERACIÓN DE CONTRASEÑA (Supabase + Resend)
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) return res.status(400).json({ success: false, error: 'Falta el correo.' });

    try {
        // 1. Verificar que el usuario exista en la tabla historial
        const { data: usuarios, error: userError } = await supabase
            .from('historial')
            .select('id, nombre')
            .eq('email', email)
            .eq('accion', 'REGISTRO NUEVO USUARIO')
            .limit(1);

        if (userError) throw userError;

        if (!usuarios || usuarios.length === 0) {
            return res.status(404).json({ success: false, error: 'No existe una cuenta con ese correo.' });
        }

        const usuario = usuarios[0];

        // 2. Generar código de 6 dígitos
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        // 3. Calcular expiración: ahora + 15 minutos
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        // 4. Eliminar tokens previos de este usuario (evitar acumulación)
        await supabase
            .from('recovery_tokens')
            .delete()
            .eq('user_id', usuario.id);

        // 5. Insertar nuevo token en Supabase
        const { error: insertError } = await supabase
            .from('recovery_tokens')
            .insert([{ user_id: usuario.id, token: code, expires_at: expiresAt }]);

        if (insertError) throw insertError;

        // 6. Enviar el correo via Resend
        const { data: emailData, error: emailError } = await resend.emails.send({
            from: 'Soporte DocenteAI <onboarding@resend.dev>',
            to: [email],
            subject: 'Recuperación de Contraseña - DocenteAI',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #2563eb;">DocenteAI</h2>
                        <p style="color: #64748b;">Plataforma de Gestión Académica</p>
                    </div>
                    <p>Hola, <strong>${usuario.nombre}</strong></p>
                    <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta asociada a <strong>${email}</strong>.</p>
                    <p>Tu código de recuperación temporal es:</p>
                    <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e293b; border-radius: 8px; margin: 20px 0;">
                        ${code}
                    </div>
                    <p>⏱️ Este código expira en <strong>15 minutos</strong>.</p>
                    <p>Si no solicitaste este cambio, puedes ignorar este correo con seguridad.</p>
                    <p style="margin-top: 30px; font-size: 12px; color: #94a3b8; text-align: center;">© 2026 DocenteAI - UNEXPO Guarenas</p>
                </div>
            `
        });

        if (emailError) throw emailError;

        console.log(`✅ Código de recuperación enviado a ${email} | Resend ID: ${emailData.id}`);

        res.json({ success: true, message: 'Correo enviado correctamente.' });

    } catch (error) {
        console.error('❌ Error en forgot-password:', error.message);
        res.status(500).json({ success: false, error: 'Error al procesar la solicitud.' });
    }
});

// 🚀 RUTA DE RESTABLECIMIENTO DE CONTRASEÑA (Supabase - Sin RAM)
app.post('/api/auth/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
        return res.status(400).json({ success: false, error: 'Faltan datos: email, code y newPassword son requeridos.' });
    }

    try {
        // 1. Buscar el user_id a partir del email
        const { data: usuarios, error: userError } = await supabase
            .from('historial')
            .select('id')
            .eq('email', email)
            .eq('accion', 'REGISTRO NUEVO USUARIO')
            .limit(1);

        if (userError) throw userError;

        if (!usuarios || usuarios.length === 0) {
            return res.status(404).json({ success: false, error: 'No existe una cuenta con ese correo.' });
        }

        const userId = usuarios[0].id;

        // 2. Buscar el token en recovery_tokens
        const { data: tokens, error: tokenError } = await supabase
            .from('recovery_tokens')
            .select('*')
            .eq('user_id', userId)
            .eq('token', code)
            .limit(1);

        if (tokenError) throw tokenError;

        if (!tokens || tokens.length === 0) {
            return res.status(400).json({ success: false, error: 'Código incorrecto o no solicitado.' });
        }

        const tokenRecord = tokens[0];

        // 3. Verificar caducidad
        if (new Date() > new Date(tokenRecord.expires_at)) {
            // Purgar token expirado de la BD
            await supabase.from('recovery_tokens').delete().eq('id', tokenRecord.id);
            return res.status(400).json({ success: false, error: 'El código ha expirado. Solicita uno nuevo.' });
        }

        // 4. ¡CRÍTICO! Hashear la nueva contraseña antes de guardar
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // 5. UPDATE real en historial: actualizar contraseña del usuario registrado
        const { error: updateError } = await supabase
            .from('historial')
            .update({ password: hashedPassword })
            .eq('id', userId)
            .eq('accion', 'REGISTRO NUEVO USUARIO');

        if (updateError) throw updateError;

        // 6. Eliminar token usado (evitar ataques de repetición / Replay Attack)
        await supabase.from('recovery_tokens').delete().eq('id', tokenRecord.id);

        console.log(`✅ Contraseña restablecida para user_id: ${userId}`);

        res.json({ success: true, message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });

    } catch (error) {
        console.error('❌ Error en reset-password:', error.message);
        res.status(500).json({ success: false, error: 'Error interno al restablecer la contraseña.' });
    }
});

// 🚀 RUTA DE CAMBIO DE CONTRASEÑA (Desde Dashboard) - Protegida con JWT
app.post('/api/auth/change-password', verifyToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id; // Viene del JWT — no del body

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, error: 'Faltan datos: currentPassword y newPassword son requeridos.' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ success: false, error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
    }

    try {
        // 1. Obtener el hash actual del usuario autenticado (por ID, no por email)
        const { data: usuarios, error: userError } = await supabase
            .from('historial')
            .select('id, password')
            .eq('id', userId)
            .eq('accion', 'REGISTRO NUEVO USUARIO')
            .limit(1);

        if (userError) throw userError;

        if (!usuarios || usuarios.length === 0) {
            return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
        }

        const usuario = usuarios[0];

        // 2. Verificar contraseña actual con bcrypt
        const passwordValida = await bcrypt.compare(currentPassword, usuario.password);
        if (!passwordValida) {
            return res.status(401).json({ success: false, error: 'La contraseña actual es incorrecta.' });
        }

        // 3. Hashear la nueva contraseña
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // 4. UPDATE en historial por ID (operación atómica y segura)
        const { error: updateError } = await supabase
            .from('historial')
            .update({ password: hashedPassword })
            .eq('id', userId)
            .eq('accion', 'REGISTRO NUEVO USUARIO');

        if (updateError) throw updateError;

        console.log(`✅ Contraseña cambiada para user_id: ${userId}`);
        res.json({ success: true, message: 'Contraseña actualizada correctamente.' });

    } catch (error) {
        console.error('❌ Error al cambiar clave:', error.message);
        res.status(500).json({ success: false, error: 'Error al actualizar la contraseña.' });
    }
});

// 🚀 RUTA DE REGISTRO PROFESIONAL: Con hash bcrypt + verificación de duplicados
app.post('/api/auth/register', async (req, res) => {
    const { nombre, email, password, institucion, departamento, cargo } = req.body;

    if (!email || !password || !nombre) {
        return res.status(400).json({ success: false, error: 'Faltan datos obligatorios: nombre, email y contraseña.' });
    }

    try {
        // 1. Verificar si el email ya está registrado
        const { data: existentes, error: checkError } = await supabase
            .from('historial')
            .select('email')
            .eq('email', email)
            .eq('accion', 'REGISTRO NUEVO USUARIO')
            .limit(1);

        if (checkError) throw checkError;

        if (existentes && existentes.length > 0) {
            return res.status(409).json({ success: false, error: 'Este email ya está registrado. Inicia sesión o recupera tu contraseña.' });
        }

        // 2. Aplicar hash criptográfico a la contraseña
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // 3. Guardar en Supabase con el hash (nunca texto plano)
        const { error: insertError } = await supabase
            .from('historial')
            .insert([{
                email,
                password: hashedPassword,
                nombre,
                accion: 'REGISTRO NUEVO USUARIO',
                universidad: institucion || null,
                especialidad: departamento || null,
                cargo: cargo || null
            }]);

        if (insertError) throw insertError;

        console.log(`✅ Nuevo usuario registrado: ${nombre} <${email}>`);

        return res.status(201).json({
            success: true,
            message: 'Registro exitoso. Ya puedes iniciar sesión.',
            user: { nombre, email, institucion, departamento, cargo }
        });

    } catch (error) {
        console.error('❌ Error en Registro:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- MOCK DATA ROUTES (Para revivir el Dashboard) ---

// 1. Redactor IA Inteligente (Groq AI) - Protegido con JWT
app.post('/api/ai/generate', verifyToken, async (req, res) => {
    try {
        const { prompt } = req.body;
        const userId = req.user.id; // Disponible para futuro historial de IA por usuario

        console.log(`✍️ Redactando para user_id: ${userId} | prompt: ${prompt?.substring(0, 60)}...`);

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

// 2. Generador de Exámenes Universitario INTELIGENTE (Groq AI) - Protegido con JWT
app.post('/api/generate-exam', verifyToken, async (req, res) => {
    try {
        const { topic, difficulty, numQuestions, type } = req.body;
        const userId = req.user.id; // Disponible para historial futuro

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

// 3. Asistente de Planificación (Groq AI + PDF Parse) - Protegido con JWT
// NOTA: upload.single() va primero (procesa el multipart), luego verifyToken valida el JWT en el header
app.post('/api/generate-planning', upload.single('syllabus'), verifyToken, async (req, res) => {
    try {
        const userId = req.user.id; // Disponible para registrar planificaciones por usuario en el futuro
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

// 4. Agenda - Eliminada mock, redirigida internamente a /api/tasks (ya con user_id)
// El frontend usa directamente /api/tasks. Esta ruta se mantiene como alias protegido.
app.get('/api/agenda', verifyToken, (req, res) => {
    res.redirect(307, '/api/tasks');
});


// 6. Estudiantes - Conectado a Supabase (Ruta protegida + Tenancy)
app.get('/api/students', verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('estudiantes')
            .select('*')
            .eq('user_id', req.user.id) // 🔒 Solo los estudiantes de este profesor
            .order('id', { ascending: true });

        if (error) throw error;

        // Mapear los datos de Supabase al formato que espera el frontend
        const mappedStudents = (data || []).map(student => {
            const nombreCompleto = (student.nombre || student.name || '').trim();

            let initials = '??';
            if (nombreCompleto) {
                const nameParts = nombreCompleto.split(/\s+/).filter(part => part.length > 0);
                if (nameParts.length >= 2) {
                    initials = nameParts[0][0].toUpperCase() + nameParts[nameParts.length - 1][0].toUpperCase();
                } else if (nameParts.length === 1) {
                    initials = nameParts[0].substring(0, 2).toUpperCase();
                }
            }

            const colors = [
                'bg-gradient-to-br from-blue-500 to-purple-600',
                'bg-gradient-to-br from-green-500 to-teal-600',
                'bg-gradient-to-br from-orange-500 to-red-600',
                'bg-gradient-to-br from-pink-500 to-rose-600',
                'bg-gradient-to-br from-indigo-500 to-blue-600'
            ];
            const avatarClass = colors[student.id % colors.length];

            const grade = parseFloat(student.nota || student.grade || 0);

            let status = student.estado || student.status;
            if (!status) {
                if (grade >= 10) status = 'aprobado';
                else if (grade >= 7) status = 'riesgo';
                else status = 'reprobado';
            }

            return {
                id: student.id,
                name: nombreCompleto,
                email: student.email || '',
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

// 7. Crear Estudiante - POST (Ruta protegida + Tenancy)
app.post('/api/students', verifyToken, async (req, res) => {
    try {
        const { name, email, subject, grade } = req.body;

        if (!name || !subject || grade === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Faltan campos requeridos: name, subject, grade'
            });
        }

        let status = 'aprobado';
        if (grade >= 10) status = 'aprobado';
        else if (grade >= 7) status = 'riesgo';
        else status = 'reprobado';

        const { data, error } = await supabase
            .from('estudiantes')
            .insert([{
                nombre: name,
                email: email || null,
                materia: subject,
                nota: parseFloat(grade),
                estado: status,
                user_id: req.user.id  // 🔒 Asociar al profesor autenticado
            }])
            .select();

        if (error) throw error;

        res.json({ success: true, data: data[0] });
    } catch (error) {
        console.error('Error al crear estudiante:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 8. Actualizar Estudiante - PUT (Ruta protegida + Tenancy)
app.put('/api/students/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { grade, status, email } = req.body;

        const updateData = {};
        if (grade !== undefined) updateData.nota = parseFloat(grade);
        if (status !== undefined) updateData.estado = status.toLowerCase();
        if (email !== undefined) updateData.email = email || null;

        const { data, error } = await supabase
            .from('estudiantes')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', req.user.id) // 🔒 Solo puede editar sus propios estudiantes
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({ success: false, error: 'Estudiante no encontrado o no autorizado.' });
        }

        res.json({ success: true, data: data[0] });
    } catch (error) {
        console.error('Error al actualizar estudiante:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 9. Enviar Comunicado Masivo (Ruta protegida + Tenancy)
app.post('/api/send-announcement', verifyToken, async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, error: 'El mensaje es requerido.' });
        }

        // Obtener correos de los estudiantes del profesor
        const { data, error } = await supabase
            .from('estudiantes')
            .select('email')
            .eq('user_id', req.user.id)
            .not('email', 'is', null)
            .neq('email', '');

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(400).json({ success: false, error: 'No tienes estudiantes con dirección de correo electrónico.' });
        }

        const validEmails = data.map(s => s.email).filter(e => e && e.includes('@'));

        if (validEmails.length === 0) {
            return res.status(400).json({ success: false, error: 'Ningún estudiante tiene un correo válido.' });
        }

        // Configurar envío BCC
        const sendResponse = await resend.emails.send({
            from: 'DocenteAI <onboarding@resend.dev>', // Asumiendo default de resend para prueba
            to: req.user.email || 'profesor@docenteai.com', // El TO puede ser el profe
            bcc: validEmails,
            subject: 'Nuevo Comunicado de tu Profesor',
            html: `<p>${message.replace(/\n/g, '<br>')}</p>`,
            text: message
        });

        if (sendResponse.error) {
            console.error('Resend error:', sendResponse.error);
            return res.status(500).json({ success: false, error: 'Error al enviar usando el servicio de correo.' });
        }

        res.json({ success: true, count: validEmails.length });
    } catch (error) {
        console.error('Error al enviar comunicado masivo:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 8b. Eliminar Estudiante - DELETE (Ruta protegida + Tenancy)
app.delete('/api/students/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('estudiantes')
            .delete()
            .eq('id', id)
            .eq('user_id', req.user.id) // 🔒 Solo puede borrar sus propios estudiantes
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({ success: false, error: 'Estudiante no encontrado o no autorizado.' });
        }

        res.json({ success: true, message: 'Estudiante eliminado correctamente.' });
    } catch (error) {
        console.error('Error al eliminar estudiante:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 9. Configuración de usuario - Supabase (Aislamiento por user_id)
app.get('/api/settings', verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('user_settings')
            .select('*')
            .eq('user_id', req.user.id)
            .limit(1);

        if (error) throw error;

        if (!data || data.length === 0) {
            // Si no tiene configuración aún, retornar defaults
            return res.json({ theme: 'light', reminders: true, summary: false });
        }

        res.json(data[0]);
    } catch (error) {
        console.error('Error al obtener settings:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/settings', verifyToken, async (req, res) => {
    const { reminders, summary, theme } = req.body;
    try {
        // UPSERT: inserta si no existe, actualiza si ya existe
        const { error } = await supabase
            .from('user_settings')
            .upsert(
                { user_id: req.user.id, reminders, summary, theme: theme || 'light' },
                { onConflict: 'user_id' }
            );

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Error al guardar settings:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 10. Gestión de Tareas (Agenda) - Supabase (Aislamiento por usuario)
app.get('/api/tasks', verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('user_id', req.user.id)
            .order('date', { ascending: true });

        if (error) throw error;

        res.json({ success: true, data: data || [] });
    } catch (error) {
        console.error("Error fetching tasks:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks', verifyToken, async (req, res) => {
    const { title, date, type } = req.body;
    if (!title || !date) {
        return res.status(400).json({ error: "Faltan datos" });
    }

    try {
        const { data, error } = await supabase
            .from('tasks')
            .insert([{ title, date, type: type || 'general', user_id: req.user.id }])
            .select();

        if (error) throw error;

        res.json({
            success: true,
            message: "Tarea guardada",
            data: data[0]
        });
    } catch (error) {
        console.error("Error creating task:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/tasks/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', id)
            .eq('user_id', req.user.id); // Solo puede borrar sus propias tareas

        if (error) throw error;

        res.json({ success: true, message: 'Tarea eliminada' });
    } catch (error) {
        console.error('Error deleting task:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});