import type { NextApiRequest, NextApiResponse } from 'next';
import { uploadMongoImg } from '@fastgpt/service/common/file/image/controller';
import { authCert } from '@fastgpt/service/support/permission/auth/common';
import { NextAPI } from '@/service/middleware/entry';
import { getUploadModel } from '@fastgpt/service/common/file/multer';
import { removeFilesByPaths } from '@fastgpt/service/common/file/utils';
import { jsonRes } from '@fastgpt/service/common/response';
import fs from 'fs';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const filePaths: string[] = [];
  try {
    const { teamId } = await authCert({ req, authToken: true });

    // 创建 multer 上传处理器
    const upload = getUploadModel({
      maxSize: 12 * 1024 * 1024 // 12MB
    });

    const { file } = await upload.getUploadFile(req, res);
    filePaths.push(file.path);

    // 检查文件类型
    if (!file.mimetype.startsWith('image/')) {
      throw new Error('只支持图片文件');
    }

    // 读取文件并转换为 base64
    const fileBuffer = fs.readFileSync(file.path);
    const base64Data = fileBuffer.toString('base64');
    const base64Img = `data:${file.mimetype};base64,${base64Data}`;

    // 上传到 MongoDB
    const imageUrl = await uploadMongoImg({
      base64Img,
      teamId,
      forever: true // 设置为永久存储
    });

    jsonRes(res, {
      data: imageUrl
    });
  } catch (error) {
    jsonRes(res, {
      code: 500,
      error: error instanceof Error ? error.message : '上传失败'
    });
  } finally {
    // 清理临时文件
    removeFilesByPaths(filePaths);
  }
}

export default NextAPI(handler);

export const config = {
  api: {
    bodyParser: false // 必须禁用默认的 body parser 以支持文件上传
  }
};
