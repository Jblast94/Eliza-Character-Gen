import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs/promises';
import pdf2md from '@opendocsg/pdf2md';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// CORS configuration with explicit methods
const corsOptions = {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization']
};

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (_, file, cb) => cb(null, file.originalname)
});

const upload = multer({ storage: storage });

// Middleware order is important
app.use(cors(corsOptions));
app.use(express.static(__dirname));
app.use(express.json({ limit: '50mb' }));  // Move this up before routes

// Add OPTIONS handler for preflight requests
app.options('*', cors(corsOptions));

// Ensure uploads directory exists
await fs.mkdir('uploads', { recursive: true }).catch(console.error);

// Helper function to parse AI response
const parseAIResponse = (content) => {
    console.log('Original content:', content);

    try {
        // First try direct JSON parse
        return JSON.parse(content);
    } catch (directParseError) {
        console.log('Direct parse failed, attempting cleanup');

        // Find the JSON object boundaries
        const startIndex = content.indexOf('{');
        const endIndex = content.lastIndexOf('}');
        
        if (startIndex === -1 || endIndex === -1) {
            throw new Error('No complete JSON object found in response');
        }

        let jsonContent = content.substring(startIndex, endIndex + 1);
        
        // Clean up common issues
        jsonContent = jsonContent
            .replace(/,\s*}/g, '}')  // Remove trailing commas
            .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
            .replace(/\{\s*\}/g, '{}')  // Normalize empty objects
            .replace(/\[\s*\]/g, '[]')  // Normalize empty arrays
            .replace(/"\s*:\s*undefined/g, '": null')  // Replace undefined with null
            .replace(/"\s*:\s*,/g, '": null,')  // Fix empty values
            .replace(/"\s*:\s*}/g, '": null}')  // Fix empty values at end
            .replace(/\n/g, ' ')  // Remove newlines
            .replace(/\s+/g, ' ')  // Normalize whitespace
            .trim();

        console.log('Cleaned JSON content:', jsonContent);

        try {
            return JSON.parse(jsonContent);
        } catch (cleanupParseError) {
            console.error('Parse error after cleanup:', cleanupParseError);
            throw new Error(`Failed to parse JSON content: ${cleanupParseError.message}`);
        }
    }
};

// Fix JSON formatting endpoint
app.post('/api/fix-json', async (req, res) => {
    try {
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }

        console.log('Original content:', content);

        try {
            const characterData = parseAIResponse(content);
            console.log('Successfully parsed character data');
            res.json({ character: characterData });
        } catch (parseError) {
            console.error('Parse error:', parseError);
            console.error('Content:', content);
            throw new Error(`Failed to parse JSON: ${parseError.message}`);
        }
    } catch (error) {
        console.error('JSON fixing error:', error);
        res.status(500).json({ error: error.message || 'Failed to fix JSON formatting' });
    }
});

// Add this helper function near the top
const sendJsonResponse = (res, data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.json(data);
};

