import { NextAPI } from '@/service/middleware/entry';
import { authSystemAdmin } from '@fastgpt/service/support/permission/user/auth';
import { MongoUser } from '@fastgpt/service/support/user/schema';
import { type NextApiRequest, type NextApiResponse } from 'next';
import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';

export type GetAllUsersQuery = {
  page?: string;
  limit?: string;
  search?: string;
  accessKey?: string;
};

export type GetAllUsersResponse = {
  users: {
    _id: string;
    username: string;
    avatar?: string;
    status: string;
    createTime: number;
    accessKey?: string;
  }[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<GetAllUsersResponse> {
  // 验证是否为root用户
  await authSystemAdmin({ req });

  const { page = '1', limit = '10', search, accessKey } = req.query as GetAllUsersQuery;

  // 参数验证
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);

  if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
    return Promise.reject(CommonErrEnum.invalidParams);
  }

  // 构建查询条件
  const query: any = {};

  if (accessKey) {
    // accessKey 精确搜索
    query.accessKey = accessKey;
  } else if (search) {
    // 用户名模糊搜索
    query.username = { $regex: search, $options: 'i' };
  }

  // 计算分页
  const skip = (pageNum - 1) * limitNum;

  // 并行查询用户数据和总数
  const [users, total] = await Promise.all([
    MongoUser.find(query, '_id username avatar status createTime accessKey')
      .sort({ createTime: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    MongoUser.countDocuments(query)
  ]);

  const totalPages = Math.ceil(total / limitNum);

  return {
    users: users.map((user) => ({
      _id: user._id.toString(),
      username: user.username,
      avatar: (user as any).avatar,
      status: user.status,
      createTime: user.createTime,
      accessKey: (user as any).accessKey
    })),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages
  };
}

export default NextAPI(handler);
