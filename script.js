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
    openModal('modal-register');
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


// FUNCIONES DE REGISTRO UNIFICADO Y STRIPE REDIRECT

function register() {
    const nombre = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-pass').value;
    const passConfirm = document.getElementById('reg-pass-confirm').value;

    if (!nombre || !email || !pass || !passConfirm) {
        Swal.fire({ icon: 'warning', title: 'Faltan Datos', text: 'Por favor completa todos los campos.' });
        return;
    }

    if (pass !== passConfirm) {
        Swal.fire({ icon: 'warning', title: 'Error', text: 'Las contraseñas no coinciden.' });
        return;
    }

    const btn = document.getElementById('btn-register');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';
    btn.disabled = true;

    fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre, email: email, password: pass })
    })
        .then(async res => {
            const data = await res.json();

            if (data.success || res.status === 409) {
                if (data.success) {
                    localStorage.setItem('userEmail', email);
                    localStorage.setItem('userName', nombre);
                    localStorage.setItem('docenteai_token', data.token);
                }

                // Redirigir a Stripe
                const stripe = Stripe('AQUI_VA_LA_PK_TEST');
                stripe.redirectToCheckout({
                    lineItems: [{ price: 'price_1T4VaAR8fPXINnmWnFvPIvKC', quantity: 1 }],
                    mode: 'subscription',
                    successUrl: window.location.origin + '/dashboard.html',
                    cancelUrl: window.location.href
                }).then((result) => {
                    if (result.error) {
                        Swal.fire({ icon: 'error', title: 'Error de Pago', text: result.error.message });
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                    }
                });
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: data.error || 'Fallo en registro' });
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        })
        .catch(() => {
            Swal.fire({ icon: 'error', title: 'Error', text: 'Error de conexión con el servidor.' });
            btn.innerHTML = originalText;
            btn.disabled = false;
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
});