import { CUSTOM_SPLIT_SIGN } from '@fastgpt/global/common/string/textSplitter';
import { type ReadRawTextByBuffer, type ReadFileResponse } from '../type';
import xlsx from 'node-xlsx';
import * as XLSX from 'xlsx';

// 处理合并单元格：拆分并填充内容
const processMergedCells = (worksheet: any): any[][] => {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
  const result: any[][] = [];

  // 初始化结果数组
  for (let R = range.s.r; R <= range.e.r; ++R) {
    result[R] = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      result[R][C] = '';
    }
  }

  // 填充普通单元格的值
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = worksheet[cellAddress];
      if (cell && cell.v !== undefined) {
        result[R][C] = cell.v;
      }
    }
  }

  // 处理合并单元格
  if (worksheet['!merges']) {
    worksheet['!merges'].forEach((merge: any) => {
      // 获取合并区域左上角单元格的值
      const topLeftAddress = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
      const topLeftCell = worksheet[topLeftAddress];
      const mergeValue = topLeftCell && topLeftCell.v !== undefined ? topLeftCell.v : '';

      // 将值填充到合并区域的所有单元格
      for (let R = merge.s.r; R <= merge.e.r; ++R) {
        for (let C = merge.s.c; C <= merge.e.c; ++C) {
          result[R][C] = mergeValue;
        }
      }
    });
  }

  return result;
};

// 新的 xlsx 读取函数，支持合并单元格处理
export const readXlsxWithMergedCells = async ({
  buffer
}: ReadRawTextByBuffer): Promise<ReadFileResponse> => {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // 处理每个工作表
    const worksheets = workbook.SheetNames.map((sheetName: string) => {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet || !worksheet['!ref']) {
        console.log(`工作表 ${sheetName} 为空`);
        return null;
      }

      // 处理合并单元格
      const data = processMergedCells(worksheet);

      if (!data || data.length === 0) {
        return null;
      }

      // 找到第一个非空行作为表头
      let headerRowIndex = -1;
      let header = null;

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (
          row &&
          row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
        ) {
          header = row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)));
          headerRowIndex = i;
          break;
        }
      }

      if (!header || header.length === 0) {
        return null;
      }

      // 处理数据行（表头之后的行）
      const dataRows = data
        .slice(headerRowIndex + 1)
        .filter(
          (row) =>
            row &&
            row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
        );

      if (dataRows.length === 0) {
        return null;
      }

      const keyValuePairs = dataRows
        .map((row, rowIndex) => {
          // 确保每行都有足够的列
          const normalizedRow: any[] = [];
          for (let i = 0; i < header.length; i++) {
            const cellValue = i < row.length ? row[i] : '';
            normalizedRow.push(cellValue === null || cellValue === undefined ? '' : cellValue);
          }

          const pairs = header
            .map((key, colIndex) => {
              const rawKey = String(key).trim();
              const rawValue = String(normalizedRow[colIndex]).trim();

              if (!rawKey || !rawValue) return null;

              // 处理键名中的换行符
              const cleanKey = rawKey.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');

              // 处理值中的换行符，保持内容的可读性
              const cleanValue = rawValue.replace(/[\r\n]+/g, ' | ').replace(/\t/g, ' ');

              return `${cleanKey}: ${cleanValue}`;
            })
            .filter(Boolean)
            .join('\n');

          return pairs ? `--- 第${rowIndex + 1}行数据 ---\n${pairs}` : null;
        })
        .filter(Boolean)
        .join('\n\n');

      return keyValuePairs ? `=== 工作表: ${sheetName} ===\n${keyValuePairs}` : null;
    }).filter(Boolean);

    // 生成最终结果
    const formatText = worksheets.join(`\n\n${CUSTOM_SPLIT_SIGN}\n\n`);

    // 生成简化的rawText
    const rawText = workbook.SheetNames.map((sheetName: string) => {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet || !worksheet['!ref']) return '';

      const data = processMergedCells(worksheet);
      return data
        .filter(
          (row) =>
            row &&
            row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
        )
        .map((row) =>
          row
            .map((cell) => {
              if (cell === null || cell === undefined) return '';
              const cellStr = String(cell)
                .replace(/[\r\n\t]/g, ' ')
                .trim();
              // 如果包含逗号或引号，用引号包围
              return cellStr.includes(',') || cellStr.includes('"')
                ? `"${cellStr.replace(/"/g, '""')}"`
                : cellStr;
            })
            .join(',')
        )
        .join('\n');
    })
      .filter(Boolean)
      .join('\n');

    return {
      rawText,
      formatText
    };
  } catch (error) {
    console.error('Excel解析出错:', error);
    throw error;
  }
};

export const readXlsxRawText = async (params: ReadRawTextByBuffer): Promise<ReadFileResponse> => {
  // 使用新的支持合并单元格处理的函数
  return readXlsxWithMergedCells(params);
};
