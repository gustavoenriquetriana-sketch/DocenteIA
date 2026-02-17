
const fetch = require('node-fetch'); // Assuming node-fetch is available

async function testLogin() {
    console.log("Starting login test...");

    // 1. First Register a User
    const email = `login_test_${Date.now()}@example.com`;
    const password = "password123";
    const name = "Login Tester";

    try {
        console.log(`Step 1: Registering user ${email}...`);
        const regResponse = await fetch('http://localhost:3000/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        const regData = await regResponse.json();

        if (!regData.success) {
            throw new Error(`Registration failed: ${regData.error}`);
        }
        console.log("✅ Registration Successful. ID:", regData.userId);

        // 2. Now Try Login
        console.log("Step 2: Attempting Login...");
        const loginResponse = await fetch('http://localhost:3000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const loginData = await loginResponse.json();
        console.log("Login Response Status:", loginResponse.status);
        console.log("Login Response Data:", JSON.stringify(loginData, null, 2));

        if (loginData.success) {
            console.log("✅ LOGIN SUCCESSFUL!");
        } else {
            console.log("❌ LOGIN FAILED!", loginData.error);
        }

    } catch (error) {
        console.error("❌ Test Failed:", error.message);
    }
}

// Global fetch polyfill if needed
if (!global.fetch) {
    global.fetch = require('node-fetch');
}

testLogin();
