const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const Groq = require('groq-sdk');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Usa key real en prod

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

//  RUTA DE WEBHOOK STRIPE (Debe ir ANTES de middlewares de JSON globales para usar express.raw si fuera necesario, pero simplificaremos aquí para parseo normal si webhook no usa firmas estrictas, OJO: en PROD requiere express.raw para validar firma)
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const payload = req.body;
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        // En desarrollo local o si no hay secret configurado, saltamos validación (solo educativo, NO para prod)
        if (endpointSecret && sig) {
            event = stripe.webhooks.constructEvent(payload, sig, endpointSecret);
        } else {
            // Peligroso pero útil si no tienes el webhook secret a mano temporalmente
            event = JSON.parse(payload.toString());
        }
    } catch (err) {
        console.error('⚠️ Error de Webhook de Stripe:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Manejar el evento
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        // Obtener el email del cliente de Stripe
        const customerEmail = session.customer_details ? session.customer_details.email : null;

        if (customerEmail) {
            console.log(`💰 Pago exitoso para: ${customerEmail}. Actualizando a plan Pro...`);

            // Actualizar usuario en Supabase
            try {
                const { error } = await supabase
                    .from('historial')
                    .update({ plan: 'pro', fecha_pago: new Date().toISOString() }) // Asegúrate de tener estas columnas, o usa el campo apropiado
                    .eq('email', customerEmail)
                    .eq('accion', 'REGISTRO NUEVO USUARIO');

                if (error) {
                    console.error('❌ Error actualizando plan en Supabase para', customerEmail, error.message);
                } else {
                    console.log(`✅ Plan Pro activado en DB para: ${customerEmail}`);
                }
            } catch (dbErr) {
                console.error('❌ Error de BD al procesar Webhook:', dbErr.message);
            }
        }
    }

    // Retorna 200 siempre a Stripe para confirmar recepción
    res.json({ received: true });
});

// Configuración básica (Se movieron debajo del webhook para que el webhook pueda usar raw body si es necesario)
const allowedOrigins = ['https://docente-ia.vercel.app', 'http://localhost:3000'];
app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Configure multer for PDF uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// 👁️ ESTA ES LA LLAVE: Le dice al servidor que busque tus archivos index.html, dashboard.html, etc.
app.use(express.static(__dirname));

