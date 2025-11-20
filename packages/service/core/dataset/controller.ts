import { type DatasetSchemaType } from '@fastgpt/global/core/dataset/type';
import { MongoDatasetCollection } from './collection/schema';
import { MongoDataset } from './schema';
import { delCollectionRelatedSource } from './collection/controller';
import { type ClientSession } from '../../common/mongo';
import { MongoDatasetTraining } from './training/schema';
import { MongoDatasetData } from './data/schema';
import { deleteDatasetDataVector } from '../../common/vectorDB/controller';
import { MongoDatasetDataText } from './data/dataTextSchema';
import { DatasetErrEnum } from '@fastgpt/global/common/error/code/dataset';
import { retryFn } from '@fastgpt/global/common/system/utils';
import { clearDatasetImages } from './image/utils';
import { mongoSessionRun } from '../../common/mongo/sessionRun';

/* ============= dataset ========== */
/* find all datasetId by top datasetId */
export async function findDatasetAndAllChildren({
  teamId,
  datasetId,
  fields
}: {
  teamId: string;
  datasetId: string;
  fields?: string;
}): Promise<DatasetSchemaType[]> {
  const find = async (id: string) => {
    const children = await MongoDataset.find(
      {
        teamId,
        parentId: id
      },
      fields
    ).lean();

    let datasets = children;

    for (const child of children) {
      const grandChildrenIds = await find(child._id);
      datasets = datasets.concat(grandChildrenIds);
    }

    return datasets;
  };
  const [dataset, childDatasets] = await Promise.all([
    MongoDataset.findById(datasetId).lean(),
    find(datasetId)
  ]);

  if (!dataset) {
    return Promise.reject('Dataset not found');
  }

  return [dataset, ...childDatasets];
}

export async function getCollectionWithDataset(collectionId: string) {
  const data = await MongoDatasetCollection.findById(collectionId)
    .populate<{ dataset: DatasetSchemaType }>('dataset')
    .lean();
  if (!data) {
    return Promise.reject(DatasetErrEnum.unExistCollection);
  }
  return data;
}

/* delete all data by datasetIds */
export async function delDatasetRelevantData({
  datasets,
  session
}: {
  datasets: DatasetSchemaType[];
  session: ClientSession;
}) {
  if (!datasets.length) return;

  const teamId = datasets[0].teamId;

  if (!teamId) {
    return Promise.reject('TeamId is required');
  }

  const datasetIds = datasets.map((item) => item._id);

  // Get _id, teamId, fileId, metadata.relatedImgId for all collections
  const collections = await MongoDatasetCollection.find(
    {
      teamId,
      datasetId: { $in: datasetIds }
    },
    '_id teamId datasetId fileId metadata'
  ).lean();

  await retryFn(async () => {
    await Promise.all([
      // delete training data
      MongoDatasetTraining.deleteMany({
        teamId,
        datasetId: { $in: datasetIds }
      }),
      //Delete dataset_data_texts
      MongoDatasetDataText.deleteMany({
        teamId,
        datasetId: { $in: datasetIds }
      }),
      //delete dataset_datas
      MongoDatasetData.deleteMany({ teamId, datasetId: { $in: datasetIds } }),
      // Delete collection image and file
      delCollectionRelatedSource({ collections }),
      // Delete dataset Image
      clearDatasetImages(datasetIds),
      // Delete vector data
      deleteDatasetDataVector({ teamId, datasetIds })
    ]);
  });

  // delete collections
  await MongoDatasetCollection.deleteMany({
    teamId,
    datasetId: { $in: datasetIds }
  }).session(session);
}

/**
 * 更新 dataset 的 updateTime，如果该 dataset 有 parent，递归更新其 parent 的 updateTime
 * @param datasetId - 要更新的 dataset ID
 * @param session - 可选的数据库会话，如果不提供将创建新的事务
 * @param maxDepth - 最大递归深度，默认为 50，防止无限循环
 */
export async function updateDatasetUpdateTime(
  datasetId: string | null,
  session?: ClientSession,
  maxDepth: number = 50
): Promise<void> {
  const visitedIds = new Set<string>(); // 用于检测循环引用

  const updateRecursive = async (
    currentDatasetId: string | null,
    currentSession: ClientSession,
    currentDepth: number = 0
  ) => {
    if (!currentDatasetId) {
      return;
    }

    // 检查递归深度限制
    if (currentDepth >= maxDepth) {
      throw new Error(
        `Maximum recursion depth (${maxDepth}) exceeded when updating dataset updateTime`
      );
    }

    // 检测循环引用
    if (visitedIds.has(currentDatasetId)) {
      throw new Error(`Circular reference detected in dataset hierarchy: ${currentDatasetId}`);
    }
    visitedIds.add(currentDatasetId);

    // 更新当前 dataset 的 updateTime
    const dataset = await MongoDataset.findByIdAndUpdate(
      currentDatasetId,
      { updateTime: new Date() },
      { session: currentSession, new: true }
    ).lean();

    if (!dataset) {
      throw new Error(`Dataset not found: ${currentDatasetId}`);
    }

    // 如果有 parent，递归更新 parent 的 updateTime
    if (dataset.parentId) {
      await updateRecursive(dataset.parentId, currentSession, currentDepth + 1);
    }
  };

  if (session) {
    // 如果提供了 session，直接使用
    await updateRecursive(datasetId, session);
  } else {
    // 如果没有提供 session，创建新的事务
    await mongoSessionRun(async (newSession) => {
      await updateRecursive(datasetId, newSession);
    });
  }
}
