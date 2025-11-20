import type { NextApiRequest, NextApiResponse } from 'next';
import { MongoUser } from '@fastgpt/service/support/user/schema';
import { setCookie } from '@fastgpt/service/support/permission/controller';
import { getUserDetail } from '@fastgpt/service/support/user/controller';
import { UserStatusEnum } from '@fastgpt/global/support/user/constant';
import { NextAPI } from '@/service/middleware/entry';
import { useIPFrequencyLimit } from '@fastgpt/service/common/middle/reqFrequencyLimit';
import { pushTrack } from '@fastgpt/service/common/middle/tracks/utils';
import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';
import { UserErrEnum } from '@fastgpt/global/common/error/code/user';
import { addOperationLog } from '@fastgpt/service/support/operationLog/addOperationLog';
import { OperationLogEventEnum } from '@fastgpt/global/support/operationLog/constants';
import { createUserSession } from '@fastgpt/service/support/user/session';
import { createDefaultTeam } from '@fastgpt/service/support/user/team/controller';
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';
import { hashStr } from '@fastgpt/global/common/string/tools';
import requestIp from 'request-ip';

interface RegisterBody {
  username: string;
  password: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { username, password } = req.body as RegisterBody;

  if (!username || !password) {
    return Promise.reject(CommonErrEnum.invalidParams);
  }

  // 检查用户名是否已存在
  const existingUser = await MongoUser.findOne({ username });
  if (existingUser) {
    return Promise.reject('用户名已存在');
  }

  // 在事务中创建用户和默认团队
  const { userId, tmbId } = await mongoSessionRun(async (session) => {
    // 创建用户
    const [{ _id: userId }] = await MongoUser.create(
      [
        {
          username,
          password: hashStr(password),
          status: UserStatusEnum.active
        }
      ],
      { session, ordered: true }
    );

    // 创建默认团队
    const tmb = await createDefaultTeam({
      userId: userId.toString(),
      session
    });

    if (!tmb) {
      throw new Error('创建默认团队失败');
    }

    return { userId, tmbId: tmb._id };
  });

  // 等待事务提交后再获取用户详情
  const userDetail = await getUserDetail({
    tmbId: tmbId.toString(),
    userId: userId.toString()
  });

  // 更新用户的最后登录团队
  await MongoUser.findByIdAndUpdate(userDetail._id, {
    lastLoginTmbId: userDetail.team.tmbId
  });

  // 创建用户会话
  const token = await createUserSession({
    userId: userDetail._id,
    teamId: userDetail.team.teamId,
    tmbId: userDetail.team.tmbId,
    isRoot: false,
    ip: requestIp.getClientIp(req)
  });

  setCookie(res, token);

  // 记录追踪和操作日志
  pushTrack.login({
    type: 'password',
    uid: userDetail._id,
    teamId: userDetail.team.teamId,
    tmbId: userDetail.team.tmbId
  });

  addOperationLog({
    tmbId: userDetail.team.tmbId,
    teamId: userDetail.team.teamId,
    event: OperationLogEventEnum.LOGIN
  });

  return {
    user: userDetail,
    token
  };
}

export default NextAPI(handler);
