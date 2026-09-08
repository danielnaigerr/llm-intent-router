import { generalChatPrompt } from '../../prompts/prompts';
import { llmClient } from '../../llm/client';
import type { ChatMessage } from '../../repositories/history.repository';

function historyToText(history: ChatMessage[]) {
   return history
      .slice(-20) // Keep the prompt small to avoid excessive token usage
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');
}

function checkGuardrails(userInput: string): string | null {
   const input = userInput.toLowerCase();

   // Check for political content (Hebrew and English keywords)
   const politicalKeywords = [
      'politics',
      'political',
      'election',
      'vote',
      'democrat',
      'republican',
      'government',
      'party',
   ];

   // Check for malicious code requests
   const malwareKeywords = [
      'malware',
      'virus',
      'trojan',
      'hack',
      'exploit',
      'exploit code',
      'write a virus',
      'create malware',
      'ransomware',
      'keylogger',
   ];

   // Check for illegal activities
   const illegalKeywords = [
      'drugs',
      'illegal',
      'bomb',
      'weapon',
      'gun',
      'violence',
      'how to kill',
   ];

   for (const keyword of politicalKeywords) {
      if (input.includes(keyword)) {
         return 'I cannot process this request: political discussions are not within my scope due to safety protocols.';
      }
   }

   for (const keyword of malwareKeywords) {
      if (input.includes(keyword)) {
         return 'I cannot process this request: writing malicious code violates safety protocols.';
      }
   }

   for (const keyword of illegalKeywords) {
      if (input.includes(keyword)) {
         return `I cannot process this request: content related to "${keyword}" is restricted due to safety protocols.`;
      }
   }

   return null;
}

export async function generalChat(history: ChatMessage[], userInput: string) {
   // Check guardrails first
   const guardrailResponse = checkGuardrails(userInput);
   if (guardrailResponse) {
      console.log('Guardrail triggered for input:', userInput);
      return { id: 'guardrail', message: guardrailResponse };
   }

   const historyBlock = history.length ? historyToText(history) : '(empty)';

   const fullPrompt = `
${generalChatPrompt}

Conversation history:
${historyBlock}

User: ${userInput}
Assistant:
`.trim();

   const response = await llmClient.generateText({
      model: 'gpt-4o-mini',
      prompt: fullPrompt,
      temperature: 0.2,
      maxTokens: 200,
   });

   return { id: response.id, message: response.text };
}
