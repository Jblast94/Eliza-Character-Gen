import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs/promises';
import pdf2md from '@opendocsg/pdf2md';
import { CharacterGeneratorService } from './services/characterGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const characterService = new CharacterGeneratorService();

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

// Add this helper function near the top
const sendJsonResponse = (res, data) => {
    res.setHeader('Content-Type', 'application/json');
    return res.json(data);
};

// Fix JSON formatting endpoint
app.post('/api/fix-json', async (req, res) => {
    try {
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }

        try {
            const characterData = characterService.fixJson(content);
            res.json({ character: characterData });
        } catch (error) {
            console.error('JSON fixing error:', error);
            res.status(500).json({ error: error.message || 'Failed to fix JSON formatting' });
        }
    } catch (error) {
        console.error('JSON fixing error:', error);
        res.status(500).json({ error: error.message || 'Failed to fix JSON formatting' });
    }
});

// Character generation endpoint
app.post('/api/generate-character', async (req, res) => {
    try {
        const { prompt, model } = req.body;
        const apiKey = req.headers['x-api-key'];

        if (!prompt || !model || !apiKey) {
            return res.status(400).json({ error: 'Missing required fields: prompt, model, or API key' });
        }

        const result = await characterService.generateCharacter(prompt, model, apiKey);
        return sendJsonResponse(res, result);
    } catch (error) {
        console.error('Character generation error:', error);
        return sendJsonResponse(res.status(500), { 
            error: error.message || 'Failed to generate character' 
        });
    }
});

// Character refinement endpoint
app.post('/api/refine-character', async (req, res) => {
    try {
        const { prompt, model, currentCharacter } = req.body;
        const apiKey = req.headers['x-api-key'];

        const result = await characterService.refineCharacter(prompt, model, currentCharacter, apiKey);
        return sendJsonResponse(res, result);

    } catch (error) {
        console.error('Character refinement error:', error);
        res.status(500).json({ error: error.message || 'Failed to refine character' });
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

const PORT = process.env.PORT || 4001;
const HOST = process.env.HOST || '0.0.0.0';

if (process.argv[1] === __filename) {
    app.listen(PORT, HOST, () => {
        console.log(`Server running on http://${HOST}:${PORT}`);
    });
}

export { app };

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