// Character generation endpoint
app.post('/api/generate-character', async (req, res) => {
    try {
        const { prompt, model, image } = req.body;
        const apiKey = req.headers['x-api-key'];

        // Validate inputs
        if (!prompt) {
            return sendJsonResponse(res.status(400), { error: 'Prompt is required' });
        }
        if (!model) {
            return sendJsonResponse(res.status(400), { error: 'Model is required' });
        }
        if (!apiKey) {
            return sendJsonResponse(res.status(400), { error: 'API key is required' });
        }

        // Extract potential name from the prompt
        const nameMatch = prompt.match(/name(?:\s+is)?(?:\s*:)?\s*([A-Z][a-zA-Z\s]+?)(?:\.|\s|$)/i);
        const suggestedName = nameMatch ? nameMatch[1].trim() : '';

        // Create a template for consistent structure
        const template = {
            name: suggestedName,
            clients: [],
            modelProvider: "",
            settings: {
                secrets: {},  // Changed from empty object to properly nested structure
                voice: {
                    model: ""
                }
            },
            plugins: [],
            bio: [],
            lore: [],
            knowledge: [],
            messageExamples: [],
            postExamples: [],
            topics: [],
            style: {
                all: [],
                chat: [],
                post: []
            },
            adjectives: [],
            people: []
        };

        const userMessageContent = [
            {
                type: 'text',
                text: `Template to follow:
${JSON.stringify(template, null, 2)}

Character description: ${prompt}

Generate a complete character profile as a single JSON object following the exact template structure. Include relevant knowledge entries based on the description.`
            }
        ];

        if (image && model.includes('vision')) {
            userMessageContent.push({
                type: 'image_url',
                image_url: {
                    url: image
                }
            });
            // Add a text block to instruct the model on how to use the image
            userMessageContent.push({
                type: 'text',
                text: "Use the provided image to inform the character's appearance and style."
            });
        }

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.APP_URL || 'http://localhost:4000',
                'X-Title': 'Eliza Character Generator'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: `You are a character generation assistant that MUST ONLY output valid JSON. NEVER output apologies, explanations, or any other text.

CRITICAL RULES:
1. ONLY output a JSON object following the exact template structure provided
2. Start with { and end with }
3. NO text before or after the JSON
4. NO apologies or explanations
5. NO content warnings or disclaimers
6. Every sentence must end with a period
7. Adjectives must be single words
8. Knowledge entries MUST be an array of strings, each ending with a period
9. Each knowledge entry MUST be a complete sentence
10. Use the suggested name if provided, or generate an appropriate one

You will receive a character description and template. Generate a complete character profile.`
                    },
                    {
                        role: 'user',
                        content: userMessageContent
                    }
                ],
                temperature: 0.7,
                max_tokens: 4000,
                presence_penalty: 0.0,
                frequency_penalty: 0.0,
                top_p: 0.95,
                stop: null
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to generate character');
        }

        const data = await response.json();
        const generatedContent = data.choices[0].message.content;

        try {
            console.log('Raw AI response:', generatedContent);
            const characterData = parseAIResponse(generatedContent);
            console.log('Parsed character:', characterData);

            // Ensure all required fields are present
            const requiredFields = ['bio', 'lore', 'topics', 'style', 'adjectives', 'messageExamples', 'postExamples'];
            const missingFields = requiredFields.filter(field => !characterData[field]);
            
            if (missingFields.length > 0) {
                throw new Error(`Invalid character data: missing ${missingFields.join(', ')}`);
            }

            // Process knowledge entries specifically
            if (characterData.knowledge) {
                characterData.knowledge = Array.isArray(characterData.knowledge) ? 
                    characterData.knowledge.map(entry => {
                        if (typeof entry === 'string') {
                            return entry.endsWith('.') ? entry : entry + '.';
                        }
                        if (typeof entry === 'object' && entry !== null) {
                            // If it's an object, try to extract meaningful text
                            const text = entry.text || entry.content || entry.value || entry.toString();
                            return typeof text === 'string' ? 
                                (text.endsWith('.') ? text : text + '.') : 
                                'Invalid knowledge entry.';
                        }
                        return 'Invalid knowledge entry.';
                    }) : [];
            } else {
                characterData.knowledge = [];
            }

            // Ensure all other arrays are properly initialized
            characterData.bio = Array.isArray(characterData.bio) ? characterData.bio : [];
            characterData.lore = Array.isArray(characterData.lore) ? characterData.lore : [];
            characterData.topics = Array.isArray(characterData.topics) ? characterData.topics : [];
            characterData.messageExamples = Array.isArray(characterData.messageExamples) ? characterData.messageExamples : [];
            characterData.postExamples = Array.isArray(characterData.postExamples) ? characterData.postExamples : [];
            characterData.adjectives = Array.isArray(characterData.adjectives) ? characterData.adjectives : [];
            characterData.people = Array.isArray(characterData.people) ? characterData.people : [];
            characterData.style = characterData.style || { all: [], chat: [], post: [] };

            // Ensure style arrays are properly initialized
            characterData.style.all = Array.isArray(characterData.style.all) ? characterData.style.all : [];
            characterData.style.chat = Array.isArray(characterData.style.chat) ? characterData.style.chat : [];
            characterData.style.post = Array.isArray(characterData.style.post) ? characterData.style.post : [];

            return sendJsonResponse(res, {
                character: characterData,
                rawPrompt: prompt,
                rawResponse: generatedContent
            });
        } catch (parseError) {
            console.error('Parse error:', parseError);
            console.error('Generated content:', generatedContent);
            throw new Error(`Failed to parse generated content: ${parseError.message}`);
        }
    } catch (error) {
        console.error('Character generation error:', error);
        return sendJsonResponse(res.status(500), { 
            error: error.message || 'Failed to generate character' 
        });
    }
});

