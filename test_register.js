
const fetch = require('node-fetch'); // Assuming node-fetch is available, or use built-in fetch if node version supports it (Node 18+)

// Helper to wait
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function testRegistration() {
    console.log("Starting registration test...");

    // Random email to avoid conflict
    const email = `testuser_${Date.now()}@example.com`;
    const password = "password123";
    const name = "Test User";

    try {
        const response = await fetch('http://localhost:3000/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });

        const data = await response.json();
        console.log("Response Status:", response.status);
        console.log("Response Data:", JSON.stringify(data, null, 2));

        if (data.success) {
            console.log("✅ Registration Successful!");
        } else {
            console.log("❌ Registration Failed!", data.error);
        }

    } catch (error) {
        console.error("Error during test:", error);
    }
}

// Check if node-fetch is needed or if global fetch exists
if (!global.fetch) {
    try {
        global.fetch = require('node-fetch');
    } catch (e) {
        console.log("node-fetch not found, trying built-in http");
        // Fallback to http if needed, but usually recent node has fetch or valid environment
    }
}

testRegistration();
