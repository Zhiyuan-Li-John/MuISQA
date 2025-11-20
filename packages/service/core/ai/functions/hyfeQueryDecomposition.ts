import { createChatCompletion } from '../config';
import { type ChatItemType } from '@fastgpt/global/core/chat/type';
import { countGptMessagesTokens, countPromptTokens } from '../../../common/string/tiktoken/index';
import { getLLMModel } from '../model';
import { llmCompletionsBodyFormat, formatLLMResponse } from '../utils';
import { addLog } from '../../../common/system/log';
import json5 from 'json5';

/* 
    HYFE Query Decomposition - 基于事实提取的问题分解
    使用两阶段策略：先尝试直接回答并提取事实，失败时进行问题改写
*/

export const hyfeQueryDecomposition = async ({
  query,
  model
}: {
  query: string;
  model: string;
}): Promise<{
  rawQuery: string;
  decomposedQueries: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}> => {
  const modelData = getLLMModel(model);

  // 主要的 Prompt：用于回答并提取事实
  const mainPrompt = `System role: You are a "Question Answering + Fact Extraction" assistant. 
Your goal is to first answer the question accurately, then decompose your answer into atomic fact statements that can be independently verified.

Input:
- Question: ${query}

Task requirements:
1) Provide a direct and concise answer to the question.
   - If the question naturally fits a structured format (e.g., gene mutations, drugs, rivers, nuclides), 
     present the answer as a well-formatted **Markdown table** with clear column headers.
   - If a table is not suitable, just provide a short text answer.
2) After giving the answer (or table), break it down into a "list of verifiable facts." 
   Each fact must be:
   - Atomic: contains only one verifiable claim, no bundled conclusions or multi-clause statements.
   - Explicit: avoid vague pronouns ("it/this/above"); use full entity names, include time, numerical units, or ranges where applicable, 
     and avoid hedging words like "maybe/probably."
   - Checkable: phrased in a way that can be verified via databases, search, or rules (with key entities, relations, or numbers clearly stated).
   - Independent: understandable without relying on context or cross-references ("see above," "as mentioned," etc. are forbidden).
3) If the question cannot be answered or lacks sufficient evidence, return a short "answer," and set \`facts\` to an empty list [].
4) Do not output any extra commentary or reasoning.

Output (must strictly be JSON, case-sensitive keys, exact structure):
{
  "answer": "<your answer in Markdown table or concise text>",
  "facts": [
    "<fact_1>",
    "<fact_2>",
    "... (each no longer than ~30 English words)"
  ]
}`;

  // Query Rewriting Prompt：当主流程失败时使用
  const rewritePrompt = `System role: You are a query rewriting assistant. Your task is to split the following complex question into simpler, more specific sub-questions that can each be answered independently.

Original Question: ${query}

Instructions:
- Break the original question into 2–5 focused, atomic sub-questions.
- Ensure each sub-question is self-contained and clearly defined.
- Avoid vague terms; make sure entities and context are explicit.

Output Format (strictly JSON):
{
  "sub_questions": [
    "<sub_question_1>",
    "<sub_question_2>",
    "... up to 5 sub-questions"
  ]
}`;

  const parseResponse = (responseText: string): string[] => {
    try {
      const cleanedResponse = responseText.trim();

      // 尝试移除可能的思考标签
      const thinkMatch = cleanedResponse.match(/(?<=<\/think>)\s*(.*)/s);
      const finalResponse = thinkMatch ? thinkMatch[1].trim() : cleanedResponse;

      // 移除可能的代码块标记
      const jsonResponse = finalResponse.replace(/^```json\s*/g, '').replace(/\s*```$/g, '');

      const parsed = json5.parse(jsonResponse);
      return parsed.facts || [];
    } catch (error) {
      addLog.warn('Failed to parse HYFE main response', { responseText });
      return [];
    }
  };

  const parseRewriteResponse = (responseText: string): string[] => {
    try {
      const cleanedResponse = responseText
        .trim()
        .replace(/^```json\s*/g, '')
        .replace(/\s*```$/g, '');

      const parsed = json5.parse(cleanedResponse);
      return parsed.sub_questions || [];
    } catch (error) {
      addLog.warn('Failed to parse HYFE rewrite response', { responseText });
      return [query]; // 返回原查询作为后备
    }
  };

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // 第一步：执行main_prompt查询
  try {
    const mainMessages = [
      {
        role: 'user',
        content: mainPrompt
      }
    ] as any;

    const { response: mainResponse } = await createChatCompletion({
      body: llmCompletionsBodyFormat(
        {
          stream: true,
          model: modelData.model,
          temperature: 0.1,
          messages: mainMessages
        },
        modelData
      )
    });

    const { text: mainAnswer, usage: mainUsage } = await formatLLMResponse(mainResponse);
    const mainInputTokens =
      mainUsage?.prompt_tokens || (await countGptMessagesTokens(mainMessages));
    const mainOutputTokens = mainUsage?.completion_tokens || (await countPromptTokens(mainAnswer));

    totalInputTokens += mainInputTokens;
    totalOutputTokens += mainOutputTokens;

    const facts = parseResponse(mainAnswer);
    if (facts && facts.length > 0) {
      return {
        rawQuery: query,
        decomposedQueries: facts,
        model,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens
      };
    }
  } catch (error) {
    addLog.warn('HYFE main prompt failed');
  }

  // 第二步：如果主流程没有成功，执行问题改写
  try {
    const rewriteMessages = [
      {
        role: 'user',
        content: rewritePrompt
      }
    ] as any;

    const { response: rewriteResponse } = await createChatCompletion({
      body: llmCompletionsBodyFormat(
        {
          stream: true,
          model: modelData.model,
          temperature: 0.1,
          messages: rewriteMessages
        },
        modelData
      )
    });

    const { text: rewriteAnswer, usage: rewriteUsage } = await formatLLMResponse(rewriteResponse);
    const rewriteInputTokens =
      rewriteUsage?.prompt_tokens || (await countGptMessagesTokens(rewriteMessages));
    const rewriteOutputTokens =
      rewriteUsage?.completion_tokens || (await countPromptTokens(rewriteAnswer));

    totalInputTokens += rewriteInputTokens;
    totalOutputTokens += rewriteOutputTokens;

    const subQuestions = parseRewriteResponse(rewriteAnswer);

    return {
      rawQuery: query,
      decomposedQueries: subQuestions,
      model,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens
    };
  } catch (error) {
    addLog.warn('HYFE rewrite prompt failed');

    // 如果所有步骤都失败，返回原查询
    return {
      rawQuery: query,
      decomposedQueries: [query],
      model,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens
    };
  }
};
