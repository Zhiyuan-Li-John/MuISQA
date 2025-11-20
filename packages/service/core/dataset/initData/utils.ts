import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';
import { MongoInitData } from './schema';
import { getInitDataCache, setInitDataCache } from './cache';
import type { InitDataSchemaType } from './schema';
import { MongoUser } from '../../../support/user/schema';
import { getUserDetail } from '../../../support/user/controller';
import { MongoDataset } from '../schema';
import { mongoSessionRun } from '../../../common/mongo/sessionRun';
import { DatasetTypeEnum } from '@fastgpt/global/core/dataset/constants';
import { getDefaultEmbeddingModel, getDatasetModel } from '../../ai/model';

/**
 * 通过 key 获取初始化数据
 */
export const getInitDataByKey = async (key: string): Promise<InitDataSchemaType> => {
  if (!key) {
    return Promise.reject(CommonErrEnum.missingParams);
  }

  // 先从缓存中查找
  let initData = await getInitDataCache(key);

  if (!initData) {
    // 缓存中没有，从数据库查找
    const dbData = await MongoInitData.findOne({ key }).lean();

    if (!dbData) {
      return Promise.reject('未找到对应的初始化数据，请检查 key 是否正确');
    }

    initData = {
      _id: dbData._id.toString(),
      key: dbData.key,
      name: dbData.name,
      project: dbData.project,
      appId: dbData.appId.toString(),
      teamId: dbData.teamId.toString(),
      tmbId: dbData.tmbId.toString(),
      knowledgeBaseFolderId: dbData.knowledgeBaseFolderId.toString(),
      createTime: dbData.createTime,
      updateTime: dbData.updateTime
    };

    // 重新设置缓存
    await setInitDataCache(key, initData);
  }

  return initData;
};

/**
 * 通过 accessKey 从用户表获取用户信息
 */
export const getUserByAccessKey = async (
  accessKey: string
): Promise<{
  teamId: string;
  tmbId: string;
  userId: string;
} | null> => {
  if (!accessKey) {
    return null;
  }

  // 从用户表中查找具有该 accessKey 的用户
  const user = await MongoUser.findOne({ accessKey }).lean();

  if (!user) {
    return null;
  }

  // 获取用户详情（包含团队信息）
  const userDetail = await getUserDetail({
    tmbId: user.lastLoginTmbId,
    userId: user._id
  });

  return {
    teamId: userDetail.team.teamId,
    tmbId: userDetail.team.tmbId,
    userId: user._id.toString()
  };
};

/**
 * 验证 key 并获取对应的知识库文件夹 ID
 * 优先从用户表中查找，如果没有找到，再从 initData 中查找
 */
export const validateKeyAndGetKnowledgeBaseId = async (
  key: string
): Promise<{
  knowledgeBaseFolderId?: string; // 对于用户绑定模式，这个字段可选
  teamId: string;
  tmbId: string;
  userId: string;
  isUserBound?: boolean; // 标识是否为用户绑定模式
}> => {
  // 首先尝试从用户表中查找
  const userInfo = await getUserByAccessKey(key);

  if (userInfo) {
    // 如果在用户表中找到了，使用用户的团队信息
    // 用户绑定模式下不需要限制 knowledgeBaseFolderId，用户可以操作团队下的所有资源
    return {
      teamId: userInfo.teamId,
      tmbId: userInfo.tmbId,
      userId: userInfo.userId,
      isUserBound: true
    };
  }

  // 如果用户表中没有找到，回退到原有的 initData 逻辑
  const initData = await getInitDataByKey(key);

  return {
    knowledgeBaseFolderId: initData.knowledgeBaseFolderId,
    teamId: initData.teamId,
    tmbId: initData.tmbId,
    userId: global.systemEnv.defaultUserId || '',
    isUserBound: false
  };
};

/**
 * 验证 key 并获取对应的工作台文件夹 ID
 * 优先从用户表中查找，如果没有找到，再从 initData 中查找
 */
