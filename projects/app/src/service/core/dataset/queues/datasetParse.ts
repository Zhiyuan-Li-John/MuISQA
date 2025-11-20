/* Dataset collection source parse, not max size. */

import { ParagraphChunkAIModeEnum } from '@fastgpt/global/core/dataset/constants';
import {
  DatasetCollectionDataProcessModeEnum,
  DatasetCollectionTypeEnum,
  DatasetSourceReadTypeEnum,
  TrainingModeEnum
} from '@fastgpt/global/core/dataset/constants';
import type {
  DatasetCollectionSchemaType,
  DatasetSchemaType
} from '@fastgpt/global/core/dataset/type';
import { addLog } from '@fastgpt/service/common/system/log';
import { MongoDatasetTraining } from '@fastgpt/service/core/dataset/training/schema';
import { addMinutes } from 'date-fns';
import { checkTeamAiPointsAndLock } from './utils';
import { getErrText } from '@fastgpt/global/common/error/utils';
import { delay } from '@fastgpt/service/common/bullmq';
import { rawText2Chunks, readDatasetSourceRawText } from '@fastgpt/service/core/dataset/read';
import { getLLMModel, getDefaultLLMModel } from '@fastgpt/service/core/ai/model';
import { createChatCompletion } from '@fastgpt/service/core/ai/config';
import { llmCompletionsBodyFormat, formatLLMResponse } from '@fastgpt/service/core/ai/utils';
import { getLLMMaxChunkSize } from '@fastgpt/global/core/dataset/training/utils';
import { checkDatasetIndexLimit } from '@fastgpt/service/support/permission/teamLimit';
import { predictDataLimitLength } from '@fastgpt/global/core/dataset/utils';
import { getTrainingModeByCollection } from '@fastgpt/service/core/dataset/collection/utils';
import { pushDataListToTrainingQueue } from '@fastgpt/service/core/dataset/training/controller';
import { DatasetDataIndexTypeEnum } from '@fastgpt/global/core/dataset/data/constants';
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';
import { MongoDatasetCollection } from '@fastgpt/service/core/dataset/collection/schema';
import { hashStr } from '@fastgpt/global/common/string/tools';
import { POST } from '@fastgpt/service/common/api/plusRequest';
import { pushLLMTrainingUsage } from '@fastgpt/service/support/wallet/usage/controller';
import { MongoImage } from '@fastgpt/service/common/file/image/schema';

