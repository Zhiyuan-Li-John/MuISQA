/* 索引增强队列 - 对已完成处理的数据进行索引增强 */

import { TrainingModeEnum } from '@fastgpt/global/core/dataset/constants';
import type {
  DatasetCollectionSchemaType,
  DatasetSchemaType
} from '@fastgpt/global/core/dataset/type';
import { addLog } from '@fastgpt/service/common/system/log';
import { MongoDatasetTraining } from '@fastgpt/service/core/dataset/training/schema';
import { MongoDatasetData } from '@fastgpt/service/core/dataset/data/schema';
import { addMinutes } from 'date-fns';
import { checkTeamAiPointsAndLock } from './utils';
import { getErrText } from '@fastgpt/global/common/error/utils';
import { delay } from '@fastgpt/service/common/bullmq';
import { getLLMModel, getDefaultLLMModel } from '@fastgpt/service/core/ai/model';
import { createChatCompletion } from '@fastgpt/service/core/ai/config';
import { llmCompletionsBodyFormat, formatLLMResponse } from '@fastgpt/service/core/ai/utils';
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';
import { DatasetDataIndexTypeEnum } from '@fastgpt/global/core/dataset/data/constants';
import { pushLLMTrainingUsage } from '@fastgpt/service/support/wallet/usage/controller';
import { Types } from '@fastgpt/service/common/mongo';

type PopulateType = {
  dataset: DatasetSchemaType;
  collection: DatasetCollectionSchemaType;
  data: {
    _id: string;
    q: string;
    a?: string;
    indexes: Array<{
      type: string;
      text: string;
      dataId?: string;
    }>;
  };
};

// 索引增强函数
const enhanceDataWithAutoIndexes = async ({
  dataItem,
  autoIndexesModel,
  autoIndexesSize
}: {
  dataItem: {
    _id: string;
    q: string;
    a?: string;
    indexes: Array<{
      type: string;
      text: string;
      dataId?: string;
    }>;
  };
  autoIndexesModel: string;
  autoIndexesSize: number;
}) => {
  if (!dataItem.q?.trim()) {
    return { enhancedIndexes: [], inputTokens: 0, outputTokens: 0 };
  }

  const model = getLLMModel(autoIndexesModel);
  const targetSize = autoIndexesSize;

  const autoIndexesPrompt = `
你是一个专业的问题生成助手。请根据给定的文本内容，生成用户可能会问的问题。

要求：
1. 问题要与文本内容密切相关
2. 问题要简洁明了，便于搜索
3. 问题要覆盖文本的不同角度和层面
4. 问题要使用与文本相同的语言
5. 根据文本内容的丰富程度和复杂性，自行判断生成合适数量的问题（最多${targetSize}个）
6. 如果文本内容简单，可以生成较少的问题；如果内容丰富，可以生成更多问题
7. 输出格式为JSON数组，每个元素为字符串
8. 不要生成与现有索引重复的问题

现有索引：
${dataItem.indexes.map((index) => `- ${index.text}`).join('\n')}

文本内容：
"""
${dataItem.q}
"""

请根据上述文本内容生成相关问题（最多${targetSize}个）：`;

  try {
    // 调用LLM生成问题
    const { response } = await createChatCompletion({
      body: llmCompletionsBodyFormat(
        {
          model: model.model,
          temperature: 0.3,
          messages: [
            {
              role: 'user',
              content: autoIndexesPrompt
            }
          ],
          stream: true
        },
        model
      )
    });

    const { text: answer, usage } = await formatLLMResponse(response);
    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;

    if (answer) {
      try {
        // 尝试解析JSON响应
        const start = answer.indexOf('[');
        const end = answer.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
          const jsonStr = answer.slice(start, end + 1);
          const generatedQuestions = JSON.parse(jsonStr);

          if (Array.isArray(generatedQuestions)) {
            // 过滤有效的问题
            const validQuestions = generatedQuestions
              .filter((q) => typeof q === 'string' && q.trim())
              .map((q) => q.trim())
              .slice(0, targetSize); // 限制数量

            const enhancedIndexes = validQuestions.map((text) => ({
              type: DatasetDataIndexTypeEnum.custom,
              text
            }));

            return { enhancedIndexes, inputTokens, outputTokens };
          }
        }
      } catch (parseError) {
        // JSON解析失败，尝试按行分割
        const lines = answer
          .split('\n')
          .map((line) => line.replace(/^[\d\.\-\*\s]*/, '').trim())
          .filter((line) => line && !line.startsWith('[') && !line.startsWith(']'))
          .slice(0, targetSize);

        if (lines.length > 0) {
          const enhancedIndexes = lines.map((text) => ({
            type: DatasetDataIndexTypeEnum.custom,
            text
          }));

          return { enhancedIndexes, inputTokens, outputTokens };
        }
      }
    }

    return { enhancedIndexes: [], inputTokens, outputTokens };
  } catch (error) {
    addLog.warn('Auto indexes generation failed for data:', {
      dataId: dataItem._id,
      error: getErrText(error)
    });
    return { enhancedIndexes: [], inputTokens: 0, outputTokens: 0 };
  }
};

