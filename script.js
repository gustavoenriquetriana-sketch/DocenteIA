// script.js

// 1. CALCULADORA
const hoursInput = document.getElementById('input-hours');
const rateInput = document.getElementById('input-rate');
const displayHours = document.getElementById('display-hours');
const resultSavings = document.getElementById('result-savings');
const resultTime = document.getElementById('result-time');

function calculateImpact() {
    const hours = parseFloat(hoursInput.value);
    const rate = parseFloat(rateInput.value) || 0;

    displayHours.innerText = hours + 'h';

    // Fórmulas
    const monthlySavings = (hours * rate * 4) * 0.7;
    const semesterTime = (hours * 4 * 4.5) * 0.7;

    resultSavings.innerText = '$' + monthlySavings.toFixed(2);
    resultTime.innerText = Math.round(semesterTime) + 'h';
}

if (hoursInput && rateInput) {
    hoursInput.addEventListener('input', calculateImpact);
    rateInput.addEventListener('input', calculateImpact);
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
const modal = document.getElementById('custom-modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalIcon = document.getElementById('modal-icon');

function showModal(title, contentHTML, iconClass = 'fa-bell') {
    modalTitle.innerText = title;
    modalMessage.innerHTML = contentHTML;
    modalIcon.className = `fa-solid ${iconClass} text-2xl text-blue-600`;
    modal.classList.remove('hidden');
}

function closeModal() {
    modal.classList.add('hidden');
}

// 4. ACCIONES DE BOTONES
function loginDocente() {
    // Simulamos el HTML de un formulario de Login real
    const loginFormHTML = `
        <div class="text-left">
            <div class="mb-4">
                <label class="block text-xs font-bold text-slate-700 mb-1">Correo Institucional</label>
                <input id="login-email" type="email" placeholder="profesor@unexpo.edu.ve" class="w-full p-2 rounded border border-slate-300 text-sm focus:outline-none focus:border-blue-500">
            </div>
            <div class="mb-6">
                <label class="block text-xs font-bold text-slate-700 mb-1">Contraseña</label>
                <input id="login-password" type="password" placeholder="••••••••" class="w-full p-2 rounded border border-slate-300 text-sm focus:outline-none focus:border-blue-500">
            </div>
            <div class="flex items-center justify-between mb-4">
                <label class="flex items-center text-xs text-slate-500">
                    <input type="checkbox" class="mr-2"> Recordarme
                </label>
                <a href="#" class="text-xs text-blue-600 hover:underline">¿Olvidaste tu clave?</a>
            </div>
            <button onclick="simularEntrada()" class="w-full bg-blue-900 text-white py-2 rounded-lg font-bold text-sm hover:bg-blue-800 transition">
                Iniciar Sesión
            </button>
        </div>
    `;

    showModal("Acceso Docente", loginFormHTML, "fa-user-lock");
}

// Función extra para simular que entra
// En script.js
function simularEntrada() {
    const btn = document.querySelector('#custom-modal button.bg-blue-900');
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    btn.innerText = "Verificando...";
    btn.classList.add('opacity-75', 'cursor-not-allowed');

    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    })
        .then(res => res.json())
        .then(data => {
            if (data.token) {
                closeModal();
                window.location.href = 'dashboard.html';
            } else {
                alert("Error: " + (data.error || "Credenciales inválidas"));
                btn.innerText = "Iniciar Sesión";
                btn.classList.remove('opacity-75', 'cursor-not-allowed');
            }
        })
        .catch(err => {
            console.error(err);
            alert("Error de conexión");
            btn.innerText = "Iniciar Sesión";
            btn.classList.remove('opacity-75', 'cursor-not-allowed');
        });
}


function contactarVentas() {
    showModal("Solicitud Enviada", "<p>Gracias por tu interés en la <strong>Licencia Institucional</strong>.</p><br><p>Un representante te contactará en 24 horas.</p>", "fa-envelope-circle-check");
}

function verVacantes() {
    showModal("Únete al Equipo 🚀",
        `<div class="text-left bg-slate-50 p-3 rounded border border-slate-100 text-xs">
            <p class="font-bold mb-2">Posiciones Abiertas:</p>
            <ul class="list-disc pl-4 space-y-1 mb-3 text-slate-600">
                <li>Ingeniero(a) de IA y Backend</li>
                <li>Especialista en Marketing y Ventas</li>
            </ul>
            <p class="font-bold">Envía tu CV a:</p>
            <p class="text-blue-600">talento@docenteai.ve</p>
        </div>`,
        "fa-briefcase");
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
        showModal("Falta Información", "Por favor escribe el tema del correo para que la IA pueda redactarlo.", "fa-triangle-exclamation");
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