// File processing endpoint
app.post('/api/process-files', upload.array('files'), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const knowledge = [];

        for (const file of files) {
            try {
                const content = await fs.readFile(file.path);
                let processedContent;

                if (file.mimetype === 'application/pdf') {
                    const uint8Array = new Uint8Array(content);
                    processedContent = await pdf2md(uint8Array);
                    processedContent = processedContent
                        .split(/[.!?]+/)
                        .map(sentence => sentence.trim())
                        .filter(sentence => sentence.length > 0 && !sentence.startsWith('-'))
                        .map(sentence => sentence + '.');
                } else if (isTextFile(file.originalname)) {
                    processedContent = content.toString('utf-8')
                        .split(/[.!?]+/)
                        .map(sentence => sentence.trim())
                        .filter(sentence => sentence.length > 0 && !sentence.startsWith('-'))
                        .map(sentence => sentence + '.');
                }

                if (processedContent) {
                    knowledge.push(...processedContent);
                }

                await fs.unlink(file.path).catch(console.error);
            } catch (fileError) {
                console.error(`Error processing file ${file.originalname}:`, fileError);
            }
        }

        res.json({ knowledge });
    } catch (error) {
        console.error('File processing error:', error);
        res.status(500).json({ error: 'Failed to process files' });
    }
});

// Helper functions
const isTextFile = filename => ['.txt','.md','.json','.yml','.csv'].includes(
    filename.toLowerCase().slice(filename.lastIndexOf('.'))
);

// Add this new endpoint with the other API endpoints
app.post('/api/refine-character', async (req, res) => {
    try {
        const { prompt, model, currentCharacter, image } = req.body;
        const apiKey = req.headers['x-api-key'];

        if (!prompt || !model || !currentCharacter) {
            return res.status(400).json({ error: 'Prompt, model, and current character data are required' });
        }
        if (!apiKey) {
            return res.status(400).json({ error: 'API key is required' });
        }

        // Store existing knowledge and name
        const hasExistingKnowledge = Array.isArray(currentCharacter.knowledge) && currentCharacter.knowledge.length > 0;
        const existingKnowledge = currentCharacter.knowledge || [];
        const existingName = currentCharacter.name || "";

        // Extract potential new name from the prompt
        const nameMatch = prompt.match(/name(?:\s+is)?(?:\s*:)?\s*([A-Z][a-zA-Z\s]+?)(?:\.|\s|$)/i);
        const newName = nameMatch ? nameMatch[1].trim() : existingName;

        // Create a template for the AI to follow
        const template = {
            name: newName,
            clients: currentCharacter.clients || [],
            modelProvider: currentCharacter.modelProvider || "",
            settings: currentCharacter.settings || { secrets: {}, voice: { model: "" } },
            plugins: currentCharacter.plugins || [],
            bio: [],
            lore: [],
            knowledge: hasExistingKnowledge ? existingKnowledge : [],
            messageExamples: [],
            postExamples: [],
            topics: [],
            style: {
                all: [],
                chat: [],
                post: []
            },
            adjectives: [],
            people: currentCharacter.people || []
        };

        const userMessageContent = [
            {
                type: 'text',
                text: `Current character data:
${JSON.stringify(currentCharacter, null, 2)}

Template to follow:
${JSON.stringify(template, null, 2)}

Refinement instructions: ${prompt}

Output the refined character data as a single JSON object following the exact template structure. ${hasExistingKnowledge ? 'DO NOT modify the existing knowledge array.' : 'Create new knowledge entries if appropriate.'}`
            }
        ];

        if (image && model.includes('vision')) {
            userMessageContent.push({
                type: 'image_url',
                image_url: {
                    url: image
                }
            });
            // Add a text block to instruct the model on how to use the image
            userMessageContent.push({
                type: 'text',
                text: "Use the provided image to inform the character's appearance and style during refinement."
            });
        }

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.APP_URL || 'http://localhost:4000',
                'X-Title': 'Eliza Character Generator'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: `You are a character refinement assistant that MUST ONLY output valid JSON. NEVER output apologies, explanations, or any other text.

CRITICAL RULES:
1. ONLY output a JSON object following the exact template structure provided
2. Start with { and end with }
3. NO text before or after the JSON
4. NO apologies or explanations
5. NO content warnings or disclaimers
6. Maintain the character's core traits while incorporating refinements
7. Every sentence must end with a period
8. Adjectives must be single words
9. Knowledge entries MUST be an array of strings, each ending with a period
10. Each knowledge entry MUST be a complete sentence
11. Use the new name if provided in the refinement instructions

You will receive the current character data and refinement instructions. Enhance and modify the character while maintaining consistency.`
                    },
                    {
                        role: 'user',
                        content: userMessageContent
                    }
                ],
                temperature: 0.7,
                max_tokens: 4000,
                presence_penalty: 0.0,
                frequency_penalty: 0.0,
                top_p: 0.95,
                stop: null
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to refine character');
        }

        const data = await response.json();
        const refinedContent = data.choices[0].message.content;

        try {
            console.log('Raw AI response:', refinedContent);
            const refinedCharacter = parseAIResponse(refinedContent);
            console.log('Parsed character:', refinedCharacter);
            
            // Ensure all required fields are present
            const requiredFields = ['bio', 'lore', 'topics', 'style', 'adjectives', 'messageExamples', 'postExamples'];
            const missingFields = requiredFields.filter(field => !refinedCharacter[field]);
            
            if (missingFields.length > 0) {
                throw new Error(`Invalid character data: missing ${missingFields.join(', ')}`);
            }

            // Process knowledge entries specifically
            if (refinedCharacter.knowledge) {
                refinedCharacter.knowledge = Array.isArray(refinedCharacter.knowledge) ? 
                    refinedCharacter.knowledge.map(entry => {
                        if (typeof entry === 'string') {
                            return entry.endsWith('.') ? entry : entry + '.';
                        }
                        if (typeof entry === 'object' && entry !== null) {
                            // If it's an object, try to extract meaningful text
                            const text = entry.text || entry.content || entry.value || entry.toString();
                            return typeof text === 'string' ? 
                                (text.endsWith('.') ? text : text + '.') : 
                                'Invalid knowledge entry.';
                        }
                        return 'Invalid knowledge entry.';
                    }) : [];
            } else {
                refinedCharacter.knowledge = [];
            }

            // If there's existing knowledge, preserve it
            if (hasExistingKnowledge) {
                refinedCharacter.knowledge = existingKnowledge;
            }

            // Ensure all arrays are properly initialized
            refinedCharacter.bio = Array.isArray(refinedCharacter.bio) ? refinedCharacter.bio : [];
            refinedCharacter.lore = Array.isArray(refinedCharacter.lore) ? refinedCharacter.lore : [];
            refinedCharacter.topics = Array.isArray(refinedCharacter.topics) ? refinedCharacter.topics : [];
            refinedCharacter.messageExamples = Array.isArray(refinedCharacter.messageExamples) ? refinedCharacter.messageExamples : [];
            refinedCharacter.postExamples = Array.isArray(refinedCharacter.postExamples) ? refinedCharacter.postExamples : [];
            refinedCharacter.adjectives = Array.isArray(refinedCharacter.adjectives) ? refinedCharacter.adjectives : [];
            refinedCharacter.people = Array.isArray(refinedCharacter.people) ? refinedCharacter.people : [];
            refinedCharacter.style = refinedCharacter.style || { all: [], chat: [], post: [] };

            // Ensure style arrays are properly initialized
            refinedCharacter.style.all = Array.isArray(refinedCharacter.style.all) ? refinedCharacter.style.all : [];
            refinedCharacter.style.chat = Array.isArray(refinedCharacter.style.chat) ? refinedCharacter.style.chat : [];
            refinedCharacter.style.post = Array.isArray(refinedCharacter.style.post) ? refinedCharacter.style.post : [];

            res.json({
                character: refinedCharacter,
                rawPrompt: prompt,
                rawResponse: refinedContent
            });
        } catch (parseError) {
            console.error('Parse error:', parseError);
            console.error('Refined content:', refinedContent);
            throw new Error(`Failed to parse refined content: ${parseError.message}`);
        }
    } catch (error) {
        console.error('Character refinement error:', error);
        res.status(500).json({ error: error.message || 'Failed to refine character' });
    }
});