// 索引增强函数
const enhanceChunksWithAutoIndexes = async ({
  chunks,
  autoIndexesModel,
  autoIndexesSize
}: {
  chunks: Array<{
    q?: string;
    a?: string;
    indexes?: string[];
  }>;
  autoIndexesModel: string;
  autoIndexesSize: number;
}) => {
  for (const chunk of chunks) {
    if (!chunk.q) continue; // 跳过没有内容的chunk

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

文本内容：
"""
${chunk.q}
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

      const { text: answer } = await formatLLMResponse(response);

      if (answer) {
        try {
          // 尝试解析JSON响应
          const start = answer.indexOf('[');
          const end = answer.lastIndexOf(']');
          if (start !== -1 && end !== -1) {
            const jsonStr = answer.slice(start, end + 1);
            const generatedQuestions = JSON.parse(jsonStr);

            if (Array.isArray(generatedQuestions)) {
              // 初始化indexes数组（如果不存在）
              if (!chunk.indexes) {
                chunk.indexes = [];
              }

              // 将生成的问题添加到indexes中
              const validQuestions = generatedQuestions
                .filter((q) => typeof q === 'string' && q.trim())
                .map((q) => q.trim())
                .slice(0, targetSize); // 限制数量

              chunk.indexes.push(...validQuestions);
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
            if (!chunk.indexes) {
              chunk.indexes = [];
            }
            chunk.indexes.push(...lines);
          }
        }
      }
    } catch (error) {
      // 忽略单个chunk的错误，继续处理其他chunk
      addLog.warn('Auto indexes generation failed for chunk:', { error: getErrText(error) });
    }
  }
};

const requestLLMPargraph = async ({
  rawText,
  model,
  billId,
  paragraphChunkAIMode
}: {
  rawText: string;
  model: string;
  billId: string;
  paragraphChunkAIMode: ParagraphChunkAIModeEnum;
}) => {
  if (
    !global.feConfigs?.isPlus ||
    !paragraphChunkAIMode ||
    paragraphChunkAIMode === ParagraphChunkAIModeEnum.forbid
  ) {
    return {
      resultText: rawText,
      totalInputTokens: 0,
      totalOutputTokens: 0
    };
  }

  // Check is markdown text(Include 1 group of title)
  if (paragraphChunkAIMode === ParagraphChunkAIModeEnum.auto) {
    const isMarkdown = /^(#+)\s/.test(rawText);
    if (isMarkdown) {
      return {
        resultText: rawText,
        totalInputTokens: 0,
        totalOutputTokens: 0
      };
    }
  }

  const data = await POST<{
    resultText: string;
    totalInputTokens: number;
    totalOutputTokens: number;
  }>('/core/dataset/training/llmPargraph', {
    rawText,
    model,
    billId
  });

  return data;
};

export const datasetParseQueue = async (): Promise<any> => {
  const startTime = Date.now();

  // 1. Get task and lock 20 minutes ago
  const {
    data,
    done = false,
    error = false
  } = await (async () => {
    try {
      const data = await MongoDatasetTraining.findOneAndUpdate(
        {
          mode: TrainingModeEnum.parse,
          retryCount: { $gt: 0 },
          lockTime: { $lte: addMinutes(new Date(), -20) }
        },
        {
          lockTime: new Date(),
          $inc: { retryCount: -1 }
        }
      )
        .populate<{
          dataset: DatasetSchemaType;
          collection: DatasetCollectionSchemaType;
        }>([
          {
            path: 'collection',
            select: '-qaPrompt'
          },
          {
            path: 'dataset'
          }
        ])
        .lean();

      // task preemption
      if (!data) {
        return {
          done: true
        };
      }
      return {
        data
      };
    } catch (error) {
      addLog.error(`[Parse Queue] Error`, error);
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
    return datasetParseQueue();
  }

  // Check team points and lock(No mistakes will be thrown here)
  if (!(await checkTeamAiPointsAndLock(data.teamId))) {
    return;
  }

  const dataset = data.dataset;
  const collection = data.collection;

  if (!dataset || !collection) {
    addLog.warn(`[Parse Queue] data not found`, data);
    await MongoDatasetTraining.deleteOne({ _id: data._id });
    return;
  }

  addLog.info(`[Parse Queue] Start`);

  try {
    const trainingMode = getTrainingModeByCollection({
      trainingType: collection.trainingType,
      autoIndexes: collection.autoIndexes,
      imageIndex: collection.imageIndex
    });

    // 1. Parse rawtext
    const sourceReadType = await (async () => {
      if (collection.type === DatasetCollectionTypeEnum.link) {
        if (!collection.rawLink) return Promise.reject('rawLink is missing');
        return {
          type: DatasetSourceReadTypeEnum.link,
          sourceId: collection.rawLink,
          selector: collection.metadata?.webPageSelector
        };
      }
      if (collection.type === DatasetCollectionTypeEnum.file) {
        if (!collection.fileId) return Promise.reject('fileId is missing');
        return {
          type: DatasetSourceReadTypeEnum.fileLocal,
          sourceId: String(collection.fileId)
        };
      }
      if (collection.type === DatasetCollectionTypeEnum.apiFile) {
        if (!collection.apiFileId) return Promise.reject('apiFileId is missing');
        return {
          type: DatasetSourceReadTypeEnum.apiFile,
          sourceId: collection.apiFileId,
          apiDatasetServer: dataset.apiDatasetServer
        };
      }
      if (collection.type === DatasetCollectionTypeEnum.externalFile) {
        if (!collection.externalFileUrl) return Promise.reject('externalFileId is missing');
        return {
          type: DatasetSourceReadTypeEnum.externalFile,
          sourceId: collection.externalFileUrl,
          externalFileId: collection.externalFileId
        };
      }

      return null;
    })();

    if (!sourceReadType) {
      addLog.warn(`[Parse Queue] Source read type is null, delete task`);
      await MongoDatasetTraining.deleteOne({
        _id: data._id
      });
      return;
    }

    // 2. Read source
    const { title, rawText } = await readDatasetSourceRawText({
      teamId: data.teamId,
      tmbId: data.tmbId,
      customPdfParse: collection.customPdfParse,
      ...sourceReadType
    });

    // 3. LLM Pargraph
    const { resultText, totalInputTokens, totalOutputTokens } = await requestLLMPargraph({
      rawText,
      model: dataset.agentModel,
      billId: data.billId,
      paragraphChunkAIMode: collection.paragraphChunkAIMode
    });
    // Push usage
    pushLLMTrainingUsage({
      teamId: data.teamId,
      tmbId: data.tmbId,
      model: dataset.agentModel,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      billId: data.billId,
      mode: 'paragraph'
    });

    // 4. Chunk split
    const chunks = await rawText2Chunks({
      rawText: resultText,
      chunkTriggerType: collection.chunkTriggerType,
      chunkTriggerMinSize: collection.chunkTriggerMinSize,
      chunkSize: collection.chunkSize,
      paragraphChunkDeep: collection.paragraphChunkDeep,
      paragraphChunkMinSize: collection.paragraphChunkMinSize,
      maxSize: getLLMMaxChunkSize(getLLMModel(dataset.agentModel)),
      overlapRatio:
        collection.trainingType === DatasetCollectionDataProcessModeEnum.chunk ? 0.2 : 0,
      customReg: collection.chunkSplitter ? [collection.chunkSplitter] : [],
      backupParse: collection.trainingType === DatasetCollectionDataProcessModeEnum.backup,
      filename: collection.name
    });

    // 5. 索引增强处理
    if (data.autoIndexes === true && chunks.length > 0) {
      // 设置默认值
      const autoIndexesModel = data.autoIndexesModel || getDefaultLLMModel()?.model;
      const autoIndexesSize = data.autoIndexesSize || 3;

      if (autoIndexesModel) {
        // 检查是否有有效的文本内容
        const hasValidContent = chunks.some((chunk) => chunk.q && chunk.q.trim());

        if (hasValidContent) {
          addLog.debug(
            `[Parse Queue] Starting auto indexes enhancement for ${chunks.length} chunks`
          );
          await enhanceChunksWithAutoIndexes({
            chunks,
            autoIndexesModel,
            autoIndexesSize
          });
          addLog.debug(`[Parse Queue] Auto indexes enhancement completed`);
        }
      }
    }

    // 6. Check dataset limit
    try {
      await checkDatasetIndexLimit({
        teamId: data.teamId,
        insertLen: predictDataLimitLength(trainingMode, chunks)
      });
    } catch (error) {
      addLog.warn(`[Parse Queue] Check dataset limit failed, lock the task`);
      await MongoDatasetTraining.updateOne(
        {
          _id: data._id
        },
        {
          errorMsg: getErrText(error, 'unknown error'),
          lockTime: new Date('2999/5/5')
        }
      );
      return;
    }

    await mongoSessionRun(async (session) => {
      // 7. Update collection title(Link) - 只有链接类型的集合才用title更新名称
      await MongoDatasetCollection.updateOne(
        { _id: collection._id },
        {
          // 只有链接类型的集合才更新名称，避免覆盖用户重命名后的文件集合名称
          ...(title && collection.type === DatasetCollectionTypeEnum.link && { name: title }),
          rawTextLength: resultText.length,
          hashRawText: hashStr(resultText)
        },
        { session }
      );

      // 8. Push to chunk queue
      await pushDataListToTrainingQueue({
        teamId: data.teamId,
        tmbId: data.tmbId,
        datasetId: dataset._id,
        collectionId: collection._id,
        agentModel: dataset.agentModel,
        vectorModel: dataset.vectorModel,
        vlmModel: dataset.vlmModel,
        indexSize: collection.indexSize,
        mode: trainingMode,
        billId: data.billId,
        data: chunks.map((item, index) => ({
          ...item,
          indexes: item.indexes?.map((text) => ({
            type: DatasetDataIndexTypeEnum.custom,
            text
          })),
          chunkIndex: index
        })),
        session
      });

      // 9. Delete task
      await MongoDatasetTraining.deleteOne(
        {
          _id: data._id
        },
        {
          session
        }
      );

      // 10. Remove image ttl
      const relatedImgId = collection.metadata?.relatedImgId;
      if (relatedImgId) {
        await MongoImage.updateMany(
          {
            teamId: collection.teamId,
            'metadata.relatedId': relatedImgId
          },
          {
            // Remove expiredTime to avoid ttl expiration
            $unset: {
              expiredTime: 1
            }
          },
          {
            session
          }
        );
      }
    });

    addLog.debug(`[Parse Queue] Finish`, {
      time: Date.now() - startTime
    });
  } catch (err) {
    addLog.error(`[Parse Queue] Error`, err);

    await MongoDatasetTraining.updateOne(
      {
        _id: data._id
      },
      {
        errorMsg: getErrText(err, 'unknown error'),
        lockTime: addMinutes(new Date(), -1)
      }
    );

    return datasetParseQueue();
  }
};
