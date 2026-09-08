import OpenAI from 'openai';

const client = new OpenAI({
   apiKey: process.env.OPENAI_API_KEY,
});

type GenerateTextOption = {
   model?: string;
   prompt: string;
   temperature?: number;
   maxTokens?: number;
   previousResponseId?: string;
   responseFormat?: { type: 'json_object' } | { type: 'text' };
};

type GenerateTextResult = {
   id: string;
   text: string;
};

export const llmClient = {
   async generateText({
      model = 'gpt-4o-mini',
      prompt,
      temperature = 0.2,
      maxTokens = 300,
      previousResponseId,
      responseFormat,
   }: GenerateTextOption): Promise<GenerateTextResult> {
      const params: any = {
         model,
         input: prompt,
         temperature,
         max_output_tokens: maxTokens,
      };

      if (previousResponseId) {
         params.previous_response_id = previousResponseId;
      }

      if (responseFormat?.type === 'json_object') {
         params.response_format = { type: 'json_object' };
      }

      let response;
      try {
         response = await client.responses.create(params);
      } catch (error: any) {
         if (
            responseFormat?.type === 'json_object' &&
            (error?.message?.includes('response_format') ||
               error?.code === 'invalid_request_error')
         ) {
            delete params.response_format;
            response = await client.responses.create(params);
         } else {
            throw error;
         }
      }

      return {
         id: response.id,
         text: response.output_text,
      };
   },
};
