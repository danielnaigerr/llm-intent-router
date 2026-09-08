import { classifierPrompt } from '../prompts/prompts';
import { llmClient } from '../llm/client';
import { getWeather } from './apps/weather.app';
import { calculateMath } from './apps/math.app';
import { getExchangeRate } from './apps/exchange.app';
import { generalChat } from './apps/general.app';
import { analyzeReviewWithSelfCorrection } from './apps/reviewAnalyzer.app';
import { historyRepository } from '../repositories/history.repository';

type Classification = {
   intent: 'weather' | 'math' | 'exchange' | 'analyzeReview' | 'general';
   parameters: {
      city: string | null;
      expression: string | null;
      from: string | null;
      to: string | null;
      reviewText: string | null;
   };
   confidence: number;
};

function fillTemplate(userInput: string) {
   return classifierPrompt.replace('{{USER_INPUT}}', userInput);
}

async function classify(userInput: string): Promise<Classification> {
   const prompt = fillTemplate(userInput);

   const r = await llmClient.generateText({
      model: 'gpt-4o-mini',
      prompt,
      temperature: 0,
      maxTokens: 200,
      responseFormat: { type: 'json_object' },
   });

   // Log the raw JSON response from the classifier (useful when debugging routing)
   console.log('RAW JSON FROM LLM:', r.text);

   // Parse JSON strictly with a safe fallback
   let obj: any;
   try {
      // Remove markdown code blocks if present
      let jsonText = r.text.trim();
      if (jsonText.startsWith('```json')) {
         jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonText.startsWith('```')) {
         jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      obj = JSON.parse(jsonText);
   } catch (error) {
      console.error('JSON parse error:', error);
      // Fallback if the model returned invalid JSON
      return {
         intent: 'general',
         parameters: {
            city: null,
            expression: null,
            from: null,
            to: null,
            reviewText: null,
         },
         confidence: 0.0,
      };
   }

   // Validate intent
   const intent = obj.intent;
   if (
      !['weather', 'math', 'exchange', 'analyzeReview', 'general'].includes(
         intent
      )
   ) {
      console.warn('Invalid intent received:', intent);
      return {
         intent: 'general',
         parameters: {
            city: null,
            expression: null,
            from: null,
            to: null,
            reviewText: null,
         },
         confidence: 0.0,
      };
   }

   // Validate and extract parameters safely
   const params = obj.parameters || {};
   const confidence =
      typeof obj.confidence === 'number' &&
      obj.confidence >= 0 &&
      obj.confidence <= 1
         ? obj.confidence
         : 0.5;

   return {
      intent,
      parameters: {
         city: typeof params.city === 'string' ? params.city : null,
         expression:
            typeof params.expression === 'string' ? params.expression : null,
         from: typeof params.from === 'string' ? params.from : null,
         to: typeof params.to === 'string' ? params.to : null,
         reviewText:
            typeof params.reviewText === 'string' ? params.reviewText : null,
      },
      confidence,
   };
}

function formatReviewAnalysisForUser(analysis: {
   summary: string;
   overall_sentiment: string;
   score: number;
   aspects: Array<{ topic: string; sentiment: string; detail: string }>;
}) {
   const lines: string[] = [];
   lines.push('Analyzing review...');
   lines.push(`Summary: ${analysis.summary}`);
   lines.push(`Overall sentiment: ${analysis.overall_sentiment}`);
   lines.push(`Score: ${analysis.score}/10`);

   if (analysis.aspects.length) {
      lines.push('');
      lines.push('Detailed aspects:');
      analysis.aspects.forEach((a, i) => {
         lines.push(` ${i + 1}. ${a.topic} (${a.sentiment}): "${a.detail}"`);
      });
   }

   return lines.join('\n');
}

export const routerService = {
   async handleUserMessage(conversationId: string, userInput: string) {
      console.log('Router service called with:', { conversationId, userInput });

      // Reset command
      if (userInput.trim() === '/reset') {
         await historyRepository.resetAll();
         return {
            message: 'Conversation has been reset. A new session has started.',
         };
      }

      const decision = await classify(userInput);

      // Log the classification result (useful when debugging routing)
      console.log('Classification result:', {
         intent: decision.intent,
         confidence: decision.confidence,
         parameters: decision.parameters,
      });

      let assistantMessage = '';

      if (decision.intent === 'weather' && decision.parameters.city) {
         assistantMessage = await getWeather(decision.parameters.city);
      } else if (decision.intent === 'math') {
         // If an expression exists, use it. Otherwise, treat the input as a word problem.
         const mathInput = decision.parameters.expression || userInput;
         assistantMessage = await calculateMath(mathInput);
      } else if (decision.intent === 'exchange' && decision.parameters.from) {
         assistantMessage = getExchangeRate(
            decision.parameters.from,
            userInput
         );
      } else if (
         decision.intent === 'analyzeReview' &&
         decision.parameters.reviewText
      ) {
         const analysis = await analyzeReviewWithSelfCorrection(
            decision.parameters.reviewText
         );
         assistantMessage = formatReviewAnalysisForUser(analysis);
      } else {
         const history = historyRepository.get(conversationId);
         console.log('History length:', history.length);
         const r = await generalChat(history, userInput);
         assistantMessage = r.message;
      }

      // Save conversation history after each interaction
      historyRepository.append(conversationId, {
         role: 'user',
         content: userInput,
      });
      historyRepository.append(conversationId, {
         role: 'assistant',
         content: assistantMessage,
      });
      await historyRepository.save();

      return { message: assistantMessage, intent: decision.intent };
   },
};