export const validateKeyAndGetWorkspaceId = async (
  key: string
): Promise<{
  teamId: string;
  tmbId: string;
}> => {
  // 首先尝试从用户表中查找
  const userInfo = await getUserByAccessKey(key);

  if (userInfo) {
    return {
      teamId: userInfo.teamId,
      tmbId: userInfo.tmbId
    };
  }

  // 如果用户表中没有找到，回退到原有的 initData 逻辑
  const initData = await getInitDataByKey(key);

  return {
    teamId: initData.teamId,
    tmbId: initData.tmbId
  };
};

/**
 * 验证 key 并获取对应的appId
 * 优先从用户表中查找，如果没有找到，再从 initData 中查找
 */
export const validateKeyAndGetAppId = async (
  key: string
): Promise<{
  appId: string;
  teamId: string;
  tmbId: string;
}> => {
  // 首先尝试从用户表中查找
  const userInfo = await getUserByAccessKey(key);

  if (userInfo) {
    // 对于用户绑定模式，可能需要创建或查找默认应用
    // 这里暂时使用团队ID作为appId，实际使用时可能需要调整
    return {
      appId: userInfo.teamId, // 临时方案，可能需要根据实际需求调整
      teamId: userInfo.teamId,
      tmbId: userInfo.tmbId
    };
  }

  // 如果用户表中没有找到，回退到原有的 initData 逻辑
  const initData = await getInitDataByKey(key);
  return {
    appId: initData.appId,
    teamId: initData.teamId,
    tmbId: initData.tmbId
  };
};

/**
 * 通过 name 和 project 查找或创建初始化数据
 * 如果已存在相同的 name 和 project，返回现有的数据
 * 否则返回 null，表示需要创建新的数据
 */
export const findInitDataByNameAndProject = async (
  teamId: string,
  name: string,
  project: string
): Promise<InitDataSchemaType | null> => {
  if (!teamId || !name || !project) {
    return Promise.reject(CommonErrEnum.missingParams);
  }

  // 先从数据库查找是否已存在
  const existingData = await MongoInitData.findOne({ teamId, name, project }).lean();

  if (!existingData) {
    return null;
  }

  const initData: InitDataSchemaType = {
    _id: existingData._id.toString(),
    key: existingData.key,
    name: existingData.name,
    project: existingData.project,
    appId: existingData.appId.toString(),
    teamId: existingData.teamId.toString(),
    tmbId: existingData.tmbId.toString(),
    knowledgeBaseFolderId: existingData.knowledgeBaseFolderId.toString(),
    createTime: existingData.createTime,
    updateTime: existingData.updateTime
  };

  // 将数据存储到缓存中
  await setInitDataCache(initData.key, initData);

  return initData;
};

/**
 * 获取或创建用户的临时文件知识库
 * 如果用户已有临时知识库，则直接返回ID
 * 如果没有，则创建一个新的临时知识库并保存到用户记录中
 */
export const getOrCreateTempDataset = async (
  userId: string,
  teamId: string,
  tmbId: string
): Promise<string> => {
  if (!userId || !teamId || !tmbId) {
    return Promise.reject(CommonErrEnum.missingParams);
  }

  // 查找用户是否已有临时知识库
  const user = await MongoUser.findById(userId);
  if (!user) {
    return Promise.reject('用户不存在');
  }

  // 如果用户已有临时知识库，检查是否还存在
  if (user.tempDatasetId) {
    const existingDataset = await MongoDataset.findById(user.tempDatasetId);
    if (existingDataset) {
      return user.tempDatasetId.toString();
    }
  }

  // 创建新的临时知识库
  const tempDatasetId = await mongoSessionRun(async (session) => {
    const [{ _id }] = await MongoDataset.create(
      [
        {
          name: '临时文件知识库',
          intro: '用于临时存储通过URL上传的文件，此知识库不会在列表中显示',
          teamId,
          tmbId,
          vectorModel: getDefaultEmbeddingModel()?.model,
          agentModel: getDatasetModel()?.model,
          avatar: 'core/dataset/commonDatasetColor',
          type: DatasetTypeEnum.dataset,
          parentId: null
        }
      ],
      { session }
    );

    // 更新用户记录，保存临时知识库ID
    await MongoUser.updateOne({ _id: userId }, { tempDatasetId: _id }, { session });

    return _id;
  });

  return tempDatasetId.toString();
};
