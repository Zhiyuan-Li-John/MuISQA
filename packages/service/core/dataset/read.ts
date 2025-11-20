import { BucketNameEnum } from '@fastgpt/global/common/file/constants';
import {
  ChunkTriggerConfigTypeEnum,
  DatasetSourceReadTypeEnum
} from '@fastgpt/global/core/dataset/constants';
import { readFileContentFromMongo } from '../../common/file/gridfs/controller';
import { urlsFetch } from '../../common/string/cheerio';
import { type TextSplitProps } from '@fastgpt/global/common/string/textSplitter';
import axios from 'axios';
import { readRawContentByFileBuffer } from '../../common/file/read/utils';
import { parseFileExtensionFromUrl } from '@fastgpt/global/common/string/tools';
import { getApiDatasetRequest } from './apiDataset';
import Papa from 'papaparse';
import type { ApiDatasetServerType } from '@fastgpt/global/core/dataset/apiDataset/type';
import { text2Chunks } from '../../worker/function';

// Excel文件按行分块处理函数
const parseExcelToRowChunks = (
  rawText: string,
  imageIdList?: string[]
): Array<{
  q: string;
  a: string;
  indexes?: string[];
  imageIdList?: string[];
}> => {
  // 使用CUSTOM_SPLIT_SIGN分割不同的工作表
  const { CUSTOM_SPLIT_SIGN } = require('@fastgpt/global/common/string/textSplitter');
  const worksheets = rawText.split(`\n\n${CUSTOM_SPLIT_SIGN}\n\n`);

  const chunks: Array<{
    q: string;
    a: string;
    indexes?: string[];
    imageIdList?: string[];
  }> = [];

  worksheets.forEach((worksheet) => {
    if (!worksheet.trim()) return;

    // 提取工作表名称
    const worksheetNameMatch = worksheet.match(/=== 工作表: (.+?) ===/);
    const worksheetName = worksheetNameMatch ? worksheetNameMatch[1] : '未知工作表';

    // 按行分割，每个 "--- 第N行数据 ---" 开始的部分作为一个chunk
    const rowPattern = /--- 第(\d+)行数据 ---\n([\s\S]*?)(?=\n--- 第\d+行数据 ---|$)/g;
    let match;

    while ((match = rowPattern.exec(worksheet)) !== null) {
      const rowNumber = match[1];
      const rowContent = match[2].trim();

      if (!rowContent) continue;

      // 为每行数据添加工作表信息作为上下文
      const contextualContent = `工作表: ${worksheetName}\n第${rowNumber}行数据:\n${rowContent}`;

      chunks.push({
        q: contextualContent,
        a: '',
        indexes: [],
        imageIdList
      });
    }
  });

  return chunks;
};

export const readFileRawTextByUrl = async ({
  teamId,
  tmbId,
  url,
  customPdfParse,
  getFormatText,
  relatedId
}: {
  teamId: string;
  tmbId: string;
  url: string;
  customPdfParse?: boolean;
  getFormatText?: boolean;
  relatedId: string; // externalFileId / apiFileId
}) => {
  const response = await axios({
    method: 'get',
    url: url,
    responseType: 'arraybuffer'
  });
  const extension = parseFileExtensionFromUrl(url);

  const buffer = Buffer.from(response.data, 'binary');

  const { rawText } = await readRawContentByFileBuffer({
    customPdfParse,
    getFormatText,
    extension,
    teamId,
    tmbId,
    buffer,
    encoding: 'utf-8',
    metadata: {
      relatedId
    }
  });

  return rawText;
};

