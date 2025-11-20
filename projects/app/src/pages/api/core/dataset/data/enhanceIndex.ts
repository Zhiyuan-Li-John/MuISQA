import { NextAPI } from '@/service/middleware/entry';
import type { ApiRequestProps } from '@fastgpt/service/type/next';
import { authDataset } from '@fastgpt/service/support/permission/dataset/auth';
import { MongoDatasetData } from '@fastgpt/service/core/dataset/data/schema';
import { MongoDatasetCollection } from '@fastgpt/service/core/dataset/collection/schema';
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
import { WritePermissionVal } from '@fastgpt/global/support/permission/constant';

export type EnhanceIndexProps = {
  datasetId: string;
  collectionId?: string; // 如果不提供，则对整个数据集进行索引增强
  dataIds?: string[]; // 如果不提供，则对collection或dataset下的所有已完成数据进行索引增强
  autoIndexesModel?: string; // LLM模型，不提供则使用默认模型
  autoIndexesSize?: number; // 生成索引数量，默认3个
};

export type EnhanceIndexResponse = {
  message: string;
  taskCount: number;
  billId: string;
};

/**
 * 对已经处理完成的数据或集合进行索引增强
 *
 * 请求示例：
 * curl -X POST http://localhost:3000/api/core/dataset/data/enhanceIndex \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer YOUR_TOKEN" \
 *   -d '{
 *     "datasetId": "your-dataset-id",
 *     "collectionId": "your-collection-id",
 *     "autoIndexesModel": "gpt-3.5-turbo",
 *     "autoIndexesSize": 5
 *   }'
 */
async function handler(req: ApiRequestProps<EnhanceIndexProps>): Promise<EnhanceIndexResponse> {
  const { datasetId, collectionId, dataIds, autoIndexesModel, autoIndexesSize = 3 } = req.body;

  if (!datasetId) {
    return Promise.reject(CommonErrEnum.missingParams);
  }

  // 验证数据集权限
  const { dataset, teamId, tmbId } = await authDataset({
    req,
    authToken: true,
    authApiKey: true,
    datasetId,
    per: WritePermissionVal
  });

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

  let targetDataIds: string[] = [];

  if (dataIds && dataIds.length > 0) {
    // 使用指定的数据ID
    targetDataIds = dataIds;
  } else {
    // 查询需要增强索引的数据
    const matchConditions: any = {
      teamId,
      datasetId
    };

    if (collectionId) {
      // 验证集合是否存在
      const collection = await MongoDatasetCollection.findOne({
        _id: collectionId,
        teamId,
        datasetId
      });

      if (!collection) {
        return Promise.reject('集合不存在');
      }

      matchConditions.collectionId = collectionId;
    }

    // 查询已完成处理的数据（没有正在进行的训练任务）
    const dataList = await MongoDatasetData.find(matchConditions, '_id collectionId').lean();

    targetDataIds = dataList.map((item) => String(item._id));
  }

  if (targetDataIds.length === 0) {
    return {
      message: '没有找到需要索引增强的数据',
      taskCount: 0,
      billId: ''
    };
  }

  // 限制批量处理数量，避免过多任务
  const maxBatchSize = 100;
  if (targetDataIds.length > maxBatchSize) {
    targetDataIds = targetDataIds.slice(0, maxBatchSize);
  }

  // 创建训练账单
  const { billId } = await createTrainingUsage({
    teamId,
    tmbId,
    appName: `索引增强-${collectionId ? '集合' : '数据集'}`,
    billSource: UsageSourceEnum.training,
    vectorModel: getEmbeddingModel(dataset.vectorModel)?.name,
    agentModel: getLLMModel(dataset.agentModel)?.name,
    vllmModel: getVlmModel(dataset.vlmModel)?.name
  });

  // 将数据推送到索引增强队列
  await mongoSessionRun(async (session) => {
    if (collectionId) {
      // 集合级索引增强，所有数据都属于同一个集合
      await pushDataToIndexEnhanceQueue({
        teamId,
        tmbId,
        datasetId,
        collectionId,
        dataIds: targetDataIds,
        billId,
        autoIndexesModel: finalAutoIndexesModel,
        autoIndexesSize,
        session
      });
    } else {
      // 数据集级索引增强，需要为每个数据项查找其集合ID
      const dataWithCollections = await MongoDatasetData.find(
        { _id: { $in: targetDataIds } },
        '_id collectionId'
      ).lean();

      // 按集合ID分组数据
      const dataByCollection = dataWithCollections.reduce(
        (acc, data) => {
          const cId = String(data.collectionId);
          if (!acc[cId]) {
            acc[cId] = [];
          }
          acc[cId].push(String(data._id));
          return acc;
        },
        {} as Record<string, string[]>
      );

      // 为每个集合分别创建索引增强任务
      for (const [cId, dataIds] of Object.entries(dataByCollection)) {
        await pushDataToIndexEnhanceQueue({
          teamId,
          tmbId,
          datasetId,
          collectionId: cId,
          dataIds,
          billId,
          autoIndexesModel: finalAutoIndexesModel,
          autoIndexesSize,
          session
        });
      }
    }
  });

  return {
    message: `已成功创建 ${targetDataIds.length} 个索引增强任务`,
    taskCount: targetDataIds.length,
    billId
  };
}

export default NextAPI(handler);
