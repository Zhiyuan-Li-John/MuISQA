import {
  DatasetCollectionTypeEnum,
  DatasetCollectionDataProcessModeEnum,
  DatasetTypeEnum
} from '@fastgpt/global/core/dataset/constants';
import type { CreateDatasetCollectionParams } from '@fastgpt/global/core/dataset/api.d';
import { MongoDatasetCollection } from './schema';
import type {
  DatasetCollectionSchemaType,
  DatasetSchemaType
} from '@fastgpt/global/core/dataset/type';
import { MongoDatasetTraining } from '../training/schema';
import { MongoDatasetData } from '../data/schema';
import { delImgByRelatedId } from '../../../common/file/image/controller';
import { deleteDatasetDataVector } from '../../../common/vectorDB/controller';
import { delFileByFileIdList } from '../../../common/file/gridfs/controller';
import { BucketNameEnum } from '@fastgpt/global/common/file/constants';
import type { ClientSession } from '../../../common/mongo';
import { createOrGetCollectionTags } from './utils';
import { rawText2Chunks } from '../read';
import { checkDatasetIndexLimit } from '../../../support/permission/teamLimit';
import { predictDataLimitLength } from '../../../../global/core/dataset/utils';
import { mongoSessionRun } from '../../../common/mongo/sessionRun';
import { createTrainingUsage } from '../../../support/wallet/usage/controller';
import { UsageSourceEnum } from '@fastgpt/global/support/wallet/usage/constants';
import { getLLMModel, getEmbeddingModel, getVlmModel } from '../../ai/model';
import { createChatCompletion } from '../../ai/config';
import { llmCompletionsBodyFormat, formatLLMResponse } from '../../ai/utils';
import { pushDataListToTrainingQueue, pushDatasetToParseQueue } from '../training/controller';
import { MongoImage } from '../../../common/file/image/schema';
import { hashStr } from '@fastgpt/global/common/string/tools';
import { addDays } from 'date-fns';
import { MongoDatasetDataText } from '../data/dataTextSchema';
import { retryFn } from '@fastgpt/global/common/system/utils';
import { getTrainingModeByCollection } from './utils';
import {
  computedCollectionChunkSettings,
  getLLMMaxChunkSize
} from '@fastgpt/global/core/dataset/training/utils';
import { DatasetDataIndexTypeEnum } from '@fastgpt/global/core/dataset/data/constants';
import { clearCollectionImages, removeDatasetImageExpiredTime } from '../image/utils';
import { getDefaultLLMModel } from '../../ai/model';
import { readDatasetSourceRawText } from '../read';
import { DatasetSourceReadTypeEnum } from '@fastgpt/global/core/dataset/constants';
import { pushLLMTrainingUsage } from '../../../support/wallet/usage/controller';
import { addLog } from '../../../common/system/log';
import { getErrText } from '@fastgpt/global/common/error/utils';
import { insertDatasetDataVector } from '../../../common/vectorDB/controller';

/**
 * 同步处理集合数据 - 不使用队列
 * 专门用于临时知识库的同步处理，包含文档解析、切片和向量化的完整流程
 */
