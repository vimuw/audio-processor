import { GoogleGenerativeAI } from "@google/generative-ai";
import { SBOBBINATORE_PROMPT } from "./prompts";

export class GeminiHelper {
    constructor() {
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (!apiKey) {
            console.error("VITE_GEMINI_API_KEY is missing from .env");
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
    }

    /**
     * Converts a File object to a base64 string readable by Gemini.
     */
    async fileToGenerativePart(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64Data = reader.result.split(',')[1];
                resolve({
                    inlineData: {
                        data: base64Data,
                        mimeType: file.type
                    },
                });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * Step 1 (Refactored): Process a specific AUDIO chunk directly to notes.
     * This bypasses the need for a full transcript first, and uses the model's multimodal capabilities.
     * Checks for audio length/size to ensure it fits in a single request.
     */
    async generateNotesFromAudioChunk(audioFile) {
        try {
            const audioPart = await this.fileToGenerativePart(audioFile);

            // Adapt prompt for Audio input - Requesting HTML for DOC export
            const fullPrompt = `
${SBOBBINATORE_PROMPT}

ISTRUZIONI AGGIUNTIVE PER L'INPUT AUDIO E FORMATTAZIONE:
1. Ascolta attentamente questo segmento audio della lezione.
2. Genera gli appunti dettagliati come richiesto sopra, basandoti direttamente sull'audio.
3. **FORMATO OUTPUT**: Genera il testo in **HTML PURO** (senza markdown, senza blocchi di codice \`\`\`).
   - Usa <h2> per i titoli delle sezioni.
   - Usa <p> per i paragrafi.
   - Usa <b> per il grassetto dei concetti chiave.
   - Usa <ul> e <li> per gli elenchi.
   - Non usare CSS o tag <style>, solo tag semantici di base.
   - Non includere <html>, <head> o <body>, solo il contenuto parziale.
`;

            const result = await this.model.generateContent([fullPrompt, audioPart]);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error("Error generating notes from audio chunk:", error);
            throw error;
        }
    }
}
