// script.js

// 1. CALCULADORA DE AHORRO
const hoursInput = document.getElementById('input-hours');
const rateInput = document.getElementById('input-rate');

function calcularAhorro() {
    if (!hoursInput || !rateInput) return;

    const hours = parseFloat(hoursInput.value) || 0;
    const rate = parseFloat(rateInput.value) || 0;
    const subsPrice = 3.99;

    // Update display
    const displayHours = document.getElementById('display-hours');
    if (displayHours) displayHours.innerText = hours + 'h';

    // Fórmulas
    const monthlySavings = (hours * rate) * 4;
    const semesterSavings = monthlySavings * 6;
    const semesterTime = hours * 24;

    // ROI Calculation
    const hoursToPay = rate > 0 ? (subsPrice / rate).toFixed(1) : 0;
    let roiMessage = "Se paga sola en " + hoursToPay + "h";
    if (hoursToPay < 1 && hoursToPay > 0) roiMessage = "Se paga sola en minutos";

    // Update UI
    const elSavings = document.getElementById('result-savings');
    const elSemester = document.getElementById('result-semester');
    const elTime = document.getElementById('result-time');
    const elRoi = document.getElementById('roi-text');

    if (elSavings) elSavings.innerText = '$' + monthlySavings.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (elSemester) elSemester.innerText = '$' + semesterSavings.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (elTime) elTime.innerText = semesterTime + 'h';
    if (elRoi) elRoi.innerText = roiMessage;
}

// Event Listeners (Backup if oninput fails)
if (hoursInput && rateInput) {
    hoursInput.addEventListener('input', calcularAhorro);
    rateInput.addEventListener('input', calcularAhorro);
}

// 2. TABS DASHBOARD
function switchTab(tabName) {
    ['resumen', 'redactor', 'estudiantes'].forEach(id => {
        document.getElementById('tab-' + id).classList.add('hidden');
        const btn = document.getElementById('btn-' + id);
        btn.classList.remove('bg-blue-600', 'text-white');
        btn.classList.add('text-slate-400', 'hover:bg-slate-800', 'hover:text-white');
    });
    document.getElementById('tab-' + tabName).classList.remove('hidden');
    const activeBtn = document.getElementById('btn-' + tabName);
    activeBtn.classList.remove('text-slate-400', 'hover:bg-slate-800');
    activeBtn.classList.add('bg-blue-600', 'text-white');
}

// 3. SISTEMA DE VENTANAS MODALES
// Funciones globales para manejar modales (Restauradas)

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Bloquear scroll
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = ''; // Restaurar scroll
    }
}

// 4. ACCIONES DE BOTONES

function contactarVentas() {
    Swal.fire({
        icon: 'success',
        title: 'Solicitud Enviada',
        html: '<p>Gracias por tu interés en la <strong>Licencia Institucional</strong>.</p><br><p>Un representante te contactará en 24 horas.</p>',
        customClass: { popup: 'rounded-2xl' }
    });
}

function verVacantes() {
    Swal.fire({
        icon: 'info',
        title: 'Únete al Equipo 🚀',
        html: `<div class="text-left bg-slate-50 p-3 rounded border border-slate-100 text-xs">
            <p class="font-bold mb-2">Posiciones Abiertas:</p>
            <ul class="list-disc pl-4 space-y-1 mb-3 text-slate-600">
                <li>Ingeniero(a) de IA y Backend</li>
                <li>Especialista en Marketing y Ventas</li>
            </ul>
            <p class="font-bold">Envía tu CV a:</p>
            <p class="text-blue-600">talento@docenteai.ve</p>
        </div>`,
        customClass: { popup: 'rounded-2xl' }
    });
}


function switchToRegister() {
    closeModal('modal-login');
    openModal('modal-pago');

    // Add event listeners for live card updates if not already there
    // We can just rely on onchange="updateCard()" in HTML, or add input listener here
    ['pay-card', 'pay-date', 'pay-name'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateCard);
    });
}

function switchToLogin() {
    closeModal('modal-register');
    closeModal('modal-forgot-password'); // Ensure password modal is also closed
    const loginModal = document.getElementById('modal-login');
    if (loginModal) loginModal.classList.remove('hidden');
}

function openForgotPassword() {
    closeModal('modal-login');
    resetRecoveryModal();
    const modal = document.getElementById('modal-forgot-password');
    if (modal) modal.classList.remove('hidden');
}

function backToLogin() {
    closeModal('modal-forgot-password');
    openModal('modal-login');
}

