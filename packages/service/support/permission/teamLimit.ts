/**
 * 团队限制检查模块
 *
 * 新增的基于 knowledge-key 的限制：
 * 1. 每个 knowledge-key 最多 100 个数据集
 * 2. 每个数据集最多 10000 个集合
 *
 * 使用方法：
 *
 * 1. 在数据集创建接口中使用：
 *    await checkKnowledgeKeyDatasetLimit(key);
 *
 * 2. 在集合创建接口中使用：
 *    await checkCollectionCreateLimit(datasetId, 1); // 创建1个集合
 *    // 或者批量创建时：
 *    await checkCollectionCreateLimit(datasetId, batchSize);
 *
 * 3. 单独检查数据集下的集合数量：
 *    const count = await checkDatasetCollectionLimit(datasetId);
 */

import { getTeamPlanStatus, getTeamStandPlan, getTeamPoints } from '../../support/wallet/sub/utils';
import { MongoApp } from '../../core/app/schema';
import { MongoDataset } from '../../core/dataset/schema';
import { DatasetTypeEnum } from '@fastgpt/global/core/dataset/constants';
import { TeamErrEnum } from '@fastgpt/global/common/error/code/team';
import { SystemErrEnum } from '@fastgpt/global/common/error/code/system';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import { MongoTeamMember } from '../user/team/teamMemberSchema';
import { TeamMemberStatusEnum } from '@fastgpt/global/support/user/team/constant';
import { getVectorCountByTeamId } from '../../common/vectorDB/controller';
import { MongoDatasetCollection } from '../../core/dataset/collection/schema';
import { validateKeyAndGetKnowledgeBaseId } from '../../core/dataset/initData/utils';

export const checkTeamAIPoints = async (teamId: string) => {
  // 取消AI积分限制检查
  // if (!global.subPlans?.standard) return;

  // const { totalPoints, usedPoints } = await getTeamPoints({ teamId });

  // if (usedPoints >= totalPoints) {
  //   return Promise.reject(TeamErrEnum.aiPointsNotEnough);
  // }

  // return {
  //   totalPoints,
  //   usedPoints
  // };

  // 直接返回足够的积分
  return {
    totalPoints: 999999999,
    usedPoints: 0
  };
};

export const checkTeamMemberLimit = async (teamId: string, newCount: number) => {
  // 取消团队成员数量限制
  // const [{ standardConstants }, memberCount] = await Promise.all([
  //   getTeamStandPlan({
  //     teamId
  //   }),
  //   MongoTeamMember.countDocuments({
  //     teamId,
  //     status: { $ne: TeamMemberStatusEnum.leave }
  //   })
  // ]);

  // if (standardConstants && newCount + memberCount > standardConstants.maxTeamMember) {
  //   return Promise.reject(TeamErrEnum.teamOverSize);
  // }

  // 直接通过检查
  return;
};

export const checkTeamAppLimit = async (teamId: string, amount = 1) => {
  // 取消应用数量限制
  // const [{ standardConstants }, appCount] = await Promise.all([
  //   getTeamStandPlan({ teamId }),
  //   MongoApp.countDocuments({
  //     teamId,
  //     type: {
  //       $in: [AppTypeEnum.simple, AppTypeEnum.workflow, AppTypeEnum.plugin, AppTypeEnum.tool]
  //     }
  //   })
  // ]);

  // if (standardConstants && appCount + amount >= standardConstants.maxAppAmount) {
  //   return Promise.reject(TeamErrEnum.appAmountNotEnough);
  // }

  // // System check
  // if (global?.licenseData?.maxApps && typeof global?.licenseData?.maxApps === 'number') {
  //   const totalApps = await MongoApp.countDocuments({
  //     type: {
  //       $in: [AppTypeEnum.simple, AppTypeEnum.workflow, AppTypeEnum.plugin, AppTypeEnum.tool]
  //     }
  //   });
  //   if (totalApps >= global.licenseData.maxApps) {
  //     return Promise.reject(SystemErrEnum.licenseAppAmountLimit);
  //   }
  // }

  // 直接通过检查
  return;
};

