import { jest } from '@jest/globals';
import request from 'supertest';

// Mock external dependencies
jest.unstable_mockModule('@opendocsg/pdf2md', () => ({
    default: jest.fn()
}));

// Mock the CharacterGeneratorService
const mockGenerateCharacter = jest.fn();
const mockRefineCharacter = jest.fn();
const mockFixJson = jest.fn();

jest.unstable_mockModule('../services/characterGenerator.js', () => ({
    CharacterGeneratorService: class {
        constructor() {}
        generateCharacter = mockGenerateCharacter;
        refineCharacter = mockRefineCharacter;
        fixJson = mockFixJson;
    }
}));

// Import app after mocking
const { app } = await import('../server.js');

describe('Server API Endpoints', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/generate-character', () => {
        it('should return 400 if fields are missing', async () => {
            const res = await request(app)
                .post('/api/generate-character')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.error).toBeDefined();
        });

        it('should generate character successfully', async () => {
            mockGenerateCharacter.mockResolvedValue({
                character: { name: 'Test' },
                rawPrompt: 'test prompt',
                rawResponse: '{}'
            });

            const res = await request(app)
                .post('/api/generate-character')
                .set('X-API-Key', 'test-key')
                .send({
                    prompt: 'test prompt',
                    model: 'test-model'
                });

            expect(res.status).toBe(200);
            expect(res.body.character.name).toBe('Test');
            expect(mockGenerateCharacter).toHaveBeenCalled();
        });

        it('should handle service errors', async () => {
            mockGenerateCharacter.mockRejectedValue(new Error('Service Error'));

            const res = await request(app)
                .post('/api/generate-character')
                .set('X-API-Key', 'test-key')
                .send({
                    prompt: 'test prompt',
                    model: 'test-model'
                });

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Service Error');
        });
    });

    describe('POST /api/fix-json', () => {
        it('should fix json successfully', async () => {
            mockFixJson.mockReturnValue({ name: 'Fixed' });

            const res = await request(app)
                .post('/api/fix-json')
                .send({ content: '{bad json' });

            expect(res.status).toBe(200);
            expect(res.body.character.name).toBe('Fixed');
        });
    });
});
