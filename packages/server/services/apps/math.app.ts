// services/apps/math.app.ts
import { llmClient } from '../../llm/client';
import { mathCoTPrompt } from '../../prompts/prompts';

function isWordProblem(input: string): boolean {
   // Check if input contains letters (not only numbers and operators)
   const hasLetters = /[a-zA-Z]/.test(input);
   return hasLetters;
}

async function translateWordProblemToExpression(
   wordProblem: string
): Promise<string | null> {
   const prompt = mathCoTPrompt.replace('{{WORD_PROBLEM}}', wordProblem);

   console.log('Chain of Thought - Translating word problem to expression');
   console.log('Word problem:', wordProblem);

   try {
      const response = await llmClient.generateText({
         model: 'gpt-4o-mini',
         prompt,
         temperature: 0,
         maxTokens: 50,
      });

      // Extract only the expression (remove any extra formatting)
      let expression = response.text.trim();

      // Remove markdown blocks if present
      if (expression.startsWith('```')) {
         expression = expression
            .replace(/^```\w*\s*/, '')
            .replace(/\s*```$/, '');
      }

      // Take only the first line (the expression itself)
      const firstLine = expression.split('\n')[0];
      expression = firstLine ? firstLine.trim() : expression.trim();

      console.log('CoT result - Expression:', expression);

      return expression || null;
   } catch (error) {
      console.error('CoT translation error:', error);
      return null;
   }
}

function calculateExpression(expression: string): string {
   const expr = expression.trim();
   if (!expr) return 'Empty expression.';

   // Allow only safe mathematical characters
   const ALLOWED_CHARS = /^[0-9+\-*/().\s]+$/;
   if (!ALLOWED_CHARS.test(expr)) {
      return 'Invalid expression. Use only numbers and + - * / ( ) .';
   }

   if (
      expr.includes('**') ||
      expr.includes('//') ||
      expr.includes('/*') ||
      expr.includes('*/')
   ) {
      return 'Invalid expression.';
   }

   try {
      const result = Function(`"use strict"; return (${expr});`)() as unknown;

      if (typeof result !== 'number' || !Number.isFinite(result)) {
         return 'The result is undefined.';
      }

      const pretty = Number.isInteger(result)
         ? result.toFixed(0)
         : result.toString();

      return `The result is ${pretty}`;
   } catch {
      return "I couldn't compute that. Please check the expression.";
   }
}

export async function calculateMath(input: string): Promise<string> {
   const trimmed = input.trim();
   if (!trimmed) return 'Empty input.';

   // Check if this is a word problem
   if (isWordProblem(trimmed)) {
      // Translate the word problem into a mathematical expression
      const expression = await translateWordProblemToExpression(trimmed);
      if (!expression) {
         return "I couldn't translate that word problem into a mathematical expression.";
      }

      // Calculate the resulting expression
      return calculateExpression(expression);
   } else {
      // Direct mathematical expression
      return calculateExpression(trimmed);
   }
}