function sendRecoveryEmail() {
    const email = document.getElementById('forgot-email').value;

    if (!email) {
        Swal.fire({
            icon: 'warning',
            title: 'Falta Correo',
            text: 'Por favor ingresa tu correo institucional.'
        });
        return;
    }

    const btn = document.getElementById('btn-recovery');
    const originalText = btn.innerHTML;

    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Enviando...';
    btn.disabled = true;

    // Real API call to Nodemailer endpoint
    fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                Swal.fire({
                    icon: 'success',
                    title: '¡Correo Enviado!',
                    html: `Hemos enviado el código a <strong>${email}</strong>.<br>Revisa tu bandeja de entrada o spam.`,
                    timer: 3000
                });

                // Switch to Step 2
                document.getElementById('recovery-step-1').classList.add('hidden');
                document.getElementById('recovery-step-2').classList.remove('hidden');

            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: data.error || 'No se pudo enviar el correo.'
                });
            }
        })
        .catch(err => {
            console.error(err);
            Swal.fire({
                icon: 'error',
                title: 'Error de Conexión',
                text: 'Hubo un problema al contactar con el servidor de correo.'
            });
        })
        .finally(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        });
}

function resetPassword() {
    const email = document.getElementById('forgot-email').value;
    const code = document.getElementById('recovery-code').value;
    const newPassword = document.getElementById('new-password').value;

    if (!code || !newPassword) {
        Swal.fire({ icon: 'warning', text: 'Por favor ingresa el código y la nueva contraseña.' });
        return;
    }

    const btn = document.getElementById('btn-reset-pass');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
    btn.disabled = true;

    fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                Swal.fire({
                    icon: 'success',
                    title: '¡Contraseña Actualizada!',
                    text: 'Ahora puedes iniciar sesión con tu nueva clave.',
                    confirmButtonText: 'Ir al Login'
                }).then(() => {
                    backToLogin();
                });
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: data.error });
            }
        })
        .catch(err => {
            console.error(err);
            Swal.fire({ icon: 'error', text: 'Error al conectar con el servidor.' });
        })
        .finally(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        });
}

// Helper to reset modal state when closing/opening
function resetRecoveryModal() {
    document.getElementById('recovery-step-1')?.classList.remove('hidden');
    document.getElementById('recovery-step-2')?.classList.add('hidden');
    document.getElementById('forgot-email').value = '';
    document.getElementById('recovery-code').value = '';
    document.getElementById('new-password').value = '';
}


// LÓGICA TARJETA (Optimizada con requestAnimationFrame)
let rafIdCard = null;
function updateCard() {
    if (rafIdCard) cancelAnimationFrame(rafIdCard);

    rafIdCard = requestAnimationFrame(() => {
        const numInput = document.getElementById('pay-card');
        const dateInput = document.getElementById('pay-date');
        const nameInput = document.getElementById('pay-name');

        const num = numInput ? numInput.value : '';
        const date = dateInput ? dateInput.value : '';
        const name = nameInput ? nameInput.value : '';

        const numDisplay = document.getElementById('card-num-display');
        const dateDisplay = document.getElementById('card-date-display');
        const nameDisplay = document.getElementById('card-name-display');

        if (numDisplay) numDisplay.innerText = num || '0000 0000 0000 0000';
        if (dateDisplay) dateDisplay.innerText = date || 'MM/YY';
        if (nameDisplay) nameDisplay.innerText = name || 'NOMBRE APELLIDO';
    });
}

