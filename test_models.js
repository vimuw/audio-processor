
import { GoogleGenerativeAI } from "@google/generative-ai";

async function listModels() {
    // Hardcoding key for quick test script
    const genAI = new GoogleGenerativeAI("AIzaSyBgOdhUzj3mk3YCX-rWb9xIlqDUemcedDw");

    console.log("Checking available models...");

    // Try newer models first
    const modelsToTry = [
        "gemini-1.5-flash",
        "gemini-1.5-flash-latest",
        "gemini-1.5-flash-001",
        "gemini-1.5-pro",
        "gemini-pro"
    ];

    for (const modelName of modelsToTry) {
        try {
            console.log(`Testing: ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Hello, are you there?");
            console.log(`✅ SUCCESS: ${modelName} responded:`, result.response.text());
            return; // Stop on first success
        } catch (error) {
            console.error(`❌ FAILED: ${modelName} - ${error.message}`);
        }
    }
}

listModels();
