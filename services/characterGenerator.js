import nodeFetch from 'node-fetch';
import JSON5 from 'json5';

const DEFAULT_TEMPLATE = {
    name: "",
    clients: [],
    modelProvider: "",
    settings: {
        secrets: {},
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

const SYSTEM_PROMPT_GENERATION = `You are an expert creative writer and character designer specializing in creating AI personas. Your task is to create a deep, complex, and consistent character profile based on the user's description.

CRITICAL INSTRUCTIONS:
1. Output ONLY a valid JSON object.
2. Follow the provided template structure EXACTLY.
3. Ensure all arrays are populated with high-quality, relevant content.
4. "bio" should contain distinct facts about the character's life and personality.
5. "lore" should contain backstory elements.
6. "style" fields should describe HOW the character speaks (e.g., "uses slang", "speaks formally", "uses emojis").
7. "messageExamples" must be realistic dialogues.
8. DO NOT include any text outside the JSON object (no markdown, no explanations).
9. Ensure valid JSON syntax (close all braces/brackets, escape quotes if needed).`;

const SYSTEM_PROMPT_REFINEMENT = `You are an expert character editor. Your task is to refine an existing character profile based on new instructions while maintaining consistency and depth.

CRITICAL INSTRUCTIONS:
1. Output ONLY a valid JSON object.
2. Follow the provided template structure EXACTLY.
3. Apply the user's refinement instructions carefully.
4. Maintain the character's core identity unless instructed otherwise.
5. Ensure valid JSON syntax.
6. DO NOT include any text outside the JSON object.`;

export class CharacterGeneratorService {
    constructor(fetchImplementation = nodeFetch) {
        this.fetch = fetchImplementation;
    }

    /**
     * Parses and cleans AI response content to extract JSON.
     * @param {string} content
     * @returns {object}
     */
    parseAIResponse(content) {
        console.log('Original content:', content);

        try {
            // First try direct parse with JSON5 (more forgiving)
            return JSON5.parse(content);
        } catch (directParseError) {
            console.log('Direct parse failed, attempting cleanup');

            // Find JSON object boundaries
            const startIndex = content.indexOf('{');
            const endIndex = content.lastIndexOf('}');

            if (startIndex === -1 || endIndex === -1) {
                throw new Error('No complete JSON object found in response');
            }

            let jsonContent = content.substring(startIndex, endIndex + 1);

            // Clean up markdown code blocks if present
            jsonContent = jsonContent.replace(/```json/g, '').replace(/```/g, '');

            try {
                return JSON5.parse(jsonContent);
            } catch (cleanupParseError) {
                console.error('Parse error after cleanup:', cleanupParseError);
                throw new Error(`Failed to parse JSON content: ${cleanupParseError.message}`);
            }
        }
    }

    /**
     * Validate and normalize character data
     */
    normalizeCharacterData(data) {
        const characterData = { ...data };

        // Ensure required fields exist
        const defaults = DEFAULT_TEMPLATE;

        // Helper to ensure array
        const ensureArray = (arr) => Array.isArray(arr) ? arr : [];

        characterData.bio = ensureArray(characterData.bio);
        characterData.lore = ensureArray(characterData.lore);
        characterData.topics = ensureArray(characterData.topics);
        characterData.knowledge = ensureArray(characterData.knowledge);
        characterData.messageExamples = ensureArray(characterData.messageExamples);
        characterData.postExamples = ensureArray(characterData.postExamples);
        characterData.adjectives = ensureArray(characterData.adjectives);
        characterData.people = ensureArray(characterData.people);

        characterData.style = characterData.style || {};
        characterData.style.all = ensureArray(characterData.style.all);
        characterData.style.chat = ensureArray(characterData.style.chat);
        characterData.style.post = ensureArray(characterData.style.post);

        characterData.settings = characterData.settings || {};
        characterData.settings.secrets = characterData.settings.secrets || {};
        characterData.settings.voice = characterData.settings.voice || { model: "" };

        // Process knowledge entries (ensure they are sentences)
        characterData.knowledge = characterData.knowledge.map(entry => {
            if (typeof entry === 'string') {
                return entry.endsWith('.') ? entry : entry + '.';
            }
            if (typeof entry === 'object' && entry !== null) {
                const text = entry.text || entry.content || entry.value || entry.toString();
                return typeof text === 'string' ?
                    (text.endsWith('.') ? text : text + '.') :
                    null;
            }
            return null;
        }).filter(Boolean);

        return characterData;
    }

    async generateCharacter(prompt, model, apiKey) {
        if (!prompt) throw new Error('Prompt is required');
        if (!model) throw new Error('Model is required');
        if (!apiKey) throw new Error('API key is required');

        // Extract potential name
        const nameMatch = prompt.match(/name(?:\s+is)?(?:\s*:)?\s*([A-Z][a-zA-Z\s]+?)(?:\.|\s|$)/i);
        const suggestedName = nameMatch ? nameMatch[1].trim() : '';

        const template = { ...DEFAULT_TEMPLATE, name: suggestedName };

        const response = await this.fetch('https://openrouter.ai/api/v1/chat/completions', {
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
                        content: SYSTEM_PROMPT_GENERATION
                    },
                    {
                        role: 'user',
                        content: `Template to follow:
${JSON.stringify(template, null, 2)}

Character description: ${prompt}

Generate a complete character profile as a single JSON object following the exact template structure.`
                    }
                ],
                temperature: 0.7,
                max_tokens: 4000
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to generate character');
        }

        const data = await response.json();
        const generatedContent = data.choices[0].message.content;

        const parsedData = this.parseAIResponse(generatedContent);
        return {
            character: this.normalizeCharacterData(parsedData),
            rawPrompt: prompt,
            rawResponse: generatedContent
        };
    }

    async refineCharacter(prompt, model, currentCharacter, apiKey) {
        if (!prompt || !model || !currentCharacter) throw new Error('Missing required arguments');
        if (!apiKey) throw new Error('API key is required');

        const existingKnowledge = Array.isArray(currentCharacter.knowledge) ? currentCharacter.knowledge : [];
        const hasExistingKnowledge = existingKnowledge.length > 0;

        const template = { ...DEFAULT_TEMPLATE, ...currentCharacter };

        const response = await this.fetch('https://openrouter.ai/api/v1/chat/completions', {
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
                        content: SYSTEM_PROMPT_REFINEMENT
                    },
                    {
                        role: 'user',
                        content: `Current character data:
${JSON.stringify(currentCharacter, null, 2)}

Template to follow:
${JSON.stringify(DEFAULT_TEMPLATE, null, 2)}

Refinement instructions: ${prompt}

Output the refined character data as a single JSON object. ${hasExistingKnowledge ? 'DO NOT modify the existing knowledge array unless instructed.' : ''}`
                    }
                ],
                temperature: 0.7,
                max_tokens: 4000
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to refine character');
        }

        const data = await response.json();
        const generatedContent = data.choices[0].message.content;

        const parsedData = this.parseAIResponse(generatedContent);

        return {
            character: this.normalizeCharacterData(parsedData),
            rawPrompt: prompt,
            rawResponse: generatedContent
        };
    }

    fixJson(content) {
        const parsed = this.parseAIResponse(content);
        return this.normalizeCharacterData(parsed);
    }
}