function procesarPago() {
    // Safety check with Optional Chaining/Nullish Coalescing
    const nombre = document.getElementById('pay-name')?.value || '';
    const email = document.getElementById('pay-email')?.value || '';
    const pass = document.getElementById('pay-password')?.value || '';
    const card = document.getElementById('pay-card')?.value || '';
    const date = document.getElementById('pay-date')?.value || '';
    const cvc = document.getElementById('pay-cvc')?.value || '';

    console.log('Procesando pago:', { nombre, email, cardLast4: card.slice(-4) });

    if (!nombre || !email || !pass || !card || !date || !cvc) {
        Swal.fire({ icon: 'warning', title: 'Faltan Datos', text: 'Por favor completa todos los campos para continuar.' });
        return;
    }

    // Button handling requires finding the button within the modal context or by ID if it had one.
    // Since it has onclick="procesarPago()", we can find it via event or simple query selector context
    // But since we are inside the function, let's grab it by specific selector
    const btn = document.querySelector('#modal-pago button[onclick="procesarPago()"]');
    const originalText = btn ? btn.innerHTML : "Pagar y Activar Cuenta";

    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';
        btn.classList.add('opacity-75', 'cursor-not-allowed');
        btn.disabled = true;
    }

    const delay = new Promise(resolve => setTimeout(resolve, 1500));
    delay.then(() => {
        fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nombre: nombre,
                email: email,
                password: pass
            })
        })
            .then(async res => {
                const data = await res.json();
                if (res.status === 409) {
                    Swal.fire({ icon: 'warning', title: 'Email ya registrado', text: data.error });
                    if (btn) { btn.innerHTML = originalText; btn.classList.remove('opacity-75', 'cursor-not-allowed'); btn.disabled = false; }
                    return;
                }
                if (res.ok && data.success) {
                    if (btn) {
                        btn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Bienvenido!';
                        btn.classList.replace('bg-slate-900', 'bg-green-600');
                    }
                    localStorage.setItem('userEmail', email);
                    localStorage.setItem('userName', nombre);
                    Swal.fire({
                        icon: 'success',
                        title: '¡Registro Exitoso!',
                        text: 'Tu cuenta fue creada. Ahora inicia sesión.',
                        timer: 2500,
                        showConfirmButton: false
                    });
                    setTimeout(() => { closeModal('modal-pago'); openModal('modal-login'); }, 2500);
                } else {
                    Swal.fire({ icon: 'error', title: 'Error', text: data.error || 'Fallo en registro' });
                    if (btn) { btn.innerHTML = originalText; btn.classList.remove('opacity-75', 'cursor-not-allowed'); btn.disabled = false; }
                }
            })
            .catch(() => {
                Swal.fire({ icon: 'error', title: 'Error', text: 'Error de conexión con el servidor.' });
                if (btn) { btn.innerHTML = originalText; btn.classList.remove('opacity-75', 'cursor-not-allowed'); btn.disabled = false; }
            });
    });
}

// 🔑 HELPER: Manejo global de errores de autenticación
function handleAuthError(status) {
    if (status === 401 || status === 403) {
        localStorage.clear();
        window.location.href = 'index.html';
        return true;
    }
    return false;
}

// 🔑 HELPER: Fetch con autorización JWT automática
function authFetch(url, options = {}) {
    const token = localStorage.getItem('docenteai_token');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        ...(options.headers || {})
    };

    if (options.body instanceof FormData) {
        delete headers['Content-Type'];
    }

    return fetch(url, { ...options, headers });
}

function login() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-pass').value;
    const btn = document.getElementById('btn-login');

    if (!email || !password) {
        Swal.fire({ icon: 'warning', title: 'Error', text: 'Ingresa correo y contraseña' });
        return;
    }

    btn.innerText = "Verificando...";
    btn.classList.add('opacity-75', 'cursor-not-allowed');

    fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    })
        .then(async res => {
            const data = await res.json();
            if (res.status === 401 || res.status === 403) {
                Swal.fire({ icon: 'error', title: 'Acceso Denegado', text: data.error || 'Credenciales incorrectas.' });
                return;
            }
            if (!res.ok) {
                Swal.fire({ icon: 'error', title: 'Error', text: data.error || 'Error en el servidor.' });
                return;
            }
            if (data.success && data.token) {
                // Guardar token JWT real y datos del usuario
                localStorage.setItem('docenteai_token', data.token);
                localStorage.setItem('userEmail', data.user.email);
                localStorage.setItem('userName', data.user.name);
                localStorage.setItem('usuarioNombre', data.nombre || data.user.name || 'Usuario');
                localStorage.setItem('userId', data.user.id);
                window.location.href = 'dashboard.html';
            } else {
                Swal.fire({ icon: 'error', title: 'Error de Acceso', text: data.error || 'Credenciales incorrectas.' });
            }
        })
        .catch(() => {
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo conectar al servidor.' });
        })
        .finally(() => {
            btn.innerText = "Entrar";
            btn.classList.remove('opacity-75', 'cursor-not-allowed');
        });
}


function syncData() {
    const btn = document.getElementById('btn-sync');
    const icon = btn.querySelector('i');
    icon.classList.add('fa-spin');
    btn.innerText = "Sincronizando...";
    setTimeout(() => {
        icon.classList.remove('fa-spin');
        btn.innerHTML = '<i class="fa-solid fa-check text-green-500 mr-2"></i> Listo';
        setTimeout(() => btn.innerHTML = '<i class="fa-solid fa-arrows-rotate mr-2"></i> Sincronizar', 2000);
    }, 1500);
}

function generarBorrador() {
    const input = document.getElementById('ai-input').value;
    const output = document.getElementById('ai-output');
    const resultBox = document.getElementById('ai-result-box');

    if (input.length < 5) {
        Swal.fire({ icon: 'warning', title: 'Falta Información', text: 'Por favor escribe el tema del correo para que la IA pueda redactarlo.' });
        return;
    }

    if (output) {
        output.innerHTML = '<span class="animate-pulse text-slate-400">✨ Redactando mensaje...</span>';
        resultBox.classList.remove('hidden');

        setTimeout(() => {
            output.innerHTML = `
                <p class="font-bold text-slate-800 mb-2">Asunto: Información Importante</p>
                <p>"Estimados estudiantes,</p><br>
                <p>Espero que estén bien. Les escribo para informarles sobre: <strong>${input}</strong>.</p><br>
                <p>Quedo atento a sus dudas.</p>
                <p>Atentamente,<br>Prof. UNEXPO"</p>
            `;
        }, 1000);
    }
}

