require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        // For identifying the correct model name
        const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });
        // Note: The SDK doesn't have a direct 'listModels' method exposed easily on the main entry point in all versions, 
        // but let's try to use the API directly or a known script pattern if the SDK supports it.
        // Actually, checking documentation (simulated), SDK implies getting a model.
        // Let's try the direct REST API via fetch if SDK doesn't clarify.
        // But wait, the error message suggested calling ListModels.

        // Let's try to infer from common names or use a script that tries multiple.
        // But better: Use the API key to hit the REST endpoint for models.

        const apiKey = process.env.GEMINI_API_KEY;
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.models) {
            console.log("Available Models:");
            data.models.forEach(m => console.log(`- ${m.name}`));
        } else {
            console.log("No models found or error:", data);
        }

    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listModels();
