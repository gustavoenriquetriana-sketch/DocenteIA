require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function verifyGemini() {
    console.log("Checking GEMINI_API_KEY...");
    if (!process.env.GEMINI_API_KEY) {
        console.error("❌ GEMINI_API_KEY not found in .env");
        process.exit(1);
    }
    console.log("✅ GEMINI_API_KEY found (length: " + process.env.GEMINI_API_KEY.length + ")");

    try {
        console.log("Initializing Gemini client...");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        console.log("Sending test prompt: 'Hello, are you operational?'...");
        const result = await model.generateContent("Hello, are you operational? Reply with 'Yes, I am operational.'");
        const response = await result.response;
        const text = response.text();

        console.log("\n--- API Response ---");
        console.log(text);
        console.log("--------------------\n");
        console.log("✅ Gemini API verification successful!");
    } catch (error) {
        console.error("❌ Gemini API verification failed:");
        console.error(error);
        process.exit(1);
    }
}

verifyGemini();