// 5. LEGAL & EXTRAS
function openLegalModal(title) {
    const titleEl = document.getElementById('legal-title');
    if (titleEl) titleEl.innerText = title;
    openModal('modal-legal');
}

// 6. INICIALIZACIÓN Y EVENTOS DOM
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Loaded - DocenteAI ready');

    // Inicializar lógica de formulario de ventas (Solicitar Demo)
    const btnDemo = document.getElementById('btn-solicitar-demo');
    if (btnDemo) {
        btnDemo.addEventListener('click', () => {
            const name = document.getElementById('lead-name').value;
            const role = document.getElementById('lead-role').value;
            const institution = document.getElementById('lead-institution').value;
            const size = document.getElementById('lead-size').value;

            if (!name || !role || !institution || !size) {
                Swal.fire({ icon: 'warning', title: 'Campos Incompletos', text: 'Por favor completa todos los campos.' });
                return;
            }

            const originalText = btnDemo.innerHTML;
            btnDemo.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Enviando...';
            btnDemo.disabled = true;

            fetch('/api/leads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, role, institution, size })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        closeModal('modal-ventas');
                        // Reset inputs
                        ['lead-name', 'lead-role', 'lead-institution', 'lead-size'].forEach(id => document.getElementById(id).value = '');

                        Swal.fire({
                            icon: 'success',
                            title: '¡Solicitud Recibida!',
                            text: `Hemos registrado el interés de ${institution}. Un asesor te contactará pronto.`,
                            timer: 3000
                        });
                    } else {
                        Swal.fire({ icon: 'error', title: 'Error', text: data.message });
                    }
                })
                .catch(err => {
                    console.error(err);
                    Swal.fire({ icon: 'error', title: 'Error', text: 'Error de conexión.' });
                })
                .finally(() => {
                    btnDemo.innerHTML = originalText;
                    btnDemo.disabled = false;
                });
        });
    }

    // Auto-start Driver.js tour
    setTimeout(() => {
        if (!localStorage.getItem('docenteai_tour_seen')) {
            iniciarTutorial();
        }
    }, 1000);
});

// 7. ONBOARDING TOUR (Driver.js)
function iniciarTutorial() {
    // Close support chat if open
    const chat = document.getElementById('modal-support-chat');
    if (chat && typeof chat.classList !== 'undefined') {
        chat.classList.add('force-hidden');
    }

    if (!window.driver || !window.driver.js) {
        console.error("Driver.js no está cargado.");
        return;
    }

    const driver = window.driver.js.driver;
    const driverObj = driver({
        showProgress: true,
        animate: true,
        opacity: 0.75,
        doneBtnText: '¡Entendido!',
        closeBtnText: 'Cerrar',
        nextBtnText: 'Siguiente',
        prevBtnText: 'Anterior',
        steps: [
            {
                popover: {
                    title: '¡Bienvenido a DocenteAI! 👋',
                    description: 'Tu nueva plataforma de gestión académica inteligente. Te daremos un recorrido rápido por las herramientas clave para potenciar tu productividad.',
                    align: 'center'
                }
            },
            {
                element: '#btn-estudiantes',
                popover: {
                    title: 'Tu Lista de Clase',
                    description: 'Aquí gestionarás a todos tus alumnos y sus notas.',
                    side: "right",
                    align: 'start'
                }
            },
            {
                element: '#btn-nueva-tarea-nav',
                popover: {
                    title: 'Organiza tu Semestre',
                    description: 'Programa exámenes, clases y entregas para que el sistema te avise.',
                    side: "left",
                    align: 'start'
                }
            },
            {
                element: '#btn-redactor',
                popover: {
                    title: 'Tu Asistente Virtual',
                    description: 'Deja que la IA redacte correos y anuncios por ti en segundos.',
                    side: "right",
                    align: 'start'
                }
            }
        ],
        onDestroyStarted: () => {
            if (!driverObj.hasNextStep() || confirm("¿Saltar el tour?")) {
                localStorage.setItem('docenteai_tour_seen', 'true');
                driverObj.destroy();
            }
        },
        onPopoverRender: (popover, { config, state }) => {
            if (state.activeIndex === config.steps.length - 1) {
                localStorage.setItem('docenteai_tour_seen', 'true');
            }
        }
    });

    driverObj.drive();
}