/* 
  fileId - local file, read from mongo
  link - request
  externalFile/apiFile = request read
*/
export const readDatasetSourceRawText = async ({
  teamId,
  tmbId,
  type,
  sourceId,
  selector,
  externalFileId,
  apiDatasetServer,
  customPdfParse,
  getFormatText
}: {
  teamId: string;
  tmbId: string;
  type: DatasetSourceReadTypeEnum;
  sourceId: string;
  customPdfParse?: boolean;
  getFormatText?: boolean;

  selector?: string; // link selector
  externalFileId?: string; // external file dataset
  apiDatasetServer?: ApiDatasetServerType; // api dataset
}): Promise<{
  title?: string;
  rawText: string;
}> => {
  if (type === DatasetSourceReadTypeEnum.fileLocal) {
    const { filename, rawText } = await readFileContentFromMongo({
      teamId,
      tmbId,
      bucketName: BucketNameEnum.dataset,
      fileId: sourceId,
      customPdfParse,
      getFormatText
    });
    return {
      title: filename,
      rawText
    };
  } else if (type === DatasetSourceReadTypeEnum.link) {
    const result = await urlsFetch({
      urlList: [sourceId],
      selector
    });

    const { title = sourceId, content = '' } = result[0];
    if (!content || content === 'Cannot fetch internal url') {
      return Promise.reject(content || 'Can not fetch content from link');
    }

    return {
      title,
      rawText: content
    };
  } else if (type === DatasetSourceReadTypeEnum.externalFile) {
    if (!externalFileId) return Promise.reject('FileId not found');
    const rawText = await readFileRawTextByUrl({
      teamId,
      tmbId,
      url: sourceId,
      relatedId: externalFileId,
      customPdfParse
    });
    return {
      rawText
    };
  } else if (type === DatasetSourceReadTypeEnum.apiFile) {
    const { title, rawText } = await readApiServerFileContent({
      apiDatasetServer,
      apiFileId: sourceId,
      teamId,
      tmbId
    });
    return {
      title,
      rawText
    };
  }
  return {
    title: '',
    rawText: ''
  };
};

export const readApiServerFileContent = async ({
  apiDatasetServer,
  apiFileId,
  teamId,
  tmbId,
  customPdfParse
}: {
  apiDatasetServer?: ApiDatasetServerType;
  apiFileId: string;
  teamId: string;
  tmbId: string;
  customPdfParse?: boolean;
}): Promise<{
  title?: string;
  rawText: string;
}> => {
  return (await getApiDatasetRequest(apiDatasetServer)).getFileContent({
    teamId,
    tmbId,
    apiFileId,
    customPdfParse
  });
};

export const rawText2Chunks = async ({
  rawText = '',
  chunkTriggerType = ChunkTriggerConfigTypeEnum.minSize,
  chunkTriggerMinSize = 1000,
  backupParse,
  chunkSize = 512,
  imageIdList,
  filename,
  ...splitProps
}: {
  rawText: string;
  imageIdList?: string[];
  filename?: string; // 文件名，用于识别Excel文件

  chunkTriggerType?: ChunkTriggerConfigTypeEnum;
  chunkTriggerMinSize?: number; // maxSize from agent model, not store

  backupParse?: boolean;
  tableParse?: boolean;
} & TextSplitProps): Promise<
  {
    q: string;
    a: string;
    indexes?: string[];
    imageIdList?: string[];
  }[]
> => {
  const parseDatasetBackup2Chunks = (rawText: string) => {
    const csvArr = Papa.parse(rawText).data as string[][];

    const chunks = csvArr
      .slice(1)
      .map((item) => ({
        q: item[0] || '',
        a: item[1] || '',
        indexes: item.slice(2).filter((item) => item.trim()),
        imageIdList
      }))
      .filter((item) => item.q || item.a);

    return {
      chunks
    };
  };

  if (backupParse) {
    return parseDatasetBackup2Chunks(rawText).chunks;
  }

  // Excel文件特殊处理：强制按行分块，无视分块参数
  const isExcelFile =
    filename &&
    (filename.toLowerCase().endsWith('.xlsx') || filename.toLowerCase().endsWith('.xls'));
  if (isExcelFile) {
    return parseExcelToRowChunks(rawText, imageIdList);
  }

  // Chunk condition
  // 1. 选择最大值条件，只有超过了最大值(默认为模型的最大值*0.7），才会触发分块
  if (chunkTriggerType === ChunkTriggerConfigTypeEnum.maxSize) {
    const textLength = rawText.trim().length;
    const maxSize = splitProps.maxSize ? splitProps.maxSize * 0.7 : 16000;
    if (textLength < maxSize) {
      return [
        {
          q: rawText,
          a: '',
          imageIdList
        }
      ];
    }
  }
  // 2. 选择最小值条件，只有超过最小值(手动决定)才会触发分块
  if (chunkTriggerType !== ChunkTriggerConfigTypeEnum.forceChunk) {
    const textLength = rawText.trim().length;
    if (textLength < chunkTriggerMinSize) {
      return [{ q: rawText, a: '', imageIdList }];
    }
  }

  const { chunks } = await text2Chunks({
    text: rawText,
    chunkSize,
    ...splitProps
  });

  return chunks.map((item) => ({
    q: item,
    a: '',
    indexes: [],
    imageIdList
  }));
};
