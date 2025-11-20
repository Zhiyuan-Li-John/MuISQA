import { NextAPI } from '@/service/middleware/entry';
import { authSystemAdmin } from '@fastgpt/service/support/permission/user/auth';
import { MongoUser } from '@fastgpt/service/support/user/schema';
import { getUserDetail } from '@fastgpt/service/support/user/controller';
import { createUserSession } from '@fastgpt/service/support/user/session';
import { setCookie } from '@fastgpt/service/support/permission/controller';
import { type NextApiRequest, type NextApiResponse } from 'next';
import requestIp from 'request-ip';
import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';

interface SwitchUserBody {
  targetUserId: string;
}

export type SwitchUserResponse = {
  user: any;
  token: string;
};

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<SwitchUserResponse> {
  // 验证是否为root用户
  await authSystemAdmin({ req });

  const { targetUserId } = req.body as SwitchUserBody;

  if (!targetUserId) {
    return Promise.reject(CommonErrEnum.missingParams);
  }

  // 检查目标用户是否存在
  const targetUser = await MongoUser.findById(targetUserId);
  if (!targetUser) {
    return Promise.reject('目标用户不存在');
  }

  // 获取目标用户详情
  const userDetail = await getUserDetail({
    tmbId: targetUser.lastLoginTmbId,
    userId: targetUser._id
  });

  // 更新用户的最后登录团队
  await MongoUser.findByIdAndUpdate(targetUser._id, {
    lastLoginTmbId: userDetail.team.tmbId
  });

  // 创建用户会话，保持root权限
  const token = await createUserSession({
    userId: targetUser._id,
    teamId: userDetail.team.teamId,
    tmbId: userDetail.team.tmbId,
    isRoot: true, // 保持root权限
    ip: requestIp.getClientIp(req)
  });

  setCookie(res, token);

  return {
    user: userDetail,
    token
  };
}

export default NextAPI(handler);