// Configuración de Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuración de Groq AI
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Ruta principal: Cuando entres a localhost:5000, te enviará al index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// RUTA DE LOG: Para guardar correos y claves en Supabase
app.post('/api/log-actividad', async (req, res) => {
    try {
        const { email, nombre, accion } = req.body;
        const { data, error } = await supabase
            .from('historial')
            .insert([{ email, nombre, accion }]);

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

// 🛡️ RATE LIMITER PARA LOGIN (5 intentos cada 15 min por IP)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5,
    message: { success: false, error: 'Demasiados intentos de inicio de sesión. Inténtalo de nuevo en 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// 🚀 RUTA DE LOGIN: Autenticación real con bcrypt + JWT
app.post('/api/auth/login', loginLimiter, async (req, res) => {
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
                nombre: usuario.nombre,
                universidad: usuario.universidad || '',
                cargo: usuario.cargo || ''
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

        // 3. Guardar en Supabase con el hash y obtener el ID
        const { data: newUser, error: insertError } = await supabase
            .from('historial')
            .insert([{
                email,
                password: hashedPassword,
                nombre,
                accion: 'REGISTRO NUEVO USUARIO',
                universidad: institucion || null,
                especialidad: departamento || null,
                cargo: cargo || null
            }])
            .select('*');

        if (insertError) throw insertError;

        const insertedUser = newUser[0];
        console.log(`✅ Nuevo usuario registrado: ${nombre} <${email}>`);

        // 4. Firmar JWT con 24h de expiración
        const token = jwt.sign(
            { id: insertedUser.id, email: insertedUser.email, nombre: insertedUser.nombre },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        return res.status(201).json({
            success: true,
            message: 'Registro exitoso. Serás redirigido a Stripe.',
            token,
            nombre: nombre, // root level for backward compatibility
            user: {
                id: insertedUser.id,
                email,
                name: nombre, // Used by some parts of the frontend
                nombre,
                institucion,
                departamento,
                cargo,
                plan: 'gratis' // Por defecto
            }
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

        const MAX_CHARS = 20000;
        let finalText = data.text.substring(0, MAX_CHARS);
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

            if (extractedPages.length > MAX_CHARS) {
                finalText = extractedPages.substring(0, MAX_CHARS);
                extractionNote = `\n\n[NOTA: El texto ha sido truncado por límites de sistema para páginas ${startPage}-${endPage}. Úsalo como referencia junto al índice]`;
            } else {
                finalText = extractedPages;
                extractionNote = startPage === endPage
                    ? `\n[NOTA: Página ${startPage} extraída]`
                    : `\n[NOTA: Páginas ${startPage}-${endPage} extraídas]`;
            }
        } else if (data.text.length > MAX_CHARS) {
            extractionNote = '\n\n[NOTA: El texto ha sido truncado por límites de sistema. Busca el ÍNDICE o CONTENIDO al inicio para elaborar el plan]';
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
4. NO inventes datos que no estén en el PDF
REGLA 1: Solo puedes usar los temas, capítulos y títulos EXACTOS que aparecen en el texto proporcionado. PROHIBIDO inventar números de capítulos.
REGLA 2: Distribuye el contenido real del documento a lo largo de las semanas de forma lógica. No uses relleno genérico como 'Semana de revisión' a menos que ya hayas agotado el contenido técnico del PDF.
REGLA 3: PROHIBIDO INVENTAR NÚMEROS DE PÁGINA. Si vas a citar, extrae el número de página real donde aparece el tema. Si no estás seguro de la página, cita solo el Título del Tema, pero NUNCA inventes números.
REGLA 4: Debes analizar la totalidad del documento subido. Es OBLIGATORIO que el plan de 16 semanas abarque desde el primer tema hasta el ÚLTIMO tema del documento. No cortes el temario por la mitad para rellenar las semanas, condensa los temas iniciales si es necesario para asegurar que los temas finales (ej. Criptografía, IA, etc.) se incluyan en las últimas semanas del plan.
REGLA 5: Es posible que recibas el texto truncado. Si es así, busca la sección de ÍNDICE o CONTENIDO al principio del documento y basa estrictamente tu plan de 16 semanas en esos temas listados, abarcando desde el primer hasta el último tema del índice.`;

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
        const { message, profesor } = req.body;
        const nombreProfesor = profesor || 'Docente';

        if (!message) {
            return res.status(400).json({ success: false, error: 'Mensaje vacío.' });
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
            from: 'DocenteAI <onboarding@resend.dev>', // El remitente autorizado
            to: 'gustavoenriquetriana@gmail.com', // Destinatario autorizado
            bcc: validEmails, // Aquí van tus alumnos
            subject: `Nuevo comunicado de Docente ${nombreProfesor}`,
            html: `<p>${message.replace(/\n/g, '<br>')}</p>`,
            text: message
        });

        if (sendResponse.error) {
            console.error('Resend error:', sendResponse.error);
            return res.status(500).json({ success: false, error: 'Error al enviar usando el servicio de correo.' });
        }

        // Registrar uso de IA (Gamificación)
        try {
            await supabase.from('uso_ia').insert([{
                profesor_id: req.user.id,
                minutos_ahorrados: 15,
                accion: 'Envío de comunicado masivo'
            }]);
        } catch (e) { console.error('Error registrando uso IA:', e); }

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

// 10. Estadísticas de Clases Hoy
app.get('/api/stats/clases-hoy', verifyToken, async (req, res) => {
    try {
        const hoy = new Date();
        const year = hoy.getFullYear();
        const month = String(hoy.getMonth() + 1).padStart(2, '0');
        const day = String(hoy.getDate()).padStart(2, '0');
        const fechaHoy = `${year}-${month}-${day}`;

        const { data, error } = await supabase
            .from('tasks')
            .select('title')
            .eq('user_id', req.user.id)
            .eq('date', fechaHoy)
            .eq('type', 'clase');

        if (error) throw error;

        const totalClases = data ? data.length : 0;
        let mensaje = 'Día libre';
        if (totalClases > 0) {
            mensaje = 'Agendadas hoy';
        }

        res.json({ success: true, totalClases, mensaje });
    } catch (error) {
        console.error('Error al obtener clases hoy:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 10b. Estadísticas Por Calificar
app.get('/api/stats/por-calificar', verifyToken, async (req, res) => {
    try {
        const hoy = new Date();
        const year = hoy.getFullYear();
        const month = String(hoy.getMonth() + 1).padStart(2, '0');
        const day = String(hoy.getDate()).padStart(2, '0');
        const fechaHoy = `${year}-${month}-${day}`;

        const tiposCalificables = ['examen', 'practica', 'exposicion', 'defensa', 'revision'];

        const { data, error } = await supabase
            .from('tasks')
            .select('id')
            .eq('user_id', req.user.id)
            .lt('date', fechaHoy)
            .in('type', tiposCalificables);

        if (error) throw error;

        const pendientes = data ? data.length : 0;
        const mensaje = pendientes > 0 ? 'Evaluaciones atrasadas' : 'Al día';

        res.json({ success: true, pendientes, mensaje });
    } catch (error) {
        console.error('Error al obtener pendientes por calificar:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 10c. Estadísticas de Tiempo Ahorrado con IA
app.get('/api/stats/tiempo-ahorrado', verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('uso_ia')
            .select('minutos_ahorrados')
            .eq('profesor_id', req.user.id);

        if (error) throw error;

        let totalMinutos = 0;
        if (data && data.length > 0) {
            totalMinutos = data.reduce((acc, curr) => acc + (curr.minutos_ahorrados || 0), 0);
        }

        let tiempoStr = '';
        if (totalMinutos < 60) {
            tiempoStr = `${totalMinutos} min`;
        } else {
            tiempoStr = `${parseFloat((totalMinutos / 60).toFixed(1))}h`;
        }

        res.json({ success: true, tiempo: tiempoStr, mensaje: 'Ahorrados con IA' });
    } catch (error) {
        console.error('Error obteniendo tiempo ahorrado:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 10d. Estadísticas de Rendimiento (Gráfico)
app.get('/api/stats/rendimiento', verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('estudiantes')
            .select('materia, nota')
            .eq('user_id', req.user.id);

        if (error) throw error;

        const agrupar = {};
        data.forEach(s => {
            const mat = s.materia || 'General';
            if (!agrupar[mat]) { agrupar[mat] = { sum: 0, count: 0 }; }
            agrupar[mat].sum += parseFloat(s.nota || 0);
            agrupar[mat].count++;
        });

        const labels = [];
        const chartData = [];
        for (const [materia, info] of Object.entries(agrupar)) {
            labels.push(materia);
            chartData.push(parseFloat((info.sum / info.count).toFixed(1)));
        }

        res.json({ success: true, labels, data: chartData });
    } catch (error) {
        console.error('Error al generar estadísticas:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- SISTEMA DE EVALUACIONES DINÁMICAS ---

// 8c. Obtener Historial de Evaluaciones de un Estudiante - GET
app.get('/api/evaluaciones/:estudianteId', verifyToken, async (req, res) => {
    try {
        const { estudianteId } = req.params;

        // Primero verificamos que el estudiante pertenezca al profesor (seguridad)
        const { data: studentCheck, error: studentError } = await supabase
            .from('estudiantes')
            .select('id')
            .eq('id', estudianteId)
            .eq('user_id', req.user.id)
            .single();

        if (studentError || !studentCheck) {
            return res.status(404).json({ success: false, error: 'Estudiante no encontrado o no autorizado.' });
        }

        // Si es válido, buscamos sus evaluaciones
        const { data, error } = await supabase
            .from('evaluaciones')
            .select('*')
            .eq('estudiante_id', estudianteId)
            .order('creado_en', { ascending: false });

        if (error) throw error;

        res.json({ success: true, evaluaciones: data });
    } catch (error) {
        console.error('Error al obtener evaluaciones:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 8d. Añadir Evaluación y Recalcular Nota Final - POST
app.post('/api/evaluaciones', verifyToken, async (req, res) => {
    try {
        const { estudiante_id, tipo, nota, peso_porcentual } = req.body;

        // 1. Verificación de Seguridad
        const { data: studentCheck, error: studentError } = await supabase
            .from('estudiantes')
            .select('id')
            .eq('id', estudiante_id)
            .eq('user_id', req.user.id)
            .single();

        if (studentError || !studentCheck) {
            return res.status(404).json({ success: false, error: 'Estudiante no autorizado.' });
        }

        // 2. Insertar Nueva Evaluación
        const { error: insertError } = await supabase
            .from('evaluaciones')
            .insert([{
                estudiante_id,
                tipo,
                nota: parseFloat(nota),
                peso_porcentual: parseFloat(peso_porcentual)
            }]);

        if (insertError) throw insertError;

        // 3. Consultar TODAS las evaluaciones para recalcular la nota final
        const { data: evaluaciones, error: evalsError } = await supabase
            .from('evaluaciones')
            .select('tipo, nota, peso_porcentual')
            .eq('estudiante_id', estudiante_id);

        if (evalsError) throw evalsError;

        // 4. Calcular Nota Final Segura (Reglamento UNEXPO - Absoluto)
        let sumaRegulares = 0;
        let porcentajeTotal = 0; // Se mantiene por si el frontend lo necesita
        let menorRegularPuntos = Infinity;
        let tieneSustitutiva = false;
        let puntosSustitutiva = 0;

        evaluaciones.forEach(ev => {
            const puntos = parseFloat(ev.nota); // La nota YA SON los puntos directos (Ej: 18)
            const peso = parseFloat(ev.peso_porcentual); // Referencia

            porcentajeTotal += peso;

            if (ev.tipo === 'sustitutiva') {
                tieneSustitutiva = true;
                puntosSustitutiva += puntos;
            } else {
                // Es una evaluación regular
                sumaRegulares += puntos;
                if (puntos < menorRegularPuntos) {
                    menorRegularPuntos = puntos;
                }
            }
        });

        // Aplicar regla de sustitutiva: resta la regular más baja y suma la sustitutiva
        let sumaFinal = sumaRegulares;
        if (tieneSustitutiva && menorRegularPuntos !== Infinity) {
            sumaFinal = sumaFinal - menorRegularPuntos + puntosSustitutiva;
        }

        // 5. Determinar nuevo estado (Regla Universidad: 0-100, Aprobado >= 50)
        const nuevoEstado = sumaFinal >= 50 ? 'aprobado' : 'riesgo';

        // 6. Actualizar la tabla principal de Estudiantes
        const { error: updateError } = await supabase
            .from('estudiantes')
            .update({
                nota: parseFloat(sumaFinal.toFixed(2)),
                estado: nuevoEstado
            })
            .eq('id', estudiante_id)
            .eq('user_id', req.user.id);

        if (updateError) throw updateError;

        res.json({
            success: true,
            nuevaNota: parseFloat(sumaFinal.toFixed(2)),
            nuevoEstado,
            porcentajeAcumulado: porcentajeTotal
        });

    } catch (error) {
        console.error('Error al procesar evaluación:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ----------------------------------------

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

// 9c. Cambiar Contraseña (Gamificación / Seguridad)
app.put('/api/user/password', verifyToken, async (req, res) => {
    try {
        const { passwordActual, nuevaPassword } = req.body;

        if (!passwordActual || !nuevaPassword) {
            return res.status(400).json({ success: false, error: 'Ambas contraseñas son requeridas.' });
        }

        // Obtener usuario del historial
        const { data: users, error: userError } = await supabase
            .from('historial')
            .select('id, password')
            .eq('id', req.user.id);

        if (userError) throw userError;

        if (!users || users.length === 0) {
            return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
        }

        const user = users[0];

        // Comparar contraseñas
        const match = await bcrypt.compare(passwordActual, user.password);
        if (!match) {
            return res.status(400).json({ success: false, error: 'La contraseña actual es incorrecta' });
        }

        // Hashear nueva contraseña
        const saltRounds = 10;
        const hashedNewPassword = await bcrypt.hash(nuevaPassword, saltRounds);

        // Actualizar tabla
        const { error: updateError } = await supabase
            .from('historial')
            .update({ password: hashedNewPassword })
            .eq('id', req.user.id);

        if (updateError) throw updateError;

        res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
    } catch (error) {
        console.error('Error al cambiar contraseña:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 9d. Gestión de Materias (Multitenant)
app.get('/api/materias', verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('materias')
            .select('*')
            .eq('profesor_id', req.user.id)
            .order('nombre', { ascending: true });

        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (error) {
        console.error('Error al obtener materias:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/materias', verifyToken, async (req, res) => {
    try {
        const { nombre } = req.body;
        if (!nombre || nombre.trim() === '') {
            return res.status(400).json({ success: false, error: 'El nombre de la materia es requerido.' });
        }

        const { data, error } = await supabase
            .from('materias')
            .insert([{ profesor_id: req.user.id, nombre: nombre.trim() }])
            .select();

        if (error) throw error;
        res.json({ success: true, data: data[0] });
    } catch (error) {
        console.error('Error al agregar materia:', error.message);
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

// 11. Sistema de Soporte y Tickets
app.get('/api/support/tickets', verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('tickets')
            .select(`
                id,
                creado_en,
                profesor_id,
                asunto,
                descripcion,
                estado
            `)
            .order('creado_en', { ascending: false });

        if (error) {
            console.error("Supabase Select Error:", error);
            throw error;
        }

        res.status(200).json({ success: true, tickets: data });
    } catch (error) {
        console.error("Error fetching tickets:", error.message);
        res.status(500).json({ success: false, error: "Error interno al obtener los tickets." });
    }
});

app.post('/api/support/ticket', verifyToken, async (req, res) => {
    const { asunto, descripcion } = req.body;

    if (!asunto || !descripcion) {
        return res.status(400).json({ error: "El asunto y la descripción son obligatorios." });
    }

    try {
        const { data, error } = await supabase
            .from('tickets')
            .insert([
                {
                    profesor_id: req.user.id,
                    asunto: asunto,
                    descripcion: descripcion,
                    estado: 'Abierto' // Opcional, dependiendo de los defaults en Supabase
                }
            ])
            .select();

        if (error) {
            console.error("Supabase Insert Error:", error);
            throw error;
        }

        res.status(201).json({
            success: true,
            mensaje: 'Ticket enviado correctamente',
            ticket: data[0]
        });

    } catch (error) {
        console.error("Error al crear ticket:", error.message);
        res.status(500).json({ success: false, error: "Error interno al enviar el ticket." });
    }
});

app.put('/api/support/ticket/:id/status', verifyToken, async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    if (!estado) {
        return res.status(400).json({ error: "El nuevo estado es obligatorio." });
    }

    try {
        const { data, error } = await supabase
            .from('tickets')
            .update({ estado: estado })
            .eq('id', id)
            .select();

        if (error) {
            console.error("Supabase Update Error:", error);
            throw error;
        }

        res.status(200).json({
            success: true,
            mensaje: 'Estado del ticket actualizado',
            ticket: data[0]
        });

    } catch (error) {
        console.error("Error al actualizar estado del ticket:", error.message);
        res.status(500).json({ success: false, error: "Error interno al actualizar el ticket." });
    }
});

app.get('/api/support/my-tickets', verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('tickets')
            .select('*')
            .eq('profesor_id', req.user.id)
            .order('creado_en', { ascending: false });

        if (error) {
            console.error("Supabase Select Error:", error);
            throw error;
        }

        res.status(200).json({ success: true, tickets: data });
    } catch (error) {
        console.error("Error fetching user tickets:", error.message);
        res.status(500).json({ success: false, error: "Error interno al obtener tu historial de tickets." });
    }
});

// GET user automation settings
app.get('/api/settings/automation', verifyToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('user_settings')
            .select('recordatorios_clase, resumen_semanal')
            .eq('profesor_id', req.user.id)
            .single();

        if (error && error.code !== 'PGRST116') { // Ignore "No rows found" error
            throw error;
        }

        if (!data) {
            return res.status(200).json({ success: true, recordatorios_clase: false, resumen_semanal: false });
        }

        res.status(200).json({ success: true, ...data });
    } catch (error) {
        console.error("Error fetching automation settings:", error.message);
        res.status(500).json({ success: false, error: "Error interno al obtener configuración." });
    }
});

// POST upsert user automation settings
app.post('/api/settings/automation', verifyToken, async (req, res) => {
    const { recordatorios_clase, resumen_semanal } = req.body;

    // Convert string to boolean if necessary
    const isRemindersOn = recordatorios_clase === true || recordatorios_clase === 'true';
    const isSummaryOn = resumen_semanal === true || resumen_semanal === 'true';

    try {
        const { error } = await supabase
            .from('user_settings')
            .upsert({
                profesor_id: req.user.id,
                recordatorios_clase: isRemindersOn,
                resumen_semanal: isSummaryOn
            }, { onConflict: 'profesor_id' }); // Ensures it updates if exists, inserts if not

        if (error) throw error;

        res.status(200).json({ success: true, mensaje: "Configuración guardada" });
    } catch (error) {
        console.error("Error saving automation settings:", error.message);
        res.status(500).json({ success: false, error: "Error interno al guardar configuración." });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});