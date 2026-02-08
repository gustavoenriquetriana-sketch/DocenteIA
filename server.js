require('dns').setDefaultResultOrder('ipv4first'); // <--- CRITICO: Forzar IPv4 antes de CUALQUIER otra cosa
console.log("¡¡¡TAVO: EL CÓDIGO NUEVO (FIX IPv6) YA LLEGÓ A RAILWAY!!! 🚀"); // <--- ESTO ES LA PRUEBA
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./backend/routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve frontend if moved to public, but for now we serve root

// Serve static files from root for this simple setup
app.use(express.static(__dirname));

// API Routes
app.use('/api', apiRoutes);

// Fallback to index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Admin Route
app.get('/admin/soporte', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-soporte.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Forzando reinicio del servidor v6 - pdf-parse con default export