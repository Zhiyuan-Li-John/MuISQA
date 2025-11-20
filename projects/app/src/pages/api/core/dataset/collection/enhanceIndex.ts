import { NextAPI } from '@/service/middleware/entry';
import type { ApiRequestProps } from '@fastgpt/service/type/next';
import { authDatasetCollection } from '@fastgpt/service/support/permission/dataset/auth';
import { WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import { MongoDatasetData } from '@fastgpt/service/core/dataset/data/schema';
import { pushDataToIndexEnhanceQueue } from '@fastgpt/service/core/dataset/training/controller';
import { createTrainingUsage } from '@fastgpt/service/support/wallet/usage/controller';
import { UsageSourceEnum } from '@fastgpt/global/support/wallet/usage/constants';
import {
  getLLMModel,
  getEmbeddingModel,
  getVlmModel,
  getDefaultLLMModel
} from '@fastgpt/service/core/ai/model';
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';
import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';

export type EnhanceCollectionIndexProps = {
  collectionId: string;
  autoIndexesModel?: string; // LLM模型，不提供则使用默认模型
  autoIndexesSize?: number; // 生成索引数量，默认3个
};

export type EnhanceCollectionIndexResponse = {
  message: string;
  taskCount: number;
  billId: string;
};

/**
 * 对指定集合的已完成数据进行索引增强
 *
 * 请求示例：
 * curl -X POST http://localhost:3000/api/core/dataset/collection/enhanceIndex \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer YOUR_TOKEN" \
 *   -d '{
 *     "collectionId": "your-collection-id",
 *     "autoIndexesModel": "gpt-3.5-turbo",
 *     "autoIndexesSize": 5
 *   }'
 */
async function handler(
  req: ApiRequestProps<EnhanceCollectionIndexProps>
): Promise<EnhanceCollectionIndexResponse> {
  const { collectionId, autoIndexesModel, autoIndexesSize = 3 } = req.body;

  if (!collectionId) {
    return Promise.reject(CommonErrEnum.missingParams);
  }

  // 验证集合权限
  const { collection, teamId, tmbId } = await authDatasetCollection({
    req,
    authToken: true,
    authApiKey: true,
    collectionId,
    per: WritePermissionVal
  });

  const dataset = collection.dataset;

  // 设置默认模型
  const finalAutoIndexesModel = autoIndexesModel || getDefaultLLMModel()?.model;
  if (!finalAutoIndexesModel) {
    return Promise.reject('没有可用的LLM模型进行索引增强');
  }

  // 验证模型是否存在
  const model = getLLMModel(finalAutoIndexesModel);
  if (!model) {
    return Promise.reject(`模型 ${finalAutoIndexesModel} 不存在`);
  }

  // 查询集合下已完成处理的数据
  const dataList = await MongoDatasetData.find(
    {
      teamId,
      datasetId: dataset._id,
      collectionId
    },
    '_id'
  ).lean();

  if (dataList.length === 0) {
    return {
      message: '集合中没有找到需要索引增强的数据',
      taskCount: 0,
      billId: ''
    };
  }

  const dataIds = dataList.map((item) => String(item._id));

  // 限制批量处理数量，避免过多任务
  const maxBatchSize = 100;
  const targetDataIds = dataIds.length > maxBatchSize ? dataIds.slice(0, maxBatchSize) : dataIds;

  // 创建训练账单
  const { billId } = await createTrainingUsage({
    teamId,
    tmbId,
    appName: `索引增强-${collection.name}`,
    billSource: UsageSourceEnum.training,
    vectorModel: getEmbeddingModel(dataset.vectorModel)?.name,
    agentModel: getLLMModel(dataset.agentModel)?.name,
    vllmModel: getVlmModel(dataset.vlmModel)?.name
  });

  // 将数据推送到索引增强队列
  await mongoSessionRun(async (session) => {
    await pushDataToIndexEnhanceQueue({
      teamId,
      tmbId,
      datasetId: String(dataset._id),
      collectionId,
      dataIds: targetDataIds,
      billId,
      autoIndexesModel: finalAutoIndexesModel,
      autoIndexesSize,
      session
    });
  });

  return {
    message: `已成功为集合 "${collection.name}" 创建 ${targetDataIds.length} 个索引增强任务`,
    taskCount: targetDataIds.length,
    billId
  };
}

export default NextAPI(handler);