export const processCollectionDataSync = async ({
  dataset,
  collection,
  teamId,
  tmbId,
  billId
}: {
  dataset: DatasetSchemaType;
  collection: DatasetCollectionSchemaType;
  teamId: string;
  tmbId: string;
  billId?: string;
}) => {
  try {
    addLog.info(`[Sync Processing] Start processing collection: ${collection._id}`);

    // 1. 确定数据源类型并读取原始文本
    const sourceReadType = await (async () => {
      if (collection.type === DatasetCollectionTypeEnum.link) {
        if (!collection.rawLink) throw new Error('rawLink is missing');
        return {
          type: DatasetSourceReadTypeEnum.link,
          sourceId: collection.rawLink,
          selector: collection.metadata?.webPageSelector
        };
      }
      if (collection.type === DatasetCollectionTypeEnum.file) {
        if (!collection.fileId) throw new Error('fileId is missing');
        return {
          type: DatasetSourceReadTypeEnum.fileLocal,
          sourceId: String(collection.fileId)
        };
      }
      if (collection.type === DatasetCollectionTypeEnum.apiFile) {
        if (!collection.apiFileId) throw new Error('apiFileId is missing');
        return {
          type: DatasetSourceReadTypeEnum.apiFile,
          sourceId: collection.apiFileId,
          apiDatasetServer: dataset.apiDatasetServer
        };
      }
      if (collection.type === DatasetCollectionTypeEnum.externalFile) {
        if (!collection.externalFileUrl) throw new Error('externalFileId is missing');
        return {
          type: DatasetSourceReadTypeEnum.externalFile,
          sourceId: collection.externalFileUrl,
          externalFileId: collection.externalFileId
        };
      }
      throw new Error('Unsupported collection type');
    })();

    // 2. 读取原始文本
    const { title, rawText } = await readDatasetSourceRawText({
      teamId,
      tmbId,
      customPdfParse: collection.customPdfParse,
      ...sourceReadType
    });

    if (!rawText) {
      throw new Error('Failed to read raw text from source');
    }

    // 3. 文本切片（跳过LLM段落处理以简化流程）
    const chunks = await rawText2Chunks({
      rawText,
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

    addLog.info(
      `[Sync Processing] Generated ${chunks.length} chunks for collection: ${collection._id}`
    );

    if (chunks.length === 0) {
      addLog.warn(`[Sync Processing] No chunks generated for collection: ${collection._id}`);
      return {
        insertLen: 0,
        totalTokens: 0,
        insertResults: []
      };
    }

    // 4. 检查数据限制
    const trainingMode = getTrainingModeByCollection({
      trainingType: collection.trainingType,
      autoIndexes: collection.autoIndexes,
      imageIndex: collection.imageIndex
    });

    await checkDatasetIndexLimit({
      teamId,
      insertLen: predictDataLimitLength(trainingMode, chunks)
    });

    // 5. 同步处理每个数据块 - 直接使用pushDataListToTrainingQueue的逻辑但同步执行
    let totalTokens = 0;
    const insertResults: Array<{ insertId?: string; tokens: number }> = [];

    await mongoSessionRun(async (session) => {
      // 更新集合信息
      await MongoDatasetCollection.updateOne(
        { _id: collection._id },
        {
          ...(title && collection.type === DatasetCollectionTypeEnum.link && { name: title }),
          rawTextLength: rawText.length,
          hashRawText: hashStr(rawText)
        },
        { session }
      );

      // 同步处理每个数据块 - 直接插入到数据集而不使用队列
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        try {
          const embModel = getEmbeddingModel(dataset.vectorModel);
          if (!embModel) {
            throw new Error('Embedding model not found');
          }

          // 1. 先处理索引并生成向量
          // 注意：rawText2Chunks 在正常切片模式下总是返回 indexes: []
          // 所以我们直接使用 chunk.q 作为索引文本
          const indexTexts = [chunk.q];

          console.log(
            `[Sync Processing] Processing chunk ${i + 1}/${chunks.length}: "${chunk.q.substring(0, 100)}..."`
          );

          let chunkTokens = 0;
          const processedIndexes = [];

          // 为每个索引生成向量并插入向量数据库
          for (const indexText of indexTexts) {
            try {
              const { tokens, insertId } = await insertDatasetDataVector({
                query: indexText,
                model: embModel,
                teamId,
                datasetId: dataset._id,
                collectionId: collection._id
              });

              processedIndexes.push({
                type: DatasetDataIndexTypeEnum.custom,
                text: indexText,
                dataId: insertId // 使用向量数据库返回的ID
              });
              chunkTokens += tokens;

              console.log(
                `[Sync Processing] ✓ Generated vector with ID: ${insertId}, tokens: ${tokens}`
              );
              addLog.info(
                `[Sync Processing] Generated vector for index: ${indexText.substring(0, 50)}...`
              );
            } catch (error) {
              addLog.error(
                `[Sync Processing] Failed to generate vector for index: ${indexText}`,
                error
              );
              // 如果向量生成失败，跳过这个索引
              continue;
            }
          }

          // 2. 创建数据记录时直接包含处理好的索引
          const [{ _id: dataId }] = await MongoDatasetData.create(
            [
              {
                teamId,
                tmbId,
                datasetId: dataset._id,
                collectionId: collection._id,
                q: chunk.q,
                a: chunk.a || '',
                chunkIndex: i,
                indexes: processedIndexes // 直接包含处理好的索引
              }
            ],
            { session }
          );

          console.log(
            `[Sync Processing] ✓ Created data record with ${processedIndexes.length} indexes, dataId: ${dataId}`
          );

          totalTokens += chunkTokens;
          insertResults.push({
            insertId: String(dataId),
            tokens: chunkTokens
          });

          addLog.info(
            `[Sync Processing] Processed chunk ${i + 1}/${chunks.length} for collection: ${collection._id}`
          );
        } catch (error) {
          addLog.error(
            `[Sync Processing] Failed to process chunk ${i} for collection: ${collection._id}:`,
            error
          );
          throw error;
        }
      }
    });

    addLog.info(
      `[Sync Processing] Completed processing collection: ${collection._id}, generated ${chunks.length} chunks with ${totalTokens} tokens`
    );

    return {
      insertLen: chunks.length,
      totalTokens,
      insertResults
    };
  } catch (error) {
    addLog.error(`[Sync Processing] Error processing collection: ${collection._id}`, error);
    throw error;
  }
};

export const createCollectionAndInsertData = async ({
  dataset,
  rawText,
  imageIds,
  createCollectionParams,
  backupParse = false,
  billId,
  session
}: {
  dataset: DatasetSchemaType;
  rawText?: string;
  imageIds?: string[];
  createCollectionParams: CreateOneCollectionParams;

  backupParse?: boolean;

  billId?: string;
  session?: ClientSession;
}) => {
  // Adapter 4.9.0
  if (createCollectionParams.trainingType === DatasetCollectionDataProcessModeEnum.auto) {
    createCollectionParams.trainingType = DatasetCollectionDataProcessModeEnum.chunk;
    createCollectionParams.autoIndexes = true;
  }

  const formatCreateCollectionParams = computedCollectionChunkSettings({
    ...createCollectionParams,
    llmModel: getLLMModel(dataset.agentModel),
    vectorModel: getEmbeddingModel(dataset.vectorModel)
  });

  const teamId = formatCreateCollectionParams.teamId;
  const tmbId = formatCreateCollectionParams.tmbId;

  // Set default params
  const trainingType =
    formatCreateCollectionParams.trainingType || DatasetCollectionDataProcessModeEnum.chunk;
  const trainingMode = getTrainingModeByCollection({
    trainingType: trainingType,
    autoIndexes: formatCreateCollectionParams.autoIndexes,
    imageIndex: formatCreateCollectionParams.imageIndex
  });

  if (
    trainingType === DatasetCollectionDataProcessModeEnum.qa ||
    trainingType === DatasetCollectionDataProcessModeEnum.backup ||
    trainingType === DatasetCollectionDataProcessModeEnum.template
  ) {
    delete formatCreateCollectionParams.chunkTriggerType;
    delete formatCreateCollectionParams.chunkTriggerMinSize;
    delete formatCreateCollectionParams.dataEnhanceCollectionName;
    delete formatCreateCollectionParams.imageIndex;
    delete formatCreateCollectionParams.autoIndexes;

    if (
      trainingType === DatasetCollectionDataProcessModeEnum.backup ||
      trainingType === DatasetCollectionDataProcessModeEnum.template
    ) {
      delete formatCreateCollectionParams.paragraphChunkAIMode;
      delete formatCreateCollectionParams.paragraphChunkDeep;
      delete formatCreateCollectionParams.paragraphChunkMinSize;
      delete formatCreateCollectionParams.chunkSplitMode;
      delete formatCreateCollectionParams.chunkSize;
      delete formatCreateCollectionParams.chunkSplitter;
      delete formatCreateCollectionParams.indexSize;
      delete formatCreateCollectionParams.indexPrefixTitle;
    }
  }
  if (trainingType !== DatasetCollectionDataProcessModeEnum.qa) {
    delete formatCreateCollectionParams.qaPrompt;
  }

  // 1. split chunks or create image chunks
  const {
    chunks,
    chunkSize,
    indexSize
  }: {
    chunks: Array<{
      q?: string;
      a?: string; // answer or custom content
      imageId?: string;
      indexes?: string[];
    }>;
    chunkSize?: number;
    indexSize?: number;
  } = await (async () => {
    if (rawText) {
      // Process text chunks
      const chunks = await rawText2Chunks({
        rawText,
        chunkTriggerType: formatCreateCollectionParams.chunkTriggerType,
        chunkTriggerMinSize: formatCreateCollectionParams.chunkTriggerMinSize,
        chunkSize: formatCreateCollectionParams.chunkSize,
        paragraphChunkDeep: formatCreateCollectionParams.paragraphChunkDeep,
        paragraphChunkMinSize: formatCreateCollectionParams.paragraphChunkMinSize,
        maxSize: getLLMMaxChunkSize(getLLMModel(dataset.agentModel)),
        overlapRatio: trainingType === DatasetCollectionDataProcessModeEnum.chunk ? 0.2 : 0,
        customReg: formatCreateCollectionParams.chunkSplitter
          ? [formatCreateCollectionParams.chunkSplitter]
          : [],
        backupParse,
        filename: formatCreateCollectionParams.name
      });
      return {
        chunks,
        chunkSize: formatCreateCollectionParams.chunkSize,
        indexSize: formatCreateCollectionParams.indexSize
      };
    }

    if (imageIds) {
      // Process image chunks
      const chunks = imageIds.map((imageId: string) => ({
        imageId,
        indexes: []
      }));
      return { chunks };
    }

    return {
      chunks: [],
      chunkSize: formatCreateCollectionParams.chunkSize,
      indexSize: formatCreateCollectionParams.indexSize
    };
  })();

  // 2. auth limit
  await checkDatasetIndexLimit({
    teamId,
    insertLen: predictDataLimitLength(trainingMode, chunks)
  });

  // 索引增强
  if (createCollectionParams.autoIndexes === true) {
    if (!createCollectionParams.autoIndexesModel) {
      createCollectionParams.autoIndexesModel = getDefaultLLMModel()?.model;
    }

    if (!createCollectionParams.autoIndexesSize) {
      createCollectionParams.autoIndexesSize = 3;
    }

    for (const chunk of chunks) {
      if (!chunk.q) continue; // 跳过没有内容的chunk

      const autoIndexesModel = getLLMModel(createCollectionParams.autoIndexesModel);
      const targetSize = createCollectionParams.autoIndexesSize;

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
              model: autoIndexesModel.model,
              temperature: 0.3,
              messages: [
                {
                  role: 'user',
                  content: autoIndexesPrompt
                }
              ],
              stream: true
            },
            autoIndexesModel
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
        console.warn('Auto indexes generation failed for chunk:', error);
      }
    }
  }

  const fn = async (session: ClientSession) => {
    // 3. Create collection
    const { _id: collectionId } = await createOneCollection({
      ...formatCreateCollectionParams,
      trainingType,
      chunkSize,
      indexSize,

      hashRawText: rawText ? hashStr(rawText) : undefined,
      rawTextLength: rawText?.length,
      nextSyncTime: (() => {
        // ignore auto collections sync for website datasets
        if (!dataset.autoSync && dataset.type === DatasetTypeEnum.websiteDataset) return undefined;
        if (
          [DatasetCollectionTypeEnum.link, DatasetCollectionTypeEnum.apiFile].includes(
            formatCreateCollectionParams.type
          )
        ) {
          return addDays(new Date(), 1);
        }
        return undefined;
      })(),
      session
    });

    // 4. create training bill
    const traingBillId = await (async () => {
      if (billId) return billId;
      const { billId: newBillId } = await createTrainingUsage({
        teamId,
        tmbId,
        appName: formatCreateCollectionParams.name,
        billSource: UsageSourceEnum.training,
        vectorModel: getEmbeddingModel(dataset.vectorModel)?.name,
        agentModel: getLLMModel(dataset.agentModel)?.name,
        vllmModel: getVlmModel(dataset.vlmModel)?.name,
        session
      });
      return newBillId;
    })();

    // 5. insert to training queue
    const insertResults = await (async () => {
      if (rawText || imageIds) {
        return pushDataListToTrainingQueue({
          teamId,
          tmbId,
          datasetId: dataset._id,
          collectionId,
          agentModel: dataset.agentModel,
          vectorModel: dataset.vectorModel,
          vlmModel: dataset.vlmModel,
          indexSize,
          mode: trainingMode,
          billId: traingBillId,
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
      } else {
        await pushDatasetToParseQueue({
          teamId,
          tmbId,
          datasetId: dataset._id,
          collectionId,
          billId: traingBillId,
          session,
          autoIndexes: createCollectionParams.autoIndexes,
          autoIndexesModel: createCollectionParams.autoIndexesModel,
          autoIndexesSize: createCollectionParams.autoIndexesSize
        });
        return {
          insertLen: 0
        };
      }
    })();

    // 6. Remove images ttl index
    await removeDatasetImageExpiredTime({
      ids: imageIds,
      collectionId,
      session
    });

    return {
      collectionId: String(collectionId),
      insertResults
    };
  };

  if (session) {
    return fn(session);
  }
  return mongoSessionRun(fn);
};

export type CreateOneCollectionParams = CreateDatasetCollectionParams & {
  teamId: string;
  tmbId: string;
  session?: ClientSession;
};
export async function createOneCollection({ session, ...props }: CreateOneCollectionParams) {
  const {
    teamId,
    parentId,
    datasetId,
    tags,

    fileId,
    rawLink,
    externalFileId,
    externalFileUrl,
    apiFileId
  } = props;
  // Create collection tags
  const collectionTags = await createOrGetCollectionTags({ tags, teamId, datasetId, session });

  // Create collection
  const [collection] = await MongoDatasetCollection.create(
    [
      {
        ...props,
        _id: undefined,

        parentId: parentId || null,

        tags: collectionTags,

        ...(fileId ? { fileId } : {}),
        ...(rawLink ? { rawLink } : {}),
        ...(externalFileId ? { externalFileId } : {}),
        ...(externalFileUrl ? { externalFileUrl } : {}),
        ...(apiFileId ? { apiFileId } : {})
      }
    ],
    { session, ordered: true }
  );

  return collection;
}

/* delete collection related images/files */
export const delCollectionRelatedSource = async ({
  collections,
  session
}: {
  collections: {
    teamId: string;
    fileId?: string;
    metadata?: {
      relatedImgId?: string;
    };
  }[];
  session?: ClientSession;
}) => {
  if (collections.length === 0) return;

  const teamId = collections[0].teamId;

  if (!teamId) return Promise.reject('teamId is not exist');

  const fileIdList = collections.map((item) => item?.fileId || '').filter(Boolean);
  const relatedImageIds = collections
    .map((item) => item?.metadata?.relatedImgId || '')
    .filter(Boolean);

  // Delete files and images in parallel
  await Promise.all([
    // Delete files
    delFileByFileIdList({
      bucketName: BucketNameEnum.dataset,
      fileIdList
    }),
    // Delete images
    delImgByRelatedId({
      teamId,
      relateIds: relatedImageIds,
      session
    })
  ]);
};
/**
 * delete collection and it related data
 */
export async function delCollection({
  collections,
  session,
  delImg = true,
  delFile = true
}: {
  collections: DatasetCollectionSchemaType[];
  session: ClientSession;
  delImg: boolean;
  delFile: boolean;
}) {
  if (collections.length === 0) return;

  const teamId = collections[0].teamId;

  if (!teamId) return Promise.reject('teamId is not exist');

  const datasetIds = Array.from(new Set(collections.map((item) => String(item.datasetId))));
  const collectionIds = collections.map((item) => String(item._id));

  await retryFn(async () => {
    await Promise.all([
      // Delete training data
      MongoDatasetTraining.deleteMany({
        teamId,
        datasetId: { $in: datasetIds },
        collectionId: { $in: collectionIds }
      }),
      // Delete dataset_data_texts
      MongoDatasetDataText.deleteMany({
        teamId,
        datasetId: { $in: datasetIds },
        collectionId: { $in: collectionIds }
      }),
      // Delete dataset_datas
      MongoDatasetData.deleteMany({
        teamId,
        datasetId: { $in: datasetIds },
        collectionId: { $in: collectionIds }
      }),
      // Delete dataset_images
      clearCollectionImages(collectionIds),
      // Delete images if needed
      ...(delImg
        ? [
            delImgByRelatedId({
              teamId,
              relateIds: collections
                .map((item) => item?.metadata?.relatedImgId || '')
                .filter(Boolean)
            })
          ]
        : []),
      // Delete files if needed
      ...(delFile
        ? [
            delFileByFileIdList({
              bucketName: BucketNameEnum.dataset,
              fileIdList: collections.map((item) => item?.fileId || '').filter(Boolean)
            })
          ]
        : []),
      // Delete vector data
      deleteDatasetDataVector({ teamId, datasetIds, collectionIds })
    ]);

    // delete collections
    await MongoDatasetCollection.deleteMany(
      {
        teamId,
        _id: { $in: collectionIds }
      },
      { session }
    );
  });
}
