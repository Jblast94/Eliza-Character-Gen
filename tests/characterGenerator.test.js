import { jest } from '@jest/globals';
import { CharacterGeneratorService } from '../services/characterGenerator.js';

describe('CharacterGeneratorService', () => {
    let service;
    let mockFetch;

    beforeEach(() => {
        mockFetch = jest.fn();
        service = new CharacterGeneratorService(mockFetch);
    });

    describe('parseAIResponse', () => {
        it('should parse valid JSON', () => {
            const input = '{"name": "Test"}';
            const result = service.parseAIResponse(input);
            expect(result).toEqual({ name: "Test" });
        });

        it('should parse JSON with comments (JSON5)', () => {
            const input = '{name: "Test", // comment\n}';
            const result = service.parseAIResponse(input);
            expect(result).toEqual({ name: "Test" });
        });

        it('should extract JSON from markdown block', () => {
            const input = 'Here is the JSON:\n```json\n{"name": "Test"}\n```';
            const result = service.parseAIResponse(input);
            expect(result).toEqual({ name: "Test" });
        });

        it('should extract JSON from surrounding text', () => {
            const input = 'Sure, here it is: {"name": "Test"} Thanks!';
            const result = service.parseAIResponse(input);
            expect(result).toEqual({ name: "Test" });
        });
    });

    describe('generateCharacter', () => {
        const mockApiKey = 'test-key';
        const mockModel = 'test-model';
        const mockPrompt = 'A brave knight named Arthur';

        it('should successfully generate a character', async () => {
            const mockResponse = {
                name: "Arthur",
                bio: ["A brave knight."]
            };

            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify(mockResponse)
                        }
                    }]
                })
            });

            const result = await service.generateCharacter(mockPrompt, mockModel, mockApiKey);

            expect(result.character.name).toBe("Arthur");
            expect(result.character.bio).toContain("A brave knight.");
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should handle API errors', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                json: async () => ({ error: { message: "API Error" } })
            });

            await expect(service.generateCharacter(mockPrompt, mockModel, mockApiKey))
                .rejects.toThrow("API Error");
        });
    });

    describe('fixJson', () => {
        it('should fix malformed JSON', () => {
            const malformed = '{ name: "Test", }'; // Trailing comma
            const result = service.fixJson(malformed);
            expect(result.name).toBe("Test");
        });
    });
});
