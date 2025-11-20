import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';
import { type ApiRequestProps } from '../../type/next';

export function parsePaginationRequest(req: ApiRequestProps) {
  const {
    pageSize = 10,
    pageNum = 1,
    offset = 0,
    page = 1,
    limit = 10
  } = Object.keys(req.body).includes('pageSize') || Object.keys(req.body).includes('limit')
    ? req.body
    : Object.keys(req.query).includes('pageSize') || Object.keys(req.query).includes('limit')
      ? req.query
      : {};

  if (
    req.body.page !== undefined ||
    req.body.limit !== undefined ||
    req.query.page !== undefined ||
    req.query.limit !== undefined
  ) {
    const finalLimit = Number(limit);
    const finalPage = Number(page);

    if (!finalLimit || finalPage < 1) {
      throw new Error(CommonErrEnum.missingParams);
    }

    return {
      pageSize: finalLimit,
      offset: (finalPage - 1) * finalLimit
    };
  }

  if (!pageSize || (pageNum === undefined && offset === undefined)) {
    throw new Error(CommonErrEnum.missingParams);
  }
  return {
    pageSize: Number(pageSize),
    offset: offset ? Number(offset) : (Number(pageNum) - 1) * Number(pageSize)
  };
}