export const indexEnhanceQueue = async (): Promise<any> => {
  const startTime = Date.now();

  // 1. 获取任务并锁定10分钟
  const {
    data,
    done = false,
    error = false
  } = await (async () => {
    try {
      const data = await MongoDatasetTraining.findOneAndUpdate(
        {
          mode: TrainingModeEnum.indexEnhance,
          retryCount: { $gt: 0 },
          lockTime: { $lte: addMinutes(new Date(), -10) }
        },
        {
          lockTime: new Date(),
          $inc: { retryCount: -1 }
        }
      )
        .populate<PopulateType>([
          {
            path: 'dataset',
            select: 'agentModel'
          },
          {
            path: 'collection',
            select: 'name'
          },
          {
            path: 'data',
            select: '_id q a indexes'
          }
        ])
        .lean();

      // 任务抢占
      if (!data) {
        return {
          done: true
        };
      }
      return {
        data
      };
    } catch (error) {
      addLog.error(`[Index Enhance Queue] Error`, error);
      return {
        error: true
      };
    }
  })();

  if (done || !data) {
    return;
  }
  if (error) {
    await delay(500);
    return indexEnhanceQueue();
  }

  // 检查团队积分并锁定
  if (!(await checkTeamAiPointsAndLock(data.teamId))) {
    return;
  }

  const dataset = data.dataset;
  const collection = data.collection;
  const dataItem = data.data;

  if (!dataset || !collection || !dataItem) {
    addLog.warn(`[Index Enhance Queue] data not found`, data);
    await MongoDatasetTraining.deleteOne({ _id: data._id });
    return;
  }

  addLog.info(`[Index Enhance Queue] Start enhancing data: ${dataItem._id}`);

  try {
    // 设置默认值
    const autoIndexesModel = data.autoIndexesModel || getDefaultLLMModel()?.model;
    const autoIndexesSize = data.autoIndexesSize || 3;

    if (!autoIndexesModel) {
      addLog.warn(`[Index Enhance Queue] No model available for enhancement`);
      await MongoDatasetTraining.deleteOne({ _id: data._id });
      return;
    }

    // 执行索引增强
    const { enhancedIndexes, inputTokens, outputTokens } = await enhanceDataWithAutoIndexes({
      dataItem,
      autoIndexesModel,
      autoIndexesSize
    });

    // 推送使用量统计
    pushLLMTrainingUsage({
      teamId: data.teamId,
      tmbId: data.tmbId,
      model: autoIndexesModel,
      inputTokens,
      outputTokens,
      billId: data.billId,
      mode: 'indexEnhance'
    });

    await mongoSessionRun(async (session) => {
      if (enhancedIndexes.length > 0) {
        // 更新数据项，添加增强的索引
        await MongoDatasetData.updateOne(
          { _id: dataItem._id },
          {
            $push: {
              indexes: { $each: enhancedIndexes }
            },
            updateTime: new Date()
          },
          { session }
        );

        addLog.info(
          `[Index Enhance Queue] Enhanced ${enhancedIndexes.length} indexes for data: ${dataItem._id}`
        );
      }

      // 删除训练任务
      await MongoDatasetTraining.deleteOne({ _id: data._id }, { session });
    });

    addLog.debug(`[Index Enhance Queue] Finish`, {
      time: Date.now() - startTime,
      enhancedCount: enhancedIndexes.length
    });
  } catch (err) {
    addLog.error(`[Index Enhance Queue] Error`, err);

    await MongoDatasetTraining.updateOne(
      { _id: data._id },
      {
        errorMsg: getErrText(err, 'unknown error'),
        lockTime: addMinutes(new Date(), -1)
      }
    );

    return indexEnhanceQueue();
  }
};