// Voice generation endpoint
app.post('/api/generate-voice', async (req, res) => {
    try {
        const { text, voice } = req.body;

        if (!text || !voice) {
            return res.status(400).json({ error: 'Text and voice model are required' });
        }

        // ==================================================================================
        // IMPORTANT: CONFIGURE YOUR RUNPOD URL
        // Replace 'YOUR_RUNPOD_SERVERLESS_ENDPOINT_URL' with your actual RunPod endpoint.
        // The voice generation feature will not work until this is configured.
        // ==================================================================================
        const runpodUrl = 'YOUR_RUNPOD_SERVERLESS_ENDPOINT_URL';

        if (runpodUrl === 'YOUR_RUNPOD_SERVERLESS_ENDPOINT_URL') {
            return res.status(500).json({ error: 'RunPod endpoint URL is not configured in server.js' });
        }

        const response = await fetch(runpodUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                input: {
                    text: text,
                    voice: voice
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to generate voice from RunPod');
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        response.body.pipe(res);

    } catch (error) {
        console.error('Voice generation error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate voice' });
    }
});

const PORT = process.env.PORT || 4001;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Update the error handling middleware at the bottom
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    return sendJsonResponse(res.status(500), { 
        error: 'Internal server error',
        details: err.message 
    });
});

// Add this catch-all middleware for unhandled routes
app.use((req, res) => {
    return sendJsonResponse(res.status(404), { 
        error: 'Not Found',
        path: req.path 
    });
});
