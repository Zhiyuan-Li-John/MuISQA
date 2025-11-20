import { setRedisCache, getRedisCache, delRedisCache } from '../../../common/redis/cache';
import type { InitDataSchemaType } from './schema';

// 缓存 key 前缀
const INIT_DATA_CACHE_PREFIX = 'init_data';

// 缓存时间：1小时
const CACHE_EXPIRE_TIME = 60 * 60;

// 获取缓存 key
const getCacheKey = (key: string) => `${INIT_DATA_CACHE_PREFIX}:${key}`;

/**
 * 设置初始化数据缓存
 */
export const setInitDataCache = async (key: string, data: InitDataSchemaType) => {
  const cacheKey = getCacheKey(key);
  const cacheData = JSON.stringify(data);
  await setRedisCache(cacheKey, cacheData, CACHE_EXPIRE_TIME);
};

/**
 * 获取初始化数据缓存
 */
export const getInitDataCache = async (key: string): Promise<InitDataSchemaType | null> => {
  const cacheKey = getCacheKey(key);
  const cacheData = await getRedisCache(cacheKey);

  if (!cacheData) {
    return null;
  }

  try {
    return JSON.parse(cacheData) as InitDataSchemaType;
  } catch (error) {
    console.error('Parse init data cache error:', error);
    // 如果解析失败，删除缓存
    await delInitDataCache(key);
    return null;
  }
};

/**
 * 删除初始化数据缓存
 */
export const delInitDataCache = async (key: string) => {
  const cacheKey = getCacheKey(key);
  await delRedisCache(cacheKey);
};
