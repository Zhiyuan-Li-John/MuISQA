import { type AuthFrequencyLimitProps } from '@fastgpt/global/common/frequenctLimit/type';
import { POST } from '@fastgpt/service/common/api/plusRequest';

export const authFrequencyLimit = (data: AuthFrequencyLimitProps) => {
  // 取消频率限制检查
  // if (!global.feConfigs.isPlus) return;

  // return POST('/common/freequencyLimit/auth', data);

  // 直接返回，不做任何限制检查
  return Promise.resolve();
};
