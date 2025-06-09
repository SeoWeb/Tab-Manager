'use server';

/**
 * @fileOverview An AI agent that suggests names or categories for tab collections based on the URLs.
 *
 * - suggestCollectionName - A function that suggests a collection name based on URLs.
 * - SuggestCollectionNameInput - The input type for the suggestCollectionName function.
 * - SuggestCollectionNameOutput - The return type for the suggestCollectionName function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestCollectionNameInputSchema = z.object({
  urls: z.array(z.string().url()).describe('An array of URLs in the tab collection.'),
});
export type SuggestCollectionNameInput = z.infer<typeof SuggestCollectionNameInputSchema>;

const SuggestCollectionNameOutputSchema = z.object({
  collectionName: z.string().describe('A suggested name for the tab collection.'),
});
export type SuggestCollectionNameOutput = z.infer<typeof SuggestCollectionNameOutputSchema>;

export async function suggestCollectionName(input: SuggestCollectionNameInput): Promise<SuggestCollectionNameOutput> {
  return suggestCollectionNameFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestCollectionNamePrompt',
  input: {schema: SuggestCollectionNameInputSchema},
  output: {schema: SuggestCollectionNameOutputSchema},
  prompt: `You are a helpful AI assistant that suggests a name for a collection of tabs based on their URLs. Suggest only the name of the collection, and nothing else. The suggested name should be no more than 3 words.

URLs: {{#each urls}}{{{this}}} {{/each}}`,
});

const suggestCollectionNameFlow = ai.defineFlow(
  {
    name: 'suggestCollectionNameFlow',
    inputSchema: SuggestCollectionNameInputSchema,
    outputSchema: SuggestCollectionNameOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
