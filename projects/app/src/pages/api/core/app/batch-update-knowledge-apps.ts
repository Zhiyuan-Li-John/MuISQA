import type { NextApiResponse } from 'next';
import { NextAPI } from '@/service/middleware/entry';
import { authUserPer } from '@fastgpt/service/support/permission/user/auth';
import { MongoApp } from '@fastgpt/service/core/app/schema';
import { MongoAppVersion } from '@fastgpt/service/core/app/version/schema';
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';
import { beforeUpdateAppFormat } from '@fastgpt/service/core/app/controller';
import { getNextTimeByCronStringAndTimezone } from '@fastgpt/global/common/string/time';
import { WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import { type ApiRequestProps } from '@fastgpt/service/type/next';
import { addOperationLog } from '@fastgpt/service/support/operationLog/addOperationLog';
import { OperationLogEventEnum } from '@fastgpt/global/support/operationLog/constants';
import { getI18nAppType } from '@fastgpt/service/support/operationLog/util';
import { i18nT } from '@fastgpt/web/i18n/utils';

// 模板配置接口定义
interface TemplateConfig {
  nodes: any[];
  edges: any[];
  chatConfig: any;
}

interface BatchUpdateKnowledgeAppsProps {
  versionName?: string;
  isPublish?: boolean;
  dryRun?: boolean; // 是否只是预览，不实际更新
  template: TemplateConfig; // 模板配置，必需参数
}

interface BatchUpdateResult {
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  apps: Array<{
    appId: string;
    appName: string;
    status: 'updated' | 'skipped' | 'error';
    error?: string;
  }>;
}

async function handler(
  req: ApiRequestProps<BatchUpdateKnowledgeAppsProps>,
  res: NextApiResponse<BatchUpdateResult>
) {
  const { versionName = '知识库模板更新', isPublish = false, dryRun = false, template } = req.body;

  // 验证模板配置是否存在
  if (!template || !template.nodes || !template.edges || !template.chatConfig) {
    return res.status(400).json({
      updatedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      apps: [],
      error: '模板配置不完整，请提供完整的 nodes、edges 和 chatConfig'
    } as any);
  }

  // 验证用户权限 - 需要管理员权限
  const { tmbId, teamId } = await authUserPer({
    req,
    authToken: true,
    per: WritePermissionVal
  });

  const result: BatchUpdateResult = {
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    apps: []
  };

  try {
    // 查找所有名称包含"知识库应用"的应用
    const knowledgeApps = await MongoApp.find({
      name: { $regex: '知识库应用', $options: 'i' },
      teamId
    }).select('_id name modules edges chatConfig');

    console.log(`找到 ${knowledgeApps.length} 个知识库应用`);

    // 如果是预览模式，直接返回找到的应用列表
    if (dryRun) {
      result.apps = knowledgeApps.map((app) => ({
        appId: app._id.toString(),
        appName: app.name,
        status: 'skipped' as const
      }));
      result.skippedCount = knowledgeApps.length;
      return res.json(result);
    }

    // 批量更新应用
    for (const app of knowledgeApps) {
      try {
        const { nodes, edges, chatConfig } = template;

        // 格式化节点数据
        beforeUpdateAppFormat({
          nodes: nodes as any
        });

        // 保持原有的chatConfig变量配置，只更新模板部分
        const updatedChatConfig = {
          ...chatConfig,
          variables: app.chatConfig?.variables || chatConfig.variables,
          scheduledTriggerConfig:
            app.chatConfig?.scheduledTriggerConfig || chatConfig.scheduledTriggerConfig
        };

        await mongoSessionRun(async (session) => {
          // 创建版本历史
          const [{ _id: versionId }] = await MongoAppVersion.create(
            [
              {
                appId: app._id,
                nodes: nodes as any,
                edges,
                chatConfig: updatedChatConfig,
                isPublish,
                versionName,
                tmbId
              }
            ],
            { session, ordered: true }
          );

          // 更新应用
          const updateData: any = {
            modules: nodes,
            edges,
            chatConfig: updatedChatConfig,
            updateTime: new Date(),
            version: 'v2',
            'pluginData.nodeVersion': versionId
          };

          // 如果发布且有定时任务配置，更新定时任务
          if (isPublish && updatedChatConfig?.scheduledTriggerConfig?.cronString) {
            updateData.$set = {
              scheduledTriggerConfig: updatedChatConfig.scheduledTriggerConfig,
              scheduledTriggerNextTime: getNextTimeByCronStringAndTimezone(
                updatedChatConfig.scheduledTriggerConfig
              )
            };
          } else if (isPublish) {
            updateData.$unset = {
              scheduledTriggerConfig: '',
              scheduledTriggerNextTime: ''
            };
          }

          await MongoApp.findByIdAndUpdate(app._id, updateData, { session });
        });

        // 添加操作日志
        addOperationLog({
          tmbId,
          teamId,
          event: OperationLogEventEnum.UPDATE_PUBLISH_APP,
          params: {
            appName: app.name,
            operationName: isPublish
              ? i18nT('account_team:save_and_publish')
              : i18nT('account_team:update'),
            appId: app._id.toString(),
            appType: getI18nAppType(app.type)
          }
        });

        result.apps.push({
          appId: app._id.toString(),
          appName: app.name,
          status: 'updated'
        });
        result.updatedCount++;

        console.log(`成功更新应用: ${app.name}`);
      } catch (error) {
        console.error(`更新应用失败: ${app.name}`, error);
        result.apps.push({
          appId: app._id.toString(),
          appName: app.name,
          status: 'error',
          error: error instanceof Error ? error.message : '未知错误'
        });
        result.errorCount++;
      }
    }

    console.log(`批量更新完成: 成功 ${result.updatedCount}, 失败 ${result.errorCount}`);
    res.json(result);
  } catch (error) {
    console.error('批量更新知识库应用失败:', error);
    res.status(500).json({
      updatedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      apps: [],
      error: error instanceof Error ? error.message : '服务器内部错误'
    } as any);
  }
}

export default NextAPI(handler);