export const checkDatasetIndexLimit = async ({
  teamId,
  insertLen = 0
}: {
  teamId: string;
  insertLen?: number;
}) => {
  // 取消数据集索引大小限制
  // const [{ standardConstants, totalPoints, usedPoints, datasetMaxSize }, usedDatasetIndexSize] =
  //   await Promise.all([getTeamPlanStatus({ teamId }), getVectorCountByTeamId(teamId)]);

  // if (!standardConstants) return;

  // if (usedDatasetIndexSize + insertLen >= datasetMaxSize) {
  //   return Promise.reject(TeamErrEnum.datasetSizeNotEnough);
  // }

  // if (usedPoints >= totalPoints) {
  //   return Promise.reject(TeamErrEnum.aiPointsNotEnough);
  // }

  // 直接通过检查
  return;
};

export const checkTeamDatasetLimit = async (teamId: string) => {
  // 取消数据集数量限制
  // const [{ standardConstants }, datasetCount] = await Promise.all([
  //   getTeamStandPlan({ teamId }),
  //   MongoDataset.countDocuments({
  //     teamId,
  //     type: { $ne: DatasetTypeEnum.folder }
  //   })
  // ]);

  // // User check
  // if (standardConstants && datasetCount >= standardConstants.maxDatasetAmount) {
  //   return Promise.reject(TeamErrEnum.datasetAmountNotEnough);
  // }

  // // System check
  // if (global?.licenseData?.maxDatasets && typeof global?.licenseData?.maxDatasets === 'number') {
  //   const totalDatasets = await MongoDataset.countDocuments({
  //     type: { $ne: DatasetTypeEnum.folder }
  //   });
  //   if (totalDatasets >= global.licenseData.maxDatasets) {
  //     return Promise.reject(SystemErrEnum.licenseDatasetAmountLimit);
  //   }
  // }
  // // Open source check - 这里是导致你遇到错误的地方
  // if (!global.feConfigs.isPlus && datasetCount >= 30) {
  //   return Promise.reject(SystemErrEnum.communityVersionNumLimit);
  // }

  // 直接通过检查
  return;
};

/**
 * 基于 knowledge-key 检查数据集数量限制
 * 每个 knowledge-key 最多 100 个数据集
 * 对于用户绑定模式（parentId为null），检查团队下的数据集总数
 */
export const checkKnowledgeKeyDatasetLimit = async (parentId: string | null, teamId?: string) => {
  try {
    let datasetCount: number;

    if (parentId === null) {
      // 用户绑定模式：检查整个团队下的数据集数量
      if (!teamId) {
        return Promise.reject('用户绑定模式下需要提供 teamId');
      }
      datasetCount = await MongoDataset.countDocuments({
        teamId: teamId,
        type: { $ne: DatasetTypeEnum.folder }
      });
    } else {
      // 传统模式：检查特定知识库文件夹下的数据集数量
      datasetCount = await MongoDataset.countDocuments({
        parentId: parentId
      });
    }

    if (datasetCount >= 100) {
      return Promise.reject('该知识库已达到最大数据集数量限制（100个）');
    }

    return datasetCount;
  } catch (error) {
    return Promise.reject(error);
  }
};

/**
 * 基于数据集 ID 检查集合数量限制
 * 每个数据集最多 10000 个集合
 */
export const checkDatasetCollectionLimit = async (datasetId: string) => {
  try {
    // 统计该数据集下的集合数量
    const collectionCount = await MongoDatasetCollection.countDocuments({
      datasetId
    });

    if (collectionCount >= 10000) {
      return Promise.reject('该数据集已达到最大集合数量限制（10000个）');
    }

    return collectionCount;
  } catch (error) {
    return Promise.reject(error);
  }
};

/**
 * 在创建集合前进行限制检查的通用函数
 * 可以在任何集合创建接口中调用
 */
export const checkCollectionCreateLimit = async (datasetId: string, amount: number = 1) => {
  try {
    const currentCount = await checkDatasetCollectionLimit(datasetId);

    if (currentCount + amount > 10000) {
      return Promise.reject(
        `该数据集集合数量即将超出限制，当前：${currentCount}个，尝试添加：${amount}个，最大限制：10000个`
      );
    }

    return currentCount;
  } catch (error) {
    return Promise.reject(error);
  }
};

export const checkTeamWebSyncPermission = async (teamId: string) => {
  // 取消网站同步权限限制
  // const { standardConstants } = await getTeamStandPlan({
  //   teamId
  // });

  // if (standardConstants && !standardConstants?.permissionWebsiteSync) {
  //   return Promise.reject(TeamErrEnum.websiteSyncNotEnough);
  // }

  // 直接通过检查
  return;
};
